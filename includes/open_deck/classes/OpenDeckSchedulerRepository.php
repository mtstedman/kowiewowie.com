<?php

declare(strict_types=1);

namespace Wowie\Api\OpenDeck;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use PDO;
use PDOException;
use Throwable;
use Wowie\Api\ApiException;

final class OpenDeckSchedulerRepository
{
    private const EVICTION_VOTE_THRESHOLD = 3;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return list<array<string, mixed>> */
    public function listSlots(int $limit = 100, int $offset = 0): array
    {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);

        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id, start_at, end_at, status, filled_nomination_id, eviction_vote_threshold,
                   filled_at, closed_at, last_activity_at, created_at, updated_at
            FROM open_deck_slots
            ORDER BY start_at ASC, created_at ASC
            LIMIT :limit OFFSET :offset
        SQL);
        $statement->bindValue('limit', $limit, PDO::PARAM_INT);
        $statement->bindValue('offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $slots = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $slot) {
            $slots[] = $this->formatSlot($slot);
        }

        return $slots;
    }

    /** @return array<string, mixed> */
    public function findSlot(string $slotId): array
    {
        return $this->formatSlot($this->loadSlot($slotId));
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function createSlot(array $input): array
    {
        $startAt = $this->normalizeTimestamp($input['start_at'] ?? null, 'start_at');
        $endAt = $this->normalizeTimestamp($input['end_at'] ?? null, 'end_at');
        $this->assertOrderedTimes($startAt, $endAt);

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO open_deck_slots (start_at, end_at, eviction_vote_threshold)
            VALUES (:start_at, :end_at, :eviction_vote_threshold)
            RETURNING id
        SQL);
        $statement->execute([
            'start_at' => $startAt,
            'end_at' => $endAt,
            'eviction_vote_threshold' => self::EVICTION_VOTE_THRESHOLD,
        ]);
        $slotId = $statement->fetchColumn();
        if (!is_string($slotId)) {
            throw new \RuntimeException('The open-deck slot row could not be created.');
        }

        return $this->findSlot($slotId);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function updateSlot(string $slotId, array $input): array
    {
        $this->pdo->beginTransaction();
        try {
            $slot = $this->loadSlot($slotId, true);
            $startAt = array_key_exists('start_at', $input)
                ? $this->normalizeTimestamp($input['start_at'], 'start_at')
                : (string) $slot['start_at'];
            $endAt = array_key_exists('end_at', $input)
                ? $this->normalizeTimestamp($input['end_at'], 'end_at')
                : (string) $slot['end_at'];
            $this->assertOrderedTimes($startAt, $endAt);

            $status = (string) $slot['status'];
            if (array_key_exists('status', $input)) {
                $status = strtolower(trim((string) $input['status']));
                if (!in_array($status, ['open', 'closed'], true)) {
                    throw new ApiException(422, 'validation_error', 'status must be open or closed.', [
                        'status' => 'Choose open or closed.',
                    ]);
                }
            }
            if ((string) $slot['status'] === 'filled' && ($status !== 'filled' || $startAt !== (string) $slot['start_at'] || $endAt !== (string) $slot['end_at'])) {
                throw new ApiException(409, 'slot_filled', 'Filled open-deck slots cannot be edited.');
            }

            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE open_deck_slots
                SET start_at = :start_at,
                    end_at = :end_at,
                    status = :status,
                    closed_at = CASE WHEN :closed_status = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
                    last_activity_at = now()
                WHERE id = :id
            SQL);
            $statement->execute([
                'id' => $slot['id'],
                'start_at' => $startAt,
                'end_at' => $endAt,
                'status' => $status,
                'closed_status' => $status,
            ]);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findSlot($slotId);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function nominateSet(string $slotId, array $input): array
    {
        $setName = $this->normalizeName($input['set_name'] ?? $input['name'] ?? null, 'set_name');
        $nominatedBy = $this->normalizeOptionalName($input['nominated_by'] ?? $input['voter_identity'] ?? $input['voter'] ?? null, 'nominated_by');

        $this->pdo->beginTransaction();
        try {
            $slot = $this->loadSlot($slotId, true);
            $this->assertOpenSlot($slot);

            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO open_deck_set_nominations (slot_id, set_name, nominated_by)
                VALUES (:slot_id, :set_name, :nominated_by)
            SQL);
            try {
                $statement->execute([
                    'slot_id' => $slot['id'],
                    'set_name' => $setName,
                    'nominated_by' => $nominatedBy,
                ]);
            } catch (PDOException $error) {
                if (($error->errorInfo[0] ?? null) === '23505') {
                    throw new ApiException(409, 'duplicate_nomination', 'That set has already been nominated for this slot.');
                }
                throw $error;
            }

            $this->touchSlot((string) $slot['id']);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findSlot($slotId);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function castFillVote(string $slotId, array $input): array
    {
        $nominationId = $this->normalizeUuid((string) ($input['nomination_id'] ?? ''), 'nomination_id');
        $voter = $this->normalizeVoter($input);

        $this->pdo->beginTransaction();
        try {
            $slot = $this->loadSlot($slotId, true);
            $this->assertOpenSlot($slot);
            $nomination = $this->loadNomination((string) $slot['id'], $nominationId, true);
            if ((string) $nomination['status'] !== 'eligible') {
                throw new ApiException(409, 'nomination_not_eligible', 'Only eligible set nominations can receive fill votes.');
            }

            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO open_deck_fill_votes (slot_id, nomination_id, voter_identity_hash, voter_display_name)
                VALUES (:slot_id, :nomination_id, :voter_identity_hash, :voter_display_name)
            SQL);
            try {
                $statement->execute([
                    'slot_id' => $slot['id'],
                    'nomination_id' => $nomination['id'],
                    'voter_identity_hash' => $voter['hash'],
                    'voter_display_name' => $voter['display'],
                ]);
            } catch (PDOException $error) {
                if (($error->errorInfo[0] ?? null) === '23505') {
                    throw new ApiException(409, 'duplicate_vote', 'That voter has already voted for this set nomination.');
                }
                throw $error;
            }

            $this->touchSlot((string) $slot['id']);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findSlot($slotId);
    }

    /** @return array<string, mixed> */
    public function resolveSlot(string $slotId): array
    {
        $this->pdo->beginTransaction();
        try {
            $slot = $this->loadSlot($slotId, true);
            $this->assertOpenSlot($slot);
            $winner = $this->winningEligibleNomination((string) $slot['id']);
            if ($winner === null) {
                throw new ApiException(409, 'no_fill_votes', 'This slot has no eligible fill votes to resolve.');
            }

            $this->fillSlotWithNomination((string) $slot['id'], (string) $winner['id']);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findSlot($slotId);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function castEvictionVote(string $slotId, array $input): array
    {
        $voter = $this->normalizeVoter($input);

        $this->pdo->beginTransaction();
        try {
            $slot = $this->loadSlot($slotId, true);
            if ((string) $slot['status'] === 'closed') {
                throw new ApiException(409, 'slot_closed', 'Closed open-deck slots do not accept eviction votes.');
            }
            if ((string) $slot['status'] !== 'filled' || $slot['filled_nomination_id'] === null) {
                throw new ApiException(409, 'slot_not_filled', 'Only a filled open-deck slot can receive eviction votes.');
            }
            $targetNominationId = array_key_exists('nomination_id', $input)
                ? $this->normalizeUuid((string) $input['nomination_id'], 'nomination_id')
                : (string) $slot['filled_nomination_id'];
            if ($targetNominationId !== (string) $slot['filled_nomination_id']) {
                throw new ApiException(409, 'nomination_not_filled', 'Eviction votes can target only the currently filled set.');
            }
            $target = $this->loadNomination((string) $slot['id'], $targetNominationId, true);

            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO open_deck_eviction_votes (slot_id, target_nomination_id, voter_identity_hash, voter_display_name)
                VALUES (:slot_id, :target_nomination_id, :voter_identity_hash, :voter_display_name)
            SQL);
            try {
                $statement->execute([
                    'slot_id' => $slot['id'],
                    'target_nomination_id' => $target['id'],
                    'voter_identity_hash' => $voter['hash'],
                    'voter_display_name' => $voter['display'],
                ]);
            } catch (PDOException $error) {
                if (($error->errorInfo[0] ?? null) === '23505') {
                    throw new ApiException(409, 'duplicate_vote', 'That voter has already voted to evict this filled set.');
                }
                throw $error;
            }

            $evictionVotes = $this->evictionVoteCount((string) $target['id']);
            if ($evictionVotes >= (int) $slot['eviction_vote_threshold']) {
                $this->evictFilledNomination((string) $slot['id'], (string) $target['id']);
                $nextWinner = $this->winningEligibleNomination((string) $slot['id']);
                if ($nextWinner !== null) {
                    $this->fillSlotWithNomination((string) $slot['id'], (string) $nextWinner['id']);
                } else {
                    $this->openSlotAfterEviction((string) $slot['id']);
                }
            } else {
                $this->touchSlot((string) $slot['id']);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->findSlot($slotId);
    }

    /** @return array<string, mixed> */
    private function loadSlot(string $slotId, bool $forUpdate = false): array
    {
        $slotId = $this->normalizeUuid($slotId, 'slot_id');
        $statement = $this->pdo->prepare((<<<'SQL'
            SELECT id, start_at, end_at, status, filled_nomination_id, eviction_vote_threshold,
                   filled_at, closed_at, last_activity_at, created_at, updated_at
            FROM open_deck_slots
            WHERE id = :id
            LIMIT 1
        SQL) . ($forUpdate ? ' FOR UPDATE' : ''));
        $statement->execute(['id' => $slotId]);
        $slot = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($slot)) {
            throw new ApiException(404, 'slot_not_found', 'That open-deck slot does not exist.');
        }

        return $slot;
    }

    /** @return array<string, mixed> */
    private function loadNomination(string $slotId, string $nominationId, bool $forUpdate = false): array
    {
        $statement = $this->pdo->prepare((<<<'SQL'
            SELECT id, slot_id, set_name, nominated_by, status, filled_at, evicted_at, created_at, updated_at
            FROM open_deck_set_nominations
            WHERE slot_id = :slot_id AND id = :id
            LIMIT 1
        SQL) . ($forUpdate ? ' FOR UPDATE' : ''));
        $statement->execute([
            'slot_id' => $slotId,
            'id' => $nominationId,
        ]);
        $nomination = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($nomination)) {
            throw new ApiException(404, 'nomination_not_found', 'That open-deck set nomination does not exist.');
        }

        return $nomination;
    }

    /** @param array<string, mixed> $slot */
    private function assertOpenSlot(array $slot): void
    {
        if ((string) $slot['status'] === 'closed') {
            throw new ApiException(409, 'slot_closed', 'Closed open-deck slots do not accept scheduler actions.');
        }
        if ((string) $slot['status'] !== 'open') {
            throw new ApiException(409, 'slot_not_open', 'Only open open-deck slots can accept this action.');
        }
    }

    private function touchSlot(string $slotId): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE open_deck_slots
            SET last_activity_at = now()
            WHERE id = :id
        SQL);
        $statement->execute(['id' => $slotId]);
    }

    private function fillSlotWithNomination(string $slotId, string $nominationId): void
    {
        $nominationStatement = $this->pdo->prepare(<<<'SQL'
            UPDATE open_deck_set_nominations
            SET status = 'filled', filled_at = COALESCE(filled_at, now())
            WHERE slot_id = :slot_id AND id = :id
        SQL);
        $nominationStatement->execute([
            'slot_id' => $slotId,
            'id' => $nominationId,
        ]);

        $slotStatement = $this->pdo->prepare(<<<'SQL'
            UPDATE open_deck_slots
            SET status = 'filled', filled_nomination_id = :nomination_id, filled_at = now(),
                closed_at = NULL, last_activity_at = now()
            WHERE id = :slot_id
        SQL);
        $slotStatement->execute([
            'slot_id' => $slotId,
            'nomination_id' => $nominationId,
        ]);
    }

    private function evictFilledNomination(string $slotId, string $nominationId): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE open_deck_set_nominations
            SET status = 'evicted', evicted_at = now()
            WHERE slot_id = :slot_id AND id = :id
        SQL);
        $statement->execute([
            'slot_id' => $slotId,
            'id' => $nominationId,
        ]);
    }

    private function openSlotAfterEviction(string $slotId): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            UPDATE open_deck_slots
            SET status = 'open', filled_nomination_id = NULL, filled_at = NULL,
                closed_at = NULL, last_activity_at = now()
            WHERE id = :slot_id
        SQL);
        $statement->execute(['slot_id' => $slotId]);
    }

    /** @return array<string, mixed>|null */
    private function winningEligibleNomination(string $slotId): ?array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT n.id, n.slot_id, n.set_name, n.nominated_by, n.status, n.filled_at, n.evicted_at,
                   n.created_at, n.updated_at, COUNT(v.id) AS fill_vote_count
            FROM open_deck_set_nominations n
            LEFT JOIN open_deck_fill_votes v ON v.nomination_id = n.id
            WHERE n.slot_id = :slot_id AND n.status = 'eligible'
            GROUP BY n.id, n.slot_id, n.set_name, n.nominated_by, n.status, n.filled_at, n.evicted_at, n.created_at, n.updated_at
            HAVING COUNT(v.id) > 0
            ORDER BY COUNT(v.id) DESC, n.created_at ASC, n.id ASC
            LIMIT 1
        SQL);
        $statement->execute(['slot_id' => $slotId]);
        $winner = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($winner) ? $winner : null;
    }

    private function evictionVoteCount(string $nominationId): int
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT COUNT(*)
            FROM open_deck_eviction_votes
            WHERE target_nomination_id = :target_nomination_id
        SQL);
        $statement->execute(['target_nomination_id' => $nominationId]);

        return (int) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $slot
     * @return array<string, mixed>
     */
    private function formatSlot(array $slot): array
    {
        $nominations = $this->nominationsForSlot((string) $slot['id']);
        $filledNomination = null;
        $currentWinner = null;

        foreach ($nominations as $nomination) {
            if ($slot['filled_nomination_id'] !== null && (string) $nomination['id'] === (string) $slot['filled_nomination_id']) {
                $filledNomination = $nomination;
            }
            if ((string) $nomination['status'] !== 'eligible' || (int) $nomination['fill_vote_count'] === 0) {
                continue;
            }
            if ($currentWinner === null
                || (int) $nomination['fill_vote_count'] > (int) $currentWinner['fill_vote_count']
                || ((int) $nomination['fill_vote_count'] === (int) $currentWinner['fill_vote_count'] && (string) $nomination['created_at'] < (string) $currentWinner['created_at'])) {
                $currentWinner = $nomination;
            }
        }

        return [
            'id' => (string) $slot['id'],
            'start_at' => (string) $slot['start_at'],
            'end_at' => (string) $slot['end_at'],
            'status' => (string) $slot['status'],
            'eviction_vote_threshold' => (int) $slot['eviction_vote_threshold'],
            'filled_at' => $slot['filled_at'] === null ? null : (string) $slot['filled_at'],
            'closed_at' => $slot['closed_at'] === null ? null : (string) $slot['closed_at'],
            'filled_nomination' => $filledNomination,
            'current_winner' => $filledNomination ?? $currentWinner,
            'nominations' => $nominations,
            'created_at' => (string) $slot['created_at'],
            'updated_at' => (string) $slot['updated_at'],
        ];
    }

    /** @return list<array<string, mixed>> */
    private function nominationsForSlot(string $slotId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT n.id, n.slot_id, n.set_name, n.nominated_by, n.status, n.filled_at, n.evicted_at,
                   n.created_at, n.updated_at,
                   COUNT(DISTINCT fv.id) AS fill_vote_count,
                   COUNT(DISTINCT ev.id) AS eviction_vote_count
            FROM open_deck_set_nominations n
            LEFT JOIN open_deck_fill_votes fv ON fv.nomination_id = n.id
            LEFT JOIN open_deck_eviction_votes ev ON ev.target_nomination_id = n.id
            WHERE n.slot_id = :slot_id
            GROUP BY n.id, n.slot_id, n.set_name, n.nominated_by, n.status, n.filled_at, n.evicted_at, n.created_at, n.updated_at
            ORDER BY n.created_at ASC, n.id ASC
        SQL);
        $statement->execute(['slot_id' => $slotId]);

        $nominations = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $nomination) {
            $nominations[] = [
                'id' => (string) $nomination['id'],
                'slot_id' => (string) $nomination['slot_id'],
                'set_name' => (string) $nomination['set_name'],
                'nominated_by' => $nomination['nominated_by'] === null ? null : (string) $nomination['nominated_by'],
                'status' => (string) $nomination['status'],
                'fill_vote_count' => (int) $nomination['fill_vote_count'],
                'eviction_vote_count' => (int) $nomination['eviction_vote_count'],
                'filled_at' => $nomination['filled_at'] === null ? null : (string) $nomination['filled_at'],
                'evicted_at' => $nomination['evicted_at'] === null ? null : (string) $nomination['evicted_at'],
                'created_at' => (string) $nomination['created_at'],
                'updated_at' => (string) $nomination['updated_at'],
            ];
        }

        return $nominations;
    }

    private function normalizeTimestamp(mixed $value, string $field): string
    {
        if (!is_string($value) || trim($value) === '') {
            throw new ApiException(422, 'validation_error', $field . ' must be a timestamp string.', [
                $field => 'Provide an ISO-8601 timestamp.',
            ]);
        }
        $timestamp = trim($value);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $timestamp)) {
            throw new ApiException(422, 'validation_error', $field . ' must be an ISO-8601 timestamp with a timezone.', [
                $field => 'Use a value such as 2026-08-17T20:00:00Z.',
            ]);
        }

        try {
            $date = new DateTimeImmutable($timestamp);
        } catch (\Exception) {
            throw new ApiException(422, 'validation_error', $field . ' must be a valid timestamp.', [
                $field => 'Provide a parseable ISO-8601 timestamp.',
            ]);
        }

        return $date->setTimezone(new DateTimeZone('UTC'))->format(DateTimeInterface::ATOM);
    }

    private function assertOrderedTimes(string $startAt, string $endAt): void
    {
        if (strtotime($endAt) <= strtotime($startAt)) {
            throw new ApiException(422, 'validation_error', 'end_at must be later than start_at.', [
                'end_at' => 'Choose an end_at after start_at.',
            ]);
        }
    }

    private function normalizeName(mixed $value, string $field): string
    {
        if (!is_string($value)) {
            throw new ApiException(422, 'validation_error', $field . ' must contain between 1 and 120 characters.', [
                $field => 'Provide a non-empty string.',
            ]);
        }
        $name = trim(preg_replace('/\s+/', ' ', $value) ?? '');
        if ($name === '' || mb_strlen($name) > 120) {
            throw new ApiException(422, 'validation_error', $field . ' must contain between 1 and 120 characters.', [
                $field => 'Provide a non-empty string no longer than 120 characters.',
            ]);
        }

        return $name;
    }

    private function normalizeOptionalName(mixed $value, string $field): ?string
    {
        if ($value === null) {
            return null;
        }

        return $this->normalizeName($value, $field);
    }

    /**
     * @param array<string, mixed> $input
     * @return array{hash: string, display: string}
     */
    private function normalizeVoter(array $input): array
    {
        $display = $this->normalizeName($input['voter_identity'] ?? $input['voter'] ?? null, 'voter_identity');
        $identityKey = mb_strtolower($display);

        return [
            'hash' => hash('sha256', $identityKey),
            'display' => $display,
        ];
    }

    private function normalizeUuid(string $value, string $field): string
    {
        $value = strtolower(trim($value));
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/', $value)) {
            throw new ApiException(422, 'validation_error', $field . ' must be a valid UUID.', [
                $field => 'Provide a UUID.',
            ]);
        }

        return $value;
    }
}
