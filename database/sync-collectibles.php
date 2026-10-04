#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectiblesRepository;
use Wowie\Api\Collectibles\CollectiblesSync;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;

require __DIR__ . '/../api/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$usage = "Usage: php database/sync-collectibles.php [--catalog-only] [--only=<source_key>]\n";
$catalogOnly = false;

$only = null;
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--help' || $argument === '-h') {
        fwrite(STDOUT, $usage);
        exit(0);
    }
    if ($argument === '--catalog-only') {
        $catalogOnly = true;
        continue;
    }
    if (str_starts_with($argument, '--only=')) {
        $only = substr($argument, strlen('--only='));
        continue;
    }

    fwrite(STDERR, "Unknown argument.\n" . $usage);
    exit(2);
}

$sources = $catalogOnly ? CollectiblesSync::catalogSources() : CollectiblesSync::defaultSources();
$sourceKeys = [];
foreach ($sources as $source) {
    $sourceKeys[] = $source->sourceKey();
}

if ($only !== null && !in_array($only, $sourceKeys, true)) {
    fwrite(STDERR, 'Unknown source key. Available sources: ' . implode(', ', $sourceKeys) . "\n" . $usage);
    exit(2);
}

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$sync = new CollectiblesSync(new CollectiblesRepository(Database::connect($config)), $sources);

$failed = false;
$results = $sync->run($only);
foreach ($results as $result) {
    if ($result['status'] === 'ok') {
        fwrite(STDOUT, sprintf(
            "%s [%s] ok: %d product(s), %d variant(s)\n",
            $result['source_key'],
            $result['brand'],
            $result['products'],
            $result['variants'],
        ));
        continue;
    }

    $failed = true;
    fwrite(STDOUT, sprintf(
        "%s [%s] failed: %s\n",
        $result['source_key'],
        $result['brand'],
        $result['error'] ?? 'unknown error',
    ));
}

exit($failed || $results === [] ? 1 : 0);
