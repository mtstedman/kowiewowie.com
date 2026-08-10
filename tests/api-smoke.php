#!/usr/bin/env php
<?php

declare(strict_types=1);

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

$email = 'api-smoke@example.test';
$recipeSlug = 'api-smoke-recipe';
$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
$application = new Application($config, $pdo);

$cleanup = static function () use ($pdo, $email, $recipeSlug): void {
    $pdo->prepare('DELETE FROM recipes WHERE slug = :slug')->execute(['slug' => $recipeSlug]);
    $pdo->prepare('DELETE FROM users WHERE lower(email) = lower(:email)')->execute(['email' => $email]);
};

$cleanup();
try {
    $health = request($application, 'GET', '/health');
    assertSameValue(200, $health->status, 'health status');
    assertSameValue('ok', $health->payload['database'] ?? null, 'database health');

    $expectedCounts = ['recipes' => 2, 'magic/decks' => 2, 'magic/guides' => 2, 'games' => 3, 'music' => 3];
    foreach ($expectedCounts as $resource => $minimum) {
        $response = request($application, 'GET', '/v1/' . $resource);
        assertSameValue(200, $response->status, "{$resource} list status");
        if ((int) ($response->payload['meta']['count'] ?? 0) < $minimum) {
            throw new RuntimeException("{$resource} list is missing seeded content.");
        }
    }

    $registration = request($application, 'POST', '/v1/auth/register', [
        'email' => $email,
        'display_name' => 'API Smoke',
        'password' => 'correct-horse-battery-staple',
    ]);
    assertSameValue(201, $registration->status, 'registration status');
    $accessToken = (string) ($registration->payload['access_token'] ?? '');
    $refreshToken = (string) ($registration->payload['refresh_token'] ?? '');
    if ($accessToken === '' || $refreshToken === '') {
        throw new RuntimeException('Registration did not issue both tokens.');
    }

    $me = request($application, 'GET', '/v1/auth/me', [], ['Authorization' => 'Bearer ' . $accessToken]);
    assertSameValue($email, $me->payload['user']['email'] ?? null, 'authenticated user');

    $rotated = request($application, 'POST', '/v1/auth/refresh', ['refresh_token' => $refreshToken]);
    assertSameValue(200, $rotated->status, 'refresh status');
    $nextRefreshToken = (string) ($rotated->payload['refresh_token'] ?? '');
    if ($nextRefreshToken === '' || $nextRefreshToken === $refreshToken) {
        throw new RuntimeException('Refresh token was not rotated.');
    }
    assertSameValue(401, request($application, 'POST', '/v1/auth/refresh', ['refresh_token' => $refreshToken])->status, 'refresh reuse status');
    assertSameValue(401, request($application, 'POST', '/v1/auth/refresh', ['refresh_token' => $nextRefreshToken])->status, 'refresh family revocation status');

    assertSameValue(503, request($application, 'GET', '/v1/auth/oauth/google/start')->status, 'unconfigured OAuth status');
    assertSameValue(403, request($application, 'POST', '/v1/recipes', [], ['Authorization' => 'Bearer ' . $accessToken])->status, 'ordinary user write status');

    $pdo->prepare("UPDATE users SET roles = array_append(roles, 'editor') WHERE lower(email) = lower(:email)")
        ->execute(['email' => $email]);
    $created = request($application, 'POST', '/v1/recipes', [
        'slug' => $recipeSlug,
        'title' => 'API Smoke Recipe',
        'summary' => 'A temporary integration-test recipe.',
        'image' => null,
        'ingredients' => ['one test ingredient'],
        'instructions' => ['Remove this record after the test.'],
        'status' => 'published',
    ], ['Authorization' => 'Bearer ' . $accessToken]);
    assertSameValue(201, $created->status, 'editor create status');
    assertSameValue($recipeSlug, $created->payload['data']['slug'] ?? null, 'created recipe slug');
    assertSameValue(204, request($application, 'DELETE', '/v1/recipes/' . $recipeSlug, [], ['Authorization' => 'Bearer ' . $accessToken])->status, 'editor delete status');

    fwrite(STDOUT, "API smoke tests passed.\n");
} finally {
    $cleanup();
}

