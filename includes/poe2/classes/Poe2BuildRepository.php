<?php

declare(strict_types=1);

namespace Wowie\Api\Poe2;

use PDO;
use Throwable;
use Wowie\Api\ApiException;

/**
 * Saved Path of Exile 2 builds (table poe2_saved_builds).
 *
 * Every statement filters on the owner column, so a build that belongs to another
 * identity is indistinguishable from a build that does not exist.
 */
final class Poe2BuildRepository
{
    public const MAX_BUILDS_PER_OWNER = 100;

    private const MAX_ALLOCATED_NODE_IDS = 2048;
    // The planner sets no must-have limit, and every must-have is an allocatable node, so the
    // allocation cap bounds them too. A cap of 8 here rejected larger marked sets with a 422.
    private const MAX_MUST_HAVE_NODE_IDS = self::MAX_ALLOCATED_NODE_IDS;
    private const NODE_ID_PATTERN = '/\A[A-Za-z0-9_.:-]{1,32}\z/';
    private const UUID_PATTERN = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/';
    private const COLUMNS = 'id, user_id, guest_profile_id, character_name, build_name, class_id, ascendancy_id, '
        . 'tree_version, allocated_node_ids, must_have_node_ids, considered_node_ids, created_at, updated_at';

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array{type: string, id: string} $owner
     * @return list<array<string, mixed>>
     */
    public function listForOwner(array $owner): array
    {
        [$column, $ownerId] = $this->ownerFilter($owner);

        $statement = $this->pdo->prepare(
            'SELECT ' . self::COLUMNS . ' FROM poe2_saved_builds'
            . ' WHERE ' . $column . ' = :owner_id'
            . ' ORDER BY updated_at DESC, id DESC'
            . ' LIMIT ' . self::MAX_BUILDS_PER_OWNER
        );
        $statement->execute(['owner_id' => $ownerId]);

        $builds = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $builds[] = $this->formatBuild($row);
        }

        return $builds;
    }

    /**
     * @param array{type: string, id: string} $owner
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function create(array $owner, array $input): array
    {
        [$column, $ownerId] = $this->ownerFilter($owner);
        $fields = $this->normalizeInput($input);

        $ownsTransaction = !$this->pdo->inTransaction();
        if ($ownsTransaction) {
            $this->pdo->beginTransaction();
        }

        try {
            // Serialize creates per owner so concurrent requests cannot exceed the build limit.
            $lock = $this->pdo->prepare('SELECT pg_advisory_xact_lock(hashtext(:lock_key))');
            $lock->execute(['lock_key' => 'poe2_saved_builds:' . $column . ':' . $ownerId]);

            $count = $this->pdo->prepare('SELECT count(*) FROM poe2_saved_builds WHERE ' . $column . ' = :owner_id');
            $count->execute(['owner_id' => $ownerId]);
            if ((int) $count->fetchColumn() >= self::MAX_BUILDS_PER_OWNER) {
                throw new ApiException(409, 'build_limit_reached', 'You have reached the limit of 100 saved builds. Delete one to save another.');
            }

            $statement = $this->pdo->prepare(
                'INSERT INTO poe2_saved_builds (' . $column . ', character_name, build_name, class_id, ascendancy_id,'
                . ' tree_version, allocated_node_ids, must_have_node_ids, considered_node_ids)'
                . ' VALUES (:owner_id, :character_name, :build_name, :class_id, :ascendancy_id,'
                . ' :tree_version, CAST(:allocated_node_ids AS jsonb), CAST(:must_have_node_ids AS jsonb),'
                . " COALESCE(CAST(:considered_node_ids AS jsonb), '[]'::jsonb))"
                . ' RETURNING ' . self::COLUMNS
            );
            $statement->execute(['owner_id' => $ownerId] + $this->writeParameters($fields));
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($row)) {
                throw new \RuntimeException('The saved build row could not be created.');
            }

            if ($ownsTransaction) {
                $this->pdo->commit();
            }
        } catch (Throwable $error) {
            if ($ownsTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return $this->formatBuild($row);
    }

    /**
     * @param array{type: string, id: string} $owner
     * @return array<string, mixed>
     */
    public function find(array $owner, string $id): array
    {
        [$column, $ownerId] = $this->ownerFilter($owner);
        $buildId = $this->normalizeBuildId($id);

        $statement = $this->pdo->prepare(
            'SELECT ' . self::COLUMNS . ' FROM poe2_saved_builds'
            . ' WHERE id = :id AND ' . $column . ' = :owner_id'
            . ' LIMIT 1'
        );
        $statement->execute(['id' => $buildId, 'owner_id' => $ownerId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw $this->notFound();
        }

        return $this->formatBuild($row);
    }

    /**
     * Full replace of every writable field, except that an absent considered list keeps the
     * stored one: clients from before that field existed must not wipe it.
     *
     * @param array{type: string, id: string} $owner
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function update(array $owner, string $id, array $input): array
    {
        [$column, $ownerId] = $this->ownerFilter($owner);
        $buildId = $this->normalizeBuildId($id);
        $fields = $this->normalizeInput($input);

        $statement = $this->pdo->prepare(
            'UPDATE poe2_saved_builds'
            . ' SET character_name = :character_name,'
            . ' build_name = :build_name,'
            . ' class_id = :class_id,'
            . ' ascendancy_id = :ascendancy_id,'
            . ' tree_version = :tree_version,'
            . ' allocated_node_ids = CAST(:allocated_node_ids AS jsonb),'
            . ' must_have_node_ids = CAST(:must_have_node_ids AS jsonb),'
            . ' considered_node_ids = COALESCE(CAST(:considered_node_ids AS jsonb), considered_node_ids)'
            . ' WHERE id = :id AND ' . $column . ' = :owner_id'
            . ' RETURNING ' . self::COLUMNS
        );
        $statement->execute(['id' => $buildId, 'owner_id' => $ownerId] + $this->writeParameters($fields));
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw $this->notFound();
        }

        return $this->formatBuild($row);
    }

    /**
     * Moves a guest's saved builds to a signed-in user, most recently updated first, up to the
     * user's free build slots; any that do not fit stay with the guest. It takes the same
     * per-owner advisory locks as create(), always user before guest, so the limit holds and
     * concurrent adoptions cannot deadlock.
     *
     * @return array{adopted: int, remaining: int}
     */
    public function adoptGuestBuilds(string $guestProfileId, string $userId): array
    {
        [$guestColumn, $guestId] = $this->ownerFilter(['type' => 'guest', 'id' => $guestProfileId]);
        [$userColumn, $ownerId] = $this->ownerFilter(['type' => 'user', 'id' => $userId]);

        $ownsTransaction = !$this->pdo->inTransaction();
        if ($ownsTransaction) {
            $this->pdo->beginTransaction();
        }

        try {
            $lock = $this->pdo->prepare('SELECT pg_advisory_xact_lock(hashtext(:lock_key))');
            $lock->execute(['lock_key' => 'poe2_saved_builds:' . $userColumn . ':' . $ownerId]);
            $lock->execute(['lock_key' => 'poe2_saved_builds:' . $guestColumn . ':' . $guestId]);

            $count = $this->pdo->prepare('SELECT count(*) FROM poe2_saved_builds WHERE user_id = :user_id');
            $count->execute(['user_id' => $ownerId]);
            $room = max(0, self::MAX_BUILDS_PER_OWNER - (int) $count->fetchColumn());

            $adopted = 0;
            if ($room > 0) {
                $move = $this->pdo->prepare(
                    'UPDATE poe2_saved_builds SET user_id = :user_id, guest_profile_id = NULL'
                    . ' WHERE id IN (SELECT id FROM poe2_saved_builds WHERE guest_profile_id = :guest_id'
                    . ' ORDER BY updated_at DESC, id LIMIT :room)'
                );
                $move->bindValue('user_id', $ownerId);
                $move->bindValue('guest_id', $guestId);
                $move->bindValue('room', $room, PDO::PARAM_INT);
                $move->execute();
                $adopted = $move->rowCount();
            }

            $left = $this->pdo->prepare('SELECT count(*) FROM poe2_saved_builds WHERE guest_profile_id = :guest_id');
            $left->execute(['guest_id' => $guestId]);
            $remaining = (int) $left->fetchColumn();

            if ($ownsTransaction) {
                $this->pdo->commit();
            }
        } catch (Throwable $error) {
            if ($ownsTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return ['adopted' => $adopted, 'remaining' => $remaining];
    }

    /**
     * @param array{type: string, id: string} $owner
     */
    public function delete(array $owner, string $id): void
    {
        [$column, $ownerId] = $this->ownerFilter($owner);
        $buildId = $this->normalizeBuildId($id);

        $statement = $this->pdo->prepare(
            'DELETE FROM poe2_saved_builds WHERE id = :id AND ' . $column . ' = :owner_id'
        );
        $statement->execute(['id' => $buildId, 'owner_id' => $ownerId]);
        if ($statement->rowCount() === 0) {
            throw $this->notFound();
        }
    }

    /**
     * Maps the owner onto a fixed column name; the column never comes from request data.
     *
     * @param array<string, mixed> $owner
     * @return array{0: string, 1: string}
     */
    private function ownerFilter(array $owner): array
    {
        $column = match ($owner['type'] ?? null) {
            'user' => 'user_id',
            'guest' => 'guest_profile_id',
            default => throw new \InvalidArgumentException('The build owner type must be user or guest.'),
        };

        $ownerId = $owner['id'] ?? null;
        if (!is_string($ownerId) || preg_match(self::UUID_PATTERN, strtolower($ownerId)) !== 1) {
            throw new \InvalidArgumentException('The build owner id must be a UUID.');
        }

        return [$column, strtolower($ownerId)];
    }

    private function normalizeBuildId(string $id): string
    {
        $id = strtolower($id);
        if (preg_match(self::UUID_PATTERN, $id) !== 1) {
            throw $this->notFound();
        }

        return $id;
    }

    private function notFound(): ApiException
    {
        return new ApiException(404, 'build_not_found', 'That saved build does not exist.');
    }

    /**
     * @param array<string, mixed> $input
     * @return array{character_name: string, build_name: string, class_id: string, ascendancy_id: ?string, tree_version: string, allocated_node_ids: list<string>, must_have_node_ids: list<string>, considered_node_ids: ?list<string>}
     */
    private function normalizeInput(array $input): array
    {
        $errors = [];

        $fields = [
            'character_name' => $this->textField($input, 'character_name', 64, $errors),
            'build_name' => $this->textField($input, 'build_name', 80, $errors),
            'class_id' => $this->textField($input, 'class_id', 64, $errors),
            'ascendancy_id' => ($input['ascendancy_id'] ?? null) === null
                ? null
                : $this->textField($input, 'ascendancy_id', 64, $errors),
            'tree_version' => $this->textField($input, 'tree_version', 32, $errors),
            'allocated_node_ids' => $this->nodeIdList($input, 'allocated_node_ids', self::MAX_ALLOCATED_NODE_IDS, $errors),
            'must_have_node_ids' => $this->nodeIdList($input, 'must_have_node_ids', self::MAX_MUST_HAVE_NODE_IDS, $errors),
            // Optional, for clients from before the considered list existed; null means "not sent".
            'considered_node_ids' => array_key_exists('considered_node_ids', $input)
                ? $this->nodeIdList($input, 'considered_node_ids', self::MAX_ALLOCATED_NODE_IDS, $errors)
                : null,
        ];

        if ($errors !== []) {
            throw new ApiException(422, 'validation_failed', 'The build could not be saved because some fields are invalid.', $errors);
        }

        return $fields;
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, string> $errors
     */
    private function textField(array $input, string $field, int $maxLength, array &$errors): string
    {
        $value = $input[$field] ?? null;
        if (!is_string($value)) {
            $errors[$field] = $value === null
                ? "{$field} is required."
                : "{$field} must be a string.";
            return '';
        }

        $value = trim($value);
        if ($value === '') {
            $errors[$field] = "{$field} must not be empty.";
            return '';
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            $errors[$field] = "{$field} must not contain control characters.";
            return '';
        }
        if (mb_strlen($value, 'UTF-8') > $maxLength) {
            $errors[$field] = "{$field} must be at most {$maxLength} characters.";
            return '';
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, string> $errors
     * @return list<string>
     */
    private function nodeIdList(array $input, string $field, int $maxCount, array &$errors): array
    {
        $value = $input[$field] ?? null;
        // The value must arrive with its wire-level type: a JSON array is a PHP list, while a
        // JSON object is a stdClass (never an array), so {"0":"a"} cannot pass as ["a"].
        if (!is_array($value) || !array_is_list($value)) {
            $errors[$field] = "{$field} must be an array of node id strings.";
            return [];
        }
        if (count($value) > $maxCount) {
            $errors[$field] = "{$field} must contain at most {$maxCount} node ids.";
            return [];
        }

        $seen = [];
        foreach ($value as $nodeId) {
            if (!is_string($nodeId) || preg_match(self::NODE_ID_PATTERN, $nodeId) !== 1) {
                $errors[$field] = "{$field} must contain only node ids of 1-32 characters using letters, digits, '_', '.', ':' or '-'.";
                return [];
            }
            if (isset($seen[$nodeId])) {
                $errors[$field] = "{$field} must not contain duplicate node ids.";
                return [];
            }
            $seen[$nodeId] = true;
        }

        return $value;
    }

    /**
     * @param array{character_name: string, build_name: string, class_id: string, ascendancy_id: ?string, tree_version: string, allocated_node_ids: list<string>, must_have_node_ids: list<string>, considered_node_ids: ?list<string>} $fields
     * @return array<string, ?string>
     */
    private function writeParameters(array $fields): array
    {
        return [
            'character_name' => $fields['character_name'],
            'build_name' => $fields['build_name'],
            'class_id' => $fields['class_id'],
            'ascendancy_id' => $fields['ascendancy_id'],
            'tree_version' => $fields['tree_version'],
            'allocated_node_ids' => json_encode($fields['allocated_node_ids'], JSON_THROW_ON_ERROR),
            'must_have_node_ids' => json_encode($fields['must_have_node_ids'], JSON_THROW_ON_ERROR),
            'considered_node_ids' => $fields['considered_node_ids'] === null
                ? null
                : json_encode($fields['considered_node_ids'], JSON_THROW_ON_ERROR),
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function formatBuild(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'owner' => $row['user_id'] !== null ? 'user' : 'guest',
            'character_name' => (string) $row['character_name'],
            'build_name' => (string) $row['build_name'],
            'class_id' => (string) $row['class_id'],
            'ascendancy_id' => $row['ascendancy_id'] === null ? null : (string) $row['ascendancy_id'],
            'tree_version' => (string) $row['tree_version'],
            'allocated_node_ids' => $this->decodeNodeIds($row['allocated_node_ids']),
            'must_have_node_ids' => $this->decodeNodeIds($row['must_have_node_ids']),
            'considered_node_ids' => $this->decodeNodeIds($row['considered_node_ids']),
            'created_at' => (string) $row['created_at'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    /**
     * @return list<string>
     */
    private function decodeNodeIds(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            return [];
        }

        $nodeIds = [];
        foreach ($decoded as $nodeId) {
            if (is_string($nodeId) || is_int($nodeId)) {
                $nodeIds[] = (string) $nodeId;
            }
        }

        return $nodeIds;
    }
}
