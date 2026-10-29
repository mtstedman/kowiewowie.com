#!/usr/bin/env php
<?php

declare(strict_types=1);

// Books: the version-24 migration chain entry, the content repository contract for admin-authored
// book recommendations, and the /books and /v1/books API routes with their admin-only mutations.
// Persistence runs against an in-memory SQLite stand-in for the books table, so this check needs
// pdo_sqlite but never touches the configured database.

use Wowie\Api\ApiException;
use Wowie\Api\Application;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Config;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Database\SchemaVersionMinter;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

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

/** @param array<string, mixed> $overrides @return array<string, mixed> */
function book(string $slug, array $overrides = []): array
{
    return array_replace([
        'slug' => $slug,
        'title' => 'The Left Hand of Darkness',
        'author' => 'Ursula K. Le Guin',
        'amazon_url' => 'https://www.amazon.com/dp/0441478123',
        'cover_image_url' => 'https://images.example.com/covers/left-hand.jpg',
        'price_amount' => '17.99',
        'price_currency' => 'USD',
        'overview' => 'An envoy visits a planet whose people have no fixed sex.',
        'status' => 'published',
    ], $overrides);
}

/** @param array<string, mixed>|null $body @param array<string, string> $query */
function apiRequest(Application $application, string $method, string $path, ?array $body = null, ?string $token = null, array $query = []): Response
{
    return $application->handle(new Request(
        $method,
        $path,
        $token === null ? [] : ['authorization' => 'Bearer ' . $token],
        $query,
        $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR),
        '127.0.0.1',
    ));
}

function bookCount(PDO $pdo): int
{
    return (int) $pdo->query('SELECT count(*) FROM books')->fetchColumn();
}

/** @param array<string, mixed> $input */
function expectInvalid(ContentRepository $repository, PDO $pdo, array $input, string $label): void
{
    $before = bookCount($pdo);
    try {
        $repository->save('books', $input, null);
        check('validation_failed', 'saved', "{$label} is rejected");
    } catch (ApiException $error) {
        check([422, 'validation_failed'], [$error->status, $error->errorCode], "{$label} is rejected");
    }
    check($before, bookCount($pdo), "{$label} persists nothing");
}

$root = dirname(__DIR__);
$postgres = $root . '/docs/postgres';

// Migration chain: version 24 appends 023_books.sql with its checksum; history is untouched.
$chain = json_decode((string) file_get_contents($postgres . '/migration-chain.json'), true, flags: JSON_THROW_ON_ERROR);
$last = $chain['versions'][count($chain['versions']) - 1];
check(24, $last['version'] ?? null, 'chain ends at version 24');
check('updates/023_books.sql', $last['updates'][0]['file'] ?? null, 'version 24 update file');
check(hash_file('sha256', $postgres . '/updates/023_books.sql'), $last['updates'][0]['sha256'] ?? null, 'version 24 checksum');
check('updates/022_poe2_inventory.sql', $chain['versions'][22]['updates'][0]['file'] ?? null, 'version 23 update file is unchanged');
check('390948c7bd533533048b8cf2034db05b6824e0f41e54cc08ebd6ed9e4648b010', $chain['versions'][22]['updates'][0]['sha256'] ?? null, 'version 23 checksum is unchanged');
check('24', trim((string) file_get_contents($postgres . '/VERSION')), 'VERSION pin');
try {
    check(24, SchemaVersionMinter::validateDefinition($postgres)['targetVersion'], 'validated target version');
} catch (Throwable $error) {
    $failures[] = 'migration chain does not validate: ' . $error->getMessage();
}
$migration = (string) file_get_contents($postgres . '/updates/023_books.sql');
foreach ([
    'CREATE TABLE books (',
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    'slug text NOT NULL UNIQUE',
    'author text CHECK (author IS NULL',
    'price_amount numeric(12, 2) NOT NULL CHECK (price_amount >= 0)',
    "price_currency text NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$')",
    "status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived'))",
    'created_by uuid REFERENCES users(id) ON DELETE SET NULL',
    'updated_by uuid REFERENCES users(id) ON DELETE SET NULL',
    'published_at timestamptz,',
    'created_at timestamptz NOT NULL DEFAULT now()',
    'updated_at timestamptz NOT NULL DEFAULT now()',
    "CREATE INDEX books_public_idx ON books (published_at DESC) WHERE status = 'published'",
    'CREATE TRIGGER books_set_updated_at BEFORE UPDATE ON books FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
] as $fragment) {
    check(true, str_contains($migration, $fragment), "migration declares {$fragment}");
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "pdo_sqlite is required for the isolated books regressions.\n");
    exit(1);
}

putenv('WOWIE_JWT_SECRET=' . str_repeat('books-content-test-secret-', 2));
putenv('WOWIE_JWT_ISSUER=https://api.wowiekowie.test');
putenv('WOWIE_JWT_AUDIENCE=wowiekowie.test');

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$clock = 0;
$pdo->sqliteCreateFunction('now', static function () use (&$clock): string {
    ++$clock;

    return gmdate('Y-m-d H:i:s', 1_790_000_000 + $clock) . '+00';
});
$uuid = "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))";
$pdo->exec(<<<SQL
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        roles TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        email_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE books (
        id TEXT PRIMARY KEY DEFAULT {$uuid},
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        author TEXT,
        amazon_url TEXT NOT NULL,
        cover_image_url TEXT NOT NULL,
        price_amount TEXT NOT NULL,
        price_currency TEXT NOT NULL,
        overview TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
        created_by TEXT REFERENCES users(id),
        updated_by TEXT REFERENCES users(id),
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE music_entries (
        id TEXT PRIMARY KEY DEFAULT {$uuid},
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        spotify_url TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT,
        updated_by TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
SQL);

$users = [
    'admin' => ['11111111-1111-4111-8111-111111111111', '{admin}'],
    'second-admin' => ['22222222-2222-4222-8222-222222222222', '{admin}'],
    'editor' => ['33333333-3333-4333-8333-333333333333', '{editor}'],
    'member' => ['44444444-4444-4444-8444-444444444444', '{}'],
];
$insertUser = $pdo->prepare('INSERT INTO users (id, email, display_name, roles) VALUES (:id, :email, :name, :roles)');
foreach ($users as $name => [$id, $roles]) {
    $insertUser->execute(['id' => $id, 'email' => "{$name}@example.test", 'name' => $name, 'roles' => $roles]);
}
$adminId = $users['admin'][0];
$secondAdminId = $users['second-admin'][0];

$config = Config::load($root);
$jwt = new JwtService($config);
$tokens = [
    'admin' => $jwt->issue($adminId, ['admin']),
    'editor' => $jwt->issue($users['editor'][0], ['editor']),
    'member' => $jwt->issue($users['member'][0], []),
];
$application = new Application($config, $pdo);
$repository = new ContentRepository($pdo);
$auditOf = static function (string $slug) use ($pdo): array {
    $statement = $pdo->prepare('SELECT created_by, updated_by FROM books WHERE slug = :slug');
    $statement->execute(['slug' => $slug]);

    return $statement->fetch() ?: [];
};

// Round trip: every field, decimal price, audit attribution and publication timestamps survive.
$created = $repository->save('books', book('left-hand', ['status' => 'draft']), $adminId);
$item = $created['item'];
check(true, $created['created'], 'first save creates');
check(
    ['id', 'slug', 'title', 'author', 'amazon_url', 'cover_image_url', 'price_amount', 'price_currency', 'overview', 'status', 'created_at', 'updated_at', 'published_at'],
    array_keys($item),
    'book fields',
);
check(1, preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $item['id']), 'book id is a UUID string');
check(
    ['left-hand', 'The Left Hand of Darkness', 'Ursula K. Le Guin', 'https://www.amazon.com/dp/0441478123', 'https://images.example.com/covers/left-hand.jpg', '17.99', 'USD', 'An envoy visits a planet whose people have no fixed sex.', 'draft', null],
    [$item['slug'], $item['title'], $item['author'], $item['amazon_url'], $item['cover_image_url'], $item['price_amount'], $item['price_currency'], $item['overview'], $item['status'], $item['published_at']],
    'created draft values',
);
check(true, is_string($item['created_at']) && $item['created_at'] !== '' && is_string($item['updated_at']), 'timestamps are strings');
check(['created_by' => $adminId, 'updated_by' => $adminId], $auditOf('left-hand'), 'creator attribution');

$updated = $repository->save('books', book('left-hand', [
    'title' => 'The Dispossessed',
    'author' => null,
    'amazon_url' => 'https://amzn.to/3xYzAbC',
    'cover_image_url' => 'https://m.media-amazon.com/images/I/81dispossessed.jpg',
    'price_amount' => '18.5',
    'price_currency' => 'GBP',
    'overview' => 'Two worlds, one physicist.',
    'status' => 'published',
]), $secondAdminId);
$published = $updated['item'];
check(false, $updated['created'], 'second save updates');
check($item['id'], $published['id'], 'update keeps the id');
check(
    ['The Dispossessed', null, 'https://amzn.to/3xYzAbC', 'https://m.media-amazon.com/images/I/81dispossessed.jpg', '18.50', 'GBP', 'Two worlds, one physicist.', 'published'],
    [$published['title'], $published['author'], $published['amazon_url'], $published['cover_image_url'], $published['price_amount'], $published['price_currency'], $published['overview'], $published['status']],
    'updated values',
);
check(true, is_string($published['published_at']), 'publishing stamps published_at');
check(['created_by' => $adminId, 'updated_by' => $secondAdminId], $auditOf('left-hand'), 'updater attribution keeps the creator');
$archived = $repository->save('books', book('left-hand', ['status' => 'archived']), $adminId)['item'];
check([$published['published_at'], 'archived'], [$archived['published_at'], $archived['status']], 'archiving keeps published_at');
$republished = $repository->save('books', book('left-hand', ['status' => 'published']), $adminId)['item'];
check($published['published_at'], $republished['published_at'], 'republishing keeps the first published_at');
check('left-hand', $repository->find('books', 'left-hand')['slug'], 'find returns a published book');
$repository->delete('books', 'left-hand');
check(0, bookCount($pdo), 'delete removes the book');
foreach (['find' => static fn () => $repository->find('books', 'left-hand', true), 'delete' => static fn () => $repository->delete('books', 'left-hand')] as $operation => $call) {
    try {
        $call();
        check(404, 'no error', "{$operation} of a missing book");
    } catch (ApiException $error) {
        check([404, 'not_found'], [$error->status, $error->errorCode], "{$operation} of a missing book");
    }
}

// Prices: zero and positive decimals keep two-place precision; everything else is refused.
foreach (['0' => '0.00', '0.00' => '0.00', '0.5' => '0.50', '19.9' => '19.90', '19.99' => '19.99', '007.10' => '7.10', '9999999999.99' => '9999999999.99', ' 12 ' => '12.00'] as $input => $expected) {
    $saved = $repository->save('books', book('price-check', ['price_amount' => (string) $input]), $adminId)['item'];
    check($expected, $saved['price_amount'], "price {$input}");
}
foreach ([0 => '0.00', 25 => '25.00'] as $input => $expected) {
    check($expected, $repository->save('books', book('price-check', ['price_amount' => $input]), $adminId)['item']['price_amount'], "integer price {$input}");
}
$repository->delete('books', 'price-check');
foreach (['-1', '-0.01', '1.234', 'abc', '1e3', '', ' ', '.5', '5.', '1,000.00', '0x1A', '12345678901', '99999999999.00', '10000000000'] as $price) {
    expectInvalid($repository, $pdo, book('bad-price', ['price_amount' => $price]), "price " . var_export($price, true));
}
foreach ([-1, 19.99, true, null, ['1.00']] as $price) {
    expectInvalid($repository, $pdo, book('bad-price', ['price_amount' => $price]), 'price value ' . json_encode($price));
}

// Currency: an uppercase three-letter code.
check('EUR', $repository->save('books', book('currency-check', ['price_currency' => ' EUR ']), $adminId)['item']['price_currency'], 'currency is trimmed');
$repository->delete('books', 'currency-check');
foreach (['usd', 'Usd', 'US', 'USDX', 'U5D', '', '$', 840, null] as $currency) {
    expectInvalid($repository, $pdo, book('bad-currency', ['price_currency' => $currency]), 'currency ' . json_encode($currency));
}

// Required fields; author is optional.
foreach (['slug', 'title', 'amazon_url', 'cover_image_url', 'price_amount', 'price_currency', 'overview'] as $field) {
    $input = book('missing-field');
    unset($input[$field]);
    expectInvalid($repository, $pdo, $input, "missing {$field}");
}
foreach (['title', 'overview', 'amazon_url', 'cover_image_url'] as $field) {
    expectInvalid($repository, $pdo, book('blank-field', [$field => '   ']), "blank {$field}");
}
expectInvalid($repository, $pdo, book('Bad Slug'), 'malformed slug');
expectInvalid($repository, $pdo, book('long-title', ['title' => str_repeat('t', 256)]), 'overlong title');
expectInvalid($repository, $pdo, book('bad-status', ['status' => 'live']), 'unknown status');
$input = book('no-author');
unset($input['author']);
check(null, $repository->save('books', $input, $adminId)['item']['author'], 'omitted author');
check(null, $repository->save('books', book('no-author', ['author' => '']), $adminId)['item']['author'], 'empty author');
check('Octavia E. Butler', $repository->save('books', book('no-author', ['author' => '  Octavia E. Butler ']), $adminId)['item']['author'], 'trimmed author');
expectInvalid($repository, $pdo, book('bad-author', ['author' => 42]), 'non-string author');
$repository->delete('books', 'no-author');

// Amazon links: exact marketplace hosts and amzn.to over HTTPS, stored as given.
foreach ([
    'https://www.amazon.com/dp/0441478123',
    'https://amazon.com/Left-Hand-Darkness/dp/0441478123?tag=wowie-20',
    'https://www.amazon.co.uk/dp/0441478123',
    'https://amazon.co.uk/gp/product/0441478123',
    'https://www.amazon.de/dp/0441478123',
    'https://www.amazon.co.jp/dp/0441478123',
    'https://amzn.to/3xYzAbC',
    'https://WWW.AMAZON.COM/dp/0441478123',
    'https://www.amazon.com:443/dp/0441478123',
] as $url) {
    check($url, $repository->save('books', book('amazon-check', ['amazon_url' => $url]), $adminId)['item']['amazon_url'], "accepts {$url}");
}
$repository->delete('books', 'amazon-check');
foreach ([
    'http://www.amazon.com/dp/0441478123',
    'HTTPS://www.amazon.com/dp/0441478123',
    'ftp://amazon.com/dp/0441478123',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//www.amazon.com/dp/0441478123',
    'www.amazon.com/dp/0441478123',
    'https://amazon.com.evil.example/dp/0441478123',
    'https://www.amazon.com.evil.example/dp/0441478123',
    'https://evilamazon.com/dp/0441478123',
    'https://amazon-deals.com/dp/0441478123',
    'https://smile.amazon.com/dp/0441478123',
    'https://amazon.com./dp/0441478123',
    'https://amzn.to.evil.example/3xYzAbC',
    'https://xn--amzon-hra.com/dp/0441478123',
    'https://amazon.evil/dp/0441478123',
    'https://user:pass@www.amazon.com/dp/0441478123',
    'https://www.amazon.com@evil.example/dp/0441478123',
    'https://evil.example\\@www.amazon.com/dp/0441478123',
    'https://evil.example/?next=https://www.amazon.com/dp/0441478123',
    'https://www.amazon.com:8443/dp/0441478123',
    'https://www.amazon.com:80/dp/0441478123',
    "https://www.amazon.com/dp/04414\n78123",
    'https://www.amazon.com /dp/0441478123',
] as $url) {
    expectInvalid($repository, $pdo, book('bad-amazon', ['amazon_url' => $url]), "amazon_url {$url}");
}

// Cover images: any valid HTTPS URL without credentials.
check('https://m.media-amazon.com/images/I/81abc.jpg', $repository->save('books', book('cover-check', ['cover_image_url' => 'https://m.media-amazon.com/images/I/81abc.jpg']), $adminId)['item']['cover_image_url'], 'cover URL');
$repository->delete('books', 'cover-check');
foreach ([
    'http://images.example.com/cover.jpg',
    'https://user:pw@images.example.com/cover.jpg',
    'https://user@images.example.com/cover.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '//images.example.com/cover.jpg',
    'https:///cover.jpg',
    'not a url',
    'https://images.example.com/cover.jpg" onerror="alert(1)',
] as $url) {
    expectInvalid($repository, $pdo, book('bad-cover', ['cover_image_url' => $url]), "cover_image_url {$url}");
}

// Overview: plain text stored as typed, never interpreted; control characters are refused.
$markup = '<p>Hello & <script>alert("x")</script></p>';
$overview = $repository->save('books', book('plain-text', ['overview' => "  {$markup}\r\nSecond line\rThird line\n\n\tIndented  "]), $adminId)['item']['overview'];
check("{$markup}\nSecond line\nThird line\n\n\tIndented", $overview, 'overview keeps markup as text and normalizes line endings');
$response = apiRequest($application, 'GET', '/v1/books/plain-text');
check($markup . "\nSecond line\nThird line\n\n\tIndented", $response->payload['data']['overview'] ?? null, 'API returns the overview text unchanged');
$repository->delete('books', 'plain-text');
expectInvalid($repository, $pdo, book('bad-overview', ['overview' => "Bell\x07"]), 'overview control character');
expectInvalid($repository, $pdo, book('bad-overview', ['overview' => "Nul\x00byte"]), 'overview NUL byte');
expectInvalid($repository, $pdo, book('bad-overview', ['overview' => "Bad \xC3\x28 bytes"]), 'overview invalid UTF-8');
expectInvalid($repository, $pdo, book('bad-overview', ['overview' => str_repeat('o', 20_001)]), 'overlong overview');
expectInvalid($repository, $pdo, book('bad-overview', ['overview' => ['text']]), 'non-string overview');

// Visibility: public list and detail routes expose published books only.
$pdo->exec('DELETE FROM books');
$repository->save('books', book('published-book', ['status' => 'published']), $adminId);
$repository->save('books', book('draft-book', ['status' => 'draft']), $adminId);
$repository->save('books', book('archived-book', ['status' => 'archived']), $adminId);
$repository->save('books', book('another-book', ['status' => 'published', 'price_amount' => '0']), $adminId);
$legacyList = apiRequest($application, 'GET', '/books');
check(200, $legacyList->status, 'legacy list status');
check(['another-book', 'published-book'], array_column($legacyList->payload ?? [], 'slug'), 'legacy list is published only');
check(true, array_is_list($legacyList->payload ?? [null => null]), 'legacy list is a JSON array');
$versionedList = apiRequest($application, 'GET', '/v1/books');
check(200, $versionedList->status, 'versioned list status');
check(['another-book', 'published-book'], array_column($versionedList->payload['data'] ?? [], 'slug'), 'versioned list is published only');
check(['limit' => 100, 'offset' => 0, 'count' => 2], $versionedList->payload['meta'] ?? null, 'versioned list meta');
$page = apiRequest($application, 'GET', '/v1/books', query: ['limit' => '1', 'offset' => '1']);
check(['published-book'], array_column($page->payload['data'] ?? [], 'slug'), 'paged list');
check(['limit' => 1, 'offset' => 1, 'count' => 1], $page->payload['meta'] ?? null, 'paged list meta');
check(['limit' => 100, 'offset' => 0, 'count' => 2], apiRequest($application, 'GET', '/v1/books', query: ['limit' => '500', 'offset' => '-3'])->payload['meta'] ?? null, 'clamped list meta');
check('0.00', $versionedList->payload['data'][0]['price_amount'] ?? null, 'zero price in the list');
$legacyDetail = apiRequest($application, 'GET', '/books/published-book');
check([200, 'published-book', false], [$legacyDetail->status, $legacyDetail->payload['slug'] ?? null, isset($legacyDetail->payload['data'])], 'legacy detail is the bare book');
$versionedDetail = apiRequest($application, 'GET', '/v1/books/published-book');
check([200, 'published-book', '17.99'], [$versionedDetail->status, $versionedDetail->payload['data']['slug'] ?? null, $versionedDetail->payload['data']['price_amount'] ?? null], 'versioned detail wraps the book');
foreach (['/books/draft-book', '/books/archived-book', '/v1/books/draft-book', '/v1/books/archived-book', '/books/no-such-book', '/v1/books/no-such-book'] as $path) {
    $missing = apiRequest($application, 'GET', $path);
    check([404, 'not_found'], [$missing->status, $missing->payload['error'] ?? null], "GET {$path} is not found");
}

// Mutations: versioned routes need an admin; editors keep access to other content resources.
$pdo->exec('DELETE FROM books');
$attempts = static function (string $method, string $path, ?array $body) use ($application, $tokens): array {
    $statuses = [];
    foreach (['anonymous' => null, 'member' => $tokens['member'], 'editor' => $tokens['editor']] as $caller => $token) {
        $response = apiRequest($application, $method, $path, $body, $token);
        $statuses[$caller] = [$response->status, $response->payload['error'] ?? null];
    }
    $statuses['bad-token'] = [apiRequest($application, $method, $path, $body, 'not-a-token')->status];

    return $statuses;
};
$denied = ['anonymous' => [401, 'authentication_required'], 'member' => [403, 'permission_denied'], 'editor' => [403, 'permission_denied'], 'bad-token' => [401]];

check($denied, $attempts('POST', '/v1/books', book('auth-book')), 'POST /v1/books callers');
check(0, bookCount($pdo), 'denied POST persists nothing');
$post = apiRequest($application, 'POST', '/v1/books', book('auth-book'), $tokens['admin']);
check([201, 'auth-book'], [$post->status, $post->payload['data']['slug'] ?? null], 'admin POST creates');
check(['created_by' => $adminId, 'updated_by' => $adminId], $auditOf('auth-book'), 'admin POST attribution');
check([200, 'auth-book'], [($repost = apiRequest($application, 'POST', '/v1/books', book('auth-book'), $tokens['admin']))->status, $repost->payload['data']['slug'] ?? null], 'admin POST of an existing slug updates');

$putBody = book('ignored-slug', ['title' => 'Hijacked']);
unset($putBody['slug']);
check($denied, $attempts('PUT', '/v1/books/auth-book', $putBody), 'PUT /v1/books/{slug} callers');
check('The Left Hand of Darkness', $repository->find('books', 'auth-book', true)['title'], 'denied PUT changes nothing');
$put = apiRequest($application, 'PUT', '/v1/books/auth-book', ['title' => 'Admin Title', 'slug' => 'other-slug'] + $putBody, $tokens['admin']);
check([200, 'auth-book', 'Admin Title'], [$put->status, $put->payload['data']['slug'] ?? null, $put->payload['data']['title'] ?? null], 'admin PUT updates the path slug');
$putCreate = apiRequest($application, 'PUT', '/v1/books/put-created', $putBody, $tokens['admin']);
check([201, 'put-created'], [$putCreate->status, $putCreate->payload['data']['slug'] ?? null], 'admin PUT of a new slug creates');

check($denied, $attempts('DELETE', '/v1/books/auth-book', null), 'DELETE /v1/books/{slug} callers');
check(200, apiRequest($application, 'GET', '/v1/books/auth-book')->status, 'denied DELETE keeps the book');
check(204, apiRequest($application, 'DELETE', '/v1/books/auth-book', null, $tokens['admin'])->status, 'admin DELETE');
check(404, apiRequest($application, 'GET', '/v1/books/auth-book')->status, 'deleted book is gone');
check([404, 'not_found'], [($gone = apiRequest($application, 'DELETE', '/v1/books/auth-book', null, $tokens['admin']))->status, $gone->payload['error'] ?? null], 'admin DELETE of a missing book');

$before = bookCount($pdo);
$invalid = apiRequest($application, 'POST', '/v1/books', book('invalid-post', ['price_amount' => '-5']), $tokens['admin']);
check([422, 'validation_failed'], [$invalid->status, $invalid->payload['error'] ?? null], 'admin POST with an invalid price');
check($before, bookCount($pdo), 'invalid admin POST persists nothing');
check(405, apiRequest($application, 'PATCH', '/v1/books/put-created', $putBody, $tokens['admin'])->status, 'PATCH is not supported');
check(405, apiRequest($application, 'PUT', '/v1/books', $putBody, $tokens['admin'])->status, 'PUT on the collection is not supported');

foreach ([['POST', '/books'], ['PUT', '/books/put-created'], ['DELETE', '/books/put-created']] as [$method, $path]) {
    foreach (['anonymous' => null, 'admin' => $tokens['admin']] as $caller => $token) {
        $legacy = apiRequest($application, $method, $path, book('legacy-book'), $token);
        check([405, 'method_not_allowed'], [$legacy->status, $legacy->payload['error'] ?? null], "legacy {$method} {$path} as {$caller}");
    }
}
check(200, apiRequest($application, 'GET', '/v1/books/put-created')->status, 'legacy mutations change nothing');

$music = ['slug' => 'editor-song', 'title' => 'Song', 'artist' => 'Artist', 'spotify_url' => 'https://open.spotify.com/track/abc', 'status' => 'published'];
check(403, apiRequest($application, 'POST', '/v1/music', $music, $tokens['member'])->status, 'members still cannot write music');
check(201, apiRequest($application, 'POST', '/v1/music', $music, $tokens['editor'])->status, 'editors still write music');

if ($failures !== []) {
    fwrite(STDERR, "Books content checks failed:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "Books content checks passed.\n";
