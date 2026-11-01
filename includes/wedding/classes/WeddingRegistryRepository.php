<?php

declare(strict_types=1);

namespace Wowie\Api\Wedding;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;
use Wowie\Api\ApiException;

/**
 * Per-user wedding registry persistence: one profile, the registries the couple enrolled in, and
 * the catalog products they picked. Every query is scoped to the authenticated user's id.
 * The SQL is portable between PostgreSQL and SQLite: ids and timestamps are generated here.
 */
final class WeddingRegistryRepository
{
    private const NAME_MAX = 120;
    private const EMAIL_MIN = 3;
    private const EMAIL_MAX = 254;
    private const ADDRESS_MAX = 500;
    private const PICK_STATUSES = ['picked', 'added', 'removed'];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array<string, mixed>|null */
    public function profile(string $userId): ?array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT partner_one_name, partner_two_name, wedding_date, contact_email, shipping_address, updated_at
            FROM wedding_registry_profiles
            WHERE user_id = :user_id
        SQL);
        $statement->execute(['user_id' => $userId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        return [
            'partner_one_name' => (string) $row['partner_one_name'],
            'partner_two_name' => (string) $row['partner_two_name'],
            'wedding_date' => $row['wedding_date'] === null ? null : substr((string) $row['wedding_date'], 0, 10),
            'contact_email' => (string) $row['contact_email'],
            'shipping_address' => $row['shipping_address'] === null ? null : (string) $row['shipping_address'],
            'updated_at' => self::isoTimestamp((string) $row['updated_at']),
        ];
    }

    /**
     * Validates and upserts the user's single profile row.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function saveProfile(string $userId, array $input): array
    {
        $fields = [];
        $partnerOne = self::requiredName($input['partner_one_name'] ?? null, 'partner_one_name', $fields);
        $partnerTwo = self::requiredName($input['partner_two_name'] ?? null, 'partner_two_name', $fields);

        $weddingDate = $input['wedding_date'] ?? null;
        if (is_string($weddingDate) && trim($weddingDate) === '') {
            $weddingDate = null;
        }
        if ($weddingDate !== null) {
            if (!is_string($weddingDate) || !self::isCalendarDate(trim($weddingDate))) {
                $fields['wedding_date'] = 'Use a real calendar date in YYYY-MM-DD format, or leave it empty.';
                $weddingDate = null;
            } else {
                $weddingDate = trim($weddingDate);
            }
        }

        $email = $input['contact_email'] ?? null;
        $email = is_string($email) ? trim($email) : null;
        if (
            $email === null
            || mb_strlen($email) < self::EMAIL_MIN
            || mb_strlen($email) > self::EMAIL_MAX
            || filter_var($email, FILTER_VALIDATE_EMAIL) === false
        ) {
            $fields['contact_email'] = 'Enter a valid email address of at most ' . self::EMAIL_MAX . ' characters.';
        }

        $address = $input['shipping_address'] ?? null;
        if ($address !== null) {
            if (!is_string($address) || !mb_check_encoding($address, 'UTF-8')) {
                $fields['shipping_address'] = 'The shipping address must be text.';
                $address = null;
            } else {
                $address = trim(str_replace(["\r\n", "\r"], "\n", $address));
                if ($address === '') {
                    $address = null;
                } elseif (mb_strlen($address) > self::ADDRESS_MAX) {
                    $fields['shipping_address'] = 'The shipping address must be at most ' . self::ADDRESS_MAX . ' characters.';
                }
            }
        }

        if ($fields !== []) {
            throw new ApiException(422, 'validation_failed', 'The wedding registry profile is invalid.', ['fields' => $fields]);
        }

        $now = self::now();
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO wedding_registry_profiles (
                user_id, partner_one_name, partner_two_name, wedding_date, contact_email, shipping_address, created_at, updated_at
            ) VALUES (
                :user_id, :partner_one_name, :partner_two_name, :wedding_date, :contact_email, :shipping_address, :created_at, :updated_at
            )
            ON CONFLICT (user_id) DO UPDATE SET
                partner_one_name = excluded.partner_one_name,
                partner_two_name = excluded.partner_two_name,
                wedding_date = excluded.wedding_date,
                contact_email = excluded.contact_email,
                shipping_address = excluded.shipping_address,
                updated_at = excluded.updated_at
        SQL);
        $statement->execute([
            'user_id' => $userId,
            'partner_one_name' => $partnerOne,
            'partner_two_name' => $partnerTwo,
            'wedding_date' => $weddingDate,
            'contact_email' => $email,
            'shipping_address' => $address,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->profile($userId) ?? throw new ApiException(500, 'internal_error', 'The wedding registry profile could not be saved.');
    }

    /** @return list<array{registry_key: string, status: string, signup_url: string, enrolled_at: string}> */
    public function enrollments(string $userId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT registry_key, status, enrolled_at
            FROM wedding_registry_enrollments
            WHERE user_id = :user_id
        SQL);
        $statement->execute(['user_id' => $userId]);

        $enrollments = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $registry = WeddingRegistryCatalog::registry((string) $row['registry_key']);
            if ($registry === null) {
                continue;
            }
            $enrollments[] = [
                'registry_key' => (string) $row['registry_key'],
                'status' => (string) $row['status'],
                'signup_url' => (string) $registry['signup_url'],
                'enrolled_at' => self::isoTimestamp((string) $row['enrolled_at']),
            ];
        }
        $order = array_flip(WeddingRegistryCatalog::KEYS);
        usort($enrollments, static fn (array $a, array $b): int => $order[$a['registry_key']] <=> $order[$b['registry_key']]);

        return $enrollments;
    }

    /**
     * Enrolls the user in the requested registries (an empty list means all three). Repeating an
     * enrollment keeps the existing row and its original enrolled_at.
     *
     * @param array<mixed> $registryKeys
     * @return list<array{registry_key: string, status: string, signup_url: string, enrolled_at: string}>
     */
    public function enroll(string $userId, array $registryKeys): array
    {
        if (!array_is_list($registryKeys)) {
            throw new ApiException(422, 'validation_failed', 'Registries must be a list of registry keys.', [
                'fields' => ['registries' => 'Provide a list of registry keys.'],
            ]);
        }
        $keys = [];
        foreach ($registryKeys as $key) {
            if (!is_string($key) || !in_array($key, WeddingRegistryCatalog::KEYS, true)) {
                throw new ApiException(422, 'validation_failed', 'Unknown wedding registry.', [
                    'fields' => ['registries' => 'Use only ' . implode(', ', WeddingRegistryCatalog::KEYS) . '.'],
                ]);
            }
            $keys[$key] = true;
        }
        $keys = $keys === [] ? WeddingRegistryCatalog::KEYS : array_keys($keys);

        if ($this->profile($userId) === null) {
            throw new ApiException(422, 'profile_required', 'Save your wedding details before enrolling in registries.');
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO wedding_registry_enrollments (id, user_id, registry_key, status, enrolled_at, created_at, updated_at)
            VALUES (:id, :user_id, :registry_key, 'enrolled', :enrolled_at, :created_at, :updated_at)
            ON CONFLICT (user_id, registry_key) DO NOTHING
        SQL);
        $this->transaction(function () use ($statement, $userId, $keys): void {
            $now = self::now();
            foreach ($keys as $key) {
                $statement->execute([
                    'id' => self::uuid(),
                    'user_id' => $userId,
                    'registry_key' => $key,
                    'enrolled_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });

        return $this->enrollments($userId);
    }

    /** @return list<array{registry_key: string, product_key: string, status: string, updated_at: string}> */
    public function picks(string $userId): array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT registry_key, product_key, status, updated_at
            FROM wedding_registry_product_picks
            WHERE user_id = :user_id
        SQL);
        $statement->execute(['user_id' => $userId]);

        $positions = [];
        foreach (WeddingRegistryCatalog::registries() as $registryIndex => $registry) {
            foreach ($registry['products'] as $productIndex => $product) {
                $positions[$registry['key'] . '/' . $product['key']] = $registryIndex * 1000 + $productIndex;
            }
        }

        $picks = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $position = $positions[$row['registry_key'] . '/' . $row['product_key']] ?? null;
            if ($position === null) {
                continue;
            }
            $picks[$position] = [
                'registry_key' => (string) $row['registry_key'],
                'product_key' => (string) $row['product_key'],
                'status' => (string) $row['status'],
                'updated_at' => self::isoTimestamp((string) $row['updated_at']),
            ];
        }
        ksort($picks);

        return array_values($picks);
    }

    /**
     * Applies pick changes atomically: 'picked'/'added' upsert the status, 'removed' deletes.
     *
     * @param array<mixed> $picks
     * @return list<array{registry_key: string, product_key: string, status: string, updated_at: string}>
     */
    public function savePicks(string $userId, array $picks): array
    {
        if ($picks === [] || !array_is_list($picks)) {
            throw new ApiException(422, 'validation_failed', 'Provide at least one product pick.', [
                'fields' => ['picks' => 'Provide a non-empty list of picks.'],
            ]);
        }
        $changes = [];
        foreach ($picks as $index => $pick) {
            $field = "picks.{$index}";
            if (!is_array($pick)) {
                throw new ApiException(422, 'validation_failed', 'Each pick must be an object.', [
                    'fields' => [$field => 'Each pick needs registry_key, product_key and status.'],
                ]);
            }
            $status = $pick['status'] ?? null;
            if (!is_string($status) || !in_array($status, self::PICK_STATUSES, true)) {
                throw new ApiException(422, 'validation_failed', 'Unknown pick status.', [
                    'fields' => ["{$field}.status" => 'Use picked, added or removed.'],
                ]);
            }
            $registryKey = $pick['registry_key'] ?? null;
            $productKey = $pick['product_key'] ?? null;
            if (
                !is_string($registryKey)
                || !is_string($productKey)
                || WeddingRegistryCatalog::product($registryKey, $productKey) === null
            ) {
                throw new ApiException(422, 'validation_failed', 'That product is not in the registry catalog.', [
                    'fields' => ["{$field}.product_key" => 'Pick a product from this registry\'s catalog.'],
                ]);
            }
            $changes[] = ['registry_key' => $registryKey, 'product_key' => $productKey, 'status' => $status];
        }

        $upsert = $this->pdo->prepare(<<<'SQL'
            INSERT INTO wedding_registry_product_picks (id, user_id, registry_key, product_key, status, created_at, updated_at)
            VALUES (:id, :user_id, :registry_key, :product_key, :status, :created_at, :updated_at)
            ON CONFLICT (user_id, registry_key, product_key) DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at
        SQL);
        $delete = $this->pdo->prepare(<<<'SQL'
            DELETE FROM wedding_registry_product_picks
            WHERE user_id = :user_id AND registry_key = :registry_key AND product_key = :product_key
        SQL);
        $this->transaction(function () use ($upsert, $delete, $userId, $changes): void {
            $now = self::now();
            foreach ($changes as $change) {
                if ($change['status'] === 'removed') {
                    $delete->execute([
                        'user_id' => $userId,
                        'registry_key' => $change['registry_key'],
                        'product_key' => $change['product_key'],
                    ]);
                    continue;
                }
                $upsert->execute([
                    'id' => self::uuid(),
                    'user_id' => $userId,
                    'registry_key' => $change['registry_key'],
                    'product_key' => $change['product_key'],
                    'status' => $change['status'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });

        return $this->picks($userId);
    }

    private function transaction(callable $work): void
    {
        $this->pdo->beginTransaction();
        try {
            $work();
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    /** @param array<string, string> $fields */
    private static function requiredName(mixed $value, string $field, array &$fields): string
    {
        $name = is_string($value) && mb_check_encoding($value, 'UTF-8') ? trim($value) : '';
        if ($name === '' || mb_strlen($name) > self::NAME_MAX) {
            $fields[$field] = 'Enter a name of 1 to ' . self::NAME_MAX . ' characters.';
        }

        return $name;
    }

    private static function isCalendarDate(string $value): bool
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts)) {
            return false;
        }

        return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private static function now(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.uP');
    }

    private static function isoTimestamp(string $value): string
    {
        return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }
}
