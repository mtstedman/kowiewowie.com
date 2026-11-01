#!/usr/bin/env php
<?php

declare(strict_types=1);

// Wedding registry: the migration chain entry for 024_wedding_registry.sql, the static catalog,
// and the /v1/wedding-registry API (profile, enrollments, product picks) with per-user isolation.
// Persistence runs against an in-memory SQLite stand-in for the users and wedding tables, so this
// check needs pdo_sqlite but never touches the configured database.

use Wowie\Api\Application;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Config;
use Wowie\Api\Database\SchemaVersionMinter;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;
use Wowie\Api\Wedding\WeddingRegistryCatalog;

require __DIR__ . '/../api/bootstrap.php';

/** @var list<string> $failures */
$failures = [];

function check(mixed $expected, mixed $actual, string $message): void
{
    global $failures;
    if ($expected !== $actual) {
        $failures[] = "{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true);
    }
}

/** @param array<string, mixed>|null $body @param array<string, string> $headers */
function apiRequest(Application $application, string $method, string $path, ?array $body = null, ?string $token = null, array $headers = []): Response
{
    if ($token !== null) {
        $headers['authorization'] = 'Bearer ' . $token;
    }

    return $application->handle(new Request(
        $method,
        $path,
        $headers,
        [],
        $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR),
        '127.0.0.1',
    ));
}

function rowCount(PDO $pdo, string $table, ?string $userId = null): int
{
    if ($userId === null) {
        return (int) $pdo->query("SELECT count(*) FROM {$table}")->fetchColumn();
    }
    $statement = $pdo->prepare("SELECT count(*) FROM {$table} WHERE user_id = :user_id");
    $statement->execute(['user_id' => $userId]);

    return (int) $statement->fetchColumn();
}

/** @return array{0: int, 1: mixed} */
function statusAndError(Response $response): array
{
    return [$response->status, $response->payload['error'] ?? null];
}

$root = dirname(__DIR__);
$postgres = $root . '/docs/postgres';

// Migration chain: the newest version appends 024_wedding_registry.sql with its checksum.
$chain = json_decode((string) file_get_contents($postgres . '/migration-chain.json'), true, flags: JSON_THROW_ON_ERROR);
$last = $chain['versions'][count($chain['versions']) - 1];
check(26, $last['version'] ?? null, 'chain ends at version 26');
check('updates/024_wedding_registry.sql', $last['updates'][0]['file'] ?? null, 'version 26 update file');
check(hash_file('sha256', $postgres . '/updates/024_wedding_registry.sql'), $last['updates'][0]['sha256'] ?? null, 'version 26 checksum');
check('26', trim((string) file_get_contents($postgres . '/VERSION')), 'VERSION pin');
try {
    check(26, SchemaVersionMinter::validateDefinition($postgres)['targetVersion'], 'validated target version');
} catch (Throwable $error) {
    $failures[] = 'migration chain does not validate: ' . $error->getMessage();
}
$migration = (string) file_get_contents($postgres . '/updates/024_wedding_registry.sql');
foreach ([
    'CREATE TABLE wedding_registry_profiles (',
    'user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE',
    'partner_one_name text NOT NULL CHECK (char_length(partner_one_name) BETWEEN 1 AND 120)',
    'partner_two_name text NOT NULL CHECK (char_length(partner_two_name) BETWEEN 1 AND 120)',
    'wedding_date date,',
    'contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254)',
    'shipping_address text CHECK (shipping_address IS NULL OR char_length(shipping_address) <= 500)',
    'CREATE TRIGGER wedding_registry_profiles_set_updated_at',
    'CREATE TABLE wedding_registry_enrollments (',
    "registry_key text NOT NULL CHECK (registry_key IN ('amazon', 'target', 'zola'))",
    "status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled'))",
    'enrolled_at timestamptz NOT NULL DEFAULT now()',
    'UNIQUE (user_id, registry_key)',
    'CREATE INDEX wedding_registry_enrollments_user_idx ON wedding_registry_enrollments (user_id)',
    'CREATE TRIGGER wedding_registry_enrollments_set_updated_at',
    'CREATE TABLE wedding_registry_product_picks (',
    "product_key text NOT NULL CHECK (product_key ~ '^[a-z0-9-]{1,80}$')",
    "status text NOT NULL DEFAULT 'picked' CHECK (status IN ('picked', 'added'))",
    'UNIQUE (user_id, registry_key, product_key)',
    'CREATE INDEX wedding_registry_product_picks_user_idx ON wedding_registry_product_picks (user_id)',
    'CREATE TRIGGER wedding_registry_product_picks_set_updated_at',
    'FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
] as $fragment) {
    check(true, str_contains($migration, $fragment), "migration declares {$fragment}");
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "pdo_sqlite is required for the isolated wedding registry regressions.\n");
    exit(1);
}

putenv('WOWIE_JWT_SECRET=' . str_repeat('wedding-registry-test-secret-', 2));
putenv('WOWIE_JWT_ISSUER=https://api.wowiekowie.test');
putenv('WOWIE_JWT_AUDIENCE=wowiekowie.test');

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec(<<<'SQL'
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        roles TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE wedding_registry_profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        partner_one_name TEXT NOT NULL CHECK (length(partner_one_name) BETWEEN 1 AND 120),
        partner_two_name TEXT NOT NULL CHECK (length(partner_two_name) BETWEEN 1 AND 120),
        wedding_date TEXT,
        contact_email TEXT NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 254),
        shipping_address TEXT CHECK (shipping_address IS NULL OR length(shipping_address) <= 500),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE wedding_registry_enrollments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        registry_key TEXT NOT NULL CHECK (registry_key IN ('amazon', 'target', 'zola')),
        status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled')),
        enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, registry_key)
    );
    CREATE TABLE wedding_registry_product_picks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        registry_key TEXT NOT NULL CHECK (registry_key IN ('amazon', 'target', 'zola')),
        product_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'picked' CHECK (status IN ('picked', 'added')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, registry_key, product_key)
    );
SQL);

$firstId = '11111111-1111-4111-8111-111111111111';
$secondId = '22222222-2222-4222-8222-222222222222';
$insertUser = $pdo->prepare('INSERT INTO users (id, email, display_name, roles) VALUES (:id, :email, :name, :roles)');
foreach (['first' => $firstId, 'second' => $secondId] as $name => $id) {
    $insertUser->execute(['id' => $id, 'email' => "{$name}@example.test", 'name' => $name, 'roles' => '{}']);
}

$config = Config::load($root);
$jwt = new JwtService($config);
$first = $jwt->issue($firstId, []);
$second = $jwt->issue($secondId, []);
$application = new Application($config, $pdo);

// Catalog: public, three registries in order with official signup URLs and 6-8 valid products.
$catalog = apiRequest($application, 'GET', '/v1/wedding-registry/catalog');
check(200, $catalog->status, 'catalog is public');
$registries = $catalog->payload['data']['registries'] ?? [];
check(['amazon', 'target', 'zola'], array_column($registries, 'key'), 'catalog registry order');
check(WeddingRegistryCatalog::KEYS, array_column($registries, 'key'), 'catalog matches KEYS');
check(
    [
        'https://www.amazon.com/wedding/home',
        'https://www.target.com/gift-registry/create-wedding-registry',
        'https://www.zola.com/onboard/new',
    ],
    array_column($registries, 'signup_url'),
    'official signup URLs',
);
foreach ($registries as $registry) {
    $key = (string) ($registry['key'] ?? '?');
    check(
        ['key', 'name', 'tagline', 'signup_url', 'signup_help', 'add_product_help', 'products'],
        array_keys($registry),
        "{$key} registry fields",
    );
    foreach (['name', 'tagline', 'signup_help', 'add_product_help'] as $field) {
        check(true, is_string($registry[$field] ?? null) && trim($registry[$field]) !== '', "{$key} {$field} is text");
    }
    $products = $registry['products'] ?? [];
    check(true, count($products) >= 6 && count($products) <= 8, "{$key} has 6-8 products");
    $productKeys = array_column($products, 'key');
    check(count($productKeys), count(array_unique($productKeys)), "{$key} product keys are unique");
    foreach ($products as $product) {
        $productKey = (string) ($product['key'] ?? '?');
        check(['key', 'name', 'brand', 'category', 'url'], array_keys($product), "{$key}/{$productKey} product fields");
        check(1, preg_match('/^[a-z0-9-]{1,80}$/', $productKey), "{$key}/{$productKey} key format");
        check(true, str_starts_with((string) ($product['url'] ?? ''), 'https://www.' . $key . '.com/'), "{$key}/{$productKey} links to the retailer");
        check($product, WeddingRegistryCatalog::product($key, $productKey), "{$key}/{$productKey} lookup");
    }
}
check(null, WeddingRegistryCatalog::registry('macys'), 'unknown registry lookup');
check(null, WeddingRegistryCatalog::product('amazon', 'sonos-move-2-speaker'), 'product lookup is per registry');
check([405, 'method_not_allowed'], statusAndError(apiRequest($application, 'POST', '/v1/wedding-registry/catalog', [])), 'catalog is read-only');

// Authentication: every per-user route needs a valid Bearer token.
$validProfile = [
    'partner_one_name' => '  Ada Lovelace ',
    'partner_two_name' => 'Charles Babbage',
    'wedding_date' => '2027-06-12',
    'contact_email' => 'couple@example.test',
    'shipping_address' => "12 Analytical Way\r\nLondon",
];
foreach ([
    ['GET', '/v1/wedding-registry/me', null],
    ['PUT', '/v1/wedding-registry/profile', $validProfile],
    ['POST', '/v1/wedding-registry/enrollments', null],
    ['POST', '/v1/wedding-registry/picks', ['picks' => [['registry_key' => 'zola', 'product_key' => 'sonos-move-2-speaker', 'status' => 'picked']]]],
] as [$method, $path, $body]) {
    check([401, 'authentication_required'], statusAndError(apiRequest($application, $method, $path, $body)), "{$method} {$path} without a token");
    check(401, apiRequest($application, $method, $path, $body, 'not-a-token')->status, "{$method} {$path} with a bad token");
}
check(0, rowCount($pdo, 'wedding_registry_profiles') + rowCount($pdo, 'wedding_registry_enrollments') + rowCount($pdo, 'wedding_registry_product_picks'), 'unauthenticated writes persist nothing');
check([405, 'method_not_allowed'], statusAndError(apiRequest($application, 'GET', '/v1/wedding-registry/profile', null, $first)), 'GET profile is not a route');

// Writes from a foreign origin are refused before any data is touched.
$foreign = ['origin' => 'https://evil.example'];
check([403, 'origin_not_allowed'], statusAndError(apiRequest($application, 'PUT', '/v1/wedding-registry/profile', $validProfile, $first, $foreign)), 'foreign-origin profile write');
check([403, 'origin_not_allowed'], statusAndError(apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', null, $first, $foreign)), 'foreign-origin enrollment');
check(0, rowCount($pdo, 'wedding_registry_profiles'), 'foreign-origin write persists nothing');

// Enrolling requires a saved profile.
check([422, 'profile_required'], statusAndError(apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', null, $first)), 'enrollment before profile');
check(0, rowCount($pdo, 'wedding_registry_enrollments'), 'enrollment before profile persists nothing');

// Profile validation: each invalid case names its field and persists nothing.
foreach ([
    'blank partner one' => ['partner_one_name', ['partner_one_name' => '   ']],
    'missing partner two' => ['partner_two_name', ['partner_two_name' => null]],
    'overlong name' => ['partner_two_name', ['partner_two_name' => str_repeat('n', 121)]],
    'non-string name' => ['partner_one_name', ['partner_one_name' => 42]],
    'bad email' => ['contact_email', ['contact_email' => 'not-an-email']],
    'missing email' => ['contact_email', ['contact_email' => null]],
    'bad date format' => ['wedding_date', ['wedding_date' => '06/12/2027']],
    'impossible date' => ['wedding_date', ['wedding_date' => '2027-02-30']],
    'overlong address' => ['shipping_address', ['shipping_address' => str_repeat('a', 501)]],
    'non-string address' => ['shipping_address', ['shipping_address' => ['line' => 'x']]],
] as $label => [$field, $overrides]) {
    $response = apiRequest($application, 'PUT', '/v1/wedding-registry/profile', array_replace($validProfile, $overrides), $first);
    check([422, 'validation_failed'], statusAndError($response), "profile {$label} is rejected");
    check(true, isset($response->payload['details']['fields'][$field]), "profile {$label} names {$field}");
    check(0, rowCount($pdo, 'wedding_registry_profiles'), "profile {$label} persists nothing");
}

// Profile upsert.
$saved = apiRequest($application, 'PUT', '/v1/wedding-registry/profile', $validProfile, $first);
check(200, $saved->status, 'valid profile is saved');
$profile = $saved->payload['data'] ?? [];
check(
    ['partner_one_name', 'partner_two_name', 'wedding_date', 'contact_email', 'shipping_address', 'updated_at'],
    array_keys($profile),
    'profile fields',
);
check(
    ['Ada Lovelace', 'Charles Babbage', '2027-06-12', 'couple@example.test', "12 Analytical Way\nLondon"],
    [$profile['partner_one_name'] ?? null, $profile['partner_two_name'] ?? null, $profile['wedding_date'] ?? null, $profile['contact_email'] ?? null, $profile['shipping_address'] ?? null],
    'profile values are trimmed and normalized',
);
check(true, is_string($profile['updated_at'] ?? null) && strtotime($profile['updated_at']) !== false, 'profile updated_at is a timestamp');
$resaved = apiRequest($application, 'PUT', '/v1/wedding-registry/profile', ['partner_one_name' => 'Ada', 'partner_two_name' => 'Charles', 'contact_email' => 'new@example.test'], $first);
check(200, $resaved->status, 'profile update');
check(
    ['partner_one_name' => 'Ada', 'wedding_date' => null, 'shipping_address' => null],
    array_intersect_key($resaved->payload['data'] ?? [], array_flip(['partner_one_name', 'wedding_date', 'shipping_address'])),
    'optional fields can be cleared',
);
check(1, rowCount($pdo, 'wedding_registry_profiles', $firstId), 'one profile row per user');
check([422, 'validation_failed'], statusAndError(apiRequest($application, 'PUT', '/v1/wedding-registry/profile', array_replace($validProfile, ['contact_email' => 'bad']), $first)), 'invalid update is rejected');
check('new@example.test', apiRequest($application, 'GET', '/v1/wedding-registry/me', null, $first)->payload['data']['profile']['contact_email'] ?? null, 'invalid update keeps the saved profile');

// Enrollments: default all three, idempotent, unknown keys rejected.
// A request without a body enrolls in all three registries.
$enrolled = apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', null, $first);
check(200, $enrolled->status, 'default enrollment');
$enrollments = $enrolled->payload['data']['enrollments'] ?? [];
check(['amazon', 'target', 'zola'], array_column($enrollments, 'registry_key'), 'default enrolls all three in order');
check(['enrolled', 'enrolled', 'enrolled'], array_column($enrollments, 'status'), 'enrollment status');
check(array_column($registries, 'signup_url'), array_column($enrollments, 'signup_url'), 'enrollments include signup URLs');
check(['registry_key', 'status', 'signup_url', 'enrolled_at'], array_keys($enrollments[0] ?? []), 'enrollment fields');
usleep(1_100_000);
$repeat = apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', ['registries' => ['zola', 'amazon']], $first);
check(200, $repeat->status, 'repeat enrollment');
check(3, rowCount($pdo, 'wedding_registry_enrollments', $firstId), 'repeat keeps one row per registry');
check(array_column($enrollments, 'enrolled_at'), array_column($repeat->payload['data']['enrollments'] ?? [], 'enrolled_at'), 'repeat preserves enrolled_at');
$noRegistries = apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', ['registries' => []], $first);
check([200, 3], [$noRegistries->status, count($noRegistries->payload['data']['enrollments'] ?? [])], 'empty registries list re-enrolls all three');
foreach ([
    'unknown key' => ['registries' => ['macys']],
    'mixed keys' => ['registries' => ['amazon', 'Target']],
    'non-list' => ['registries' => 'amazon'],
] as $label => $body) {
    $response = apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', $body, $first);
    check([422, 'validation_failed'], statusAndError($response), "enrollment {$label} is rejected");
    check(true, isset($response->payload['details']['fields']['registries']), "enrollment {$label} names registries");
}
check(3, rowCount($pdo, 'wedding_registry_enrollments'), 'rejected enrollments persist nothing');

// Partial enrollment for a second user only enrolls the requested registry.
apiRequest($application, 'PUT', '/v1/wedding-registry/profile', $validProfile, $second);
$partial = apiRequest($application, 'POST', '/v1/wedding-registry/enrollments', ['registries' => ['target']], $second);
check([200, ['target']], [$partial->status, array_column($partial->payload['data']['enrollments'] ?? [], 'registry_key')], 'requested registries only');

// Picks: upsert picked/added, delete on removed, reject unknown entries.
$picked = apiRequest($application, 'POST', '/v1/wedding-registry/picks', ['picks' => [
    ['registry_key' => 'zola', 'product_key' => 'sonos-move-2-speaker', 'status' => 'picked'],
    ['registry_key' => 'amazon', 'product_key' => 'instant-pot-6-qt', 'status' => 'picked'],
    ['registry_key' => 'target', 'product_key' => 'breville-barista-express', 'status' => 'added'],
]], $first);
check(200, $picked->status, 'picks are saved');
$picks = $picked->payload['data']['picks'] ?? [];
check(
    [['amazon', 'instant-pot-6-qt', 'picked'], ['target', 'breville-barista-express', 'added'], ['zola', 'sonos-move-2-speaker', 'picked']],
    array_map(static fn (array $pick): array => [$pick['registry_key'], $pick['product_key'], $pick['status']], $picks),
    'picks are returned in catalog order',
);
check(['registry_key', 'product_key', 'status', 'updated_at'], array_keys($picks[0] ?? []), 'pick fields');
$changed = apiRequest($application, 'POST', '/v1/wedding-registry/picks', ['picks' => [
    ['registry_key' => 'amazon', 'product_key' => 'instant-pot-6-qt', 'status' => 'added'],
    ['registry_key' => 'zola', 'product_key' => 'sonos-move-2-speaker', 'status' => 'removed'],
    ['registry_key' => 'zola', 'product_key' => 'aura-carver-digital-photo-frame', 'status' => 'removed'],
]], $first);
check(200, $changed->status, 'pick changes');
check(
    [['amazon', 'instant-pot-6-qt', 'added'], ['target', 'breville-barista-express', 'added']],
    array_map(static fn (array $pick): array => [$pick['registry_key'], $pick['product_key'], $pick['status']], $changed->payload['data']['picks'] ?? []),
    'added upserts and removed deletes',
);
check(2, rowCount($pdo, 'wedding_registry_product_picks', $firstId), 'picks keep one row per product');
foreach ([
    'unknown product' => ['picks' => [['registry_key' => 'amazon', 'product_key' => 'no-such-product', 'status' => 'picked']]],
    'product from another registry' => ['picks' => [['registry_key' => 'amazon', 'product_key' => 'sonos-move-2-speaker', 'status' => 'picked']]],
    'unknown registry' => ['picks' => [['registry_key' => 'macys', 'product_key' => 'instant-pot-6-qt', 'status' => 'picked']]],
    'unknown status' => ['picks' => [['registry_key' => 'amazon', 'product_key' => 'cuisinart-knife-set', 'status' => 'purchased']]],
    'empty list' => ['picks' => []],
    'missing list' => null,
    'missing list in an object' => ['registries' => ['amazon']],
    'non-list' => ['picks' => ['registry_key' => 'amazon', 'product_key' => 'cuisinart-knife-set', 'status' => 'picked']],
    'valid then invalid' => ['picks' => [
        ['registry_key' => 'amazon', 'product_key' => 'cuisinart-knife-set', 'status' => 'picked'],
        ['registry_key' => 'amazon', 'product_key' => 'no-such-product', 'status' => 'picked'],
    ]],
] as $label => $body) {
    check([422, 'validation_failed'], statusAndError(apiRequest($application, 'POST', '/v1/wedding-registry/picks', $body, $first)), "picks {$label} is rejected");
}
check(2, rowCount($pdo, 'wedding_registry_product_picks'), 'rejected picks persist nothing');

// /me returns the first user's data; the second user sees none of it.
$me = apiRequest($application, 'GET', '/v1/wedding-registry/me', null, $first);
check(200, $me->status, 'me status');
check(['profile', 'enrollments', 'picks'], array_keys($me->payload['data'] ?? []), 'me fields');
check(['Ada', 3, 2], [$me->payload['data']['profile']['partner_one_name'] ?? null, count($me->payload['data']['enrollments'] ?? []), count($me->payload['data']['picks'] ?? [])], 'me returns the user data');
$otherMe = apiRequest($application, 'GET', '/v1/wedding-registry/me', null, $second);
check(['Ada Lovelace', ['target'], []], [$otherMe->payload['data']['profile']['partner_one_name'] ?? null, array_column($otherMe->payload['data']['enrollments'] ?? [], 'registry_key'), $otherMe->payload['data']['picks'] ?? null], 'second user sees only their own data');
$pdo->exec("DELETE FROM wedding_registry_enrollments WHERE user_id = '{$secondId}'");
$pdo->exec("DELETE FROM wedding_registry_profiles WHERE user_id = '{$secondId}'");
$emptyMe = apiRequest($application, 'GET', '/v1/wedding-registry/me', null, $second);
check([200, ['profile' => null, 'enrollments' => [], 'picks' => []]], [$emptyMe->status, $emptyMe->payload['data'] ?? null], 'a user without data sees an empty registry');
$otherRemove = apiRequest($application, 'POST', '/v1/wedding-registry/picks', ['picks' => [
    ['registry_key' => 'amazon', 'product_key' => 'instant-pot-6-qt', 'status' => 'removed'],
]], $second);
check([200, []], [$otherRemove->status, $otherRemove->payload['data']['picks'] ?? null], "removing another user's pick changes nothing for the caller");
check(2, rowCount($pdo, 'wedding_registry_product_picks', $firstId), "another user cannot remove the first user's picks");

if ($failures !== []) {
    fwrite(STDERR, "Wedding registry checks failed:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "Wedding registry checks passed.\n";
