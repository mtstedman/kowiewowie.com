#!/usr/bin/env php
<?php

declare(strict_types=1);

// Collections: a guest browser's figures live behind the long-lived wowie_collection cookie,
// a signed-in visitor's in their account, and the first signed-in read merges that browser's
// guest collection into the account. The test registers its own user and creates its own guest
// collections, and deletes them when it finishes. Registration must be enabled in the target
// configuration. It writes to the configured database: point WOWIE_ENV_FILE at a test one.

use Wowie\Api\Application;
use Wowie\Api\Collectibles\CollectibleCollectionRepository;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

require __DIR__ . '/../api/bootstrap.php';

const COLLECTION_COOKIE = 'wowie_collection';

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

/** The cookie value a response sets, '' when it expires the cookie, null when it sets none. */
function setCookieValue(Response $response): ?string
{
    $header = $response->headers['Set-Cookie'] ?? null;
    if (!is_string($header) || !str_starts_with($header, COLLECTION_COOKIE . '=')) {
        return null;
    }

    return explode(';', substr($header, strlen(COLLECTION_COOKIE) + 1), 2)[0];
}

/** @return list<array{product_id: string, figure_name: string, quantity: int}> */
function figures(Response $response): array
{
    return $response->payload['data'] ?? [];
}

$email = 'collectibles-collection@example.test';
$config = Config::load(dirname(__DIR__));
$pdo = Database::connect($config);
$application = new Application($config, $pdo);
$guestTokens = [];

$cleanup = static function () use ($pdo, $email, &$guestTokens): void {
    // Owned figures cascade from both owners.
    $pdo->prepare('DELETE FROM users WHERE lower(email) = lower(:email)')->execute(['email' => $email]);
    foreach ($guestTokens as $token) {
        $pdo->prepare('DELETE FROM collectible_guest_collections WHERE cookie_token_hash = :hash')
            ->execute(['hash' => hash('sha256', $token)]);
    }
};

/** @param array<string, string> $headers */
$as = static function (?string $guestToken, string $method, string $path, array $body = [], array $headers = []) use ($application): Response {
    $_COOKIE = $guestToken === null ? [] : [COLLECTION_COOKIE => $guestToken];

    return request($application, $method, $path, $body, $headers + ['Origin' => 'https://wowiekowie.com']);
};
$guestCollections = static fn (): int => (int) $pdo->query('SELECT count(*) FROM collectible_guest_collections')->fetchColumn();

$cleanup();
try {
    // A guest with no cookie reads an empty collection, and nothing is created for it.
    $before = $guestCollections();
    $empty = $as(null, 'GET', '/v1/collectibles/collection');
    assertSameValue(200, $empty->status, 'empty read status');
    assertSameValue([[], 'guest', 0], [figures($empty), $empty->payload['meta']['owner'], $empty->payload['meta']['count']], 'empty guest read');
    assertSameValue(null, setCookieValue($empty), 'no cookie for a read');
    assertSameValue($before, $guestCollections(), 'no guest collection for a read');

    // Bad input is refused before any guest collection exists.
    foreach ([
        [['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => -1], 'quantity'],
        [['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 1.5], 'quantity'],
        [['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => '2'], 'quantity'],
        [['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 1_000_001], 'quantity'],
        [['product_id' => '../12', 'figure_name' => 'Moon', 'quantity' => 1], 'product_id'],
        [['product_id' => '12', 'figure_name' => str_repeat('x', 301), 'quantity' => 1], 'figure_name'],
    ] as [$body, $field]) {
        $refused = $as(null, 'PUT', '/v1/collectibles/collection/figures', $body);
        assertSameValue(422, $refused->status, "refused {$field}");
        assertSameValue(true, array_key_exists($field, $refused->payload['details'] ?? []), "names the bad {$field}");
    }
    assertSameValue($before, $guestCollections(), 'no guest collection for refused input');

    // Writes must come from this site.
    $foreign = $as(null, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 1], ['Origin' => 'https://evil.example']);
    assertSameValue([403, 'origin_not_allowed'], [$foreign->status, $foreign->payload['error'] ?? null], 'foreign origin refused');
    assertSameValue(405, $as(null, 'POST', '/v1/collectibles/collection/figures')->status, 'figures only takes PUT');

    // The first save creates the guest collection and its 400-day cookie.
    $saved = $as(null, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 2]);
    assertSameValue(200, $saved->status, 'first save status');
    assertSameValue(['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 2], $saved->payload['data'], 'saved figure');
    $guest = (string) setCookieValue($saved);
    $guestTokens[] = $guest;
    assertSameValue(1, preg_match('/\A[A-Za-z0-9_-]{43}\z/', $guest), 'a random cookie token');
    $header = $saved->headers['Set-Cookie'];
    foreach (['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' . CollectibleCollectionRepository::COOKIE_TTL_SECONDS] as $attribute) {
        assertSameValue(true, str_contains($header, $attribute), "cookie has {$attribute}");
    }
    $stored = $pdo->prepare('SELECT count(*) FROM collectible_guest_collections WHERE cookie_token_hash = :hash');
    $stored->execute(['hash' => hash('sha256', $guest)]);
    assertSameValue(1, (int) $stored->fetchColumn(), 'only the token hash is stored');

    // The cookie names the collection, and every request renews it.
    $as($guest, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Star', 'quantity' => 1]);
    $as($guest, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => 'sonny:7', 'figure_name' => 'Rabbit (secret)', 'quantity' => 4]);
    $read = $as($guest, 'GET', '/v1/collectibles/collection');
    assertSameValue([
        ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 2],
        ['product_id' => '12', 'figure_name' => 'Star', 'quantity' => 1],
        ['product_id' => 'sonny:7', 'figure_name' => 'Rabbit (secret)', 'quantity' => 4],
    ], figures($read), 'guest collection read');
    assertSameValue($guest, setCookieValue($read), 'a read renews the same cookie');

    // Setting a quantity replaces it; zero removes the figure.
    $as($guest, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 5]);
    $as($guest, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Star', 'quantity' => 0]);
    assertSameValue([['12', 'Moon', 5], ['sonny:7', 'Rabbit (secret)', 4]], array_map(
        static fn (array $figure): array => [$figure['product_id'], $figure['figure_name'], $figure['quantity']],
        figures($as($guest, 'GET', '/v1/collectibles/collection')),
    ), 'set and remove');

    // A merge keeps the larger quantity and skips zeros and repeats.
    $merge = $as($guest, 'POST', '/v1/collectibles/collection/merge', ['figures' => [
        ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 3],
        ['product_id' => 'sonny:7', 'figure_name' => 'Rabbit (secret)', 'quantity' => 6],
        ['product_id' => '40', 'figure_name' => 'Dawn', 'quantity' => 1],
        ['product_id' => '40', 'figure_name' => 'Dawn', 'quantity' => 1],
        ['product_id' => '41', 'figure_name' => 'Dusk', 'quantity' => 0],
    ]]);
    assertSameValue(200, $merge->status, 'merge status');
    assertSameValue(2, $merge->payload['meta']['merged'], 'merge counts what changed');
    assertSameValue([['12', 'Moon', 5], ['40', 'Dawn', 1], ['sonny:7', 'Rabbit (secret)', 6]], array_map(
        static fn (array $figure): array => [$figure['product_id'], $figure['figure_name'], $figure['quantity']],
        figures($merge),
    ), 'merged collection');
    assertSameValue(422, $as($guest, 'POST', '/v1/collectibles/collection/merge', ['figures' => 'all'])->status, 'merge needs a list');

    // A cookie that names nothing is a guest without a collection.
    $unknown = $as(str_repeat('A', 43), 'GET', '/v1/collectibles/collection');
    assertSameValue([[], null], [figures($unknown), setCookieValue($unknown)], 'unknown cookie');

    // Signing in: the first read merges this browser's guest collection into the account
    // (the larger quantity wins), deletes the guest collection, and expires its cookie.
    $registration = request($application, 'POST', '/v1/auth/register', [
        'email' => $email,
        'display_name' => 'Collection Test',
        'password' => 'correct-horse-battery-staple',
    ]);
    assertSameValue(201, $registration->status, 'registration status');
    $bearer = ['Authorization' => 'Bearer ' . (string) ($registration->payload['access_token'] ?? '')];
    $as(null, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '12', 'figure_name' => 'Moon', 'quantity' => 9], $bearer);
    $as(null, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '40', 'figure_name' => 'Dawn', 'quantity' => 1], $bearer);
    $signedIn = $as($guest, 'GET', '/v1/collectibles/collection', [], $bearer);
    assertSameValue('account', $signedIn->payload['meta']['owner'], 'signed-in owner');
    assertSameValue(3, $signedIn->payload['meta']['merged_from_guest'] ?? null, 'guest figures merged');
    assertSameValue([['12', 'Moon', 9], ['40', 'Dawn', 1], ['sonny:7', 'Rabbit (secret)', 6]], array_map(
        static fn (array $figure): array => [$figure['product_id'], $figure['figure_name'], $figure['quantity']],
        figures($signedIn),
    ), 'account after the merge');
    assertSameValue('', setCookieValue($signedIn), 'the guest cookie is expired');
    $stored->execute(['hash' => hash('sha256', $guest)]);
    assertSameValue(0, (int) $stored->fetchColumn(), 'the guest collection is deleted');
    $again = $as($guest, 'GET', '/v1/collectibles/collection', [], $bearer);
    assertSameValue(false, array_key_exists('merged_from_guest', $again->payload['meta']), 'a second read merges nothing');

    // Signed in, saves go to the account and never create a guest collection.
    $before = $guestCollections();
    $as(null, 'PUT', '/v1/collectibles/collection/figures', ['product_id' => '99', 'figure_name' => 'Solo', 'quantity' => 1], $bearer);
    assertSameValue($before, $guestCollections(), 'no guest collection while signed in');
    assertSameValue(4, $as(null, 'GET', '/v1/collectibles/collection', [], $bearer)->payload['meta']['count'], 'account count');
    $bad = $as(null, 'GET', '/v1/collectibles/collection', [], ['Authorization' => 'Bearer not-a-token']);
    assertSameValue(401, $bad->status, 'a bad token is refused, not treated as a guest');

    // Signed out again, this browser starts a fresh guest collection.
    assertSameValue([], figures($as(null, 'GET', '/v1/collectibles/collection')), 'signed out after the merge');

    echo "Collectibles collection checks passed.\n";
} finally {
    $_COOKIE = [];
    $cleanup();
}
