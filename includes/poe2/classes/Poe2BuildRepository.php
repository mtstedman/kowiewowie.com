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
    private const INVENTORY_SLOTS = [
        'main_hand', 'off_hand', 'helmet', 'body_armour', 'gloves',
        'boots', 'belt', 'amulet', 'ring_1', 'ring_2',
    ];
    private const MAX_INVENTORY_VALUE = 1_000_000;
    private const COLUMNS = 'id, user_id, guest_profile_id, character_name, build_name, class_id, ascendancy_id, '
        . 'tree_version, allocated_node_ids, must_have_node_ids, considered_node_ids, inventory, created_at, updated_at';

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
                . ' tree_version, allocated_node_ids, must_have_node_ids, considered_node_ids, inventory)'
                . ' VALUES (:owner_id, :character_name, :build_name, :class_id, :ascendancy_id,'
                . ' :tree_version, CAST(:allocated_node_ids AS jsonb), CAST(:must_have_node_ids AS jsonb),'
                . " COALESCE(CAST(:considered_node_ids AS jsonb), '[]'::jsonb),"
                . " COALESCE(CAST(:inventory AS jsonb), '[]'::jsonb))"
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
     * Full replace of every writable field, except that absent considered and inventory lists
     * keep the stored values: clients from before those fields existed must not wipe them.
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
            . ' considered_node_ids = COALESCE(CAST(:considered_node_ids AS jsonb), considered_node_ids),'
            . ' inventory = COALESCE(CAST(:inventory AS jsonb), inventory)'
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
     * @return array{character_name: string, build_name: string, class_id: string, ascendancy_id: ?string, tree_version: string, allocated_node_ids: list<string>, must_have_node_ids: list<string>, considered_node_ids: ?list<string>, inventory: ?list<array<string, mixed>>}
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
            // Optional for compatibility with clients from before inventory existed.
            'inventory' => array_key_exists('inventory', $input)
                ? $this->inventory($input['inventory'], $errors)
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
     * @param array<string, string> $errors
     * @return list<array<string, mixed>>
     */
    private function inventory(mixed $value, array &$errors): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            $errors['inventory'] = 'inventory must be an array of inventory items.';
            return [];
        }
        if (count($value) > 10) {
            $errors['inventory'] = 'inventory must contain at most 10 items.';
            return [];
        }

        $items = [];
        $slots = [];
        foreach ($value as $item) {
            $item = $this->objectFields($item);
            if ($item === null || !$this->hasExactlyFields(
                $item,
                ['slot', 'name', 'equipped', 'armour', 'evasion', 'energy_shield', 'weapon']
            )) {
                $errors['inventory'] = 'Each inventory item must be an object with exactly the required fields.';
                return [];
            }

            $slot = $item['slot'];
            if (!is_string($slot) || !in_array($slot, self::INVENTORY_SLOTS, true)) {
                $errors['inventory'] = 'Each inventory item must use a known slot.';
                return [];
            }
            if (isset($slots[$slot])) {
                $errors['inventory'] = 'Inventory slots must be unique.';
                return [];
            }
            $slots[$slot] = true;

            $name = $item['name'];
            if (!is_string($name)) {
                $errors['inventory'] = 'Each inventory item name must be a string.';
                return [];
            }
            $name = $this->trimInventoryName($name);
            if (preg_match('/\p{Cc}/u', $name) === 1 || mb_strlen($name, 'UTF-8') > 80) {
                $errors['inventory'] = 'Each inventory item name must be at most 80 characters and contain no control characters.';
                return [];
            }
            if (!is_bool($item['equipped'])) {
                $errors['inventory'] = 'Each inventory item equipped value must be a boolean.';
                return [];
            }

            foreach (['armour', 'evasion', 'energy_shield'] as $field) {
                if (!$this->inventoryInteger($item[$field])) {
                    $errors['inventory'] = "Each inventory item {$field} must be an integer from 0 to " . self::MAX_INVENTORY_VALUE . '.';
                    return [];
                }
            }

            $weapon = null;
            if ($item['weapon'] !== null) {
                if ($slot !== 'main_hand') {
                    $errors['inventory'] = 'A weapon may only be set for the main_hand slot.';
                    return [];
                }
                $weaponFields = $this->objectFields($item['weapon']);
                if ($weaponFields === null || !$this->hasExactlyFields(
                    $weaponFields,
                    ['physical_min', 'physical_max', 'attacks_per_second']
                )) {
                    $errors['inventory'] = 'An inventory weapon must be null or an object with exactly the required fields.';
                    return [];
                }
                if (!$this->inventoryInteger($weaponFields['physical_min'])
                    || !$this->inventoryInteger($weaponFields['physical_max'])
                ) {
                    $errors['inventory'] = 'Weapon physical damage must use integers from 0 to ' . self::MAX_INVENTORY_VALUE . '.';
                    return [];
                }
                if ($weaponFields['physical_min'] > $weaponFields['physical_max']) {
                    $errors['inventory'] = 'Weapon physical_min must not exceed physical_max.';
                    return [];
                }
                $attacksPerSecond = $weaponFields['attacks_per_second'];
                if ((!is_int($attacksPerSecond) && !is_float($attacksPerSecond))
                    || !is_finite((float) $attacksPerSecond)
                    || $attacksPerSecond <= 0
                    || $attacksPerSecond > 100
                ) {
                    $errors['inventory'] = 'Weapon attacks_per_second must be a finite number greater than 0 and at most 100.';
                    return [];
                }
                $weapon = [
                    'physical_min' => $weaponFields['physical_min'],
                    'physical_max' => $weaponFields['physical_max'],
                    'attacks_per_second' => $attacksPerSecond,
                ];
            }

            $items[] = [
                'slot' => $slot,
                'name' => $name,
                'equipped' => $item['equipped'],
                'armour' => $item['armour'],
                'evasion' => $item['evasion'],
                'energy_shield' => $item['energy_shield'],
                'weapon' => $weapon,
            ];
        }

        return $items;
    }

    /** @return array<string, mixed>|null */
    private function objectFields(mixed $value): ?array
    {
        if ($value instanceof \stdClass) {
            return get_object_vars($value);
        }
        if (is_array($value) && !array_is_list($value)) {
            return $value;
        }

        return null;
    }

    /** @param array<string, mixed> $value @param list<string> $fields */
    private function hasExactlyFields(array $value, array $fields): bool
    {
        $actual = array_keys($value);
        sort($actual);
        sort($fields);

        return $actual === $fields;
    }

    private function inventoryInteger(mixed $value): bool
    {
        return is_int($value) && $value >= 0 && $value <= self::MAX_INVENTORY_VALUE;
    }

    private function trimInventoryName(string $value): string
    {
        $whitespace = '\\x{0009}-\\x{000D}\\x{0020}\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}'
            . '\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}';

        return preg_replace('/^[' . $whitespace . ']+|[' . $whitespace . ']+$/u', '', $value) ?? $value;
    }

    /**
     * @param array{character_name: string, build_name: string, class_id: string, ascendancy_id: ?string, tree_version: string, allocated_node_ids: list<string>, must_have_node_ids: list<string>, considered_node_ids: ?list<string>, inventory: ?list<array<string, mixed>>} $fields
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
            'inventory' => $fields['inventory'] === null
                ? null
                : json_encode($fields['inventory'], JSON_THROW_ON_ERROR),
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
            'inventory' => $this->decodeInventory($row['inventory'] ?? null),
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

    /** @return list<array<string, mixed>> */
    private function decodeInventory(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if ($decoded === null) {
            return [];
        }

        $errors = [];
        $inventory = $this->inventory($decoded, $errors);

        return $errors === [] ? $inventory : [];
    }
}
