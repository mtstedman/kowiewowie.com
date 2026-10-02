#!/usr/bin/env php
<?php

declare(strict_types=1);

// Builds saved as a guest move to the account on the first signed-in build list. The test
// registers its own user and creates its own guest profiles, and deletes all of them (and
// their builds) when it finishes. Registration must be enabled in the target configuration.

use Wowie\Api\Application;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;
use Wowie\Api\Poe2\Poe2BuildRepository;

require __DIR__ . '/../api/bootstrap.php';

const GUEST_COOKIE = 'wowie_chess_guest';

function assertSameValue(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException("{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

/** @param array<string, mixed> $body @param array<string, string> $headers */
function request(Application $application, string $method, string $path, array $body = [], array $headers = []): Response
{
    return $application->handle(new Request(
        $method,
        $path,
        array_change_key_case($headers, CASE_LOWER),
        [],
        $body === [] ? '' : json_encode($body, JSON_THROW_ON_ERROR),
        '127.0.0.1',
    ));
}

/** @return array<string, mixed> */
function buildInput(string $name): array
{
    return [
        'character_name' => 'Adoption',
        'build_name' => $name,
        'class_id' => 'Witch',
        'ascendancy_id' => null,
        'tree_version' => '0.5.5',
        'allocated_node_ids' => [],
        'must_have_node_ids' => [],
    ];
}

$email = 'poe2-adoption@example.test';
$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
$application = new Application($config, $pdo);
$repository = new Poe2BuildRepository($pdo);
$guestHashes = [];

/** @return array{token: string, id: string} */
$newGuest = static function () use ($pdo, &$guestHashes): array {
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token);
    $guestHashes[] = $hash;
    $statement = $pdo->prepare('INSERT INTO chess_guest_profiles (cookie_token_hash, display_name) VALUES (:hash, :name) RETURNING id');
    $statement->execute(['hash' => $hash, 'name' => 'Adoption Guest']);
    return ['token' => $token, 'id' => (string) $statement->fetchColumn()];
};

$cleanup = static function () use ($pdo, $email, &$guestHashes): void {
    // Builds cascade from both owners.
    $pdo->prepare('DELETE FROM users WHERE lower(email) = lower(:email)')->execute(['email' => $email]);
    foreach ($guestHashes as $hash) {
        $pdo->prepare('DELETE FROM chess_guest_profiles WHERE cookie_token_hash = :hash')->execute(['hash' => $hash]);
    }
};

$listAs = static function (?string $accessToken, ?string $guestToken) use ($application): array {
    $_COOKIE = $guestToken === null ? [] : [GUEST_COOKIE => $guestToken];
    $headers = $accessToken === null ? [] : ['Authorization' => 'Bearer ' . $accessToken];
    $response = request($application, 'GET', '/v1/poe2/builds', [], $headers);
    assertSameValue(200, $response->status, 'build list status');
    return $response->payload;
};

$cleanup();
try {
    $registration = request($application, 'POST', '/v1/auth/register', [
        'email' => $email,
        'display_name' => 'PoE2 Adoption',
        'password' => 'correct-horse-battery-staple',
    ]);
    assertSameValue(201, $registration->status, 'registration status');
    $accessToken = (string) ($registration->payload['access_token'] ?? '');
    $userId = (string) $pdo->query("SELECT id FROM users WHERE lower(email) = 'poe2-adoption@example.test'")->fetchColumn();

    // A signed-in list carrying a guest cookie moves that guest's builds to the account, once.
    $first = $newGuest();
    foreach (['one', 'two', 'three'] as $name) {
        $repository->create(['type' => 'guest', 'id' => $first['id']], buildInput($name));
    }
    $signedIn = $listAs($accessToken, $first['token']);
    assertSameValue('user', $signedIn['meta']['owner'], 'signed-in owner');
    assertSameValue(3, $signedIn['meta']['adopted_from_guest'] ?? null, 'adopted count');
    assertSameValue(0, $signedIn['meta']['guest_builds_remaining'] ?? null, 'remaining count');
    assertSameValue(3, count($signedIn['data']), 'account builds after adoption');
    $again = $listAs($accessToken, $first['token']);
    assertSameValue(false, array_key_exists('adopted_from_guest', $again['meta']), 'a second list adopts nothing');
    assertSameValue(0, $listAs(null, $first['token'])['meta']['count'], 'the guest keeps no builds');

    // Only the free slots are filled, most recently updated first; the rest stay with the guest.
    $pdo->prepare(
        "INSERT INTO poe2_saved_builds (user_id, character_name, build_name, class_id, tree_version)"
        . " SELECT :user_id, 'Adoption', 'filler ' || n, 'Witch', '0.5.5' FROM generate_series(1, 96) AS n"
    )->execute(['user_id' => $userId]);
    $second = $newGuest();
    foreach (['older', 'middle', 'newest'] as $name) {
        $repository->create(['type' => 'guest', 'id' => $second['id']], buildInput($name));
    }
    $partial = $listAs($accessToken, $second['token']);
    assertSameValue(1, $partial['meta']['adopted_from_guest'] ?? null, 'adopted into the last free slot');
    assertSameValue(2, $partial['meta']['guest_builds_remaining'] ?? null, 'builds left with the guest');
    assertSameValue(100, $partial['meta']['count'], 'account at the limit');
    assertSameValue(true, in_array('newest', array_column($partial['data'], 'build_name'), true), 'the newest build moved');

    // A full account moves nothing but still reports what stays behind.
    $third = $newGuest();
    $repository->create(['type' => 'guest', 'id' => $third['id']], buildInput('no room'));
    $full = $listAs($accessToken, $third['token']);
    assertSameValue(0, $full['meta']['adopted_from_guest'] ?? null, 'nothing adopted into a full account');
    assertSameValue(1, $full['meta']['guest_builds_remaining'] ?? null, 'the guest build stays');

    // Signed out, the cookie only lists the guest's own builds.
    $signedOut = $listAs(null, $third['token']);
    assertSameValue('guest', $signedOut['meta']['owner'], 'signed-out owner');
    assertSameValue(false, array_key_exists('adopted_from_guest', $signedOut['meta']), 'no adoption while signed out');

    // Signed in without a guest cookie, no guest profile is created.
    $profiles = static fn (): int => (int) $pdo->query('SELECT count(*) FROM chess_guest_profiles')->fetchColumn();
    $before = $profiles();
    $plain = $listAs($accessToken, null);
    assertSameValue($before, $profiles(), 'guest profiles after a signed-in list');
    assertSameValue(false, array_key_exists('adopted_from_guest', $plain['meta']), 'no adoption without a cookie');

    echo "PoE2 guest build adoption checks passed.\n";
} finally {
    $_COOKIE = [];
    $cleanup();
}
