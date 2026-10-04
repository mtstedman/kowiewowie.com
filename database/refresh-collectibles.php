#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectiblesRefreshScheduler;
use Wowie\Api\Collectibles\CollectiblesRepository;
use Wowie\Api\Collectibles\CollectiblesSync;
use Wowie\Api\Collectibles\PopMartCollectionSource;
use Wowie\Api\Collectibles\ShopifyCollectionSource;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;

require __DIR__ . '/../api/bootstrap.php';

/*
 * Scheduled, rate-limit-careful refresh of the store-fed collectibles sources
 * (Pop Mart US, TOYSEZ). Run often (a timer every few hours); it refreshes a
 * source only when CollectiblesRefreshScheduler says it is due, one source at
 * a time, and records the outcome so a store that refused us is left alone.
 * The authored catalogs refresh on every deploy instead.
 *
 * Callers hold the shared collectibles lock so this never overlaps a deploy's
 * catalog sync: flock /run/lock/wowiekowie-collectibles.lock ...
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$usage = "Usage: php database/refresh-collectibles.php --state=<file> [--dry-run]\n";
$statePath = null;
$dryRun = false;
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--help' || $argument === '-h') {
        fwrite(STDOUT, $usage);
        exit(0);
    }
    if ($argument === '--dry-run') {
        $dryRun = true;
        continue;
    }
    if (str_starts_with($argument, '--state=') && strlen($argument) > strlen('--state=')) {
        $statePath = substr($argument, strlen('--state='));
        continue;
    }
    fwrite(STDERR, "Unknown argument.\n" . $usage);
    exit(2);
}
if ($statePath === null) {
    fwrite(STDERR, $usage);
    exit(2);
}

$log = static function (string $message): void {
    fwrite(STDOUT, '[' . gmdate('Y-m-d\TH:i:s\Z') . "] {$message}\n");
};

$state = [];
if (is_file($statePath)) {
    try {
        $decoded = json_decode((string) file_get_contents($statePath), true, 16, JSON_THROW_ON_ERROR);
        $state = is_array($decoded) ? $decoded : [];
    } catch (JsonException) {
        // A damaged state file must not cause a burst of requests: every
        // source waits one normal interval before trying again.
        $log("state file {$statePath} is unreadable; treating every source as just refreshed");
        foreach ([PopMartCollectionSource::SOURCE_KEY, CollectiblesSync::NOMMI_SOURCE_KEY] as $key) {
            $state[$key] = ['next_allowed_at' => time() + CollectiblesRefreshScheduler::DEFAULT_INTERVAL_SECONDS];
        }
    }
}
$saveState = static function (array $state) use ($statePath): void {
    $temporary = $statePath . '.tmp';
    file_put_contents($temporary, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", LOCK_EX);
    rename($temporary, $statePath);
};

$random = static fn (): float => mt_rand() / (mt_getrandmax() + 1);
$scheduler = new CollectiblesRefreshScheduler($state, time(), $random);
$stores = array_values(array_filter(
    CollectiblesSync::defaultSources(),
    static fn (object $source): bool => $source instanceof PopMartCollectionSource || $source instanceof ShopifyCollectionSource,
));

$repository = null;
foreach ($stores as $index => $source) {
    $key = $source->sourceKey();
    if (!$scheduler->isDue($key)) {
        $log("{$key}: not due until " . gmdate('Y-m-d\TH:i:s\Z', $scheduler->nextAllowedAt($key)));
        continue;
    }
    if ($dryRun) {
        $log("{$key}: due; would refresh (dry run)");
        continue;
    }
    if ($index > 0) sleep(10);
    $repository ??= new CollectiblesRepository(Database::connect(Config::load(dirname(__DIR__))));
    $results = (new CollectiblesSync($repository, [$source]))->run();
    $result = $results[0] ?? ['status' => 'failed', 'error' => 'The source produced no result.'];
    $entry = $scheduler->record($key, $result);
    $saveState($scheduler->state());
    $next = gmdate('Y-m-d\TH:i:s\Z', (int) $entry['next_allowed_at']);
    $log($result['status'] === 'ok'
        ? sprintf('%s: refreshed %d product(s), %d variant(s); next after %s', $key, $result['products'] ?? 0, $result['variants'] ?? 0, $next)
        : sprintf('%s: %s (%s); backing off until %s (failure %d in a row)', $key, $entry['last_status'], $result['error'] ?? 'unknown error', $next, $entry['consecutive_failures']));
}

// A refused or failed store is an expected, scheduled outcome, not a crash.
exit(0);
