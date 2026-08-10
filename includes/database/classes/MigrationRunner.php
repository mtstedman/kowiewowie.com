<?php

declare(strict_types=1);

namespace Wowie\Api\Database;

use PDO;
use RuntimeException;
use Throwable;

final class MigrationRunner
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly string $migrationDirectory,
    ) {
    }

    /** @return list<string> */
    public function migrate(): array
    {
        $this->ensureLedger();
        $this->pdo->query("SELECT pg_advisory_lock(hashtext('wowiekowie.database.migrations'))");
        $applied = [];

        try {
            foreach ($this->migrationFiles() as $version => $path) {
                if ($this->isApplied($version)) {
                    continue;
                }

                $sql = file_get_contents($path);
                if ($sql === false) {
                    throw new RuntimeException("Could not read migration {$path}.");
                }

                $this->pdo->beginTransaction();
                try {
                    $this->pdo->exec($sql);
                    $statement = $this->pdo->prepare('INSERT INTO schema_migrations (version) VALUES (:version)');
                    $statement->execute(['version' => $version]);
                    $this->pdo->commit();
                    $applied[] = $version;
                } catch (Throwable $error) {
                    if ($this->pdo->inTransaction()) {
                        $this->pdo->rollBack();
                    }
                    throw $error;
                }
            }
        } finally {
            $this->pdo->query("SELECT pg_advisory_unlock(hashtext('wowiekowie.database.migrations'))");
        }

        return $applied;
    }

    /** @return list<array{version: string, applied: bool}> */
    public function status(): array
    {
        $this->ensureLedger();
        $result = [];
        foreach ($this->migrationFiles() as $version => $_path) {
            $result[] = ['version' => $version, 'applied' => $this->isApplied($version)];
        }

        return $result;
    }

    private function ensureLedger(): void
    {
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
    }

    /** @return array<string, string> */
    private function migrationFiles(): array
    {
        $paths = glob(rtrim($this->migrationDirectory, '/') . '/*.sql') ?: [];
        sort($paths, SORT_STRING);
        $files = [];
        foreach ($paths as $path) {
            $version = basename($path, '.sql');
            if (isset($files[$version])) {
                throw new RuntimeException("Duplicate migration version {$version}.");
            }
            $files[$version] = $path;
        }

        return $files;
    }

    private function isApplied(string $version): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = :version');
        $statement->execute(['version' => $version]);

        return $statement->fetchColumn() !== false;
    }
}

