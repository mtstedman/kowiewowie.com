#!/usr/bin/env php
<?php

declare(strict_types=1);

// Saved builds keep a considered list next to their must-haves. Clients from before the field
// existed must not wipe it. Runs as a guest it creates, and deletes that guest's builds and
// profile when it finishes.

use Wowie\Api\Application;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

require __DIR__ . '/../api/bootstrap.php';

function assertSameValue(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException("{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function send(Application $application, string $method, string $path, ?string $rawBody = null): Response
{
    return $application->handle(new Request(
        $method,
        $path,
        ['origin' => 'https://wowiekowie.com', 'content-type' => 'application/json'],
        [],
        $rawBody ?? '',
        '127.0.0.1',
    ));
}

/** @param array<string, mixed> $extra */
function buildBody(array $extra = []): string
{
    return json_encode([
        'character_name' => 'Considered',
        'build_name' => 'Considered',
        'class_id' => 'Witch',
        'ascendancy_id' => null,
        'tree_version' => '0.5.5',
        'allocated_node_ids' => ['100'],
        'must_have_node_ids' => ['200'],
    ] + $extra, JSON_THROW_ON_ERROR);
}

$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
$application = new Application($config, $pdo);

$token = bin2hex(random_bytes(32));
$hash = hash('sha256', $token);
$pdo->prepare('INSERT INTO chess_guest_profiles (cookie_token_hash, display_name) VALUES (:hash, :name)')
    ->execute(['hash' => $hash, 'name' => 'Considered Guest']);
$_COOKIE = ['wowie_chess_guest' => $token];

try {
    // Created without the field: an empty list.
    $legacy = send($application, 'POST', '/v1/poe2/builds', buildBody());
    assertSameValue(201, $legacy->status, 'create without considered');
    assertSameValue([], $legacy->payload['data']['considered_node_ids'], 'default considered list');

    // Created with it: stored and returned in order.
    $created = send($application, 'POST', '/v1/poe2/builds', buildBody(['considered_node_ids' => ['300', '301']]));
    assertSameValue(201, $created->status, 'create with considered');
    $id = $created->payload['data']['id'];
    assertSameValue(['300', '301'], $created->payload['data']['considered_node_ids'], 'stored considered list');
    assertSameValue(['300', '301'], send($application, 'GET', '/v1/poe2/builds/' . $id)->payload['data']['considered_node_ids'], 'read back');

    // An update from an older client (no field) keeps the list; an explicit [] clears it.
    $kept = send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody());
    assertSameValue(200, $kept->status, 'update without considered');
    assertSameValue(['300', '301'], $kept->payload['data']['considered_node_ids'], 'list kept by a legacy update');
    $cleared = send($application, 'PUT', '/v1/poe2/builds/' . $id, buildBody(['considered_node_ids' => []]));
    assertSameValue([], $cleared->payload['data']['considered_node_ids'], 'list cleared by []');

    // Same wire typing as the other node lists: a JSON object is not a list.
    $objectBody = str_replace('"considered_node_ids":["300"]', '"considered_node_ids":{"0":"300"}', buildBody(['considered_node_ids' => ['300']]));
    $invalid = send($application, 'POST', '/v1/poe2/builds', $objectBody);
    assertSameValue(422, $invalid->status, 'object rejected');
    assertSameValue(true, isset($invalid->payload['details']['considered_node_ids']), 'field named in the error');

    $listed = send($application, 'GET', '/v1/poe2/builds');
    assertSameValue(2, $listed->payload['meta']['count'], 'builds for this guest');

    echo "PoE2 considered-passive checks passed.\n";
} finally {
    $_COOKIE = [];
    // Builds cascade from the guest profile.
    $pdo->prepare('DELETE FROM chess_guest_profiles WHERE cookie_token_hash = :hash')->execute(['hash' => $hash]);
}
