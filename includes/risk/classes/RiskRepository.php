<?php

declare(strict_types=1);

namespace Wowie\Api\Risk;

use PDO;
use stdClass;
use Throwable;
use Wowie\Api\ApiException;

final class RiskRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function createGame(array $input, array $identity): array
    {
        $opponents = $input['opponent_count'] ?? null;
        if (!is_int($opponents) || $opponents < 1 || $opponents > 5) {
            throw new ApiException(422, 'validation_failed', 'opponent_count must be an integer from 1 to 5.');
        }
        $actor = $this->seatActor($identity);

        return $this->transaction(function () use ($opponents, $actor, $identity): array {
            $statement = $this->pdo->prepare('INSERT INTO risk_games (seat_count) VALUES (:seat_count) RETURNING *');
            $statement->execute(['seat_count' => $opponents + 1]);
            $game = $statement->fetch(PDO::FETCH_ASSOC);
            $this->insertPlayer((string) $game['id'], 1, 'human', $actor);
            $link = $this->createStoredLink((string) $game['id']);
            $result = $this->gameJson($game, $this->loadPlayers((string) $game['id']), $identity);
            $result['invite_link'] = $link;
            return $result;
        });
    }

    public function findGame(string $publicId, array $identity, ?int $sinceVersion = null): array
    {
        $game = $this->loadGame($publicId);
        return $this->gameJson($game, $this->loadPlayers((string) $game['id']), $identity, $sinceVersion);
    }

    public function createLink(string $publicId, array $identity): array
    {
        return $this->transaction(function () use ($publicId, $identity): array {
            $game = $this->loadGame($publicId, true);
            $this->assertHost($this->loadPlayers((string) $game['id']), $identity);
            $this->assertWaiting($game);
            return $this->createStoredLink((string) $game['id']);
        });
    }

    public function claimLink(string $token, array $identity): array
    {
        $actor = $this->seatActor($identity);
        return $this->transaction(function () use ($token, $actor, $identity): array {
            $statement = $this->pdo->prepare(<<<'SQL'
                SELECT g.* FROM risk_games g
                JOIN risk_game_links l ON l.game_id = g.id
                WHERE l.token_hash = :token_hash
                FOR UPDATE OF g
            SQL);
            $hash = hash('sha256', $token);
            $statement->execute(['token_hash' => $hash]);
            $game = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($game)) {
                throw new ApiException(404, 'link_not_found', 'That Risk invitation link does not exist.');
            }
            $statement = $this->pdo->prepare('SELECT * FROM risk_game_links WHERE token_hash = :token_hash FOR UPDATE');
            $statement->execute(['token_hash' => $hash]);
            $link = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($link)) {
                throw new ApiException(404, 'link_not_found', 'That Risk invitation link does not exist.');
            }
            if ($link['revoked_at'] !== null) {
                throw new ApiException(409, 'link_revoked', 'That Risk invitation link has been revoked.');
            }
            if ($link['expires_at'] !== null && strtotime((string) $link['expires_at']) <= time()) {
                throw new ApiException(410, 'link_expired', 'That Risk invitation link has expired.');
            }
            if ($game['status'] !== 'waiting') {
                throw new ApiException(409, 'join_closed', 'That Risk game is no longer accepting players.');
            }
            $players = $this->loadPlayers((string) $game['id']);
            if ($this->ownedSeat($players, $identity) === null) {
                $taken = array_column($players, 'seat_number');
                $seat = 1;
                while ($seat <= (int) $game['seat_count'] && in_array($seat, $taken)) {
                    $seat++;
                }
                if ($seat > (int) $game['seat_count']) {
                    throw new ApiException(409, 'game_full', 'That Risk game has no free seats.');
                }
                $this->insertPlayer((string) $game['id'], $seat, 'human', $actor);
                $players = $this->loadPlayers((string) $game['id']);
            }
            return $this->gameJson($game, $players, $identity);
        });
    }

    public function startGame(string $publicId, array $identity): array
    {
        return $this->transaction(function () use ($publicId, $identity): array {
            $game = $this->loadGame($publicId, true);
            $players = $this->loadPlayers((string) $game['id']);
            $this->assertHost($players, $identity);
            $this->assertWaiting($game);
            $taken = array_column($players, 'seat_number');
            $bot = 1;
            for ($seat = 1; $seat <= (int) $game['seat_count']; $seat++) {
                if (!in_array($seat, $taken)) {
                    $this->insertPlayer((string) $game['id'], $seat, 'bot', [
                        'user_id' => null,
                        'guest_profile_id' => null,
                        'display_name' => 'Bot ' . $bot++,
                    ]);
                }
            }
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE risk_games
                SET status = 'active', started_at = now(), updated_at = now(), state = NULL, state_version = 0
                WHERE id = :id RETURNING *
            SQL);
            $statement->execute(['id' => $game['id']]);
            return $this->gameJson($statement->fetch(PDO::FETCH_ASSOC), $this->loadPlayers((string) $game['id']), $identity);
        });
    }

    public function postState(string $publicId, array $input, array $identity): array
    {
        $version = $input['expected_version'] ?? null;
        $state = $input['state'] ?? null;
        if (!is_int($version) || $version < 0) {
            throw new ApiException(422, 'validation_failed', 'expected_version must be a nonnegative integer.');
        }
        if (is_array($state) && !array_is_list($state)) {
            $state = (object) $state;
        }
        if (!$state instanceof stdClass || !isset($state->current_seat) || !is_int($state->current_seat)) {
            throw new ApiException(422, 'validation_failed', 'state must be a JSON object containing integer current_seat.');
        }
        $finished = $input['finished'] ?? false;
        if ((array_key_exists('finished', $input) && !is_bool($input['finished']))
            || (array_key_exists('winner_seat', $input) && !is_int($input['winner_seat']))) {
            throw new ApiException(422, 'validation_failed', 'finished must be a boolean and winner_seat must be an integer.');
        }
        $winner = $input['winner_seat'] ?? null;
        try {
            $encoded = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (\JsonException $error) {
            throw new ApiException(422, 'validation_failed', 'state must contain valid JSON.');
        }
        if (strlen($encoded) > 262144) {
            throw new ApiException(413, 'state_too_large', 'state must not exceed 262144 encoded bytes.');
        }

        return $this->transaction(function () use ($publicId, $identity, $version, $state, $encoded, $finished, $winner): array {
            $game = $this->loadGame($publicId, true);
            $seatCount = (int) $game['seat_count'];
            if ($state->current_seat < 1 || $state->current_seat > $seatCount
                || ($winner !== null && ($winner < 1 || $winner > $seatCount))) {
                throw new ApiException(422, 'validation_failed', 'current_seat and winner_seat must identify a seat in this game.');
            }
            $players = $this->loadPlayers((string) $game['id']);
            $viewer = $this->ownedSeat($players, $identity);
            if ($viewer === null) {
                throw new ApiException(403, 'seat_required', 'A human seat in this Risk game is required.');
            }
            if ($game['status'] !== 'active') {
                throw new ApiException(409, 'game_not_active', 'Only an active Risk game accepts state updates.');
            }
            if ($version !== (int) $game['state_version']) {
                throw new ApiException(409, 'state_conflict', 'The Risk game state has changed.');
            }
            $allowed = false;
            if ($game['state'] === null) {
                $allowed = (int) $viewer['seat_number'] === 1;
            } else {
                $stored = json_decode((string) $game['state'], false, 128, JSON_THROW_ON_ERROR);
                $currentSeat = $stored->current_seat ?? null;
                if (is_int($currentSeat)) {
                    $allowed = (int) $viewer['seat_number'] === $currentSeat;
                    foreach ($players as $player) {
                        if ((int) $player['seat_number'] === $currentSeat && $player['kind'] === 'bot') {
                            $allowed = true;
                        }
                    }
                }
            }
            if (!$allowed) {
                throw new ApiException(403, 'not_your_turn', 'That Risk state update belongs to another player.');
            }
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE risk_games
                SET state = CAST(:state AS jsonb), state_version = state_version + 1,
                    status = :status, winner_seat = :winner_seat,
                    finished_at = CASE WHEN :finished = 1 THEN now() ELSE finished_at END,
                    updated_at = now()
                WHERE id = :id RETURNING *
            SQL);
            $statement->execute([
                'state' => $encoded,
                'status' => $finished ? 'finished' : 'active',
                'winner_seat' => $finished ? $winner : null,
                'finished' => $finished ? 1 : 0,
                'id' => $game['id'],
            ]);
            return $this->gameJson($statement->fetch(PDO::FETCH_ASSOC), $players, $identity, null, false);
        });
    }

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

    private function loadGame(string $publicId, bool $lock = false): array
    {
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i', $publicId)) {
            throw new ApiException(404, 'game_not_found', 'That Risk game does not exist.');
        }
        $statement = $this->pdo->prepare('SELECT * FROM risk_games WHERE public_id = :public_id' . ($lock ? ' FOR UPDATE' : ''));
        $statement->execute(['public_id' => $publicId]);
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($game)) {
            throw new ApiException(404, 'game_not_found', 'That Risk game does not exist.');
        }
        return $game;
    }

    private function loadPlayers(string $gameId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM risk_game_players WHERE game_id = :game_id ORDER BY seat_number');
        $statement->execute(['game_id' => $gameId]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    private function insertPlayer(string $gameId, int $seat, string $kind, array $actor): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO risk_game_players (game_id, seat_number, kind, user_id, guest_profile_id, display_name)
            VALUES (:game_id, :seat_number, :kind, :user_id, :guest_profile_id, :display_name)
        SQL);
        $statement->execute([
            'game_id' => $gameId,
            'seat_number' => $seat,
            'kind' => $kind,
            'user_id' => $actor['user_id'],
            'guest_profile_id' => $actor['guest_profile_id'],
            'display_name' => $actor['display_name'],
        ]);
    }

    private function createStoredLink(string $gameId): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $statement = $this->pdo->prepare('INSERT INTO risk_game_links (game_id, token_hash) VALUES (:game_id, :token_hash) RETURNING expires_at');
        $statement->execute(['game_id' => $gameId, 'token_hash' => hash('sha256', $token)]);
        $link = $statement->fetch(PDO::FETCH_ASSOC);
        return ['token' => $token, 'url' => '/risk/?join=' . $token, 'expires_at' => $link['expires_at']];
    }

    private function seatActor(array $identity): array
    {
        $userId = isset($identity['user']['id']) ? (string) $identity['user']['id'] : null;
        $guestId = isset($identity['guest_profile']['id']) ? (string) $identity['guest_profile']['id'] : null;
        if ($userId === null && $guestId === null) {
            throw new ApiException(401, 'identity_required', 'A user or guest identity is required for Risk.');
        }
        $name = $userId !== null
            ? (trim((string) ($identity['user']['display_name'] ?? '')) ?: 'Registered player')
            : (trim((string) ($identity['guest_profile']['display_name'] ?? '')) ?: 'Guest');
        preg_match('/^.{1,40}/us', $name, $match);
        return ['user_id' => $userId, 'guest_profile_id' => $guestId, 'display_name' => $match[0] ?? 'Player'];
    }

    private function ownedSeat(array $players, array $identity): ?array
    {
        foreach (['user_id' => 'user', 'guest_profile_id' => 'guest_profile'] as $column => $key) {
            if (!isset($identity[$key]['id'])) {
                continue;
            }
            foreach ($players as $player) {
                if ($player['kind'] === 'human' && $player[$column] !== null
                    && (string) $player[$column] === (string) $identity[$key]['id']) {
                    return $player;
                }
            }
        }
        return null;
    }

    private function assertHost(array $players, array $identity): void
    {
        $seat = $this->ownedSeat($players, $identity);
        if ($seat === null || (int) $seat['seat_number'] !== 1) {
            throw new ApiException(403, 'host_required', 'Only the host may perform this Risk action.');
        }
    }

    private function assertWaiting(array $game): void
    {
        if ($game['status'] !== 'waiting') {
            throw new ApiException(409, 'game_not_waiting', 'Only a waiting Risk game permits this action.');
        }
    }

    private function gameJson(array $game, array $players, array $identity, ?int $sinceVersion = null, bool $includeState = true): array
    {
        $viewer = $this->ownedSeat($players, $identity);
        $viewerSeat = $viewer === null ? null : (int) $viewer['seat_number'];
        $includeState = $includeState && $sinceVersion !== (int) $game['state_version'];
        return [
            'id' => (string) $game['public_id'],
            'status' => (string) $game['status'],
            'seat_count' => (int) $game['seat_count'],
            'opponent_count' => (int) $game['seat_count'] - 1,
            'state_version' => (int) $game['state_version'],
            'viewer_seat' => $viewerSeat,
            'viewer_is_host' => $viewerSeat === 1,
            'winner_seat' => $game['winner_seat'] === null ? null : (int) $game['winner_seat'],
            'players' => array_map(static fn (array $player): array => [
                'seat' => (int) $player['seat_number'],
                'kind' => (string) $player['kind'],
                'display_name' => (string) $player['display_name'],
                'is_host' => (int) $player['seat_number'] === 1,
                'is_viewer' => (int) $player['seat_number'] === $viewerSeat,
            ], $players),
            'state' => $includeState && $game['state'] !== null
                ? json_decode((string) $game['state'], false, 128, JSON_THROW_ON_ERROR)
                : null,
            'state_included' => $includeState,
        ];
    }
}
