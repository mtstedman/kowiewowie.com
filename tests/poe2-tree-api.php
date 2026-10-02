#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Application;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;
use Wowie\Api\Poe2\Poe2TreeImporter;
use Wowie\Api\Poe2\Poe2TreeRepository;

require __DIR__ . '/../api/bootstrap.php';

/*
 * PoE 2 passive-tree import and API integration checks. Requires a database at schema
 * version 17 or later; imports the pinned export if it is not already present.
 */

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new LogicException($message);
    }
}

/** @param array<string, string> $headers */
function treeRequest(Application $application, string $method, array $headers = []): Response
{
    return $application->handle(new Request($method, '/v1/poe2/tree', array_change_key_case($headers, CASE_LOWER), [], '', '127.0.0.1'));
}

function expectImportFailure(callable $import, string $fragment): void
{
    try {
        $import();
    } catch (RuntimeException $error) {
        check(str_contains($error->getMessage(), $fragment), "Expected an import error containing \"{$fragment}\", got: {$error->getMessage()}");
        return;
    }
    throw new LogicException("Expected the import to fail with \"{$fragment}\".");
}

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$pdo = Database::connect($config);
$importer = new Poe2TreeImporter($pdo);
$repository = new Poe2TreeRepository($pdo);
$manifestPath = $projectRoot . '/database/data/poe2-passive-tree/source.json';
$manifest = json_decode((string) file_get_contents($manifestPath), true, 8, JSON_THROW_ON_ERROR);
$exportJson = (string) file_get_contents(dirname($manifestPath) . '/' . $manifest['file']);
$source = ['version' => $manifest['version'], 'url' => $manifest['url'], 'commit' => $manifest['commit'], 'sha256' => $manifest['sha256']];

// ---- Import --------------------------------------------------------------------
$first = $importer->importFromManifest($manifestPath);
check($first['nodes'] === 5152 && $first['edges'] === 6070, 'the pinned export imports 5,152 nodes and 6,070 non-root edges');
$second = $importer->importFromManifest($manifestPath);
check($second['status'] === 'unchanged', 'a repeated import of the same export changes nothing');
check($repository->current()['version'] === $manifest['version'], 'the pinned version is current after import');

expectImportFailure(
    static fn () => $importer->import(['version' => 'test-tampered'] + $source, $exportJson . ' '),
    'does not match the pinned',
);

$dangling = json_decode($exportJson, false, 512, JSON_THROW_ON_ERROR);
$dangling->edges[] = (object) ['from' => 999999999, 'to' => 54447];
$danglingJson = json_encode($dangling, JSON_THROW_ON_ERROR);
expectImportFailure(
    static fn () => $importer->import(['version' => 'test-dangling', 'sha256' => hash('sha256', $danglingJson)] + $source, $danglingJson),
    'references missing node 999999999',
);

// A newer import becomes the only current version; rolling back restores the pin.
$pdo->beginTransaction();
try {
    $next = $importer->import(['version' => 'test-next'] + $source, $exportJson);
    check($next['status'] === 'imported', 'a new version imports');
    check($repository->current()['version'] === 'test-next', 'the newest import becomes current');
    $currentCount = (int) $pdo->query('SELECT count(*) FROM poe2_tree_versions WHERE is_current')->fetchColumn();
    check($currentCount === 1, 'exactly one version is current');
    $pdo->prepare('DELETE FROM poe2_tree_versions WHERE version = :version')->execute(['version' => 'test-next']);
    $leftover = (int) $pdo->query("SELECT count(*) FROM poe2_tree_nodes WHERE tree_version = 'test-next'")->fetchColumn();
    check($leftover === 0, 'deleting a version cascades to its nodes');
} finally {
    $pdo->rollBack();
}
check($repository->current()['version'] === $manifest['version'], 'rollback restores the pinned version');

// ---- API -------------------------------------------------------------------------
$application = new Application($config, $pdo);
$started = microtime(true);
$response = treeRequest($application, 'GET');
$elapsed = microtime(true) - $started;
check($response->status === 200, "GET /v1/poe2/tree returns 200, got {$response->status}");
$etag = $response->headers['ETag'] ?? '';
check(preg_match('/\A"poe2-tree-[^"]+"\z/', $etag) === 1, 'the tree response carries a strong ETag');
check(($response->headers['Cache-Control'] ?? '') === 'no-cache', 'the tree response is revalidated on every load');

$data = $response->payload['data'] ?? null;
check(is_array($data), 'the tree response has a data object');
check($data['version'] === $manifest['version'], 'the payload reports the pinned version');
check($data['source'] === ['url' => $manifest['url'], 'commit' => $manifest['commit'], 'sha256' => $manifest['sha256']], 'the payload reports the pinned source');
check(count(get_object_vars($data['tree']['nodes'])) === 5152, 'the payload carries every node');
check(count($data['tree']['edges']) === 6070, 'the payload carries every non-root edge');
check(count($data['tree']['classes']) === 12, 'the payload carries every class in export order');

foreach ([$etag, "W/{$etag}", "\"stale\", {$etag}", '*'] as $validator) {
    $revalidated = treeRequest($application, 'GET', ['If-None-Match' => $validator]);
    check($revalidated->status === 304 && $revalidated->payload === null, "If-None-Match {$validator} returns 304");
    check(($revalidated->headers['ETag'] ?? '') === $etag, 'a 304 repeats the ETag');
}
check(treeRequest($application, 'GET', ['If-None-Match' => '"stale"'])->status === 200, 'a stale validator returns the tree');
check(treeRequest($application, 'POST')->status === 405, 'writes to the tree are rejected');

// ---- The payload means the same tree as the export, through the planner's model ---
$encoded = json_encode($response->payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$payloadPath = tempnam(sys_get_temp_dir(), 'poe2-tree-payload-');
file_put_contents($payloadPath, $encoded);
try {
    $command = 'POE2_TREE_PAYLOAD=' . escapeshellarg($payloadPath)
        . ' node --test ' . escapeshellarg($projectRoot . '/tests/poe2-tree-api-payload.test.mjs') . ' 2>&1';
    exec($command, $output, $exitCode);
    if ($exitCode !== 0) {
        fwrite(STDERR, implode(PHP_EOL, $output) . PHP_EOL);
    }
    check($exitCode === 0, 'the API payload builds the same allocation models as the pinned export');
} finally {
    unlink($payloadPath);
}

fwrite(STDOUT, sprintf(
    "PoE 2 passive tree API checks passed (payload %.1f MB, built in %d ms).\n",
    strlen($encoded) / 1048576,
    (int) round($elapsed * 1000),
));
