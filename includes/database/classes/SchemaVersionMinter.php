<?php

declare(strict_types=1);

namespace Wowie\Api\Database;

use JsonException;
use PDO;
use RuntimeException;
use Throwable;

final class SchemaVersionMinter
{
    private const APPLICATION = 'wowiekowie.com';
    private const LOCK_NAME = 'wowiekowie.database.schema-version-minter';

    private int $targetVersion;

    /** @var list<array{version: int, updates: list<array{file: string, path: string, ledgerVersion: string}>}> */
    private array $versions;

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $postgresDirectory,
    ) {
        $definition = self::loadDefinition($postgresDirectory);
        $this->targetVersion = $definition['targetVersion'];
        $this->versions = $definition['versions'];
    }

    /** @return array{targetVersion: int, versionCount: int, updateCount: int} */
    public static function validateDefinition(string $postgresDirectory): array
    {
        $definition = self::loadDefinition($postgresDirectory);

        return [
            'targetVersion' => $definition['targetVersion'],
            'versionCount' => count($definition['versions']),
            'updateCount' => array_sum(array_map(
                static fn (array $version): int => count($version['updates']),
                $definition['versions'],
            )),
        ];
    }

    /**
     * Apply every update through the release pin and mint that pin atomically.
     *
     * @return array{from: int, to: int, applied: list<string>, adopted: bool}
     */
    public function mint(): array
    {
        $this->pdo->query("SELECT pg_advisory_lock(hashtext('" . self::LOCK_NAME . "'))");

        try {
            $this->ensureMetadataTables();
            $this->pdo->beginTransaction();

            try {
                $this->assertOnlyKnownUpdatesAreApplied();
                $storedVersion = $this->storedVersion();
                $currentVersion = $storedVersion ?? $this->inferVersionFromLedger();
                $this->assertVersionCanAdvance($currentVersion);

                $applied = [];
                foreach ($this->versions as $version) {
                    if ($version['version'] <= $currentVersion) {
                        continue;
                    }

                    foreach ($version['updates'] as $update) {
                        if ($this->isApplied($update['ledgerVersion'])) {
                            continue;
                        }

                        $sql = file_get_contents($update['path']);
                        if ($sql === false) {
                            throw new RuntimeException("Could not read schema update {$update['file']}.");
                        }

                        $this->pdo->exec($sql);
                        $statement = $this->pdo->prepare(
                            'INSERT INTO schema_migrations (version) VALUES (:version)',
                        );
                        $statement->execute(['version' => $update['ledgerVersion']]);
                        $applied[] = $update['file'];
                    }
                }

                $this->assertPinnedUpdatesAreApplied();
                $this->storeVersion($this->targetVersion);
                $this->pdo->commit();

                return [
                    'from' => $currentVersion,
                    'to' => $this->targetVersion,
                    'applied' => $applied,
                    'adopted' => $storedVersion === null,
                ];
            } catch (Throwable $error) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw $error;
            }
        } finally {
            $this->pdo->query("SELECT pg_advisory_unlock(hashtext('" . self::LOCK_NAME . "'))");
        }
    }

    /**
     * @return array{
     *   currentVersion: int,
     *   targetVersion: int,
     *   markerStored: bool,
     *   versions: list<array{version: int, applied: bool, updates: list<string>}>
     * }
     */
    public function status(): array
    {
        $this->ensureMetadataTables();
        $storedVersion = $this->storedVersion();
        $versions = [];

        foreach ($this->versions as $version) {
            $applied = true;
            $updates = [];
            foreach ($version['updates'] as $update) {
                $updates[] = $update['file'];
                $applied = $applied && $this->isApplied($update['ledgerVersion']);
            }
            $versions[] = [
                'version' => $version['version'],
                'applied' => $applied,
                'updates' => $updates,
            ];
        }

        return [
            'currentVersion' => $storedVersion ?? $this->inferVersionFromLedger(),
            'targetVersion' => $this->targetVersion,
            'markerStored' => $storedVersion !== null,
            'versions' => $versions,
        ];
    }

    private function ensureMetadataTables(): void
    {
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS database_schema_version (
                application text PRIMARY KEY,
                version integer NOT NULL CHECK (version >= 0),
                minted_at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
    }

    private function storedVersion(): ?int
    {
        $statement = $this->pdo->prepare(
            'SELECT version FROM database_schema_version WHERE application = :application',
        );
        $statement->execute(['application' => self::APPLICATION]);
        $version = $statement->fetchColumn();

        return $version === false ? null : (int) $version;
    }

    private function inferVersionFromLedger(): int
    {
        $currentVersion = 0;
        foreach ($this->versions as $version) {
            foreach ($version['updates'] as $update) {
                if (!$this->isApplied($update['ledgerVersion'])) {
                    return $currentVersion;
                }
            }
            $currentVersion = $version['version'];
        }

        return $currentVersion;
    }

    private function assertVersionCanAdvance(int $currentVersion): void
    {
        if ($currentVersion > $this->targetVersion) {
            throw new RuntimeException(sprintf(
                'Database schema version %d is newer than release pin %d; downgrades are not supported.',
                $currentVersion,
                $this->targetVersion,
            ));
        }

        foreach ($this->versions as $version) {
            if ($version['version'] > $currentVersion) {
                break;
            }
            foreach ($version['updates'] as $update) {
                if (!$this->isApplied($update['ledgerVersion'])) {
                    throw new RuntimeException(sprintf(
                        'Database version marker is %d, but required update %s is absent from the ledger.',
                        $currentVersion,
                        $update['file'],
                    ));
                }
            }
        }
    }

    private function assertOnlyKnownUpdatesAreApplied(): void
    {
        $known = [];
        foreach ($this->versions as $version) {
            foreach ($version['updates'] as $update) {
                $known[$update['ledgerVersion']] = true;
            }
        }

        $applied = $this->pdo->query('SELECT version FROM schema_migrations ORDER BY version')
            ->fetchAll(PDO::FETCH_COLUMN);
        foreach ($applied as $ledgerVersion) {
            if (!isset($known[(string) $ledgerVersion])) {
                throw new RuntimeException(
                    "Applied schema update {$ledgerVersion} is missing from migration-chain.json.",
                );
            }
        }
    }

    private function assertPinnedUpdatesAreApplied(): void
    {
        foreach ($this->versions as $version) {
            foreach ($version['updates'] as $update) {
                if (!$this->isApplied($update['ledgerVersion'])) {
                    throw new RuntimeException("Schema update {$update['file']} did not reach the ledger.");
                }
            }
        }
    }

    private function storeVersion(int $version): void
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO database_schema_version (application, version, minted_at)
            VALUES (:application, :version, now())
            ON CONFLICT (application) DO UPDATE
            SET version = EXCLUDED.version, minted_at = EXCLUDED.minted_at
        SQL);
        $statement->execute([
            'application' => self::APPLICATION,
            'version' => $version,
        ]);
    }

    private function isApplied(string $ledgerVersion): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = :version');
        $statement->execute(['version' => $ledgerVersion]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @return array{
     *   targetVersion: int,
     *   versions: list<array{version: int, updates: list<array{file: string, path: string, ledgerVersion: string}>}>
     * }
     */
    private static function loadDefinition(string $postgresDirectory): array
    {
        $root = realpath($postgresDirectory);
        if ($root === false || !is_dir($root)) {
            throw new RuntimeException("PostgreSQL schema directory does not exist: {$postgresDirectory}");
        }

        $versionText = file_get_contents($root . '/VERSION');
        if ($versionText === false || !preg_match('/^[1-9][0-9]*\n?$/', $versionText)) {
            throw new RuntimeException('docs/postgres/VERSION must contain one positive integer.');
        }
        $targetVersion = (int) trim($versionText);

        $schemaText = file_get_contents($root . '/SCHEMA.md');
        if ($schemaText === false || !preg_match('/\A<!-- schema-version: ([1-9][0-9]*) -->\n/', $schemaText, $schemaMatch)) {
            throw new RuntimeException('docs/postgres/SCHEMA.md must start with a schema-version marker.');
        }
        if ((int) $schemaMatch[1] !== $targetVersion) {
            throw new RuntimeException('SCHEMA.md schema-version marker does not match VERSION.');
        }

        $manifestText = file_get_contents($root . '/migration-chain.json');
        if ($manifestText === false) {
            throw new RuntimeException('Could not read docs/postgres/migration-chain.json.');
        }
        try {
            $manifest = json_decode($manifestText, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('migration-chain.json is invalid JSON.', previous: $error);
        }

        if (!is_array($manifest) || ($manifest['format'] ?? null) !== 1 || !isset($manifest['versions']) || !is_array($manifest['versions'])) {
            throw new RuntimeException('migration-chain.json must use format 1 and contain a versions array.');
        }

        $versions = [];
        $expectedVersion = 1;
        $knownLedgerVersions = [];
        foreach ($manifest['versions'] as $entry) {
            if (!is_array($entry) || ($entry['version'] ?? null) !== $expectedVersion || !isset($entry['updates']) || !is_array($entry['updates']) || $entry['updates'] === []) {
                throw new RuntimeException("Migration chain must define non-empty, consecutive version {$expectedVersion}.");
            }

            $updates = [];
            foreach ($entry['updates'] as $update) {
                $file = is_array($update) ? ($update['file'] ?? null) : null;
                $checksum = is_array($update) ? ($update['sha256'] ?? null) : null;
                if (!is_string($file) || !preg_match('#^updates/[A-Za-z0-9][A-Za-z0-9._-]*\.sql$#', $file)) {
                    throw new RuntimeException("Schema version {$expectedVersion} contains an invalid update path.");
                }
                if (!is_string($checksum) || !preg_match('/^[a-f0-9]{64}$/', $checksum)) {
                    throw new RuntimeException("Schema update {$file} must have a lowercase SHA-256 checksum.");
                }

                $path = realpath($root . '/' . $file);
                if ($path === false || !is_file($path) || !str_starts_with($path, $root . '/updates/')) {
                    throw new RuntimeException("Schema update does not exist inside docs/postgres/updates: {$file}");
                }
                $actualChecksum = hash_file('sha256', $path);
                if ($actualChecksum === false || !hash_equals($checksum, $actualChecksum)) {
                    throw new RuntimeException("Schema update checksum mismatch: {$file}");
                }

                $ledgerVersion = basename($file, '.sql');
                if (isset($knownLedgerVersions[$ledgerVersion])) {
                    throw new RuntimeException("Duplicate schema update ledger version: {$ledgerVersion}");
                }
                $knownLedgerVersions[$ledgerVersion] = true;
                $updates[] = [
                    'file' => $file,
                    'path' => $path,
                    'ledgerVersion' => $ledgerVersion,
                ];
            }

            $versions[] = ['version' => $expectedVersion, 'updates' => $updates];
            ++$expectedVersion;
        }

        if ($versions === [] || count($versions) !== $targetVersion) {
            throw new RuntimeException(sprintf(
                'VERSION is pinned to %d, but migration-chain.json ends at version %d.',
                $targetVersion,
                count($versions),
            ));
        }

        return ['targetVersion' => $targetVersion, 'versions' => $versions];
    }
}
