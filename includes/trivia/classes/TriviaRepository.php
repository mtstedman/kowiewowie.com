<?php

declare(strict_types=1);

namespace Wowie\Api\Trivia;

use PDO;
use Throwable;
use Wowie\Api\ApiException;

final class TriviaRepository
{
    private readonly TriviaQuestionCatalog $questionCatalog;

    public function __construct(private readonly PDO $pdo)
    {
        $this->questionCatalog = new TriviaQuestionCatalog();
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function createRoom(array $input, array $identity): array
    {
        $maxPlayers = $this->normalizeMaxPlayers($input['max_players'] ?? 6);
        $answerWindowSeconds = $this->normalizeAnswerWindow($input['answer_window_seconds'] ?? 30);
        $promptMinimum = $maxPlayers;
        $promptInput = $input['prompts'] ?? null;
        $prompts = $promptInput === null ? null : $this->normalizePrompts($promptInput, $promptMinimum);
        $actor = $this->seatActor($identity);
        $createdLinks = [];
        $hostRejoinLink = null;
        $publicId = null;

        $this->pdo->beginTransaction();
        try {
            $roomStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO trivia_rooms (max_players, answer_window_seconds)
                VALUES (:max_players, :answer_window_seconds)
                RETURNING id, public_id
            SQL);
            $roomStatement->execute([
                'max_players' => $maxPlayers,
                'answer_window_seconds' => $answerWindowSeconds,
            ]);
            $room = $roomStatement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($room)) {
                throw new \RuntimeException('The trivia room row could not be created.');
            }

            $roomId = (string) $room['id'];
            $publicId = (string) $room['public_id'];
            $host = $this->insertPlayer($roomId, 1, $actor['user_id'], $actor['guest_profile_id'], $actor['display_name'], 'host');
            $hostRejoinLink = $this->createRecoveryLinkForPlayer($publicId, $host);

            $hostStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_rooms
                SET host_player_id = :host_player_id,
                    updated_at = now()
                WHERE id = :id
            SQL);
            $hostStatement->execute([
                'host_player_id' => $host['id'],
                'id' => $roomId,
            ]);

            $roomPrompts = $prompts ?? $this->loadDefaultPrompts($promptMinimum);
            shuffle($roomPrompts);
            $this->insertPrompts($roomId, $roomPrompts);
            $linkInput = $this->normalizeLinkInput($input['link'] ?? []);
            for ($seat = 2; $seat <= $maxPlayers; $seat++) {
                $createdLinks[] = $this->createStoredLink($roomId, $publicId, $host, $linkInput);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if ($publicId === null) {
            throw new \RuntimeException('The new trivia room is missing its public identifier.');
        }

        $room = $this->findRoom($publicId, $identity);
        if ($hostRejoinLink !== null) {
            $room['rejoin_link'] = $hostRejoinLink;
        }
        $room['created_links'] = $createdLinks;

        return $room;
    }

    /** @return list<array<string, mixed>> */
    public function listRoomsForIdentity(array $identity, int $limit = 100, int $offset = 0): array
    {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);
        $conditions = [];
        $params = [];
        if (isset($identity['guest_profile']['id'])) {
            $conditions[] = 'p.guest_profile_id = :guest_profile_id';
            $params['guest_profile_id'] = (string) $identity['guest_profile']['id'];
        }
        if (isset($identity['user']['id'])) {
            $conditions[] = 'p.user_id = :user_id';
            $params['user_id'] = (string) $identity['user']['id'];
        }
        if ($conditions === []) {
            return [];
        }

        $statement = $this->pdo->prepare(sprintf(<<<'SQL'
            SELECT r.*
            FROM trivia_rooms r
            WHERE EXISTS (
                SELECT 1
                FROM trivia_players p
                WHERE p.room_id = r.id
                  AND (%s)
            )
            ORDER BY
                CASE WHEN r.status IN ('waiting', 'active') THEN 0 ELSE 1 END,
                r.last_activity_at DESC,
                r.created_at DESC
            LIMIT :limit
            OFFSET :offset
        SQL, implode(' OR ', $conditions)));
        foreach ($params as $name => $value) {
            $statement->bindValue(':' . $name, $value, PDO::PARAM_STR);
        }
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $rooms = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $room) {
            $rooms[] = $this->presentRoom($room, $identity);
        }

        return $rooms;
    }

    /** @return array<string, mixed> */
    public function findRoom(string $publicId, array $identity): array
    {
        return $this->presentRoom($this->loadRoomByPublicId($publicId), $identity);
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    public function createLink(string $publicId, array $input, array $identity): array
    {
        $this->pdo->beginTransaction();
        try {
            $room = $this->loadRoomByPublicId($publicId, true);
            $this->assertRoomMutable($room, 'create invitation links for');
            $players = $this->loadPlayersForRoom((string) $room['id'], true);
            $host = $this->assertHost($room, $players, $identity);
            $link = $this->createStoredLink((string) $room['id'], (string) $room['public_id'], $host, $this->normalizeLinkInput($input));
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $link;
    }

    /** @return array<string, mixed> */
    public function claimLink(string $token, array $identity): array
    {
        $token = $this->normalizeToken($token);
        $publicId = null;
        $rejoinLink = null;

        $this->pdo->beginTransaction();
        try {
            $link = $this->loadJoinLinkForUpdate($token);
            $publicId = (string) $link['public_id'];
            if ((string) $link['room_status'] !== 'waiting') {
                throw new ApiException(409, 'join_closed', 'That trivia room is no longer accepting players.');
            }

            $players = $this->loadPlayersForRoom((string) $link['room_id'], true);
            $existingSeat = $this->ownedSeat($players, $identity);
            if ($existingSeat === null) {
                $activeCount = $this->activePlayerCount($players);
                if ($activeCount >= (int) $link['max_players']) {
                    throw new ApiException(409, 'room_full', 'That trivia room already has the maximum number of players.');
                }
                $actor = $this->seatActor($identity);
                $seatNumber = $this->nextSeatNumber($players, (int) $link['max_players']);
                $existingSeat = $this->insertPlayer((string) $link['room_id'], $seatNumber, $actor['user_id'], $actor['guest_profile_id'], $actor['display_name'], 'player');
                $rejoinLink = $this->createRecoveryLinkForPlayer($publicId, $existingSeat);
            }

            $claimStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO trivia_link_claims (link_id, room_id, player_id)
                VALUES (:link_id, :room_id, :player_id)
                ON CONFLICT (link_id, player_id) DO NOTHING
            SQL);
            $claimStatement->execute([
                'link_id' => $link['id'],
                'room_id' => $link['room_id'],
                'player_id' => $existingSeat['id'],
            ]);

            $touchStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_players
                SET last_seen_at = now()
                WHERE id = :id
            SQL);
            $touchStatement->execute(['id' => $existingSeat['id']]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if ($publicId === null) {
            throw new \RuntimeException('The claimed trivia link is missing its room identifier.');
        }

        $room = $this->findRoom($publicId, $identity);
        if ($rejoinLink !== null) {
            $room['rejoin_link'] = $rejoinLink;
        }

        return $room;
    }

    /** @return array<string, mixed> */
    public function rejoinPlayer(string $token, array $identity, ?string $expectedPublicId = null): array
    {
        $token = $this->normalizeRecoveryToken($token);
        $expectedPublicId = $expectedPublicId !== null && trim($expectedPublicId) !== ''
            ? $this->normalizeUuid($expectedPublicId, 'room_id')
            : null;
        $actor = $this->seatActor($identity);
        $publicId = null;
        $seat = null;

        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                SELECT p.id, p.room_id, p.seat_number, p.role, p.user_id, p.guest_profile_id,
                       p.display_name, p.status, p.eliminated_round_id, p.joined_at, p.last_seen_at,
                       r.public_id, r.status AS room_status
                FROM trivia_players p
                JOIN trivia_rooms r ON r.id = p.room_id
                WHERE p.recovery_token_hash = :token_hash
                LIMIT 1
                FOR UPDATE OF p, r
            SQL);
            $statement->execute(['token_hash' => hash('sha256', $token)]);
            $seat = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($seat)) {
                throw new ApiException(404, 'rejoin_not_found', 'That trivia rejoin link is not valid.');
            }

            $publicId = (string) $seat['public_id'];
            if ($expectedPublicId !== null && $expectedPublicId !== $publicId) {
                throw new ApiException(409, 'rejoin_room_mismatch', 'That trivia rejoin link belongs to a different room.');
            }

            $players = $this->loadPlayersForRoom((string) $seat['room_id'], true);
            $ownedSeat = $this->ownedSeat($players, $identity);
            if ($ownedSeat !== null && (string) $ownedSeat['id'] !== (string) $seat['id']) {
                throw new ApiException(409, 'identity_already_seated', 'That identity already occupies a different seat in this trivia room.');
            }

            $updateStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_players
                SET user_id = :user_id,
                    guest_profile_id = :guest_profile_id,
                    display_name = :display_name,
                    last_seen_at = now(),
                    recovery_token_last_used_at = now()
                WHERE id = :id
            SQL);
            $updateStatement->execute([
                'user_id' => $actor['user_id'],
                'guest_profile_id' => $actor['guest_profile_id'],
                'display_name' => $actor['display_name'],
                'id' => $seat['id'],
            ]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        if ($publicId === null || !is_array($seat)) {
            throw new \RuntimeException('The trivia rejoin link is missing its room identifier.');
        }

        $room = $this->findRoom($publicId, $identity);
        $room['rejoin_link'] = $this->rejoinLinkFromToken($publicId, $token, (int) $seat['seat_number']);

        return $room;
    }

    /** @return array<string, mixed> */
    public function startRoom(string $publicId, array $identity): array
    {
        $this->pdo->beginTransaction();
        try {
            $room = $this->loadRoomByPublicId($publicId, true);
            if ((string) $room['status'] !== 'waiting') {
                throw new ApiException(409, 'room_not_waiting', 'Only a waiting trivia room can be started.');
            }
            $players = $this->loadPlayersForRoom((string) $room['id'], true);
            $this->assertHost($room, $players, $identity);
            $activePlayerCount = $this->activePlayerCount($players);
            if ($activePlayerCount < 2) {
                throw new ApiException(409, 'not_enough_players', 'A trivia room needs at least two seated players before it can start.');
            }
            $this->ensurePromptSupplyAvailable($room, $activePlayerCount);

            $this->openRound($room, 1);
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_rooms
                SET status = 'active',
                    current_round_number = 1,
                    started_at = COALESCE(started_at, now()),
                    last_activity_at = now(),
                    updated_at = now()
                WHERE id = :id
            SQL);
            $statement->execute(['id' => $room['id']]);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findRoom($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function advanceRound(string $publicId, array $input, array $identity): array
    {
        $action = strtolower(trim((string) ($input['action'] ?? 'advance')));
        if (!in_array($action, ['advance', 'resolve'], true)) {
            throw new ApiException(422, 'validation_error', 'action must be advance or resolve.', [
                'action' => 'Choose advance or resolve.',
            ]);
        }
        $force = (bool) ($input['force'] ?? false);

        $this->pdo->beginTransaction();
        try {
            $room = $this->loadRoomByPublicId($publicId, true);
            if ((string) $room['status'] === 'finished') {
                throw new ApiException(409, 'game_finished', 'This trivia game is already finished.');
            }
            if ((string) $room['status'] !== 'active') {
                throw new ApiException(409, 'room_not_active', 'Only an active trivia room can advance rounds.');
            }
            $players = $this->loadPlayersForRoom((string) $room['id'], true);
            $this->assertHost($room, $players, $identity);
            $round = $this->loadCurrentRound((string) $room['id'], true);
            if ($round === null) {
                $this->openRound($room, 1);
                $this->pdo->commit();
                return $this->findRoom($publicId, $identity);
            }

            if ((string) $round['status'] === 'answering') {
                if (!$force && strtotime((string) $round['closes_at']) > time()) {
                    throw new ApiException(409, 'answer_window_open', 'The current trivia answer window is still open.');
                }
                $this->resolveRound($round);
                $players = $this->loadPlayersForRoom((string) $room['id'], true);
                if ($this->finishIfResolved($room, $players, 'elimination')) {
                    $this->pdo->commit();
                    return $this->findRoom($publicId, $identity);
                }
                if ($action === 'resolve') {
                    $this->pdo->commit();
                    return $this->findRoom($publicId, $identity);
                }
            }

            $this->openNextRoundOrFinish($room, $players, $round);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findRoom($publicId, $identity);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function submitAnswer(string $publicId, array $input, array $identity): array
    {
        $answer = trim((string) ($input['answer'] ?? ''));
        if ($answer === '' || mb_strlen($answer) > 200) {
            throw new ApiException(422, 'validation_error', 'answer must contain between 1 and 200 characters.', [
                'answer' => 'Provide the selected answer text.',
            ]);
        }
        $clientAnswerId = $input['client_answer_id'] ?? null;
        if ($clientAnswerId !== null) {
            $clientAnswerId = $this->normalizeUuid((string) $clientAnswerId, 'client_answer_id');
        }

        $this->pdo->beginTransaction();
        try {
            $room = $this->loadRoomByPublicId($publicId, true);
            if ((string) $room['status'] === 'finished') {
                throw new ApiException(409, 'game_finished', 'This trivia game is already finished.');
            }
            if ((string) $room['status'] !== 'active') {
                throw new ApiException(409, 'room_not_active', 'Trivia answers are accepted only after the game starts.');
            }
            $players = $this->loadPlayersForRoom((string) $room['id'], true);
            $seat = $this->ownedSeat($players, $identity);
            if ($seat === null) {
                throw new ApiException(403, 'seat_required', 'Only a seated trivia player can submit answers.');
            }
            if ((string) $seat['status'] !== 'active') {
                throw new ApiException(409, 'player_eliminated', 'Eliminated trivia players cannot submit answers.');
            }

            $round = $this->loadCurrentRound((string) $room['id'], true);
            if ($round === null || (string) $round['status'] !== 'answering') {
                throw new ApiException(409, 'answer_window_closed', 'There is no open trivia answer window.');
            }
            if (strtotime((string) $round['closes_at']) <= time()) {
                throw new ApiException(409, 'answer_window_closed', 'The current trivia answer window has closed.');
            }
            if ($this->hasAnswer((string) $round['id'], (string) $seat['id'])) {
                throw new ApiException(409, 'duplicate_answer', 'That player has already answered this trivia round.');
            }
            if ($clientAnswerId !== null && $this->clientAnswerIdUsed((string) $room['id'], $clientAnswerId)) {
                throw new ApiException(409, 'duplicate_answer', 'That client_answer_id has already been used in this trivia room.');
            }

            $isCorrect = $this->normalizeAnswer($answer) === $this->normalizeAnswer((string) $round['correct_answer']);
            $answerStatement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO trivia_answers (room_id, round_id, player_id, client_answer_id, answer_text, is_correct)
                VALUES (:room_id, :round_id, :player_id, COALESCE(CAST(:client_answer_id AS uuid), gen_random_uuid()), :answer_text, :is_correct)
            SQL);
            $answerStatement->execute([
                'room_id' => $room['id'],
                'round_id' => $round['id'],
                'player_id' => $seat['id'],
                'client_answer_id' => $clientAnswerId,
                'answer_text' => $answer,
                'is_correct' => $isCorrect,
            ]);

            $touchStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_players
                SET last_seen_at = now()
                WHERE id = :id
            SQL);
            $touchStatement->execute(['id' => $seat['id']]);

            if ($this->allEligiblePlayersAnswered($round)) {
                $this->resolveRound($round);
                $players = $this->loadPlayersForRoom((string) $room['id'], true);
                if (!$this->finishIfResolved($room, $players, 'elimination')) {
                    $this->openNextRoundOrFinish($room, $players, $round);
                }
            } else {
                $activityStatement = $this->pdo->prepare(<<<'SQL'
                    UPDATE trivia_rooms
                    SET last_activity_at = now(), updated_at = now()
                    WHERE id = :id
                SQL);
                $activityStatement->execute(['id' => $room['id']]);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findRoom($publicId, $identity);
    }

    /** @param array<string, mixed> $room */
    private function assertRoomMutable(array $room, string $action): void
    {
        if ((string) $room['status'] === 'finished') {
            throw new ApiException(409, 'game_finished', 'This trivia game can no longer ' . $action . ' this room.');
        }
    }

    /** @return array<string, mixed> */
    private function loadRoomByPublicId(string $publicId, bool $forUpdate = false): array
    {
        $publicId = $this->normalizeUuid($publicId, 'room_id');
        $statement = $this->pdo->prepare((<<<'SQL'
            SELECT id, public_id, status, max_players, answer_window_seconds, host_player_id,
                   current_round_number, winner_player_id, termination, started_at, finished_at,
                   last_activity_at, created_at, updated_at
            FROM trivia_rooms
            WHERE public_id = :public_id
            LIMIT 1
        SQL) . ($forUpdate ? ' FOR UPDATE' : ''));
        $statement->execute(['public_id' => $publicId]);
        $room = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($room)) {
            throw new ApiException(404, 'room_not_found', 'That trivia room does not exist.');
        }

        return $room;
    }

    /** @return array<string, mixed> */
    private function loadJoinLinkForUpdate(string $token): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT l.id, l.room_id, l.expires_at, l.revoked_at, r.public_id, r.status AS room_status, r.max_players
            FROM trivia_room_links l
            JOIN trivia_rooms r ON r.id = l.room_id
            WHERE l.token_hash = :token_hash
              AND l.link_type = 'join'
            LIMIT 1
            FOR UPDATE OF l, r
        SQL);
        $statement->execute(['token_hash' => hash('sha256', $token)]);
        $link = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($link)) {
            throw new ApiException(404, 'link_not_found', 'That trivia join link is invalid.');
        }
        if ($link['revoked_at'] !== null) {
            throw new ApiException(409, 'link_revoked', 'That trivia join link has been revoked.');
        }
        if ($link['expires_at'] !== null && strtotime((string) $link['expires_at']) <= time()) {
            throw new ApiException(410, 'link_expired', 'That trivia join link has expired.');
        }

        return $link;
    }

    /** @return list<array<string, mixed>> */
    private function loadPlayersForRoom(string $roomId, bool $forUpdate = false): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, room_id, seat_number, role, user_id, guest_profile_id, display_name,
                   status, eliminated_round_id, joined_at, last_seen_at
            FROM trivia_players
            WHERE room_id = :room_id
            ORDER BY seat_number ASC
        SQL . ($forUpdate ? ' FOR UPDATE' : ''));
        $statement->execute(['room_id' => $roomId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<string, mixed>|null */
    private function loadCurrentRound(string $roomId, bool $forUpdate = false): ?array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT r.id, r.room_id, r.round_number, r.prompt_id, r.status, r.answer_window_seconds,
                   r.opened_at, r.closes_at, r.resolved_at, p.question, p.correct_answer,
                   p.choices, p.explanation
            FROM trivia_rounds r
            JOIN trivia_prompts p ON p.id = r.prompt_id
            WHERE r.room_id = :room_id
            ORDER BY r.round_number DESC
            LIMIT 1
        SQL . ($forUpdate ? ' FOR UPDATE OF r' : ''));
        $statement->execute(['room_id' => $roomId]);
        $round = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($round) ? $round : null;
    }

    /** @return array<string, mixed> */
    private function insertPlayer(string $roomId, int $seatNumber, ?string $userId, ?string $guestProfileId, string $displayName, string $role): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO trivia_players (room_id, seat_number, role, user_id, guest_profile_id, display_name)
            VALUES (:room_id, :seat_number, :role, :user_id, :guest_profile_id, :display_name)
            RETURNING id, room_id, seat_number, role, user_id, guest_profile_id, display_name,
                      status, eliminated_round_id, joined_at, last_seen_at
        SQL);
        $statement->execute([
            'room_id' => $roomId,
            'seat_number' => $seatNumber,
            'role' => $role,
            'user_id' => $userId,
            'guest_profile_id' => $guestProfileId,
            'display_name' => $displayName,
        ]);
        $player = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($player)) {
            throw new \RuntimeException('The trivia player seat could not be created.');
        }

        return $player;
    }

    /** @return array<string, mixed> */
    private function createRecoveryLinkForPlayer(string $publicId, array $player): array
    {
        $rawToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE trivia_players
            SET recovery_token_hash = :token_hash,
                recovery_token_created_at = now(),
                recovery_token_last_used_at = NULL
            WHERE id = :id
            RETURNING recovery_token_created_at
        SQL);
        $statement->execute([
            'token_hash' => hash('sha256', $rawToken),
            'id' => $player['id'],
        ]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw new \RuntimeException('The trivia recovery link could not be created.');
        }

        return [
            'token' => $rawToken,
            'url' => $this->rejoinUrl($publicId, $rawToken),
            'room_public_id' => $publicId,
            'seat_number' => (int) $player['seat_number'],
            'created_at' => (string) $row['recovery_token_created_at'],
        ];
    }

    /** @return array<string, mixed> */
    private function rejoinLinkFromToken(string $publicId, string $rawToken, int $seatNumber): array
    {
        return [
            'token' => $rawToken,
            'url' => $this->rejoinUrl($publicId, $rawToken),
            'room_public_id' => $publicId,
            'seat_number' => $seatNumber,
        ];
    }

    private function rejoinUrl(string $publicId, string $rawToken): string
    {
        return '/trivia/game.php?id=' . rawurlencode($publicId) . '&rejoin=' . rawurlencode($rawToken);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadDefaultPrompts(int $minimumPrompts = TriviaQuestionCatalog::MIN_PROMPTS): array
    {
        $minimumPrompts = max(TriviaQuestionCatalog::MIN_PROMPTS, $minimumPrompts);
        $prompts = $this->loadCatalogPrompts();
        if ($prompts !== []) {
            $prompts = $this->questionCatalog->resolve($prompts);
        }
        if (count($prompts) < $minimumPrompts) {
            $repositoryPrompts = $this->loadRepositoryManagedPrompts();
            if (count($repositoryPrompts) >= $minimumPrompts) {
                return array_slice($repositoryPrompts, 0, 100);
            }
        }
        if (count($prompts) === 0) {
            throw new ApiException(409, 'trivia_catalog_unavailable', 'The trivia question catalog does not have any active prompts available before creating or starting a room.');
        }
        if (count($prompts) < $minimumPrompts) {
            throw new ApiException(409, 'trivia_catalog_insufficient', sprintf(
                'The trivia question catalog needs at least %d active prompts before creating or starting this room.',
                $minimumPrompts,
            ));
        }

        return $prompts;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadCatalogPrompts(): array
    {
        $statement = $this->pdo->query(<<<'SQL'
            SELECT question, correct_answer, choices, explanation
            FROM trivia_question_catalog
            WHERE is_active
            ORDER BY display_order ASC, slug ASC
            LIMIT 100
        SQL);
        if ($statement === false) {
            throw new \RuntimeException('The trivia question catalog could not be loaded.');
        }

        $prompts = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $choices = json_decode((string) ($row['choices'] ?? ''), true);
            if (!is_array($choices) || !array_is_list($choices)) {
                throw new ApiException(409, 'trivia_catalog_malformed', 'The trivia question catalog contains a malformed prompt.');
            }
            $prompts[] = [
                'question' => (string) ($row['question'] ?? ''),
                'correct_answer' => (string) ($row['correct_answer'] ?? ''),
                'choices' => $choices,
                'explanation' => $row['explanation'] !== null ? (string) $row['explanation'] : null,
            ];
        }

        return $prompts;
    }

    /**
     * @return list<array{question: string, correct_answer: string, choices: list<string>, explanation: ?string}>
     */
    private function loadRepositoryManagedPrompts(): array
    {
        $path = dirname(__DIR__, 3) . '/database/data/trivia-questions.json';
        if (!is_file($path) || !is_readable($path)) {
            return [];
        }
        $contents = file_get_contents($path);
        if ($contents === false) {
            return [];
        }
        try {
            $items = json_decode($contents, true, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException(409, 'trivia_catalog_malformed', 'The repository trivia question source contains malformed JSON.');
        }
        if (!is_array($items) || !array_is_list($items)) {
            throw new ApiException(409, 'trivia_catalog_malformed', 'The repository trivia question source must contain a JSON array.');
        }

        $preparedItems = [];
        foreach ($items as $index => $item) {
            if (!is_array($item)) {
                throw new ApiException(409, 'trivia_catalog_malformed', 'The repository trivia question source contains a malformed prompt.');
            }
            try {
                $prompt = $this->questionCatalog->resolve([$item])[0];
            } catch (ApiException) {
                throw new ApiException(409, 'trivia_catalog_malformed', 'The repository trivia question source contains a malformed prompt.');
            }
            $isActive = array_key_exists('is_active', $item) ? (bool) $item['is_active'] : true;
            if (!$isActive) {
                continue;
            }
            $preparedItems[] = [
                'display_order' => (int) ($item['display_order'] ?? ($index + 1)),
                'slug' => (string) ($item['slug'] ?? ''),
                'prompt' => $prompt,
            ];
        }

        usort($preparedItems, static function (array $left, array $right): int {
            return ($left['display_order'] <=> $right['display_order']) ?: ($left['slug'] <=> $right['slug']);
        });

        return array_map(static fn (array $item): array => $item['prompt'], $preparedItems);
    }

    /**
     * @param list<array<string, mixed>> $prompts
     */
    private function insertPrompts(string $roomId, array $prompts): void
    {
        foreach ($prompts as $index => $prompt) {
            $this->insertPromptAtOrder($roomId, $prompt, $index + 1);
        }
    }

    /** @param array<string, mixed> $prompt */
    private function insertPromptAtOrder(string $roomId, array $prompt, int $promptOrder): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO trivia_prompts (room_id, prompt_order, question, correct_answer, choices, explanation)
            VALUES (:room_id, :prompt_order, :question, :correct_answer, CAST(:choices AS jsonb), :explanation)
        SQL);
        $statement->execute([
            'room_id' => $roomId,
            'prompt_order' => $promptOrder,
            'question' => $prompt['question'],
            'correct_answer' => $prompt['correct_answer'],
            'choices' => json_encode($prompt['choices'], JSON_THROW_ON_ERROR),
            'explanation' => $prompt['explanation'] ?? null,
        ]);
    }

    /** @param array<string, mixed> $room */
    private function ensurePromptSupplyAvailable(array $room, int $minimumPrompts): void
    {
        $roomId = (string) $room['id'];
        $promptOrders = $this->promptOrdersForRoom($roomId);
        $hasPromptOrders = $promptOrders !== [];
        if (!isset($promptOrders[1]) && $hasPromptOrders) {
            throw new ApiException(409, 'start_prompt_unavailable', 'This trivia room does not have a first prompt available to start.');
        }

        $missingOrders = [];
        $existingRequiredPromptCount = 0;
        for ($promptOrder = 1; $promptOrder <= $minimumPrompts; $promptOrder++) {
            if (isset($promptOrders[$promptOrder])) {
                $existingRequiredPromptCount++;
                continue;
            }
            $missingOrders[] = $promptOrder;
        }
        if ($missingOrders === []) {
            return;
        }

        $defaultPrompts = $this->loadDefaultPrompts($minimumPrompts);
        foreach ($missingOrders as $index => $promptOrder) {
            $this->insertPromptAtOrder($roomId, $defaultPrompts[$existingRequiredPromptCount + $index], $promptOrder);
        }
    }

    /** @return array<int, true> */
    private function promptOrdersForRoom(string $roomId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT prompt_order
            FROM trivia_prompts
            WHERE room_id = :room_id
        SQL);
        $statement->execute(['room_id' => $roomId]);

        $orders = [];
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) ?: [] as $promptOrder) {
            $orders[(int) $promptOrder] = true;
        }

        return $orders;
    }

    /** @param array<string, mixed> $room */
    private function openRound(array $room, int $roundNumber): void
    {
        $promptStatement = $this->pdo->prepare(<<<'SQL'
            SELECT id, question, correct_answer, choices
            FROM trivia_prompts
            WHERE room_id = :room_id
              AND prompt_order = :prompt_order
            LIMIT 1
        SQL);
        $promptStatement->execute([
            'room_id' => $room['id'],
            'prompt_order' => $roundNumber,
        ]);
        $prompt = $promptStatement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($prompt)) {
            throw new ApiException(409, 'prompt_unavailable', 'There is no trivia prompt available for that round.');
        }

        $choices = json_decode((string) ($prompt['choices'] ?? ''), true);
        if (!is_array($choices) || !array_is_list($choices)) {
            throw new ApiException(409, 'prompt_malformed', 'The trivia prompt for that round is malformed and cannot be used.');
        }
        $choices = array_values(array_filter(
            array_map(static fn (mixed $choice): string => trim((string) $choice), $choices),
            static fn (string $choice): bool => $choice !== ''
        ));
        $correctAnswer = trim((string) ($prompt['correct_answer'] ?? ''));
        if (trim((string) ($prompt['question'] ?? '')) === '' || $correctAnswer === '' || count($choices) < 2 || !in_array($correctAnswer, $choices, true)) {
            throw new ApiException(409, 'prompt_malformed', 'The trivia prompt for that round is malformed and cannot be used.');
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO trivia_rounds (room_id, round_number, prompt_id, answer_window_seconds, closes_at)
            VALUES (
                :room_id,
                :round_number,
                :prompt_id,
                :answer_window_seconds,
                now() + (CAST(:answer_window_seconds AS integer) * interval '1 second')
            )
        SQL);
        $statement->execute([
            'room_id' => $room['id'],
            'round_number' => $roundNumber,
            'prompt_id' => (string) $prompt['id'],
            'answer_window_seconds' => (int) $room['answer_window_seconds'],
        ]);
    }

    /** @param array<string, mixed> $round */
    private function resolveRound(array $round): void
    {
        if ((int) $round['round_number'] > 1) {
            $eliminateStatement = $this->pdo->prepare(<<<'SQL'
                UPDATE trivia_players p
                SET status = 'eliminated',
                    eliminated_round_id = :round_id,
                    last_seen_at = now()
                WHERE p.room_id = :room_id
                  AND p.status = 'active'
                  AND (
                      NOT EXISTS (
                          SELECT 1
                          FROM trivia_answers a
                          WHERE a.round_id = :round_id
                            AND a.player_id = p.id
                            AND a.is_correct
                      )
                      OR (
                          :round_number = 2
                          AND EXISTS (
                              SELECT 1
                              FROM trivia_rounds first_round
                              WHERE first_round.room_id = p.room_id
                                AND first_round.round_number = 1
                                AND first_round.status = 'resolved'
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM trivia_answers first_answer
                                    WHERE first_answer.round_id = first_round.id
                                      AND first_answer.player_id = p.id
                                      AND first_answer.is_correct
                                )
                          )
                      )
                  )
            SQL);
            $eliminateStatement->execute([
                'round_id' => $round['id'],
                'room_id' => $round['room_id'],
                'round_number' => (int) $round['round_number'],
            ]);
        }

        $roundStatement = $this->pdo->prepare(<<<'SQL'
            UPDATE trivia_rounds
            SET status = 'resolved',
                resolved_at = now()
            WHERE id = :id
        SQL);
        $roundStatement->execute(['id' => $round['id']]);
    }

    /**
     * @param array<string, mixed> $room
     * @param list<array<string, mixed>> $players
     */
    private function finishIfResolved(array $room, array $players, string $termination): bool
    {
        if ($this->activePlayerCount($players) > 1) {
            return false;
        }
        $this->finishRoom($room, $players, $termination);

        return true;
    }

    /**
     * @param array<string, mixed> $room
     * @param list<array<string, mixed>> $players
     */
    private function finishRoom(array $room, array $players, string $termination): void
    {
        $winner = null;
        foreach ($players as $player) {
            if ((string) $player['status'] === 'active') {
                $winner = (string) $player['id'];
                break;
            }
        }
        if ($this->activePlayerCount($players) !== 1) {
            $winner = null;
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE trivia_rooms
            SET status = 'finished',
                winner_player_id = CAST(:winner_player_id AS uuid),
                termination = :termination,
                finished_at = COALESCE(finished_at, now()),
                last_activity_at = now(),
                updated_at = now()
            WHERE id = :id
        SQL);
        $statement->execute([
            'winner_player_id' => $winner,
            'termination' => $termination,
            'id' => $room['id'],
        ]);
    }

    /**
     * @param array<string, mixed> $room
     * @param list<array<string, mixed>> $players
     * @param array<string, mixed> $round
     */
    private function openNextRoundOrFinish(array $room, array $players, array $round): void
    {
        $nextRound = ((int) $round['round_number']) + 1;
        if (!$this->promptExists((string) $room['id'], $nextRound)) {
            $this->ensurePromptSupplyAvailable($room, $nextRound);
        }
        if (!$this->promptExists((string) $room['id'], $nextRound)) {
            $this->finishRoom($room, $players, 'prompts_exhausted');
            return;
        }

        $this->openRound($room, $nextRound);
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE trivia_rooms
            SET current_round_number = :round_number,
                last_activity_at = now(),
                updated_at = now()
            WHERE id = :id
        SQL);
        $statement->execute([
            'round_number' => $nextRound,
            'id' => $room['id'],
        ]);
    }

    private function allEligiblePlayersAnswered(array $round): bool
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT CASE WHEN NOT EXISTS (
                SELECT 1
                FROM trivia_players p
                WHERE p.room_id = :room_id
                  AND p.status = 'active'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM trivia_answers a
                      WHERE a.round_id = :round_id
                        AND a.player_id = p.id
                  )
            ) THEN 1 ELSE 0 END
        SQL);
        $statement->execute([
            'room_id' => $round['room_id'],
            'round_id' => $round['id'],
        ]);

        return (int) $statement->fetchColumn() === 1;
    }

    private function promptExists(string $roomId, int $roundNumber): bool
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT 1
            FROM trivia_prompts
            WHERE room_id = :room_id
              AND prompt_order = :prompt_order
            LIMIT 1
        SQL);
        $statement->execute([
            'room_id' => $roomId,
            'prompt_order' => $roundNumber,
        ]);

        return $statement->fetchColumn() !== false;
    }

    private function hasAnswer(string $roundId, string $playerId): bool
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT 1
            FROM trivia_answers
            WHERE round_id = :round_id
              AND player_id = :player_id
            LIMIT 1
        SQL);
        $statement->execute([
            'round_id' => $roundId,
            'player_id' => $playerId,
        ]);

        return $statement->fetchColumn() !== false;
    }

    private function clientAnswerIdUsed(string $roomId, string $clientAnswerId): bool
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT 1
            FROM trivia_answers
            WHERE room_id = :room_id
              AND client_answer_id = :client_answer_id
            LIMIT 1
        SQL);
        $statement->execute([
            'room_id' => $roomId,
            'client_answer_id' => $clientAnswerId,
        ]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    private function createStoredLink(string $roomId, string $publicId, array $creatorSeat, array $input): array
    {
        $rawToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $expiresAt = null;
        if (($input['expires_in_seconds'] ?? null) !== null) {
            $expiresAt = gmdate(DATE_ATOM, time() + (int) $input['expires_in_seconds']);
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO trivia_room_links (room_id, token_hash, link_type, created_by_player_id, expires_at)
            VALUES (:room_id, :token_hash, 'join', :created_by_player_id, :expires_at)
            RETURNING id, link_type, expires_at, created_at
        SQL);
        $statement->execute([
            'room_id' => $roomId,
            'token_hash' => hash('sha256', $rawToken),
            'created_by_player_id' => $creatorSeat['id'],
            'expires_at' => $expiresAt,
        ]);
        $link = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($link)) {
            throw new \RuntimeException('The trivia join link could not be created.');
        }

        return [
            'id' => (string) $link['id'],
            'type' => (string) $link['link_type'],
            'expires_at' => $link['expires_at'] !== null ? (string) $link['expires_at'] : null,
            'created_at' => (string) $link['created_at'],
            'token' => $rawToken,
            'url' => '/trivia/?join=' . rawurlencode($rawToken),
            'room_public_id' => $publicId,
        ];
    }

    /**
     * @param array<string, mixed> $room
     * @param array<string, mixed> $identity
     * @return array<string, mixed>
     */
    private function presentRoom(array $room, array $identity): array
    {
        $players = $this->loadPlayersForRoom((string) $room['id']);
        $viewerSeat = $this->ownedSeat($players, $identity);
        $round = $this->loadCurrentRound((string) $room['id']);
        $answerCounts = $round !== null ? $this->answerCounts((string) $round['id']) : ['submitted' => 0, 'correct' => 0];
        $viewerAnswer = $round !== null && $viewerSeat !== null
            ? $this->playerAnswerForRound((string) $round['id'], (string) $viewerSeat['id'])
            : null;

        return [
            'id' => (string) $room['public_id'],
            'status' => (string) $room['status'],
            'max_players' => (int) $room['max_players'],
            'answer_window_seconds' => (int) $room['answer_window_seconds'],
            'current_round_number' => (int) $room['current_round_number'],
            'termination' => $room['termination'] !== null ? (string) $room['termination'] : null,
            'winner_player_id' => $room['winner_player_id'] !== null ? (string) $room['winner_player_id'] : null,
            'started_at' => $room['started_at'] !== null ? (string) $room['started_at'] : null,
            'finished_at' => $room['finished_at'] !== null ? (string) $room['finished_at'] : null,
            'last_activity_at' => (string) $room['last_activity_at'],
            'created_at' => (string) $room['created_at'],
            'updated_at' => (string) $room['updated_at'],
            'players' => array_map(fn (array $player): array => $this->presentPlayer($player, $identity), $players),
            'round' => $round !== null ? $this->presentRound($round, (string) $room['status'], $answerCounts, $viewerAnswer) : null,
            'viewer' => [
                'user_id' => isset($identity['user']['id']) ? (string) $identity['user']['id'] : null,
                'guest_profile_id' => isset($identity['guest_profile']['id']) ? (string) $identity['guest_profile']['id'] : null,
                'player_id' => $viewerSeat !== null ? (string) $viewerSeat['id'] : null,
                'seat_number' => $viewerSeat !== null ? (int) $viewerSeat['seat_number'] : null,
                'is_host' => $viewerSeat !== null && (string) $room['host_player_id'] === (string) $viewerSeat['id'],
                'is_active' => $viewerSeat !== null && (string) $viewerSeat['status'] === 'active',
            ],
        ];
    }

    /** @return array{submitted: int, correct: int} */
    private function answerCounts(string $roundId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT count(*) AS submitted,
                   count(*) FILTER (WHERE is_correct) AS correct
            FROM trivia_answers
            WHERE round_id = :round_id
        SQL);
        $statement->execute(['round_id' => $roundId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'submitted' => (int) ($row['submitted'] ?? 0),
            'correct' => (int) ($row['correct'] ?? 0),
        ];
    }

    /** @return array{answered: bool, answer_text: ?string} */
    private function playerAnswerForRound(string $roundId, string $playerId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT answer_text
            FROM trivia_answers
            WHERE round_id = :round_id
              AND player_id = :player_id
            LIMIT 1
        SQL);
        $statement->execute([
            'round_id' => $roundId,
            'player_id' => $playerId,
        ]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return [
            'answered' => is_array($row),
            'answer_text' => is_array($row) ? (string) $row['answer_text'] : null,
        ];
    }

    /**
     * @param array<string, mixed> $round
     * @param array{submitted: int, correct: int} $answerCounts
     * @param array{answered: bool, answer_text: ?string}|null $viewerAnswer
     * @return array<string, mixed>
     */
    private function presentRound(array $round, string $roomStatus, array $answerCounts, ?array $viewerAnswer): array
    {
        $choices = json_decode((string) $round['choices'], true);
        if (!is_array($choices)) {
            $choices = [];
        }
        $resolved = (string) $round['status'] === 'resolved' || $roomStatus === 'finished';
        $payload = [
            'id' => (string) $round['id'],
            'round_number' => (int) $round['round_number'],
            'status' => (string) $round['status'],
            'answer_window_seconds' => (int) $round['answer_window_seconds'],
            'opened_at' => (string) $round['opened_at'],
            'closes_at' => (string) $round['closes_at'],
            'resolved_at' => $round['resolved_at'] !== null ? (string) $round['resolved_at'] : null,
            'prompt' => [
                'question' => (string) $round['question'],
                'choices' => array_values(array_map(static fn (mixed $choice): string => (string) $choice, $choices)),
            ],
            'answers' => $answerCounts,
            'viewer_answer' => $viewerAnswer ?? ['answered' => false, 'answer_text' => null],
        ];
        if ($resolved) {
            $payload['prompt']['correct_answer'] = (string) $round['correct_answer'];
            $payload['prompt']['explanation'] = $round['explanation'] !== null ? (string) $round['explanation'] : null;
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
            'seat_number' => (int) $player['seat_number'],
            'role' => (string) $player['role'],
            'display_name' => (string) $player['display_name'],
            'user_id' => $player['user_id'] !== null ? (string) $player['user_id'] : null,
            'guest_profile_id' => $player['guest_profile_id'] !== null ? (string) $player['guest_profile_id'] : null,
            'status' => (string) $player['status'],
            'eliminated_round_id' => $player['eliminated_round_id'] !== null ? (string) $player['eliminated_round_id'] : null,
            'joined_at' => (string) $player['joined_at'],
            'last_seen_at' => (string) $player['last_seen_at'],
            'viewer_controls_player' => $this->identityOwnsSeat($player, $identity),
        ];
    }

    /**
     * @param list<array<string, mixed>> $players
     * @return array<string, mixed>
     */
    private function assertHost(array $room, array $players, array $identity): array
    {
        $seat = $this->ownedSeat($players, $identity);
        if ($seat === null || (string) $room['host_player_id'] !== (string) $seat['id']) {
            throw new ApiException(403, 'host_required', 'Only the trivia host can perform that action.');
        }

        return $seat;
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

    /** @param list<array<string, mixed>> $players */
    private function activePlayerCount(array $players): int
    {
        return count(array_filter($players, static fn (array $player): bool => (string) $player['status'] === 'active'));
    }

    /** @param list<array<string, mixed>> $players */
    private function nextSeatNumber(array $players, int $maxPlayers): int
    {
        $used = [];
        foreach ($players as $player) {
            $used[(int) $player['seat_number']] = true;
        }
        for ($seat = 1; $seat <= $maxPlayers; $seat++) {
            if (!isset($used[$seat])) {
                return $seat;
            }
        }

        throw new ApiException(409, 'room_full', 'That trivia room already has the maximum number of players.');
    }

    /**
     * @param array<string, mixed> $identity
     * @return array{user_id: ?string, guest_profile_id: ?string, display_name: string}
     */
    private function seatActor(array $identity): array
    {
        $guestProfileId = isset($identity['guest_profile']['id']) ? (string) $identity['guest_profile']['id'] : null;
        if (isset($identity['user']['id'])) {
            return [
                'user_id' => (string) $identity['user']['id'],
                'guest_profile_id' => $guestProfileId,
                'display_name' => trim((string) ($identity['user']['display_name'] ?? '')) ?: 'Registered player',
            ];
        }
        if ($guestProfileId !== null) {
            return [
                'user_id' => null,
                'guest_profile_id' => $guestProfileId,
                'display_name' => trim((string) ($identity['guest_profile']['display_name'] ?? '')) ?: 'Guest',
            ];
        }

        throw new ApiException(401, 'identity_required', 'A trivia guest identity is required for this request.');
    }

    private function normalizeMaxPlayers(mixed $value): int
    {
        if (!is_int($value) && !ctype_digit((string) $value)) {
            throw new ApiException(422, 'validation_error', 'max_players must be an integer from 2 to 6.', [
                'max_players' => 'Choose a whole number from 2 to 6.',
            ]);
        }
        $maxPlayers = (int) $value;
        if ($maxPlayers < 2 || $maxPlayers > 6) {
            throw new ApiException(422, 'validation_error', 'max_players must be between 2 and 6.', [
                'max_players' => 'Choose a whole number from 2 to 6.',
            ]);
        }

        return $maxPlayers;
    }

    private function normalizeAnswerWindow(mixed $value): int
    {
        if (!is_int($value) && !ctype_digit((string) $value)) {
            throw new ApiException(422, 'validation_error', 'answer_window_seconds must be an integer from 10 to 120.', [
                'answer_window_seconds' => 'Choose a whole number from 10 to 120.',
            ]);
        }
        $seconds = (int) $value;
        if ($seconds < 10 || $seconds > 120) {
            throw new ApiException(422, 'validation_error', 'answer_window_seconds must be between 10 and 120.', [
                'answer_window_seconds' => 'Choose a value between 10 and 120 seconds.',
            ]);
        }

        return $seconds;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function normalizePrompts(mixed $value, int $minimumPrompts = TriviaQuestionCatalog::MIN_PROMPTS): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'validation_error', 'prompts must be a list of trivia prompt objects.');
        }
        $minimumPrompts = max(TriviaQuestionCatalog::MIN_PROMPTS, $minimumPrompts);
        if (count($value) < $minimumPrompts) {
            throw new ApiException(422, 'validation_error', sprintf(
                'prompts must contain at least %d entries for the trivia game.',
                $minimumPrompts,
            ));
        }

        return array_map(fn (mixed $prompt): array => $this->normalizePrompt($prompt), $value);
    }

    /** @return array<string, mixed> */
    private function normalizePrompt(mixed $value): array
    {
        if (!is_array($value)) {
            throw new ApiException(422, 'validation_error', 'Each trivia prompt must be an object.');
        }
        $question = trim((string) ($value['question'] ?? ''));
        $correctAnswer = trim((string) ($value['correct_answer'] ?? $value['answer'] ?? ''));
        if ($question === '' || mb_strlen($question) > 300) {
            throw new ApiException(422, 'validation_error', 'Each prompt question must contain 1 to 300 characters.');
        }
        if ($correctAnswer === '' || mb_strlen($correctAnswer) > 200) {
            throw new ApiException(422, 'validation_error', 'Each prompt correct_answer must contain 1 to 200 characters.');
        }
        $choices = $value['choices'] ?? null;
        if (!is_array($choices) || !array_is_list($choices)) {
            throw new ApiException(422, 'validation_error', 'Prompt choices must be a list of answer strings.');
        }
        $choices = array_values(array_map(static fn (mixed $choice): string => trim((string) $choice), $choices));
        $choices = array_values(array_filter($choices, static fn (string $choice): bool => $choice !== ''));
        if (!in_array($correctAnswer, $choices, true)) {
            $choices[] = $correctAnswer;
        }
        if (count($choices) < 2) {
            throw new ApiException(422, 'validation_error', 'Each prompt must provide at least two answer choices.');
        }

        return [
            'question' => $question,
            'correct_answer' => $correctAnswer,
            'choices' => $choices,
            'explanation' => isset($value['explanation']) ? trim((string) $value['explanation']) : null,
        ];
    }

    /** @return array{expires_in_seconds: ?int} */
    private function normalizeLinkInput(mixed $value): array
    {
        if ($value === null || $value === []) {
            return ['expires_in_seconds' => null];
        }
        if (!is_array($value)) {
            throw new ApiException(422, 'validation_error', 'link must be an object when provided.');
        }
        $expiresIn = $value['expires_in_seconds'] ?? null;
        if ($expiresIn === null) {
            return ['expires_in_seconds' => null];
        }
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

        return ['expires_in_seconds' => $expiresIn];
    }

    private function normalizeToken(string $value): string
    {
        $value = trim($value);
        if (!preg_match('/^[A-Za-z0-9_-]{20,512}$/', $value)) {
            throw new ApiException(422, 'validation_error', 'token must be a valid trivia join token.', [
                'token' => 'Use the token from the shared trivia link.',
            ]);
        }

        return $value;
    }

    private function normalizeRecoveryToken(string $value): string
    {
        $value = trim($value);
        if (!preg_match('/^[A-Za-z0-9_-]{20,512}$/', $value)) {
            throw new ApiException(422, 'validation_error', 'token must be a valid trivia rejoin token.', [
                'token' => 'Use the token from the trivia rejoin link.',
            ]);
        }

        return $value;
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

    private function normalizeAnswer(string $value): string
    {
        return preg_replace('/\s+/', ' ', strtolower(trim($value))) ?? '';
    }
}
