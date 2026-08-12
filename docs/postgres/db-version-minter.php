#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Database\SchemaVersionMinter;

$projectRoot = dirname(__DIR__, 2);
require $projectRoot . '/api/bootstrap.php';

if (in_array('--help', $argv, true) || in_array('-h', $argv, true)) {
    fwrite(STDOUT, <<<'TEXT'
        Usage: php docs/postgres/db-version-minter.php [--validate|--status]

        With no option, atomically apply the update chain through the version in
        docs/postgres/VERSION and mint that version in the database.

          --validate  Validate the pin, chain, paths, and update checksums without a DB.
          --status    Show the database version and update-ledger status without updating.

        TEXT);
    exit(0);
}

$knownOptions = ['--validate', '--status'];
foreach (array_slice($argv, 1) as $argument) {
    if (!in_array($argument, $knownOptions, true)) {
        fwrite(STDERR, "Unknown argument: {$argument}\n");
        exit(2);
    }
}
if (in_array('--validate', $argv, true) && in_array('--status', $argv, true)) {
    fwrite(STDERR, "Use only one of --validate or --status.\n");
    exit(2);
}

if (in_array('--validate', $argv, true)) {
    $definition = SchemaVersionMinter::validateDefinition(__DIR__);
    printf(
        "PostgreSQL schema pin %d is valid (%d versions, %d updates).\n",
        $definition['targetVersion'],
        $definition['versionCount'],
        $definition['updateCount'],
    );
    exit(0);
}

$config = Config::load($projectRoot);
$minter = new SchemaVersionMinter(Database::connect($config), __DIR__);

if (in_array('--status', $argv, true)) {
    $status = $minter->status();
    printf("Database schema: %d; release pin: %d%s\n", $status['currentVersion'], $status['targetVersion'], $status['markerStored'] ? '' : ' (inferred from legacy ledger)');
    foreach ($status['versions'] as $version) {
        printf("[%s] version %d\n", $version['applied'] ? 'applied' : 'pending', $version['version']);
        foreach ($version['updates'] as $update) {
            printf("  %s\n", $update);
        }
    }
    exit(0);
}

$result = $minter->mint();
foreach ($result['applied'] as $update) {
    fwrite(STDOUT, "Applied {$update}.\n");
}
if ($result['from'] === $result['to'] && !$result['adopted']) {
    printf("Database schema is already pinned at version %d.\n", $result['to']);
} else {
    printf("Minted database schema version %d (was %d).\n", $result['to'], $result['from']);
}
