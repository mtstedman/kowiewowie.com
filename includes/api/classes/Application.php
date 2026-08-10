<?php

declare(strict_types=1);

namespace Wowie\Api;

use PDO;
use Throwable;
use Wowie\Api\Auth\AuthService;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Auth\OAuthService;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

final class Application
{
    private readonly AuthService $auth;
    private readonly OAuthService $oauth;
    private readonly ContentRepository $content;

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
    ) {
        $this->auth = new AuthService($pdo, new JwtService($config), $config);
        $this->oauth = new OAuthService($pdo, $this->auth, $config);
        $this->content = new ContentRepository($pdo);
    }

    public function handle(Request $request): Response
    {
        $requestId = preg_replace('/[^a-zA-Z0-9._-]/', '', $request->header('x-request-id') ?? '') ?: bin2hex(random_bytes(8));
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
                'resources' => ['/v1/recipes', '/v1/magic/decks', '/v1/magic/guides', '/v1/games', '/v1/music'],
            ]);
        }

        if ($request->method === 'GET' && $request->path === '/health') {
            $this->pdo->query('SELECT 1')->fetchColumn();
            return Response::json([
                'status' => 'ok',
                'service' => 'api.wowiekowie.com',
                'database' => 'ok',
                'time' => gmdate(DATE_ATOM),
            ]);
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

    /** @return array{string, ?string, bool}|null */
    private function contentRoute(string $path): ?array
    {
        if (preg_match('#^/v1/magic/(decks|guides)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, true];
        }
        if (preg_match('#^/v1/(recipes|decks|guides|games|music)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, true];
        }
        if (preg_match('#^/(recipes|decks|guides|games|music)(?:/([a-z0-9-]+))?$#', $path, $matches)) {
            return [$matches[1], $matches[2] ?? null, false];
        }

        return null;
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
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers' => 'Authorization, Content-Type, X-Request-ID',
            'Access-Control-Allow-Credentials' => 'true',
            'Access-Control-Max-Age' => '600',
            'Vary' => 'Origin',
        ];
    }
}

