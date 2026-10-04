<?php

declare(strict_types=1);

namespace Wowie\Api;

use PDO;
use Throwable;
use Wowie\Api\Auth\AuthService;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Auth\OAuthService;
use Wowie\Api\Chess\ChessEngine;
use Wowie\Api\Chess\ChessIdentityService;
use Wowie\Api\Chess\ChessRepository;
use Wowie\Api\Collectibles\CollectiblesRepository;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Content\ScryfallClient;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;
use Wowie\Api\Poe2\Poe2BuildRepository;
use Wowie\Api\Poe2\Poe2TreeRepository;
use Wowie\Api\Risk\RiskRepository;
use Wowie\Api\Trivia\TriviaIdentityService;
use Wowie\Api\Trivia\TriviaRepository;

final class Application
{
    private readonly AuthService $auth;
    private readonly OAuthService $oauth;
    private readonly ContentRepository $content;
    private readonly CollectiblesRepository $collectibles;
    private readonly ScryfallClient $scryfall;
    private readonly ChessRepository $chess;
    private readonly ChessIdentityService $chessGuests;
    private readonly TriviaIdentityService $triviaGuests;
    private readonly TriviaRepository $trivia;
    private readonly RiskRepository $risk;
    private readonly Poe2BuildRepository $poe2Builds;
    private readonly Poe2TreeRepository $poe2Tree;
    /** @var array<string, string> */
    private array $chessIdentityResponseHeaders = [];
    /** @var array<string, string> Headers that must survive an auth error response, such as an expired refresh cookie. */
    private array $authResponseHeaders = [];

    private const AUTH_MODE_HEADER = 'x-wowie-auth-mode';
    private const REFRESH_COOKIE_NAME = 'wowie_refresh';
    private const REFRESH_COOKIE_PATH = '/api/v1/auth';

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
    ) {
        $this->auth = new AuthService($pdo, new JwtService($config), $config);
        $this->oauth = new OAuthService($pdo, $this->auth, $config);
        $this->content = new ContentRepository($pdo);
        $this->collectibles = new CollectiblesRepository($pdo);
        $this->scryfall = new ScryfallClient();
        $this->chess = new ChessRepository($pdo, new ChessEngine());
        $this->chessGuests = new ChessIdentityService($pdo);
        $this->triviaGuests = new TriviaIdentityService($pdo);
        $this->trivia = new TriviaRepository($pdo);
        $this->risk = new RiskRepository($pdo);
        $this->poe2Builds = new Poe2BuildRepository($pdo);
        $this->poe2Tree = new Poe2TreeRepository($pdo);
    }

    public function handle(Request $request): Response
    {
        $requestId = preg_replace('/[^a-zA-Z0-9._-]/', '', $request->header('x-request-id') ?? '') ?: bin2hex(random_bytes(8));
        $this->chessIdentityResponseHeaders = [];
        $this->authResponseHeaders = [];
        try {
            $response = $request->method === 'OPTIONS'
                ? Response::empty()
                : $this->dispatch($request);
        } catch (ApiException $error) {
            $payload = [
                'error' => $error->errorCode,
                'message' => $error->getMessage(),
                'request_id' => $requestId,
            ];
            if ($error->details !== []) {
                $payload['details'] = $error->details;
            }
            $response = Response::json($payload, $error->status);
        } catch (Throwable $error) {
            error_log("wowiekowie API request {$requestId} failed: {$error}");
            $payload = [
                'error' => 'internal_error',
                'message' => 'The API could not complete the request.',
                'request_id' => $requestId,
            ];
            if ($this->config->boolean('WOWIE_DEBUG', false)) {
                $payload['details'] = ['exception' => $error->getMessage()];
            }
            $response = Response::json($payload, 500);
        }

        return $response->withHeaders([
            ...$this->corsHeaders($request),
            'X-Request-ID' => $requestId,
            'X-Content-Type-Options' => 'nosniff',
            ...$this->chessIdentityResponseHeaders,
            ...$this->authResponseHeaders,
        ]);
    }

    private function dispatch(Request $request): Response
    {
        if ($request->method === 'GET' && $request->path === '/') {
            return Response::json([
                'name' => 'wowiekowie API',
                'version' => 'v1',
                'status' => 'ready',
                'health' => '/health',
                'authentication' => [
                    'register' => '/v1/auth/register',
                    'login' => '/v1/auth/login',
                    'refresh' => '/v1/auth/refresh',
                    'oauth' => ['/v1/auth/oauth/google/start', '/v1/auth/oauth/github/start'],
                ],
                'resources' => ['/v1/recipes', '/v1/magic/decks', '/v1/magic/guides', '/v1/games', '/v1/music', '/v1/videos', '/v1/collectibles', '/v1/trivia/rooms', '/v1/risk/games', '/v1/poe2/tree', '/v1/poe2/builds'],
            ]);
        }

        if ($request->method === 'GET' && $request->path === '/health') {
            $this->pdo->query('SELECT 1')->fetchColumn();
            return Response::json([
                'status' => 'ok',
                'service' => 'api.wowiekowie.com',
                'database' => 'ok',
                'revision' => $this->config->deploymentRevision(),
                'time' => gmdate(DATE_ATOM),
            ]);
        }

        if ($request->method === 'GET' && $request->path === '/v1/magic/cards/search') {
            $query = trim((string) ($request->query['q'] ?? ''));
            if ($query === '') {
                throw new ApiException(422, 'validation_error', 'q is required.', [
                    'q' => 'Provide a card search query.',
                ]);
            }

            return Response::json($this->scryfall->search($query));
        }

        if ($request->method === 'GET' && $request->path === '/v1/collectibles') {
            $query = trim((string) ($request->query['q'] ?? ''));
            if ($query !== '') {
                $query = preg_match('/^.{0,100}/us', $query, $queryMatch) === 1
                    ? $queryMatch[0]
                    : substr($query, 0, 100);
            }
            $brand = trim((string) ($request->query['brand'] ?? ''));
            if ($brand !== '' && !in_array($brand, ['skullpanda', 'nommi', 'sonny-angel'], true)) {
                throw new ApiException(422, 'validation_error', 'brand must be skullpanda, nommi, or sonny-angel.', [
                    'brand' => 'Use skullpanda, nommi, or sonny-angel.',
                ]);
            }
            $sort = trim((string) ($request->query['sort'] ?? 'name-asc'));
            $sorts = ['name-asc', 'name-desc', 'price-asc', 'price-desc', 'newest', 'oldest'];
            if (!in_array($sort, $sorts, true)) {
                throw new ApiException(422, 'validation_error', 'sort is not supported.', [
                    'sort' => 'Use name-asc, name-desc, price-asc, price-desc, newest, or oldest.',
                ]);
            }
            $year = trim((string) ($request->query['year'] ?? 'all'));
            if ($year === '') $year = 'all';
            if (!in_array($year, ['all', 'unknown'], true) && preg_match('/^(?:19|20)[0-9]{2}$/', $year) !== 1) {
                throw new ApiException(422, 'validation_error', 'year must be all, unknown, or a four-digit year.', [
                    'year' => 'Use all, unknown, or a year such as 2026.',
                ]);
            }
            $series = trim((string) ($request->query['series'] ?? ''));
            if ($series !== '' && preg_match('/^[A-Za-z0-9:._-]{1,200}$/', $series) !== 1) {
                throw new ApiException(422, 'validation_error', 'series is not a valid set id.', [
                    'series' => 'Use a set id from meta.facets.series.',
                ]);
            }
            $limit = max(1, min(100, isset($request->query['limit']) ? (int) $request->query['limit'] : 48));
            $offset = max(0, isset($request->query['offset']) ? (int) $request->query['offset'] : 0);
            $result = $this->collectibles->search(
                $query === '' ? null : $query,
                $brand === '' ? null : $brand,
                $sort,
                $limit,
                $offset,
                $year,
                $series === '' ? null : $series,
            );

            return Response::json([
                'data' => $result['items'],
                'meta' => [
                    'limit' => $limit,
                    'offset' => $offset,
                    'sort' => $sort,
                    'count' => count($result['items']),
                    'total' => $result['total'],
                    'last_synced_at' => $result['last_synced_at'],
                    'year' => $year,
                    'series' => $result['series'],
                    'facets' => $result['facets'],
                ],
            ]);
        }

        if ($request->method === 'POST'
            && in_array($request->path, ['/v1/auth/register', '/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout'], true)
            && $this->isCookieAuthMode($request)
        ) {
            return $this->dispatchBrowserAuth($request);
        }
        if ($request->method === 'POST' && $request->path === '/v1/auth/register') {
            return Response::json($this->auth->register($request->json(), $request->remoteAddress, $request->header('user-agent')), 201);
        }
        if ($request->method === 'POST' && $request->path === '/v1/auth/login') {
            return Response::json($this->auth->login($request->json(), $request->remoteAddress, $request->header('user-agent')));
        }
        if ($request->method === 'POST' && $request->path === '/v1/auth/refresh') {
            $body = $request->json();
            return Response::json($this->auth->refresh((string) ($body['refresh_token'] ?? ''), $request->remoteAddress, $request->header('user-agent')));
        }
        if ($request->method === 'POST' && $request->path === '/v1/auth/logout') {
            $body = $request->json();
            $this->auth->logout((string) ($body['refresh_token'] ?? ''));
            return Response::empty();
        }
        if ($request->method === 'GET' && $request->path === '/v1/auth/me') {
            return Response::json(['user' => $this->auth->authenticatedUser($request->bearerToken())]);
        }

        if ($request->method === 'GET' && preg_match('#^/v1/auth/oauth/(google|github)/start$#', $request->path, $matches)) {
            return Response::json($this->oauth->start($matches[1], $request->query['return_to'] ?? null));
        }
        if ($request->method === 'GET' && preg_match('#^/v1/auth/oauth/(google|github)/callback$#', $request->path, $matches)) {
            if (isset($request->query['error'])) {
                throw new ApiException(400, 'oauth_denied', 'The OAuth provider did not authorize the request.');
            }
            return Response::json($this->oauth->complete(
                $matches[1],
                $request->query['code'] ?? '',
                $request->query['state'] ?? '',
                $request->remoteAddress,
                $request->header('user-agent'),
            ));
        }

        $chessResponse = $this->dispatchChess($request);
        if ($chessResponse !== null) {
            return $chessResponse;
        }

        $triviaResponse = $this->dispatchTrivia($request);
        if ($triviaResponse !== null) {
            return $triviaResponse;
        }

        $riskResponse = $this->dispatchRisk($request);
        if ($riskResponse !== null) {
            return $riskResponse;
        }

        $poe2Response = $this->dispatchPoe2($request);
        if ($poe2Response !== null) {
            return $poe2Response;
        }

        $contentRoute = $this->contentRoute($request->path);
        if ($contentRoute !== null) {
            [$resource, $slug, $isV1] = $contentRoute;
            if ($request->method === 'GET') {
                if ($slug !== null) {
                    $item = $this->content->find($resource, $slug);
                    return Response::json($isV1 ? ['data' => $item] : $item);
                }
                $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 100;
                $offset = isset($request->query['offset']) ? (int) $request->query['offset'] : 0;
                $items = $this->content->list($resource, $limit, $offset);
                return Response::json($isV1 ? [
                    'data' => $items,
                    'meta' => ['limit' => max(1, min(100, $limit)), 'offset' => max(0, $offset), 'count' => count($items)],
                ] : $items);
            }

            if (!$isV1) {
                throw new ApiException(405, 'method_not_allowed', 'Writes are available only through the versioned API.');
            }
            $user = $this->auth->authenticatedUser($request->bearerToken());
            $this->auth->requireAnyRole($user, ['admin', 'editor']);

            if ($request->method === 'POST' && $slug === null) {
                $saved = $this->content->save($resource, $request->json(), (string) $user['id']);
                return Response::json(['data' => $saved['item']], $saved['created'] ? 201 : 200);
            }
            if ($request->method === 'PUT' && $slug !== null) {
                $input = $request->json();
                $input['slug'] = $slug;
                $saved = $this->content->save($resource, $input, (string) $user['id']);
                return Response::json(['data' => $saved['item']], $saved['created'] ? 201 : 200);
            }
            if ($request->method === 'DELETE' && $slug !== null) {
                $this->content->delete($resource, $slug);
                return Response::empty();
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for this resource.');
        }

        throw new ApiException(404, 'not_found', 'The requested API endpoint does not exist.');
    }

    private function dispatchChess(Request $request): ?Response
    {
        if ($request->path === '/v1/chess/leaderboard') {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 25;
                $leaderboard = $this->chess->leaderboard($limit);
                return $this->withChessIdentity(Response::json([
                    'data' => $leaderboard,
                    'meta' => [
                        'limit' => max(1, min(100, $limit)),
                        'count' => count($leaderboard),
                        'king' => $leaderboard[0] ?? null,
                    ],
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for the chess leaderboard.');
        }

        if ($request->path === '/v1/chess/games') {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 100;
                $offset = isset($request->query['offset']) ? (int) $request->query['offset'] : 0;
                $games = $this->chess->listGamesForIdentity($identity, $limit, $offset);
                return $this->withChessIdentity(Response::json([
                    'data' => $games,
                    'meta' => [
                        'limit' => max(1, min(100, $limit)),
                        'offset' => max(0, $offset),
                        'count' => count($games),
                    ],
                ]), $identity);
            }
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->createGame($request->json(), $identity),
                ], 201), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess games.');
        }

        if ($request->path === '/v1/chess/profile') {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                return $this->withChessIdentity(Response::json([
                    'data' => $identity['guest_profile'],
                ]), $identity);
            }
            if ($request->method === 'PATCH') {
                $body = $request->json();
                $displayName = $body['display_name'] ?? null;
                if (!is_string($displayName)) {
                    throw new ApiException(422, 'validation_error', 'display_name must contain between 1 and 40 characters.', [
                        'display_name' => 'Provide a display_name string between 1 and 40 characters.',
                    ]);
                }
                $displayName = trim($displayName);
                if ($displayName === '' || mb_strlen($displayName) > 40) {
                    throw new ApiException(422, 'validation_error', 'display_name must contain between 1 and 40 characters.', [
                        'display_name' => 'Provide a display_name string between 1 and 40 characters.',
                    ]);
                }

                $identity['guest_profile'] = $this->chessGuests->updateDisplayName((string) $identity['guest_profile']['id'], $displayName);
                $this->chess->updateGuestProfileSeatDisplayName((string) $identity['guest_profile']['id'], (string) $identity['guest_profile']['display_name']);
                return $this->withChessIdentity(Response::json([
                    'data' => $identity['guest_profile'],
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for the chess profile.');
        }

        if ($request->method === 'POST' && $request->path === '/v1/chess/links/claim') {
            $identity = $this->resolveChessIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->chess->claimLink((string) ($body['token'] ?? ''), $identity),
            ]), $identity);
        }
        if ($request->method === 'POST' && preg_match('#^/v1/chess/links/([A-Za-z0-9_-]+)/claim$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            return $this->withChessIdentity(Response::json([
                'data' => $this->chess->claimLink($matches[1], $identity),
            ]), $identity);
        }
        if ($request->method === 'POST' && $request->path === '/v1/chess/rejoin') {
            $identity = $this->resolveChessIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->chess->rejoinSeat(
                    (string) ($body['token'] ?? ''),
                    $identity,
                    isset($body['game_id']) ? (string) $body['game_id'] : null,
                ),
            ]), $identity);
        }
        if ($request->method === 'POST' && preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/rejoin$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->chess->rejoinSeat((string) ($body['token'] ?? ''), $identity, $matches[1]),
            ]), $identity);
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->findGame($matches[1], $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for this chess game.');
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/resign$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->resign($matches[1], $request->json(), $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess resignations.');
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/takeback$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->requestTakeback($matches[1], $identity),
                ]), $identity);
            }
            if ($request->method === 'DELETE') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->cancelTakeback($matches[1], $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess takebacks.');
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/moves/promotions$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                $promotions = $this->chess->promotionOptions(
                    $matches[1],
                    (string) ($request->query['from'] ?? ''),
                    (string) ($request->query['to'] ?? ''),
                );
                return $this->withChessIdentity(Response::json([
                    'data' => $promotions,
                    'meta' => ['count' => count($promotions)],
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess promotion options.');
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/moves$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'GET') {
                $moves = $this->chess->moveHistory($matches[1]);
                return $this->withChessIdentity(Response::json([
                    'data' => $moves,
                    'meta' => ['count' => count($moves)],
                ]), $identity);
            }
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->submitMove($matches[1], $request->json(), $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess move history.');
        }

        if (preg_match('#^/v1/chess/games/([A-Fa-f0-9-]{36})/links$#', $request->path, $matches)) {
            $identity = $this->resolveChessIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->chess->createLink($matches[1], $request->json(), $identity),
                ], 201), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for chess invitation links.');
        }

        return null;
    }

    private function dispatchRisk(Request $request): ?Response
    {
        if ($request->path === '/v1/risk/games') {
            if ($request->method !== 'POST') {
                throw new ApiException(405, 'method_not_allowed', 'That method is not supported for Risk games.');
            }
            $identity = $this->resolveChessIdentity($request);
            return $this->withChessIdentity(Response::json([
                'data' => $this->risk->createGame($request->json(), $identity),
            ], 201), $identity);
        }

        if ($request->path === '/v1/risk/links/claim') {
            if ($request->method !== 'POST') {
                throw new ApiException(405, 'method_not_allowed', 'That method is not supported for Risk invitation claims.');
            }
            $identity = $this->resolveChessIdentity($request);
            $body = $request->json();
            $token = $body['token'] ?? null;
            if (!is_string($token)) {
                throw new ApiException(404, 'link_not_found', 'That Risk invitation link does not exist.');
            }
            return $this->withChessIdentity(Response::json([
                'data' => $this->risk->claimLink($token, $identity),
            ]), $identity);
        }

        if (preg_match('#^/v1/risk/games/([^/]+)(?:/(links|start|state))?$#', $request->path, $matches)) {
            $action = $matches[2] ?? '';
            if ($request->method !== ($action === '' ? 'GET' : 'POST')) {
                throw new ApiException(405, 'method_not_allowed', 'That method is not supported for this Risk resource.');
            }
            $identity = $this->resolveChessIdentity($request);
            $publicId = $matches[1];
            if ($action === '') {
                $sinceVersion = null;
                if (isset($request->query['since_version'])) {
                    $sinceVersion = filter_var($request->query['since_version'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
                    if ($sinceVersion === false) {
                        throw new ApiException(422, 'validation_failed', 'since_version must be a nonnegative integer.');
                    }
                }
                $game = $this->risk->findGame($publicId, $identity, $sinceVersion);
            } elseif ($action === 'links') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->risk->createLink($publicId, $identity),
                ], 201), $identity);
            } elseif ($action === 'start') {
                $game = $this->risk->startGame($publicId, $identity);
            } else {
                $game = $this->risk->postState($publicId, $request->json(), $identity);
            }
            return $this->withChessIdentity(Response::json(['data' => $game]), $identity);
        }

        return null;
    }

    private function dispatchTrivia(Request $request): ?Response
    {
        if ($request->path === '/v1/trivia/rooms') {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'GET') {
                $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 100;
                $offset = isset($request->query['offset']) ? (int) $request->query['offset'] : 0;
                $rooms = $this->trivia->listRoomsForIdentity($identity, $limit, $offset);
                return $this->withChessIdentity(Response::json([
                    'data' => $rooms,
                    'meta' => [
                        'limit' => max(1, min(100, $limit)),
                        'offset' => max(0, $offset),
                        'count' => count($rooms),
                    ],
                ]), $identity);
            }
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->createRoom($request->json(), $identity),
                ], 201), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia rooms.');
        }

        if ($request->method === 'POST' && $request->path === '/v1/trivia/links/claim') {
            $identity = $this->resolveTriviaIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->trivia->claimLink((string) ($body['token'] ?? ''), $identity),
            ]), $identity);
        }
        if ($request->method === 'POST' && preg_match('#^/v1/trivia/links/([A-Za-z0-9_-]+)/claim$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            return $this->withChessIdentity(Response::json([
                'data' => $this->trivia->claimLink($matches[1], $identity),
            ]), $identity);
        }
        if ($request->method === 'POST' && $request->path === '/v1/trivia/rejoin') {
            $identity = $this->resolveTriviaIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->trivia->rejoinPlayer(
                    (string) ($body['token'] ?? ''),
                    $identity,
                    isset($body['room_id']) ? (string) $body['room_id'] : null,
                ),
            ]), $identity);
        }
        if ($request->method === 'POST' && preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/rejoin$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            $body = $request->json();
            return $this->withChessIdentity(Response::json([
                'data' => $this->trivia->rejoinPlayer((string) ($body['token'] ?? ''), $identity, $matches[1]),
            ]), $identity);
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/replay$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->replayRoom($matches[1], $request->json(), $identity),
                ], 201), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia room replays.');
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'GET') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->findRoom($matches[1], $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for this trivia room.');
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/links$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->createLink($matches[1], $request->json(), $identity),
                ], 201), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia invitation links.');
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/start$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->startRoom($matches[1], $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia room starts.');
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/rounds/advance$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->advanceRound($matches[1], $request->json(), $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia rounds.');
        }

        if (preg_match('#^/v1/trivia/rooms/([A-Fa-f0-9-]{36})/answers$#', $request->path, $matches)) {
            $identity = $this->resolveTriviaIdentity($request);
            if ($request->method === 'POST') {
                return $this->withChessIdentity(Response::json([
                    'data' => $this->trivia->submitAnswer($matches[1], $request->json(), $identity),
                ]), $identity);
            }
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for trivia answers.');
        }

        return null;
    }

    /** @return array<string, mixed>|null */
    private function optionalAuthenticatedUser(Request $request): ?array
    {
        if ($request->header('authorization') === null) {
            return null;
        }

        return $this->auth->authenticatedUser($request->bearerToken());
    }

    /** @return array<string, mixed> */
    private function resolveChessIdentity(Request $request): array
    {
        $identity = $this->chessGuests->resolve($this->optionalAuthenticatedUser($request));
        $headers = $identity['response_headers'] ?? [];
        $this->chessIdentityResponseHeaders = is_array($headers) ? $headers : [];

        return $identity;
    }

    /** @return array<string, mixed> */
    private function resolveTriviaIdentity(Request $request): array
    {
        $identity = $this->triviaGuests->resolve($this->optionalAuthenticatedUser($request));
        $headers = $identity['response_headers'] ?? [];
        $this->chessIdentityResponseHeaders = is_array($headers) ? $headers : [];

        return $identity;
    }

    /**
     * @param array<string, mixed> $identity
     */
    private function withChessIdentity(Response $response, array $identity): Response
    {
        $headers = $identity['response_headers'] ?? [];

        return is_array($headers) && $headers !== []
            ? $response->withHeaders($headers)
            : $response;
    }

    /** @return array{string, ?string, bool}|null */
    private function contentRoute(string $path): ?array
    {
        if (preg_match('#^/v1/magic/(decks|guides)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, true];
        }
        if (preg_match('#^/v1/(recipes|decks|guides|games|music|videos)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, true];
        }
        if (preg_match('#^/(recipes|decks|guides|games|music|videos)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, false];
        }

        return null;
    }

    /**
     * Saved PoE 2 builds (shared contract poe2-builds-api). A build belongs to the logged-in
     * user when there is one, and to the guest cookie profile otherwise.
     */
    private function dispatchPoe2(Request $request): ?Response
    {
        if ($request->path === '/v1/poe2/tree') {
            return $this->poe2TreeResponse($request);
        }

        $isCollection = $request->path === '/v1/poe2/builds';
        $buildId = null;
        if (!$isCollection) {
            if (preg_match('#^/v1/poe2/builds/([A-Fa-f0-9-]{36})$#', $request->path, $matches) !== 1) {
                return null;
            }
            $buildId = $matches[1];
        }

        if (!in_array($request->method, $isCollection ? ['GET', 'POST'] : ['GET', 'PUT', 'DELETE'], true)) {
            throw new ApiException(405, 'method_not_allowed', $isCollection
                ? 'That method is not supported for PoE 2 builds.'
                : 'That method is not supported for this PoE 2 build.');
        }
        if ($request->method !== 'GET') {
            // Checked before the owner is resolved so a rejected request never touches data.
            $this->requirePoe2WriteOrigin($request);
        }

        $identity = $this->resolvePoe2Identity($request);
        $owner = $identity['owner'];

        if ($isCollection) {
            if ($request->method === 'GET') {
                $adoption = $this->adoptGuestPoe2Builds($owner);
                $builds = $this->poe2Builds->listForOwner($owner);
                return $this->withChessIdentity(Response::json([
                    'data' => $builds,
                    'meta' => [
                        'count' => count($builds),
                        'limit' => Poe2BuildRepository::MAX_BUILDS_PER_OWNER,
                        'owner' => $owner['type'],
                    ] + ($adoption === null ? [] : [
                        'adopted_from_guest' => $adoption['adopted'],
                        'guest_builds_remaining' => $adoption['remaining'],
                    ]),
                ]), $identity);
            }

            return $this->withChessIdentity(Response::json([
                'data' => $this->poe2Builds->create($owner, $this->poe2WriteInput($request)),
            ], 201), $identity);
        }

        if ($request->method === 'GET') {
            return $this->withChessIdentity(Response::json([
                'data' => $this->poe2Builds->find($owner, $buildId),
            ]), $identity);
        }
        if ($request->method === 'PUT') {
            return $this->withChessIdentity(Response::json([
                'data' => $this->poe2Builds->update($owner, $buildId, $this->poe2WriteInput($request)),
            ]), $identity);
        }

        $this->poe2Builds->delete($owner, $buildId);
        return $this->withChessIdentity(Response::empty(), $identity);
    }

    /**
     * The current imported passive tree (shared contract poe2-tree-model). Browsers revalidate
     * on every load and receive 304 while the imported version is unchanged.
     */
    private function poe2TreeResponse(Request $request): Response
    {
        if ($request->method !== 'GET') {
            throw new ApiException(405, 'method_not_allowed', 'That method is not supported for the PoE 2 passive tree.');
        }
        $version = $this->poe2Tree->current();
        if ($version === null) {
            throw new ApiException(503, 'poe2_tree_unavailable', 'The passive tree has not been imported yet.');
        }

        $etag = $this->poe2Tree->etag($version);
        $headers = ['ETag' => $etag, 'Cache-Control' => 'no-cache'];
        // nginx weakens the ETag of a gzipped response, so compare weakly.
        foreach (explode(',', $request->header('if-none-match') ?? '') as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || preg_replace('#^W/#', '', $candidate) === $etag) {
                return Response::empty(304, $headers);
            }
        }

        return Response::json(['data' => $this->poe2Tree->payload($version)], 200, $headers);
    }

    /**
     * Body of a PoE 2 build write with the node id fields kept at their wire-level type.
     *
     * Request::json() decodes JSON objects and JSON arrays to the same PHP array type, so a
     * numeric-key object such as {"0":"a"} is indistinguishable from the array ["a"]. The
     * body is decoded a second time without that collapse and the two id fields are taken
     * from it: a JSON array stays a PHP list, while a JSON object stays a stdClass that the
     * repository rejects as a non-array. Every other field, and every invalid_json outcome,
     * still comes from Request::json().
     *
     * @return array<string, mixed>
     */
    private function poe2WriteInput(Request $request): array
    {
        $input = $request->json();
        if ($input === []) {
            return $input;
        }

        // Request keeps the raw body private and exposes only the collapsed json() view.
        $rawBody = (new \ReflectionProperty(Request::class, 'rawBody'))->getValue($request);

        try {
            $wire = json_decode((string) $rawBody, false, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new ApiException(400, 'invalid_json', 'The request body must contain valid JSON.', [
                'reason' => $error->getMessage(),
            ]);
        }
        if (!$wire instanceof \stdClass) {
            throw new ApiException(400, 'invalid_json', 'The request body must be a JSON object.');
        }

        $wireFields = get_object_vars($wire);
        foreach (['allocated_node_ids', 'must_have_node_ids', 'considered_node_ids'] as $field) {
            if (array_key_exists($field, $wireFields)) {
                $input[$field] = $wireFields[$field];
            }
        }

        return $input;
    }

    /**
     * Resolves who owns the PoE 2 builds for this request. A logged-in user (Bearer token or
     * site login session) never mints a guest profile; everyone else is the guest cookie profile.
     *
     * @return array{owner: array{type: string, id: string}, response_headers: array<string, string>}
     */
    /**
     * Builds saved as a guest follow the visitor into their account: the first build list after
     * signing in moves them off the guest cookie's profile. Null when there was nothing to move.
     *
     * @param array{type: string, id: string} $owner
     * @return array{adopted: int, remaining: int}|null
     */
    private function adoptGuestPoe2Builds(array $owner): ?array
    {
        if ($owner['type'] !== 'user') {
            return null;
        }
        $guestProfileId = $this->chessGuests->existingGuestProfileId();
        if ($guestProfileId === null) {
            return null;
        }
        $adoption = $this->poe2Builds->adoptGuestBuilds($guestProfileId, $owner['id']);

        return $adoption['adopted'] === 0 && $adoption['remaining'] === 0 ? null : $adoption;
    }

    private function resolvePoe2Identity(Request $request): array
    {
        // A malformed or invalid Authorization header still fails with 401 here.
        $user = $this->optionalAuthenticatedUser($request) ?? $this->siteSessionUser();
        if ($user !== null) {
            return [
                'owner' => ['type' => 'user', 'id' => (string) $user['id']],
                'response_headers' => [],
            ];
        }

        $identity = $this->chessGuests->resolve(null);
        $headers = $identity['response_headers'] ?? [];
        $headers = is_array($headers) ? $headers : [];
        // Stored on the application so the guest cookie also reaches error responses.
        $this->chessIdentityResponseHeaders = $headers;

        return [
            'owner' => ['type' => 'guest', 'id' => (string) $identity['guest_profile']['id']],
            'response_headers' => $headers,
        ];
    }

    /**
     * Reads the site login session without ever creating or writing one. The session is only
     * opened when its cookie was sent, and the lock is released as soon as it has been read.
     * Anything short of a confirmed active user returns null so the caller falls back to guest.
     */
    private function siteSessionUser(): ?array
    {
        if (session_status() === PHP_SESSION_DISABLED) {
            return null;
        }

        $sessionName = session_name();
        $sessionId = is_string($sessionName) && $sessionName !== '' ? ($_COOKIE[$sessionName] ?? null) : null;
        if (!is_string($sessionId) || preg_match('/\A[A-Za-z0-9,-]{1,256}\z/', $sessionId) !== 1) {
            return null;
        }

        if (session_status() !== PHP_SESSION_ACTIVE) {
            if (headers_sent() || !session_start(['read_and_close' => true])) {
                return null;
            }
        }

        $sessionUser = $_SESSION['admin_user'] ?? $_SESSION['user'] ?? null;
        $userId = is_array($sessionUser) ? ($sessionUser['id'] ?? null) : null;
        if (!is_string($userId)
            || preg_match('/\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z/', $userId) !== 1
        ) {
            return null;
        }

        try {
            return $this->auth->userById($userId);
        } catch (ApiException) {
            return null;
        }
    }

    /**
     * Build writes are authorised by cookies, so a browser-sent Origin must be this site itself
     * or an origin from the same WOWIE_CORS_ORIGINS allow-list that corsHeaders() uses.
     */
    private function requirePoe2WriteOrigin(Request $request): void
    {
        $origin = $request->header('origin');
        if ($origin === null) {
            return;
        }

        $origin = trim($origin);
        $allowed = $this->config->csv('WOWIE_CORS_ORIGINS', [
            'https://wowiekowie.com',
            'https://www.wowiekowie.com',
        ]);
        if (in_array($origin, $allowed, true)) {
            return;
        }

        $host = trim($request->header('host') ?? '');
        if ($host !== '') {
            $forwardedProto = strtolower(trim(explode(',', $request->header('x-forwarded-proto') ?? '')[0]));
            $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwardedProto === 'https';
            if (strtolower($origin) === strtolower(($isHttps ? 'https' : 'http') . '://' . $host)) {
                return;
            }
        }

        throw new ApiException(403, 'origin_not_allowed', 'PoE 2 build changes must come from this site or an allowed origin.');
    }

    private function isCookieAuthMode(Request $request): bool
    {
        return strtolower(trim($request->header(self::AUTH_MODE_HEADER) ?? '')) === 'cookie';
    }

    /**
     * Public browser sessions (shared contract public-browser-auth): the refresh token
     * travels only in the host-only HttpOnly wowie_refresh cookie, never in JSON.
     */
    private function dispatchBrowserAuth(Request $request): Response
    {
        $this->requireTrustedBrowserOrigin($request);

        $ip = $request->remoteAddress;
        $userAgent = $request->header('user-agent');

        if ($request->path === '/v1/auth/register') {
            return $this->browserSessionResponse($this->auth->register($request->json(), $ip, $userAgent), 201);
        }
        if ($request->path === '/v1/auth/login') {
            return $this->browserSessionResponse($this->auth->login($request->json(), $ip, $userAgent), 200);
        }
        if ($request->path === '/v1/auth/refresh') {
            try {
                $payload = $this->auth->refresh($this->refreshCookie($request), $ip, $userAgent);
            } catch (ApiException $error) {
                // Terminal authentication failures (missing, invalid, expired, revoked,
                // reused token or inactive account) clear the browser cookie. Transient
                // server failures leave it untouched and surface as errors.
                if ($error->status === 401 || $error->status === 403) {
                    $this->authResponseHeaders = ['Set-Cookie' => $this->expiredRefreshCookie()];
                }
                throw $error;
            }

            return $this->browserSessionResponse($payload, 200);
        }

        // POST /v1/auth/logout: revoke first; only expire the cookie once revocation succeeded.
        $this->auth->logout($this->refreshCookie($request));

        return Response::empty(204, [
            'Set-Cookie' => $this->expiredRefreshCookie(),
            'Cache-Control' => 'no-store',
        ]);
    }

    private function requireTrustedBrowserOrigin(Request $request): void
    {
        $origin = trim($request->header('origin') ?? '');
        // Cookie mode is opt-in: only origins explicitly listed in WOWIE_CORS_ORIGINS qualify.
        $allowed = $this->config->csv('WOWIE_CORS_ORIGINS');
        if ($origin === '' || strtolower($origin) === 'null' || !in_array($origin, $allowed, true)) {
            throw new ApiException(403, 'origin_not_allowed', 'Browser session requests must come from an allowed origin.');
        }
    }

    private function browserSessionResponse(array $payload, int $status): Response
    {
        $refreshToken = (string) ($payload['refresh_token'] ?? '');
        $lifetime = max(0, (int) ($payload['refresh_expires_in'] ?? 0));
        unset($payload['refresh_token']);
        if ($refreshToken === '' || $lifetime === 0) {
            throw new \RuntimeException('Browser session could not be established: refresh credential missing.');
        }
        $payload['user'] = $this->browserSessionUser($payload['user'] ?? null);

        return Response::json($payload, $status, [
            'Set-Cookie' => $this->refreshCookieHeader($refreshToken, $lifetime),
        ]);
    }

    /**
     * Normalizes the cookie-mode user to the public-browser-auth shape:
     * id, email, display_name, roles, status, email_verified_at, created_at.
     */
    private function browserSessionUser(mixed $user): array
    {
        if (!is_array($user) || (string) ($user['id'] ?? '') === '') {
            throw new \RuntimeException('Browser session could not be established: user record missing.');
        }

        $statement = $this->pdo->prepare('SELECT email_verified_at FROM users WHERE id = :id');
        $statement->execute(['id' => (string) $user['id']]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row) || !array_key_exists('email_verified_at', $row)) {
            throw new \RuntimeException('Browser session could not be established: user record could not be loaded.');
        }
        $verifiedAt = $row['email_verified_at'];

        $roles = $user['roles'] ?? [];

        return [
            'id' => (string) $user['id'],
            'email' => (string) ($user['email'] ?? ''),
            'display_name' => (string) ($user['display_name'] ?? ''),
            'roles' => is_array($roles) ? array_values(array_map('strval', $roles)) : [],
            'status' => (string) ($user['status'] ?? ''),
            'email_verified_at' => $verifiedAt === null ? null : (string) $verifiedAt,
            'created_at' => (string) ($user['created_at'] ?? ''),
        ];
    }

    private function refreshCookie(Request $request): string
    {
        $cookieHeader = $request->header('cookie') ?? '';
        foreach (explode(';', $cookieHeader) as $pair) {
            $parts = explode('=', trim($pair), 2);
            if (count($parts) !== 2 || trim($parts[0]) !== self::REFRESH_COOKIE_NAME) {
                continue;
            }
            $value = trim($parts[1]);

            return preg_match('/^[A-Za-z0-9_-]{1,512}$/', $value) === 1 ? $value : '';
        }

        return '';
    }

    private function refreshCookieHeader(string $token, int $lifetime): string
    {
        return sprintf(
            '%s=%s; Max-Age=%d; Expires=%s; Path=%s; HttpOnly; Secure; SameSite=Lax',
            self::REFRESH_COOKIE_NAME,
            $token,
            $lifetime,
            gmdate('D, d M Y H:i:s \G\M\T', time() + $lifetime),
            self::REFRESH_COOKIE_PATH,
        );
    }

    private function expiredRefreshCookie(): string
    {
        return sprintf(
            '%s=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=%s; HttpOnly; Secure; SameSite=Lax',
            self::REFRESH_COOKIE_NAME,
            self::REFRESH_COOKIE_PATH,
        );
    }

    /** @return array<string, string> */
    private function corsHeaders(Request $request): array
    {
        $origin = $request->header('origin');
        $allowed = $this->config->csv('WOWIE_CORS_ORIGINS', [
            'https://wowiekowie.com',
            'https://www.wowiekowie.com',
        ]);
        if ($origin === null || !in_array($origin, $allowed, true)) {
            return [];
        }

        return [
            'Access-Control-Allow-Origin' => $origin,
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers' => 'Authorization, Content-Type, X-Request-ID',
            'Access-Control-Allow-Credentials' => 'true',
            'Access-Control-Max-Age' => '600',
            'Vary' => 'Origin',
        ];
    }
}
