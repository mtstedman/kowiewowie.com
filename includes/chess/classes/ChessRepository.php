<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

use PDO;
use Throwable;
use Wowie\Api\ApiException;

final class ChessRepository
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly ChessEngine $engine,
    ) {
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function createGame(array $input, array $identity): array
    {
        $mode = $this->normalizeMode($input['mode'] ?? 'online');
        $variant = $this->normalizeVariant($input['variant'] ?? 'standard');
        $creatorColorInput = $input['creator_color'] ?? 'white';
        if (strtolower(trim((string) $creatorColorInput)) === 'random') {
            $creatorColorInput = random_int(0, 1) === 0 ? 'white' : 'black';
        }
        $creatorColor = $this->normalizeColor($creatorColorInput, 'creator_color');
        $links = $this->normalizeInitialLinks($input['links'] ?? []);
        $actor = $this->seatActor($identity);
        $opponentColor = $creatorColor === 'white' ? 'black' : 'white';
        $startingFen = $this->startingFenForVariant($variant);
        $createdLinks = [];
        $publicId = null;

        $this->pdo->beginTransaction();
        try {
            $gameStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO chess_games (variant, status, started_at)
                VALUES (:variant, :status, :started_at)
                RETURNING id, public_id, variant, status, current_ply, result, termination, started_at, finished_at, last_activity_at, created_at, updated_at
            SQL);
            $gameStatement->execute([
                'variant' => $variant,
                'status' => $mode === 'local' ? 'active' : 'waiting',
                'started_at' => $mode === 'local' ? gmdate(DATE_ATOM) : null,
            ]);
            $game = $gameStatement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($game)) {
                throw new \RuntimeException('The chess game row could not be created.');
            }

            $gameId = (string) $game['id'];
            $publicId = (string) $game['public_id'];

            $positionStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO chess_game_positions (game_id, ply, fen)
                VALUES (:game_id, 0, :fen)
            SQL);
            $positionStatement->execute([
                'game_id' => $gameId,
                'fen' => $startingFen,
            ]);

            $creatorSeat = $this->insertPlayerSeat($gameId, $creatorColor, $actor['user_id'], $actor['guest_profile_id'], $actor['display_name']);
            $this->insertPlayerSeat($gameId, $opponentColor, null, null, $this->emptySeatDisplayName($opponentColor, $mode));

            foreach ($links as $linkInput) {
                $createdLinks[] = $this->createStoredLink($gameId, $publicId, $creatorSeat, $linkInput);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if ($publicId === null) {
            throw new \RuntimeException('The new chess game is missing its public identifier.');
        }

        $game = $this->findGame($publicId, $identity);
        if ($createdLinks === []) {
            return $game;
        }

        $game['created_links'] = $createdLinks;

        return $game;
    }

    /**
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function findGame(string $publicId, array $identity): array
    {
        $game = $this->loadGameByPublicId($publicId);
        $players = $this->loadPlayersForGame((string) $game['id']);

        return $this->presentGame($game, $players, $identity, true);
    }

    public function updateGuestProfileSeatDisplayName(string $guestProfileId, string $displayName): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE chess_game_players
            SET display_name = :display_name
            WHERE guest_profile_id = :guest_profile_id
        SQL);
        $statement->execute([
            'display_name' => $displayName,
            'guest_profile_id' => $guestProfileId,
        ]);
    }

    /** @return list<array<string, mixed>> */
    public function moveHistory(string $publicId): array
    {
        $game = $this->loadGameByPublicId($publicId);
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT
                m.id,
                m.ply,
                m.client_move_id,
                m.uci,
                m.san,
                m.played_at,
                m.played_by_player_id,
                gp.color,
                gp.display_name,
                p.fen
            FROM chess_game_moves m
            JOIN chess_game_players gp
              ON gp.game_id = m.game_id
             AND gp.id = m.played_by_player_id
            JOIN chess_game_positions p
              ON p.game_id = m.game_id
             AND p.ply = m.ply
            WHERE m.game_id = :game_id
            ORDER BY m.ply ASC
        SQL);
        $statement->execute(['game_id' => $game['id']]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn (array $row): array => [
                'id' => (string) $row['id'],
                'ply' => (int) $row['ply'],
                'client_move_id' => (string) $row['client_move_id'],
                'uci' => (string) $row['uci'],
                'san' => (string) $row['san'],
                'played_at' => (string) $row['played_at'],
                'player' => [
                    'id' => (string) $row['played_by_player_id'],
                    'color' => (string) $row['color'],
                    'display_name' => (string) $row['display_name'],
                ],
                'position_fen' => (string) $row['fen'],
            ],
            is_array($rows) ? $rows : [],
        );
    }

    /** @return list<array<string, mixed>> */
    public function promotionOptions(string $publicId, string $from, string $to): array
    {
        $game = $this->loadGameByPublicId($publicId);
        $from = strtolower(trim($from));
        $to = strtolower(trim($to));
        $moves = $this->engine->legalMoves((string) $game['current_fen']);

        if (($moves['ok'] ?? false) !== true || !is_array($moves['moves'] ?? null)) {
            return [];
        }

        return array_values(array_filter(
            $moves['moves'],
            static fn (array $move): bool => (string) ($move['from'] ?? '') === $from
                && (string) ($move['to'] ?? '') === $to
                && ($move['promotion'] ?? null) !== null,
        ));
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function submitMove(string $publicId, array $input, array $identity): array
    {
        $uci = strtolower(trim((string) ($input['uci'] ?? '')));
        if ($uci === '') {
            throw new ApiException(422, 'validation_error', 'uci is required.', [
                'uci' => 'Provide a legal move in UCI notation such as e2e4.',
            ]);
        }

        if (array_key_exists('promotion', $input) && $input['promotion'] !== null) {
            $promotion = strtolower(trim((string) $input['promotion']));
            if (!in_array($promotion, ['q', 'r', 'b', 'n'], true)) {
                throw new ApiException(422, 'validation_error', 'promotion must be q, r, b, or n.', [
                    'promotion' => 'Use q, r, b, or n.',
                ]);
            }

            $embeddedPromotion = strlen($uci) >= 5 ? $uci[4] : null;
            if ($embeddedPromotion !== null && $embeddedPromotion !== $promotion) {
                throw new ApiException(422, 'validation_error', 'promotion conflicts with the UCI promotion suffix.', [
                    'promotion' => 'Match the 5th UCI character or omit one promotion value.',
                ]);
            }
            if ($embeddedPromotion === null) {
                $uci .= $promotion;
            }
        }

        $clientMoveId = $input['client_move_id'] ?? null;
        if ($clientMoveId !== null) {
            $clientMoveId = $this->normalizeUuid((string) $clientMoveId, 'client_move_id');
        }

        $this->pdo->beginTransaction();
        try {
            $game = $this->loadGameByPublicId($publicId, true);
            if (!in_array($game['status'], ['waiting', 'active'], true)) {
                throw new ApiException(409, 'game_finished', 'This game can no longer accept moves.');
            }

            $players = $this->loadPlayersForGame((string) $game['id'], true);
            $currentSeat = $this->currentTurnSeat($players, (string) $game['side_to_move']);
            if ($currentSeat === null) {
                throw new ApiException(409, 'waiting_for_opponent', 'The current side has no player seat to move from yet.');
            }

            $this->assertCanActAsSeat($game, $players, $currentSeat, $identity);
            $move = $this->engine->applyUciMove((string) $game['current_fen'], $uci);
            if (($move['ok'] ?? false) !== true) {
                throw new ApiException(422, 'illegal_move', (string) ($move['error'] ?? 'That move is not legal in the current position.'));
            }

            if ($clientMoveId !== null) {
                $duplicateStatement = $this->pdo->prepare(<<<'SQL'
                    SELECT 1
                    FROM chess_game_moves
                    WHERE game_id = :game_id
                      AND client_move_id = :client_move_id
                    LIMIT 1
                SQL);
                $duplicateStatement->execute([
                    'game_id' => $game['id'],
                    'client_move_id' => $clientMoveId,
                ]);
                if ($duplicateStatement->fetchColumn() !== false) {
                    throw new ApiException(409, 'duplicate_client_move', 'That client_move_id has already been used for this game.');
                }
            }

            $nextPly = ((int) $game['current_ply']) + 1;
            $positionStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO chess_game_positions (game_id, ply, fen)
                VALUES (:game_id, :ply, :fen)
            SQL);
            $positionStatement->execute([
                'game_id' => $game['id'],
                'ply' => $nextPly,
                'fen' => (string) $move['fen'],
            ]);

            $moveStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO chess_game_moves (game_id, ply, played_by_player_id, client_move_id, uci, san)
                VALUES (:game_id, :ply, :played_by_player_id, COALESCE(CAST(:client_move_id AS uuid), gen_random_uuid()), :uci, :san)
            SQL);
            $moveStatement->execute([
                'game_id' => $game['id'],
                'ply' => $nextPly,
                'played_by_player_id' => $currentSeat['id'],
                'client_move_id' => $clientMoveId,
                'uci' => (string) $move['uci'],
                'san' => (string) $move['san'],
            ]);

            $state = is_array($move['state'] ?? null) ? $move['state'] : [];
            $status = $this->nextStoredStatus((string) $game['status'], $players, $state);
            $result = $status === 'completed' ? (string) ($state['result'] ?? '*') : '*';
            $termination = $status === 'completed' ? $this->terminationFromState($state) : null;

            $updateGame = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_games
                SET status = :status,
                    result = :result,
                    termination = :termination,
                    started_at = CASE
                        WHEN :status = 'waiting' THEN started_at
                        ELSE COALESCE(started_at, now())
                    END,
                    finished_at = CASE
                        WHEN :status IN ('completed', 'abandoned') THEN COALESCE(finished_at, now())
                        ELSE NULL
                    END,
                    last_activity_at = now(),
                    updated_at = now()
                WHERE id = :id
            SQL);
            $updateGame->execute([
                'status' => $status,
                'result' => $result,
                'termination' => $termination,
                'id' => $game['id'],
            ]);

            $touchSeat = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_game_players
                SET last_seen_at = now()
                WHERE game_id = :game_id
                  AND id = :id
            SQL);
            $touchSeat->execute([
                'game_id' => $game['id'],
                'id' => $currentSeat['id'],
            ]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findGame($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function resign(string $publicId, array $input, array $identity): array
    {
        $color = null;
        if (array_key_exists('color', $input) && $input['color'] !== null && trim((string) $input['color']) !== '') {
            $color = $this->normalizeColor($input['color'], 'color');
        }

        $this->pdo->beginTransaction();
        try {
            $game = $this->loadGameByPublicId($publicId, true);
            if (!in_array($game['status'], ['waiting', 'active'], true)) {
                throw new ApiException(409, 'game_finished', 'This game can no longer be resigned.');
            }

            $players = $this->loadPlayersForGame((string) $game['id'], true);
            $seat = $color !== null ? $this->seatByColor($players, $color) : $this->ownedSeat($players, $identity);
            if ($seat === null) {
                throw new ApiException(403, 'seat_required', 'Only a seated player can resign this chess game.');
            }

            $this->assertCanActAsSeat($game, $players, $seat, $identity);
            $result = (string) $seat['color'] === 'black' ? '1-0' : '0-1';

            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_games
                SET status = 'completed',
                    result = :result,
                    termination = 'resignation',
                    finished_at = COALESCE(finished_at, now()),
                    pending_takeback_by_player_id = NULL,
                    pending_takeback_requested_at = NULL,
                    last_activity_at = now(),
                    updated_at = now()
                WHERE id = :id
            SQL);
            $statement->execute([
                'result' => $result,
                'id' => $game['id'],
            ]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findGame($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function requestTakeback(string $publicId, array $identity): array
    {
        $this->pdo->beginTransaction();
        try {
            $game = $this->loadGameByPublicId($publicId, true);
            $this->assertTakebackAvailable($game);

            $players = $this->loadPlayersForGame((string) $game['id'], true);
            $seat = $this->ownedSeat($players, $identity);
            if ($seat === null) {
                throw new ApiException(403, 'seat_required', 'Only a seated player can request a takeback.');
            }

            $pendingBy = $game['pending_takeback_by_player_id'] !== null ? (string) $game['pending_takeback_by_player_id'] : null;
            if ($this->modeFromStoredGame($game, $players) === 'local') {
                $this->rollbackLatestMove($game);
            } elseif ($pendingBy === null) {
                $statement = $this->pdo->prepare(<<<'SQL'
                    UPDATE chess_games
                    SET pending_takeback_by_player_id = :player_id,
                        pending_takeback_requested_at = now(),
                        last_activity_at = now(),
                        updated_at = now()
                    WHERE id = :id
                SQL);
                $statement->execute([
                    'player_id' => $seat['id'],
                    'id' => $game['id'],
                ]);
            } elseif ($pendingBy === (string) $seat['id']) {
                throw new ApiException(409, 'takeback_already_requested', 'That player has already requested a takeback.');
            } else {
                $this->rollbackLatestMove($game);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findGame($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function cancelTakeback(string $publicId, array $identity): array
    {
        $this->pdo->beginTransaction();
        try {
            $game = $this->loadGameByPublicId($publicId, true);
            $this->assertTakebackAvailable($game);

            $players = $this->loadPlayersForGame((string) $game['id'], true);
            if (!$this->identityOwnsAnySeat($players, $identity)) {
                throw new ApiException(403, 'seat_required', 'Only a seated player can cancel or decline a takeback.');
            }

            if ($game['pending_takeback_by_player_id'] !== null) {
                $statement = $this->pdo->prepare(<<<'SQL'
                    UPDATE chess_games
                    SET pending_takeback_by_player_id = NULL,
                        pending_takeback_requested_at = NULL,
                        updated_at = now()
                    WHERE id = :id
                SQL);
                $statement->execute(['id' => $game['id']]);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findGame($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function createLink(string $publicId, array $input, array $identity): array
    {
        $linkInput = $this->normalizeLinkInput($input);
        $game = $this->loadGameByPublicId($publicId);
        if (!in_array($game['status'], ['waiting', 'active'], true)) {
            throw new ApiException(409, 'game_finished', 'Finished chess games cannot issue new invitation links.');
        }

        $players = $this->loadPlayersForGame((string) $game['id']);
        $creatorSeat = $this->ownedSeat($players, $identity);
        if ($creatorSeat === null) {
            throw new ApiException(403, 'seat_required', 'Only a seated player can create chess links for this game.');
        }

        $createdLink = $this->createStoredLink((string) $game['id'], (string) $game['public_id'], $creatorSeat, $linkInput);

        return [
            'game_public_id' => (string) $game['public_id'],
            'link' => $createdLink,
        ];
    }

    /**
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function claimLink(string $rawToken, array $identity): array
    {
        $rawToken = trim($rawToken);
        if ($rawToken === '') {
            throw new ApiException(422, 'validation_error', 'token is required.', [
                'token' => 'Provide the raw invitation token returned when the link was created.',
            ]);
        }

        $tokenHash = hash('sha256', $rawToken);
        $publicId = null;

        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                SELECT
                    l.id,
                    l.game_id,
                    l.link_type,
                    l.seat_color,
                    l.created_by_player_id,
                    l.claimed_by_player_id,
                    l.claimed_at,
                    l.expires_at,
                    l.revoked_at,
                    l.created_at,
                    g.public_id,
                    g.status
                FROM chess_game_links l
                JOIN chess_games g
                  ON g.id = l.game_id
                WHERE l.token_hash = :token_hash
                LIMIT 1
                FOR UPDATE OF l
            SQL);
            $statement->execute(['token_hash' => $tokenHash]);
            $link = $statement->fetch(PDO::FETCH_ASSOC);
            if ($link === false) {
                throw new ApiException(404, 'link_not_found', 'That chess invitation link is not valid.');
            }
            if ($link['revoked_at'] !== null) {
                throw new ApiException(409, 'link_revoked', 'That chess invitation link has been revoked.');
            }
            if ($link['expires_at'] !== null && strtotime((string) $link['expires_at']) <= time()) {
                throw new ApiException(410, 'link_expired', 'That chess invitation link has expired.');
            }
            if (!in_array((string) $link['status'], ['waiting', 'active'], true)) {
                throw new ApiException(409, 'game_finished', 'That chess invitation belongs to a game that is already finished.');
            }

            $publicId = (string) $link['public_id'];
            $players = $this->loadPlayersForGame((string) $link['game_id'], true);

            if ((string) $link['link_type'] === 'spectate') {
                $this->pdo->commit();
                return $this->findGame($publicId, $identity);
            }

            if ($link['claimed_at'] !== null || $link['claimed_by_player_id'] !== null) {
                throw new ApiException(409, 'link_already_claimed', 'That chess invitation link has already been claimed.');
            }

            $seatColor = (string) $link['seat_color'];
            $seat = $this->seatByColor($players, $seatColor);
            if ($seat === null) {
                throw new ApiException(409, 'seat_unavailable', 'That invitation no longer points to a valid player seat.');
            }
            if ($this->seatHasIdentity($seat)) {
                throw new ApiException(409, 'seat_unavailable', 'That player seat has already been claimed.');
            }
            if ($this->identityOwnsAnySeat($players, $identity)) {
                throw new ApiException(409, 'identity_already_seated', 'That identity already occupies a seat in this game.');
            }

            $actor = $this->seatActor($identity);
            $seatStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_game_players
                SET user_id = :user_id,
                    guest_profile_id = :guest_profile_id,
                    display_name = :display_name,
                    last_seen_at = now()
                WHERE game_id = :game_id
                  AND id = :id
            SQL);
            $seatStatement->execute([
                'user_id' => $actor['user_id'],
                'guest_profile_id' => $actor['guest_profile_id'],
                'display_name' => $actor['display_name'],
                'game_id' => $link['game_id'],
                'id' => $seat['id'],
            ]);

            $claimStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_game_links
                SET claimed_by_player_id = :player_id,
                    claimed_at = now()
                WHERE id = :id
            SQL);
            $claimStatement->execute([
                'player_id' => $seat['id'],
                'id' => $link['id'],
            ]);

            $gameStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE chess_games
                SET status = CASE WHEN status = 'waiting' THEN 'active' ELSE status END,
                    started_at = COALESCE(started_at, now()),
                    last_activity_at = now(),
                    updated_at = now()
                WHERE id = :id
            SQL);
            $gameStatement->execute(['id' => $link['game_id']]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if ($publicId === null) {
            throw new \RuntimeException('The claimed chess link is missing its game identifier.');
        }

        return $this->findGame($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $identity
     * @return list<array<string, mixed>>
     */
    public function listGamesForIdentity(array $identity, int $limit = 100, int $offset = 0): array
    {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);
        $conditions = [];
        $params = [];

        if (isset($identity['guest_profile']['id'])) {
            $conditions[] = 'gp.guest_profile_id = :guest_profile_id';
            $params['guest_profile_id'] = (string) $identity['guest_profile']['id'];
        }
        if (isset($identity['user']['id'])) {
            $conditions[] = 'gp.user_id = :user_id';
            $params['user_id'] = (string) $identity['user']['id'];
        }
        if ($conditions === []) {
            return [];
        }

        $statement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT
                g.id,
                g.public_id,
                g.variant,
                g.status,
                g.current_ply,
                g.result,
                g.termination,
                g.started_at,
                g.finished_at,
                g.last_activity_at,
                g.created_at,
                g.updated_at,
                g.pending_takeback_by_player_id,
                g.pending_takeback_requested_at,
                p.fen AS current_fen,
                p.side_to_move
            FROM chess_games g
            JOIN chess_game_positions p
              ON p.game_id = g.id
             AND p.ply = g.current_ply
            WHERE EXISTS (
                SELECT 1
                FROM chess_game_players gp
                WHERE gp.game_id = g.id
                  AND (%s)
            )
            ORDER BY
                CASE WHEN g.status IN ('waiting', 'active') THEN 0 ELSE 1 END,
                g.last_activity_at DESC,
                g.created_at DESC
            LIMIT :limit
            OFFSET :offset
        SQL, implode(' OR ', $conditions)));
        foreach ($params as $name => $value) {
            $statement->bindValue(':' . $name, $value, PDO::PARAM_STR);
        }
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $games = $statement->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($games) || $games === []) {
            return [];
        }

        $gameIds = array_map(static fn (array $game): string => (string) $game['id'], $games);
        $playersByGame = $this->loadPlayersForGames($gameIds);
        $openingsByGame = $this->loadOpeningsForGames($games);
        $result = [];
        foreach ($games as $game) {
            $gameId = (string) $game['id'];
            $result[] = $this->presentGame($game, $playersByGame[$gameId] ?? [], $identity, false, $openingsByGame[$gameId]);
        }

        return $result;
    }

    /** @return array<string, mixed> */
    private function loadGameByPublicId(string $publicId, bool $forUpdate = false): array
    {
        $publicId = $this->normalizeUuid($publicId, 'game_id');
        $statement = $this->pdo->prepare((<<<'SQL'
            SELECT
                g.id,
                g.public_id,
                g.variant,
                g.status,
                g.current_ply,
                g.result,
                g.termination,
                g.started_at,
                g.finished_at,
                g.last_activity_at,
                g.created_at,
                g.updated_at,
                g.pending_takeback_by_player_id,
                g.pending_takeback_requested_at,
                p.fen AS current_fen,
                p.side_to_move
            FROM chess_games g
            JOIN chess_game_positions p
              ON p.game_id = g.id
             AND p.ply = g.current_ply
            WHERE g.public_id = :public_id
            LIMIT 1
        SQL) . ($forUpdate ? ' FOR UPDATE OF g' : ''));
        $statement->execute(['public_id' => $publicId]);
        $game = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($game)) {
            throw new ApiException(404, 'game_not_found', 'That chess game does not exist.');
        }

        return $game;
    }

    /** @return list<array<string, mixed>> */
    private function loadPlayersForGame(string $gameId, bool $forUpdate = false): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, game_id, color, user_id, guest_profile_id, display_name, joined_at, last_seen_at
            FROM chess_game_players
            WHERE game_id = :game_id
            ORDER BY CASE color WHEN 'white' THEN 0 ELSE 1 END, joined_at ASC
        SQL . ($forUpdate ? ' FOR UPDATE' : ''));
        $statement->execute(['game_id' => $gameId]);
        $players = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($players) ? $players : [];
    }

    /**
     * @param list<string> $gameIds
     * @return array<string, list<array<string, mixed>>>
     */
    private function loadPlayersForGames(array $gameIds): array
    {
        if ($gameIds === []) {
            return [];
        }

        $placeholders = [];
        $params = [];
        foreach (array_values($gameIds) as $index => $gameId) {
            $placeholder = ':game_' . $index;
            $placeholders[] = $placeholder;
            $params[$placeholder] = $gameId;
        }

        $statement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT id, game_id, color, user_id, guest_profile_id, display_name, joined_at, last_seen_at
            FROM chess_game_players
            WHERE game_id IN (%s)
            ORDER BY CASE color WHEN 'white' THEN 0 ELSE 1 END, joined_at ASC
        SQL, implode(', ', $placeholders)));
        foreach ($params as $placeholder => $gameId) {
            $statement->bindValue($placeholder, $gameId, PDO::PARAM_STR);
        }
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $playersByGame = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $playersByGame[(string) $row['game_id']][] = $row;
        }

        return $playersByGame;
    }

    /** @return list<string> */
    private function loadMoveUciForGame(string $gameId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT uci
            FROM chess_game_moves
            WHERE game_id = :game_id
            ORDER BY ply ASC
        SQL);
        $statement->execute(['game_id' => $gameId]);
        $moves = $statement->fetchAll(PDO::FETCH_COLUMN);

        return array_map(static fn (mixed $uci): string => (string) $uci, is_array($moves) ? $moves : []);
    }

    /**
     * @param list<array<string, mixed>> $games
     * @return array<string, array{on_book: bool, eco_code: string|null, name: string|null}>
     */
    private function loadOpeningsForGames(array $games): array
    {
        if ($games === []) {
            return [];
        }

        $gameIds = array_map(static fn (array $game): string => (string) $game['id'], $games);
        $movesByGame = $this->loadMoveUciForGames($gameIds);
        $openingGraph = $this->loadOpeningGraph();

        $openingsByGame = [];
        foreach ($games as $game) {
            $gameId = (string) $game['id'];
            $openingsByGame[$gameId] = $this->openingForMovesFromGraph($movesByGame[$gameId] ?? [], $openingGraph);
        }

        return $openingsByGame;
    }

    /**
     * @param list<string> $gameIds
     * @return array<string, list<string>>
     */
    private function loadMoveUciForGames(array $gameIds): array
    {
        if ($gameIds === []) {
            return [];
        }

        $placeholders = [];
        $params = [];
        foreach (array_values($gameIds) as $index => $gameId) {
            $placeholder = ':game_' . $index;
            $placeholders[] = $placeholder;
            $params[$placeholder] = $gameId;
        }

        $statement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT game_id, uci
            FROM chess_game_moves
            WHERE game_id IN (%s)
            ORDER BY game_id ASC, ply ASC
        SQL, implode(', ', $placeholders)));
        foreach ($params as $placeholder => $gameId) {
            $statement->bindValue($placeholder, $gameId, PDO::PARAM_STR);
        }
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        $movesByGame = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $movesByGame[(string) $row['game_id']][] = strtolower(trim((string) $row['uci']));
        }

        return $movesByGame;
    }

    /**
     * @return array{
     *   initial: array{id: string, eco_code: string|null, name: string|null}|null,
     *   moves: array<string, array<string, array{id: string, eco_code: string|null, name: string|null}>>
     * }
     */
    private function loadOpeningGraph(): array
    {
        $initialStatement = $this->pdo->prepare(<<<'SQL'
            SELECT
                initial_position.id,
                opening.eco_code,
                opening.name
            FROM chess_opening_positions initial_position
            LEFT JOIN chess_openings opening
              ON opening.id = initial_position.opening_id
            WHERE initial_position.epd = :epd
            LIMIT 1
        SQL);
        $initialStatement->execute([
            'epd' => 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
        ]);
        $initial = $initialStatement->fetch(PDO::FETCH_ASSOC);

        $moveStatement = $this->pdo->prepare(<<<'SQL'
            SELECT
                book_move.from_position_id,
                book_move.uci,
                next_position.id,
                opening.eco_code,
                opening.name
            FROM chess_opening_moves book_move
            JOIN chess_opening_positions next_position
              ON next_position.id = book_move.to_position_id
            LEFT JOIN chess_openings opening
              ON opening.id = next_position.opening_id
        SQL);
        $moveStatement->execute();
        $rows = $moveStatement->fetchAll(PDO::FETCH_ASSOC);

        $moves = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $moves[(string) $row['from_position_id']][strtolower(trim((string) $row['uci']))] = [
                'id' => (string) $row['id'],
                'eco_code' => $row['eco_code'] === null ? null : (string) $row['eco_code'],
                'name' => $row['name'] === null ? null : (string) $row['name'],
            ];
        }

        return [
            'initial' => is_array($initial) ? [
                'id' => (string) $initial['id'],
                'eco_code' => $initial['eco_code'] === null ? null : (string) $initial['eco_code'],
                'name' => $initial['name'] === null ? null : (string) $initial['name'],
            ] : null,
            'moves' => $moves,
        ];
    }

    /**
     * @param list<string> $uciMoves
     * @param array{
     *   initial: array{id: string, eco_code: string|null, name: string|null}|null,
     *   moves: array<string, array<string, array{id: string, eco_code: string|null, name: string|null}>>
     * } $openingGraph
     * @return array{on_book: bool, eco_code: string|null, name: string|null}
     */
    private function openingForMovesFromGraph(array $uciMoves, array $openingGraph): array
    {
        if ($openingGraph['initial'] === null) {
            return $this->offBookOpening();
        }

        $currentPositionId = $openingGraph['initial']['id'];
        $currentOpening = [
            'eco_code' => $openingGraph['initial']['eco_code'],
            'name' => $openingGraph['initial']['name'],
        ];

        foreach ($uciMoves as $uci) {
            $nextPosition = $openingGraph['moves'][$currentPositionId][strtolower(trim($uci))] ?? null;
            if ($nextPosition === null) {
                return $this->offBookOpening();
            }

            $currentPositionId = $nextPosition['id'];
            if ($nextPosition['eco_code'] !== null || $nextPosition['name'] !== null) {
                $currentOpening = [
                    'eco_code' => $nextPosition['eco_code'],
                    'name' => $nextPosition['name'],
                ];
            }
        }

        return [
            'on_book' => true,
            'eco_code' => $currentOpening['eco_code'],
            'name' => $currentOpening['name'],
        ];
    }

    /** @return array{on_book: false, eco_code: null, name: null} */
    private function offBookOpening(): array
    {
        return [
            'on_book' => false,
            'eco_code' => null,
            'name' => null,
        ];
    }

    /**
     * @param array<string, mixed> $game
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $identity
     * @param array{on_book: bool, eco_code: string|null, name: string|null}|null $opening
     * @return array<string, mixed>
     */
    private function presentGame(array $game, array $players, array $identity, bool $includeLegalMoves, ?array $opening = null): array
    {
        $state = $this->engine->detectState((string) $game['current_fen']);
        if (($state['ok'] ?? false) !== true) {
            throw new ApiException(500, 'invalid_game_state', 'The stored chess position could not be evaluated.');
        }

        $viewerSeat = $this->ownedSeat($players, $identity);
        $currentSeat = $this->currentTurnSeat($players, (string) $game['side_to_move']);
        $canControlTurn = $currentSeat !== null && $this->canActAsSeat($game, $players, $currentSeat, $identity);
        $pendingTakebackBy = $game['pending_takeback_by_player_id'] !== null ? (string) $game['pending_takeback_by_player_id'] : null;
        $pendingTakebackRequester = $pendingTakebackBy !== null ? $this->playerById($players, $pendingTakebackBy) : null;
        $opening ??= (new ChessOpeningBookQuery($this->pdo))->query($this->loadMoveUciForGame((string) $game['id']));
        $payload = [
            'id' => (string) $game['public_id'],
            'variant' => (string) $game['variant'],
            'mode' => $this->modeFromStoredGame($game, $players),
            'status' => (string) $game['status'],
            'current_ply' => (int) $game['current_ply'],
            'result' => (string) $game['result'],
            'termination' => $game['termination'] !== null ? (string) $game['termination'] : null,
            'opening' => $opening,
            'takeback' => [
                'pending' => $pendingTakebackBy !== null,
                'requested_by_player_id' => $pendingTakebackBy,
                'requested_by_color' => $pendingTakebackRequester !== null ? (string) $pendingTakebackRequester['color'] : null,
                'requested_at' => $game['pending_takeback_requested_at'] !== null ? (string) $game['pending_takeback_requested_at'] : null,
                'viewer_requested' => $viewerSeat !== null && $pendingTakebackBy === (string) $viewerSeat['id'],
                'viewer_can_accept' => $viewerSeat !== null && $pendingTakebackBy !== null && $pendingTakebackBy !== (string) $viewerSeat['id'],
            ],
            'started_at' => $game['started_at'] !== null ? (string) $game['started_at'] : null,
            'finished_at' => $game['finished_at'] !== null ? (string) $game['finished_at'] : null,
            'last_activity_at' => (string) $game['last_activity_at'],
            'created_at' => (string) $game['created_at'],
            'updated_at' => (string) $game['updated_at'],
            'position' => [
                'fen' => (string) $game['current_fen'],
                'side_to_move' => (string) $game['side_to_move'],
            ],
            'rules_state' => [
                'status' => (string) $state['status'],
                'result' => (string) $state['result'],
                'in_check' => (bool) $state['in_check'],
                'legal_move_count' => (int) $state['legal_move_count'],
                'draw_reason' => $state['draw_reason'] !== null ? (string) $state['draw_reason'] : null,
            ],
            'players' => array_map(fn (array $player): array => $this->presentPlayer($player, $identity), $players),
            'viewer' => [
                'user_id' => isset($identity['user']['id']) ? (string) $identity['user']['id'] : null,
                'guest_profile_id' => isset($identity['guest_profile']['id']) ? (string) $identity['guest_profile']['id'] : null,
                'seat_color' => $viewerSeat !== null ? (string) $viewerSeat['color'] : null,
                'owns_seat' => $viewerSeat !== null,
                'controls_current_turn' => $canControlTurn,
            ],
        ];

        if ($includeLegalMoves) {
            $legalMoves = $this->engine->legalMoves((string) $game['current_fen']);
            $payload['legal_moves'] = ($legalMoves['ok'] ?? false) === true
                ? array_values($legalMoves['moves'] ?? [])
                : [];
        }

        return $payload;
    }

    /**
     * @param array<string, mixed> $player
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    private function presentPlayer(array $player, array $identity): array
    {
        return [
            'id' => (string) $player['id'],
            'color' => (string) $player['color'],
            'display_name' => (string) $player['display_name'],
            'user_id' => $player['user_id'] !== null ? (string) $player['user_id'] : null,
            'guest_profile_id' => $player['guest_profile_id'] !== null ? (string) $player['guest_profile_id'] : null,
            'joined_at' => (string) $player['joined_at'],
            'last_seen_at' => (string) $player['last_seen_at'],
            'claimed' => $this->seatHasIdentity($player),
            'viewer_controls_seat' => $this->identityOwnsSeat($player, $identity),
            'anonymous_local_seat' => !$this->seatHasIdentity($player),
        ];
    }

    /**
     * @param array<string, mixed> $identity
     * @return array{user_id: ?string, guest_profile_id: ?string, display_name: string}
     */
    private function seatActor(array $identity): array
    {
        if (isset($identity['user']['id'])) {
            return [
                'user_id' => (string) $identity['user']['id'],
                'guest_profile_id' => null,
                'display_name' => trim((string) ($identity['user']['display_name'] ?? '')) ?: 'Registered player',
            ];
        }

        if (isset($identity['guest_profile']['id'])) {
            return [
                'user_id' => null,
                'guest_profile_id' => (string) $identity['guest_profile']['id'],
                'display_name' => trim((string) ($identity['guest_profile']['display_name'] ?? '')) ?: 'Guest',
            ];
        }

        throw new ApiException(401, 'identity_required', 'A chess guest identity is required for this request.');
    }

    /** @return array<string, mixed> */
    private function insertPlayerSeat(string $gameId, string $color, ?string $userId, ?string $guestProfileId, string $displayName): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_game_players (game_id, color, user_id, guest_profile_id, display_name)
            VALUES (:game_id, :color, :user_id, :guest_profile_id, :display_name)
            RETURNING id, game_id, color, user_id, guest_profile_id, display_name, joined_at, last_seen_at
        SQL);
        $statement->execute([
            'game_id' => $gameId,
            'color' => $color,
            'user_id' => $userId,
            'guest_profile_id' => $guestProfileId,
            'display_name' => $displayName,
        ]);
        $player = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($player)) {
            throw new \RuntimeException('The chess player seat could not be created.');
        }

        return $player;
    }

    /**
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $identity
     * @return array<string, mixed>|null
     */
    private function ownedSeat(array $players, array $identity): ?array
    {
        foreach ($players as $player) {
            if ($this->identityOwnsSeat($player, $identity)) {
                return $player;
            }
        }

        return null;
    }

    /**
     * @param list<array<string, mixed>> $players
     * @return array<string, mixed>|null
     */
    private function currentTurnSeat(array $players, string $fenTurn): ?array
    {
        $color = $fenTurn === 'b' ? 'black' : 'white';

        return $this->seatByColor($players, $color);
    }

    /**
     * @param list<array<string, mixed>> $players
     * @return array<string, mixed>|null
     */
    private function seatByColor(array $players, string $color): ?array
    {
        foreach ($players as $player) {
            if ((string) $player['color'] === $color) {
                return $player;
            }
        }

        return null;
    }

    /**
     * @param list<array<string, mixed>> $players
     * @return array<string, mixed>|null
     */
    private function playerById(array $players, string $playerId): ?array
    {
        foreach ($players as $player) {
            if ((string) $player['id'] === $playerId) {
                return $player;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $game */
    private function assertTakebackAvailable(array $game): void
    {
        if (!in_array($game['status'], ['waiting', 'active'], true)) {
            throw new ApiException(409, 'game_finished', 'This game can no longer process takebacks.');
        }
        if ((int) $game['current_ply'] <= 0) {
            throw new ApiException(409, 'takeback_unavailable', 'There is no move to take back in this game.');
        }
    }

    /** @param array<string, mixed> $game */
    private function rollbackLatestMove(array $game): void
    {
        $currentPly = (int) $game['current_ply'];
        $previousPly = $currentPly - 1;
        $status = $previousPly === 0 ? 'waiting' : 'active';

        $gameStatement = $this->pdo->prepare(<<<'SQL'
            UPDATE chess_games
            SET current_ply = :previous_ply,
                status = :status,
                result = CASE WHEN status IN ('completed', 'abandoned') THEN '*' ELSE result END,
                termination = CASE WHEN status IN ('completed', 'abandoned') THEN NULL ELSE termination END,
                finished_at = CASE WHEN status IN ('completed', 'abandoned') THEN NULL ELSE finished_at END,
                pending_takeback_by_player_id = NULL,
                pending_takeback_requested_at = NULL,
                last_activity_at = now(),
                updated_at = now()
            WHERE id = :id
        SQL);
        $gameStatement->execute([
            'previous_ply' => $previousPly,
            'status' => $status,
            'id' => $game['id'],
        ]);

        $moveStatement = $this->pdo->prepare(<<<'SQL'
            DELETE FROM chess_game_moves
            WHERE game_id = :game_id
              AND ply = :ply
        SQL);
        $moveStatement->execute([
            'game_id' => $game['id'],
            'ply' => $currentPly,
        ]);
        if ($moveStatement->rowCount() !== 1) {
            throw new \RuntimeException('The current chess move could not be removed.');
        }

        $positionStatement = $this->pdo->prepare(<<<'SQL'
            DELETE FROM chess_game_positions
            WHERE game_id = :game_id
              AND ply = :ply
        SQL);
        $positionStatement->execute([
            'game_id' => $game['id'],
            'ply' => $currentPly,
        ]);
        if ($positionStatement->rowCount() !== 1) {
            throw new \RuntimeException('The current chess position could not be removed.');
        }
    }

    /**
     * @param array<string, mixed> $game
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $seat
     * @param array<string, mixed> $identity
     */
    private function assertCanActAsSeat(array $game, array $players, array $seat, array $identity): void
    {
        if (!$this->canActAsSeat($game, $players, $seat, $identity)) {
            throw new ApiException(403, 'move_not_authorized', 'That identity does not control the side to move in this chess game.');
        }
    }

    /**
     * @param array<string, mixed> $game
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $seat
     * @param array<string, mixed> $identity
     */
    private function canActAsSeat(array $game, array $players, array $seat, array $identity): bool
    {
        if ($this->identityOwnsSeat($seat, $identity)) {
            return true;
        }

        return !$this->seatHasIdentity($seat)
            && (string) $game['status'] === 'active'
            && $this->identityOwnsAnySeat($players, $identity);
    }

    /**
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $identity
     */
    private function identityOwnsAnySeat(array $players, array $identity): bool
    {
        foreach ($players as $player) {
            if ($this->identityOwnsSeat($player, $identity)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $seat
     * @param array<string, mixed> $identity
     */
    private function identityOwnsSeat(array $seat, array $identity): bool
    {
        if ($seat['user_id'] !== null && isset($identity['user']['id']) && (string) $seat['user_id'] === (string) $identity['user']['id']) {
            return true;
        }

        return $seat['guest_profile_id'] !== null
            && isset($identity['guest_profile']['id'])
            && (string) $seat['guest_profile_id'] === (string) $identity['guest_profile']['id'];
    }

    /** @param array<string, mixed> $seat */
    private function seatHasIdentity(array $seat): bool
    {
        return $seat['user_id'] !== null || $seat['guest_profile_id'] !== null;
    }

    /**
     * @param array<string, mixed> $game
     * @param list<array<string, mixed>> $players
     */
    private function modeFromStoredGame(array $game, array $players): string
    {
        foreach ($players as $player) {
            if (!$this->seatHasIdentity($player)) {
                return (string) $game['status'] === 'waiting' ? 'online' : 'local';
            }
        }

        return 'online';
    }

    private function nextStoredStatus(string $currentStatus, array $players, array $state): string
    {
        if (($state['status'] ?? 'ongoing') !== 'ongoing') {
            return 'completed';
        }

        return $currentStatus === 'waiting' && $this->allSeatsClaimed($players)
            ? 'active'
            : $currentStatus;
    }

    /** @param list<array<string, mixed>> $players */
    private function allSeatsClaimed(array $players): bool
    {
        if (count($players) < 2) {
            return false;
        }

        foreach ($players as $player) {
            if (!$this->seatHasIdentity($player)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $state */
    private function terminationFromState(array $state): ?string
    {
        return match ((string) ($state['status'] ?? 'ongoing')) {
            'checkmate' => 'checkmate',
            'stalemate' => 'stalemate',
            'draw' => (string) ($state['draw_reason'] ?? 'draw'),
            default => null,
        };
    }

    private function normalizeMode(mixed $value): string
    {
        $mode = strtolower(trim((string) $value));
        if (!in_array($mode, ['online', 'local'], true)) {
            throw new ApiException(422, 'validation_error', 'mode must be online or local.', [
                'mode' => 'Choose either online or local.',
            ]);
        }

        return $mode;
    }

    private function normalizeVariant(mixed $value): string
    {
        $variant = strtolower(trim((string) $value));
        if ($variant === 'standard' || $variant === '') {
            return 'standard';
        }
        if ($variant === 'chess960') {
            throw new ApiException(422, 'unsupported_variant', 'The current chess rules engine supports only the standard starting position.');
        }

        throw new ApiException(422, 'validation_error', 'variant must be standard.', [
            'variant' => 'Only the standard chess starting position is currently supported.',
        ]);
    }

    private function normalizeColor(mixed $value, string $field): string
    {
        $color = strtolower(trim((string) $value));
        if (!in_array($color, ['white', 'black'], true)) {
            throw new ApiException(422, 'validation_error', $field . ' must be white or black.', [
                $field => 'Choose either white or black.',
            ]);
        }

        return $color;
    }

    /**
     * @param mixed $value
     * @return list<array<string, mixed>>
     */
    private function normalizeInitialLinks(mixed $value): array
    {
        if ($value === null || $value === []) {
            return [];
        }
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'validation_error', 'links must be an array of play or spectate link descriptors.');
        }

        $links = [];
        foreach ($value as $index => $linkValue) {
            if (!is_array($linkValue)) {
                throw new ApiException(422, 'validation_error', 'Each links entry must be an object.', [
                    'links' => 'Entry ' . $index . ' must be a JSON object.',
                ]);
            }
            $links[] = $this->normalizeLinkInput($linkValue);
        }

        return $links;
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    private function normalizeLinkInput(array $input): array
    {
        $type = strtolower(trim((string) ($input['type'] ?? '')));
        if (!in_array($type, ['play', 'spectate'], true)) {
            throw new ApiException(422, 'validation_error', 'type must be play or spectate.', [
                'type' => 'Choose play or spectate.',
            ]);
        }

        $seatColor = $input['seat_color'] ?? null;
        if ($type === 'play') {
            $seatColor = $this->normalizeColor($seatColor ?? '', 'seat_color');
        } elseif ($seatColor !== null && trim((string) $seatColor) !== '') {
            throw new ApiException(422, 'validation_error', 'spectate links cannot target a seat color.', [
                'seat_color' => 'Omit seat_color for spectate links.',
            ]);
        } else {
            $seatColor = null;
        }

        $expiresIn = $input['expires_in_seconds'] ?? null;
        if ($expiresIn !== null) {
            if (!is_int($expiresIn) && !ctype_digit((string) $expiresIn)) {
                throw new ApiException(422, 'validation_error', 'expires_in_seconds must be a positive integer when provided.', [
                    'expires_in_seconds' => 'Use a whole number of seconds.',
                ]);
            }
            $expiresIn = (int) $expiresIn;
            if ($expiresIn <= 0 || $expiresIn > 2_592_000) {
                throw new ApiException(422, 'validation_error', 'expires_in_seconds must be between 1 and 2592000.', [
                    'expires_in_seconds' => 'Choose a value between 1 second and 30 days.',
                ]);
            }
        }

        return [
            'type' => $type,
            'seat_color' => $seatColor,
            'expires_in_seconds' => $expiresIn,
        ];
    }

    private function startingFenForVariant(string $variant): string
    {
        if ($variant !== 'standard') {
            throw new ApiException(422, 'unsupported_variant', 'Only standard chess is currently supported.');
        }

        return Board::STARTING_FEN;
    }

    private function emptySeatDisplayName(string $color, string $mode): string
    {
        return $mode === 'local'
            ? 'Local ' . ucfirst($color)
            : 'Open ' . ucfirst($color);
    }

    private function normalizeUuid(string $value, string $field): string
    {
        $value = strtolower(trim($value));
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $value)) {
            throw new ApiException(422, 'validation_error', $field . ' must be a UUID.', [
                $field => 'Provide a valid UUID.',
            ]);
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $creatorSeat
     * @param array<string, mixed> $linkInput
     * @return array<string, mixed>
     */
    private function createStoredLink(string $gameId, string $publicId, array $creatorSeat, array $linkInput): array
    {
        $players = $this->loadPlayersForGame($gameId);
        if (($linkInput['type'] ?? null) === 'play') {
            $seat = $this->seatByColor($players, (string) $linkInput['seat_color']);
            if ($seat === null) {
                throw new ApiException(409, 'seat_unavailable', 'That game no longer has the requested player seat.');
            }
            if ($this->seatHasIdentity($seat)) {
                throw new ApiException(409, 'seat_unavailable', 'That player seat has already been claimed.');
            }
        }

        $rawToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $tokenHash = hash('sha256', $rawToken);
        $expiresAt = null;
        if (($linkInput['expires_in_seconds'] ?? null) !== null) {
            $expiresAt = gmdate(DATE_ATOM, time() + (int) $linkInput['expires_in_seconds']);
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_game_links (game_id, token_hash, link_type, seat_color, created_by_player_id, expires_at)
            VALUES (:game_id, :token_hash, :link_type, :seat_color, :created_by_player_id, :expires_at)
            RETURNING id, link_type, seat_color, expires_at, created_at
        SQL);
        $statement->execute([
            'game_id' => $gameId,
            'token_hash' => $tokenHash,
            'link_type' => $linkInput['type'],
            'seat_color' => $linkInput['seat_color'],
            'created_by_player_id' => $creatorSeat['id'],
            'expires_at' => $expiresAt,
        ]);
        $link = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($link)) {
            throw new \RuntimeException('The chess link could not be created.');
        }

        return [
            'id' => (string) $link['id'],
            'type' => (string) $link['link_type'],
            'seat_color' => $link['seat_color'] !== null ? (string) $link['seat_color'] : null,
            'expires_at' => $link['expires_at'] !== null ? (string) $link['expires_at'] : null,
            'created_at' => (string) $link['created_at'],
            'token' => $rawToken,
            'url' => '/chess/?join=' . rawurlencode($rawToken),
            'game_public_id' => $publicId,
        ];
    }
}
