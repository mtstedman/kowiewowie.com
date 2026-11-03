<?php

declare(strict_types=1);

namespace Wowie\Api\Stratego;

use PDO;
use Throwable;
use Wowie\Api\ApiException;

/**
 * Persistence and seat/turn authority for Stratego games.
 *
 * Every response is built through gameJson(), which only ever serialises the
 * stored state after StrategoEngine::presentForViewer() has hidden whatever
 * the resolved viewer is not allowed to see.
 */
final class StrategoRepository
{
    private const INVITE_TTL_SECONDS = 30 * 86400;
    private const UUID_PATTERN = '/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i';

    public function __construct(
        private readonly PDO $pdo,
        private readonly StrategoEngine $engine,
    ) {
    }

    /** @return array<string, mixed> */
    public function createGame(array $input, array $identity): array
    {
        $requested = $input['creator_color'] ?? 'random';
        if (!is_string($requested) || !in_array($requested, ['red', 'blue', 'random'], true)) {
            throw new ApiException(422, 'validation_failed', 'creator_color must be red, blue or random.');
        }
        $creatorColor = $requested === 'random'
            ? (random_int(0, 1) === 0 ? StrategoEngine::RED : StrategoEngine::BLUE)
            : $requested;
        $opponentColor = StrategoEngine::opponent($creatorColor);
        $actor = $this->seatActor($identity);
        $encoded = $this->encodeState($this->engine->initialState());

        return $this->transaction(function () use ($creatorColor, $opponentColor, $actor, $encoded, $identity): array {
            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO stratego_games (status, state, state_version)
                VALUES ('waiting', CAST(:state AS jsonb), 0)
                RETURNING *
            SQL);
            $statement->execute(['state' => $encoded]);
            $game = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($game)) {
                throw new \RuntimeException('The Stratego game could not be created.');
            }
            $gameId = (string) $game['id'];

            $creatorSeatId = $this->insertPlayer($gameId, $creatorColor, $actor);
            $this->insertPlayer($gameId, $opponentColor, [
                'user_id' => null,
                'guest_profile_id' => null,
                'display_name' => '',
            ]);
            $link = $this->createStoredLink($gameId, $opponentColor, $creatorSeatId);

            $result = $this->gameJson($game, $this->loadPlayers($gameId), $identity);
            $result['invite_link'] = $link;

            return $result;
        });
    }

    /** @return list<array<string, mixed>> */
    public function listGamesForIdentity(array $identity, int $limit = 100): array
    {
        $limit = max(1, min(100, $limit));
        $userId = isset($identity['user']['id']) ? (string) $identity['user']['id'] : null;
        $guestId = isset($identity['guest_profile']['id']) ? (string) $identity['guest_profile']['id'] : null;
        if ($userId === null && $guestId === null) {
            return [];
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT g.*
            FROM stratego_games g
            WHERE EXISTS (
                SELECT 1
                FROM stratego_game_players gp
                WHERE gp.game_id = g.id
                  AND (gp.user_id = :user_id OR gp.guest_profile_id = :guest_profile_id)
            )
            ORDER BY g.created_at DESC, g.id DESC
            LIMIT :limit
        SQL);
        $statement->bindValue(':user_id', $userId, $userId === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':guest_profile_id', $guestId, $guestId === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();
        $games = $statement->fetchAll(PDO::FETCH_ASSOC);
        if ($games === []) {
            return [];
        }

        $gameIds = array_map(static fn (array $game): string => (string) $game['id'], $games);
        $playersStatement = $this->pdo->prepare(<<<'SQL'
            SELECT *
            FROM stratego_game_players
            WHERE game_id = ANY(CAST(:game_ids AS bigint[]))
            ORDER BY game_id, CASE color WHEN 'red' THEN 0 ELSE 1 END
        SQL);
        $playersStatement->execute(['game_ids' => '{' . implode(',', array_map('intval', $gameIds)) . '}']);
        $playersByGame = [];
        foreach ($playersStatement->fetchAll(PDO::FETCH_ASSOC) as $player) {
            $playersByGame[(string) $player['game_id']][] = $player;
        }

        $result = [];
        foreach ($games as $game) {
            $result[] = $this->gameJson($game, $playersByGame[(string) $game['id']] ?? [], $identity);
        }

        return $result;
    }

    /** @return array<string, mixed> */
    public function findGame(string $publicId, array $identity, ?int $sinceVersion = null): array
    {
        $game = $this->loadGame($publicId);

        return $this->gameJson($game, $this->loadPlayers((string) $game['id']), $identity, $sinceVersion);
    }

    /** @return array{url: string, token: string, expires_at: string|null} */
    public function createLink(string $publicId, array $identity): array
    {
        return $this->transaction(function () use ($publicId, $identity): array {
            $game = $this->loadGame($publicId, true);
            $gameId = (string) $game['id'];
            $players = $this->loadPlayers($gameId, true);
            $seat = $this->ownedSeat($players, $identity);
            if ($seat === null) {
                throw new ApiException(403, 'seat_required', 'Only the player who created this Stratego game may invite an opponent.');
            }
            if ((string) $game['status'] !== 'waiting') {
                throw new ApiException(409, 'game_not_waiting', 'Only a Stratego game that is waiting for an opponent accepts new invitations.');
            }
            $opponentColor = StrategoEngine::opponent((string) $seat['color']);
            $opponentSeat = $this->seatByColor($players, $opponentColor);
            if ($opponentSeat === null || $this->seatHasIdentity($opponentSeat)) {
                throw new ApiException(409, 'seat_unavailable', 'That Stratego game no longer has an open seat.');
            }

            return $this->createStoredLink($gameId, $opponentColor, (string) $seat['id']);
        });
    }

    /** @return array<string, mixed> */
    public function claimLink(string $rawToken, array $identity): array
    {
        $rawToken = trim($rawToken);
        if ($rawToken === '' || strlen($rawToken) > 512) {
            throw new ApiException(404, 'link_not_found', 'That Stratego invitation link does not exist.');
        }
        $actor = $this->seatActor($identity);

        return $this->transaction(function () use ($rawToken, $actor, $identity): array {
            $statement = $this->pdo->prepare(<<<'SQL'
                SELECT
                    l.id AS link_id,
                    l.seat_color,
                    l.claimed_by_player_id,
                    l.claimed_at,
                    l.expires_at,
                    l.revoked_at,
                    g.id AS game_id,
                    g.status
                FROM stratego_game_links l
                JOIN stratego_games g ON g.id = l.game_id
                WHERE l.token_hash = :token_hash
                  AND l.link_type = 'play'
                LIMIT 1
                FOR UPDATE OF l, g
            SQL);
            $statement->execute(['token_hash' => hash('sha256', $rawToken)]);
            $link = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($link) || $link['revoked_at'] !== null) {
                throw new ApiException(404, 'link_not_found', 'That Stratego invitation link does not exist.');
            }
            if ($link['claimed_at'] !== null || $link['claimed_by_player_id'] !== null) {
                throw new ApiException(409, 'link_claimed', 'That Stratego invitation link has already been claimed.');
            }
            if ($link['expires_at'] !== null && strtotime((string) $link['expires_at']) <= time()) {
                throw new ApiException(409, 'link_expired', 'That Stratego invitation link has expired.');
            }

            $gameId = (string) $link['game_id'];
            $players = $this->loadPlayers($gameId, true);
            if ($this->ownedSeat($players, $identity) !== null) {
                throw new ApiException(409, 'already_seated', 'You already have a seat in this Stratego game.');
            }
            if ((string) $link['status'] !== 'waiting') {
                throw new ApiException(409, 'seat_unavailable', 'That Stratego game is no longer accepting an opponent.');
            }

            $seat = $link['seat_color'] !== null
                ? $this->seatByColor($players, (string) $link['seat_color'])
                : $this->firstEmptySeat($players);
            if ($seat === null || $this->seatHasIdentity($seat)) {
                throw new ApiException(409, 'seat_unavailable', 'That Stratego seat has already been taken.');
            }

            $seatStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE stratego_game_players
                SET user_id = :user_id,
                    guest_profile_id = :guest_profile_id,
                    display_name = :display_name
                WHERE id = :id
                  AND game_id = :game_id
                  AND user_id IS NULL
                  AND guest_profile_id IS NULL
            SQL);
            $seatStatement->execute([
                'user_id' => $actor['user_id'],
                'guest_profile_id' => $actor['guest_profile_id'],
                'display_name' => $actor['display_name'],
                'id' => $seat['id'],
                'game_id' => $gameId,
            ]);
            if ($seatStatement->rowCount() !== 1) {
                throw new ApiException(409, 'seat_unavailable', 'That Stratego seat has already been taken.');
            }

            $claimStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE stratego_game_links
                SET claimed_by_player_id = :player_id,
                    claimed_at = now()
                WHERE id = :id
            SQL);
            $claimStatement->execute(['player_id' => $seat['id'], 'id' => $link['link_id']]);

            $gameStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE stratego_games
                SET status = 'setup',
                    state_version = state_version + 1,
                    updated_at = now()
                WHERE id = :id
                RETURNING *
            SQL);
            $gameStatement->execute(['id' => $gameId]);
            $game = $gameStatement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($game)) {
                throw new ApiException(404, 'game_not_found', 'That Stratego game does not exist.');
            }

            return $this->gameJson($game, $this->loadPlayers($gameId), $identity);
        });
    }

    /** @return array<string, mixed> */
    public function submitSetup(string $publicId, array $input, array $identity): array
    {
        $placements = $input['placements'] ?? null;
        if (!is_array($placements) || !array_is_list($placements)) {
            throw new ApiException(422, 'validation_failed', 'placements must be an array of {square, rank} objects.');
        }

        return $this->transaction(function () use ($publicId, $placements, $identity): array {
            [$game, $players, $seat] = $this->lockForSeat($publicId, $identity);
            if ((string) $game['status'] !== 'setup') {
                throw new ApiException(409, 'game_not_active', 'Setup is only allowed while the Stratego game is in setup.');
            }
            if ($this->isTrue($seat['is_ready'])) {
                throw new ApiException(409, 'game_not_active', 'Your setup is locked because you are already ready.');
            }
            $state = $this->ruled(fn (): array => $this->engine->applySetup(
                $this->decodeState($game),
                (string) $seat['color'],
                $placements,
            ));

            return $this->gameJson($this->persistState($game, $state), $players, $identity);
        });
    }

    /** @return array<string, mixed> */
    public function markReady(string $publicId, array $identity): array
    {
        return $this->transaction(function () use ($publicId, $identity): array {
            [$game, $players, $seat] = $this->lockForSeat($publicId, $identity);
            if ((string) $game['status'] !== 'setup') {
                throw new ApiException(409, 'game_not_active', 'Ready is only allowed while the Stratego game is in setup.');
            }
            $state = $this->ruled(fn (): array => $this->engine->setReady($this->decodeState($game), (string) $seat['color']));

            $readyStatement = $this->pdo->prepare('UPDATE stratego_game_players SET is_ready = true WHERE id = :id');
            $readyStatement->execute(['id' => $seat['id']]);
            $updated = $this->persistState($game, $state);

            return $this->gameJson($updated, $this->loadPlayers((string) $game['id']), $identity);
        });
    }

    /** @return array<string, mixed> */
    public function submitMove(string $publicId, array $input, array $identity): array
    {
        $from = $input['from'] ?? null;
        $to = $input['to'] ?? null;
        if (!is_string($from) || !is_string($to) || $from === '' || $to === '' || strlen($from) > 8 || strlen($to) > 8) {
            throw new ApiException(422, 'validation_failed', 'from and to must be board squares such as a1 or j10.');
        }
        $expectedVersion = $input['expected_version'] ?? null;
        if ($expectedVersion !== null && (!is_int($expectedVersion) || $expectedVersion < 0)) {
            throw new ApiException(422, 'validation_failed', 'expected_version must be a nonnegative integer.');
        }

        return $this->transaction(function () use ($publicId, $from, $to, $expectedVersion, $identity): array {
            [$game, $players, $seat] = $this->lockForSeat($publicId, $identity);
            if ((string) $game['status'] !== 'active') {
                throw new ApiException(409, 'game_not_active', 'Moves are only allowed while the Stratego game is active.');
            }
            if ($expectedVersion !== null && $expectedVersion !== (int) $game['state_version']) {
                throw new ApiException(409, 'state_conflict', 'The Stratego game state has changed.');
            }
            $state = $this->ruled(fn (): array => $this->engine->applyMove(
                $this->decodeState($game),
                (string) $seat['color'],
                $from,
                $to,
            ));

            return $this->gameJson($this->persistState($game, $state), $players, $identity);
        });
    }

    /** @return array<string, mixed> */
    public function resign(string $publicId, array $identity): array
    {
        return $this->transaction(function () use ($publicId, $identity): array {
            [$game, $players, $seat] = $this->lockForSeat($publicId, $identity);
            if (!in_array((string) $game['status'], ['setup', 'active'], true)) {
                throw new ApiException(409, 'game_not_active', 'Only a Stratego game in setup or play can be resigned.');
            }
            $state = $this->ruled(fn (): array => $this->engine->resign($this->decodeState($game), (string) $seat['color']));

            return $this->gameJson($this->persistState($game, $state), $players, $identity);
        });
    }

    /**
     * Locks the game and its seats, then resolves the caller's seat from the
     * server-side identity only.
     *
     * @return array{0: array<string, mixed>, 1: list<array<string, mixed>>, 2: array<string, mixed>}
     */
    private function lockForSeat(string $publicId, array $identity): array
    {
        $game = $this->loadGame($publicId, true);
        $players = $this->loadPlayers((string) $game['id'], true);
        $seat = $this->ownedSeat($players, $identity);
        if ($seat === null) {
            throw new ApiException(403, 'seat_required', 'A seat in this Stratego game is required.');
        }

        return [$game, $players, $seat];
    }

    /**
     * @param callable(): array<string, mixed> $operation
     * @return array<string, mixed>
     */
    private function ruled(callable $operation): array
    {
        try {
            return $operation();
        } catch (StrategoRuleException $error) {
            throw match ($error->ruleCode()) {
                'not_your_turn' => new ApiException(409, 'not_your_turn', $error->getMessage()),
                'wrong_phase' => new ApiException(409, 'game_not_active', $error->getMessage()),
                default => new ApiException(422, 'illegal_move', $error->getMessage(), ['rule' => $error->ruleCode()]),
            };
        }
    }

    /** @return array<string, mixed> */
    private function persistState(array $game, array $state): array
    {
        $phase = (string) ($state['phase'] ?? StrategoEngine::PHASE_SETUP);
        $status = match ($phase) {
            StrategoEngine::PHASE_ACTIVE => 'active',
            StrategoEngine::PHASE_FINISHED => 'finished',
            default => 'setup',
        };
        $winner = $state['winner'] ?? null;
        $winner = in_array($winner, [StrategoEngine::RED, StrategoEngine::BLUE], true) ? $winner : null;
        $finished = $status === 'finished';

        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE stratego_games
            SET state = CAST(:state AS jsonb),
                state_version = state_version + 1,
                status = :status,
                winner_color = :winner_color,
                finished_at = CASE WHEN CAST(:finished AS integer) = 1 THEN COALESCE(finished_at, now()) ELSE finished_at END,
                updated_at = now()
            WHERE id = :id
            RETURNING *
        SQL);
        $statement->execute([
            'state' => $this->encodeState($state),
            'status' => $status,
            'winner_color' => $finished ? $winner : null,
            'finished' => $finished ? 1 : 0,
            'id' => $game['id'],
        ]);
        $updated = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($updated)) {
            throw new \RuntimeException('The Stratego game state could not be saved.');
        }

        return $updated;
    }

    /**
     * @param callable(): array<mixed> $operation
     * @return array<mixed>
     */
    private function transaction(callable $operation): array
    {
        $this->pdo->beginTransaction();
        try {
            $result = $operation();
            $this->pdo->commit();
            return $result;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    /** @return array<string, mixed> */
    private function loadGame(string $publicId, bool $lock = false): array
    {
        if (preg_match(self::UUID_PATTERN, $publicId) !== 1) {
            throw new ApiException(404, 'game_not_found', 'That Stratego game does not exist.');
        }
        $statement = $this->pdo->prepare($lock
            ? 'SELECT * FROM stratego_games WHERE public_id = :public_id FOR UPDATE'
            : 'SELECT * FROM stratego_games WHERE public_id = :public_id');
        $statement->execute(['public_id' => $publicId]);
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($game)) {
            throw new ApiException(404, 'game_not_found', 'That Stratego game does not exist.');
        }

        return $game;
    }

    /** @return list<array<string, mixed>> */
    private function loadPlayers(string $gameId, bool $lock = false): array
    {
        $statement = $this->pdo->prepare($lock
            ? "SELECT * FROM stratego_game_players WHERE game_id = :game_id ORDER BY CASE color WHEN 'red' THEN 0 ELSE 1 END FOR UPDATE"
            : "SELECT * FROM stratego_game_players WHERE game_id = :game_id ORDER BY CASE color WHEN 'red' THEN 0 ELSE 1 END");
        $statement->execute(['game_id' => $gameId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    /** @param array{user_id: string|null, guest_profile_id: string|null, display_name: string} $actor */
    private function insertPlayer(string $gameId, string $color, array $actor): string
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO stratego_game_players (game_id, color, user_id, guest_profile_id, display_name)
            VALUES (:game_id, :color, :user_id, :guest_profile_id, :display_name)
            RETURNING id
        SQL);
        $statement->execute([
            'game_id' => $gameId,
            'color' => $color,
            'user_id' => $actor['user_id'],
            'guest_profile_id' => $actor['guest_profile_id'],
            'display_name' => $actor['display_name'],
        ]);

        return (string) $statement->fetchColumn();
    }

    /**
     * Stores only the SHA-256 hash of a fresh random token; the raw token is
     * returned once to the creator.
     *
     * @return array{url: string, token: string, expires_at: string|null}
     */
    private function createStoredLink(string $gameId, string $seatColor, string $creatorPlayerId): array
    {
        $rawToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO stratego_game_links (game_id, token_hash, link_type, seat_color, created_by_player_id, expires_at)
            VALUES (:game_id, :token_hash, 'play', :seat_color, :created_by_player_id, :expires_at)
            RETURNING expires_at
        SQL);
        $statement->execute([
            'game_id' => $gameId,
            'token_hash' => hash('sha256', $rawToken),
            'seat_color' => $seatColor,
            'created_by_player_id' => $creatorPlayerId,
            'expires_at' => gmdate(DATE_ATOM, time() + self::INVITE_TTL_SECONDS),
        ]);
        $expiresAt = $statement->fetchColumn();

        return [
            'url' => '/stratego/?join=' . rawurlencode($rawToken),
            'token' => $rawToken,
            'expires_at' => $expiresAt === false || $expiresAt === null ? null : (string) $expiresAt,
        ];
    }

    /** @return array{user_id: string|null, guest_profile_id: string|null, display_name: string} */
    private function seatActor(array $identity): array
    {
        if (isset($identity['user']['id'])) {
            $name = trim((string) ($identity['user']['display_name'] ?? '')) ?: 'Registered player';
            preg_match('/^.{1,40}/us', $name, $match);

            return [
                'user_id' => (string) $identity['user']['id'],
                'guest_profile_id' => null,
                'display_name' => $match[0] ?? 'Registered player',
            ];
        }
        if (isset($identity['guest_profile']['id'])) {
            return [
                'user_id' => null,
                'guest_profile_id' => (string) $identity['guest_profile']['id'],
                'display_name' => 'Guest',
            ];
        }

        throw new ApiException(401, 'identity_required', 'A user or guest identity is required for Stratego.');
    }

    /** @param list<array<string, mixed>> $players */
    private function ownedSeat(array $players, array $identity): ?array
    {
        foreach ($players as $player) {
            if ($this->identityOwnsSeat($player, $identity)) {
                return $player;
            }
        }

        return null;
    }

    private function identityOwnsSeat(array $seat, array $identity): bool
    {
        if ($seat['user_id'] !== null && isset($identity['user']['id'])
            && (string) $seat['user_id'] === (string) $identity['user']['id']) {
            return true;
        }

        return $seat['guest_profile_id'] !== null
            && isset($identity['guest_profile']['id'])
            && (string) $seat['guest_profile_id'] === (string) $identity['guest_profile']['id'];
    }

    private function seatHasIdentity(array $seat): bool
    {
        return $seat['user_id'] !== null || $seat['guest_profile_id'] !== null;
    }

    /** @param list<array<string, mixed>> $players */
    private function seatByColor(array $players, string $color): ?array
    {
        foreach ($players as $player) {
            if ((string) $player['color'] === $color) {
                return $player;
            }
        }

        return null;
    }

    /** @param list<array<string, mixed>> $players */
    private function firstEmptySeat(array $players): ?array
    {
        foreach ($players as $player) {
            if (!$this->seatHasIdentity($player)) {
                return $player;
            }
        }

        return null;
    }

    private function isTrue(mixed $value): bool
    {
        return $value === true || $value === 't' || $value === 'true' || $value === 1 || $value === '1';
    }

    /** @return array<string, mixed> */
    private function decodeState(array $game): array
    {
        $raw = $game['state'] ?? null;
        $state = is_string($raw) && $raw !== ''
            ? json_decode($raw, true, 512, JSON_THROW_ON_ERROR)
            : null;

        return is_array($state) ? $state : $this->engine->initialState();
    }

    private function encodeState(array $state): string
    {
        return json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * GameJson per the stratego-api contract. The state is always passed
     * through presentForViewer() for the server-resolved seat color.
     *
     * @param list<array<string, mixed>> $players
     * @return array<string, mixed>
     */
    private function gameJson(array $game, array $players, array $identity, ?int $sinceVersion = null): array
    {
        $status = (string) $game['status'];
        $stateVersion = (int) $game['state_version'];
        $state = $this->decodeState($game);
        $viewerSeat = $this->ownedSeat($players, $identity);
        $viewerColor = $viewerSeat !== null ? (string) $viewerSeat['color'] : null;
        $controlsTurn = $viewerColor !== null
            && $status === 'active'
            && ($state['phase'] ?? null) === StrategoEngine::PHASE_ACTIVE
            && ($state['turn'] ?? null) === $viewerColor;

        $result = [
            'id' => (string) $game['public_id'],
            'status' => $status,
            'state_version' => $stateVersion,
            'created_at' => (string) $game['created_at'],
            'updated_at' => (string) $game['updated_at'],
            'winner_color' => $game['winner_color'] !== null ? (string) $game['winner_color'] : null,
            'players' => array_map(fn (array $player): array => [
                'color' => (string) $player['color'],
                'display_name' => (string) $player['display_name'],
                'seated' => $this->seatHasIdentity($player),
                'is_ready' => $this->isTrue($player['is_ready']),
            ], $players),
            'viewer' => [
                'seat_color' => $viewerColor,
                'owns_seat' => $viewerSeat !== null,
                'controls_current_turn' => $controlsTurn,
            ],
        ];
        if ($sinceVersion === null || $sinceVersion !== $stateVersion) {
            $result['state'] = $this->engine->presentForViewer($state, $viewerColor);
        }
        $result['legal_moves'] = $controlsTurn && $viewerColor !== null
            ? $this->engine->legalMoves($state, $viewerColor)
            : [];

        return $result;
    }
}
