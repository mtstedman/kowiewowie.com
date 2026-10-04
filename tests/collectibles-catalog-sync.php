<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectibleCatalogSupplement;
use Wowie\Api\Collectibles\CollectibleHttpClient;
use Wowie\Api\Collectibles\CollectiblesRepository;
use Wowie\Api\Collectibles\CollectiblesSync;
use Wowie\Api\Collectibles\ShopifyCollectionSource;
use Wowie\Api\Collectibles\SonnyAngelCatalogSource;

require __DIR__ . '/../api/bootstrap.php';

/**
 * SQLite accepts '' as a boolean; PostgreSQL does not, and PDO sends PHP false
 * as ''. Fail any statement given a PHP bool so SQLite runs catch it too.
 */
final class RejectsPhpBooleansStatement extends PDOStatement
{
    protected function __construct() {}

    public function execute(?array $params = null): bool
    {
        foreach ($params ?? [] as $name => $value) {
            if (is_bool($value)) throw new LogicException("Parameter {$name} is a PHP bool; PostgreSQL receives '' for false.");
        }
        return parent::execute($params);
    }
}

$root = dirname(__DIR__);
$failures = [];
$assert = static function (bool $condition, string $message) use (&$failures): void {
    if (!$condition) $failures[] = $message;
};
$assertSame = static function (mixed $expected, mixed $actual, string $message) use (&$failures): void {
    if ($expected !== $actual) $failures[] = $message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true);
};

$tempDirectory = sys_get_temp_dir() . '/collectibles-catalog-sync-' . bin2hex(random_bytes(8));
if (!mkdir($tempDirectory, 0700) && !is_dir($tempDirectory)) throw new RuntimeException('Unable to create catalog regression directory.');
register_shutdown_function(static function () use ($tempDirectory): void {
    foreach (glob($tempDirectory . '/*') ?: [] as $path) @unlink($path);
    @rmdir($tempDirectory);
});

$writeJson = static function (string $name, array $data) use ($tempDirectory): string {
    $path = $tempDirectory . '/' . $name;
    if (file_put_contents($path, json_encode($data, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT)) === false) throw new RuntimeException('Unable to write catalog fixture.');
    return $path;
};
$assertInvalid = static function (string $path, string $message) use ($assert): void {
    try {
        (new CollectibleCatalogSupplement($path))->fetchProducts();
        $assert(false, $message);
    } catch (Throwable) {
        $assert(true, $message);
    }
};

foreach ([
    ['skullpanda-catalog.json', 'skullpanda', 'popmart-us'],
    ['nommi-catalog.json', 'nommi', 'toysez-nommi'],
] as [$file, $brand, $sourceKey]) {
    $source = new CollectibleCatalogSupplement($root . '/htdocs/assets/data/' . $file);
    $products = CollectiblesSync::normalizeProducts($source->fetchProducts());
    $assertSame($brand, $source->brand(), $file . ' brand');
    $assertSame($sourceKey, $source->sourceKey(), $file . ' source key');
    $assert($products !== [], $file . ' products');
    $assert(array_reduce($products, static fn (bool $found, array $product): bool => $found || $product['variants'] !== [], false), $file . ' roster');
    $assert(array_reduce($products, static fn (bool $ok, array $product): bool => $ok && $product['preserve_existing'] === true, true), $file . ' merge flag');
}

$mappings = CollectibleCatalogSupplement::mappings($root);
$assertSame('skullpanda:image-of-reality', $mappings['identity']['popmart-us' . "\0" . '953']['series_id'] ?? null, 'Skullpanda identity mapping');
$assertSame('partial', $mappings['identity']['sonny-angels-catalog' . "\0" . 'snack-series']['series_roster_status'] ?? null, 'Sonny mapping');
$assertSame('nommi:fantasy-world', $mappings['url']['toysez-nommi' . "\0" . 'https://toysez.com/products/nommi-fantasy-world-vinyl-plush-doll-series-nepenthe']['series_id'] ?? null, 'Nommi member mapping');

$rawValid = file_get_contents($root . '/htdocs/assets/data/nommi-catalog.json');
if ($rawValid === false) throw new RuntimeException('Unable to read catalog fixture.');
$valid = json_decode($rawValid, true, 512, JSON_THROW_ON_ERROR);
if (!is_array($valid)) throw new RuntimeException('Catalog fixture must be an object.');

$invalidJsonPath = $tempDirectory . '/invalid-json.json';
file_put_contents($invalidJsonPath, '{');
$assertInvalid($invalidJsonPath, 'invalid JSON must throw');

$invalidCases = [];
$case = $valid; unset($case['checkedAt']); $invalidCases['missing checkedAt'] = $case;
$case = $valid; unset($case['coverage']); $invalidCases['missing coverage'] = $case;
$case = $valid; unset($case['series'][0]['releaseYear']); $invalidCases['missing releaseYear'] = $case;
$case = $valid; unset($case['series'][0]['sources']); $invalidCases['missing series sources'] = $case;
$case = $valid; unset($case['series'][0]['sources'][0]['checkedAt']); $invalidCases['missing source checkedAt'] = $case;
$case = $valid; $case['sourceKey'] = 'popmart-us'; $invalidCases['brand source pairing'] = $case;
$case = $valid; $case['series'][0]['product']['url'] = 'http://toysez.com/insecure'; $invalidCases['product HTTPS URL'] = $case;
$case = $valid; $case['series'][0]['members'][0]['url'] = 'not-a-url'; $invalidCases['member HTTPS URL'] = $case;
$case = $valid; $case['series'][0]['sources'][0]['url'] = 'ftp://toysez.com/evidence'; $invalidCases['source HTTPS URL'] = $case;
$case = $valid; $case['series'][0]['figures'][0]['sources'][0]['checkedAt'] = '2026-02-30'; $invalidCases['figure source checkedAt'] = $case;
$case = $valid;
$case['series'][0]['members'][] = ['externalId' => 'shared-member', 'url' => 'https://toysez.com/products/shared-first'];
$case['series'][1]['members'][] = ['externalId' => 'shared-member', 'url' => 'https://toysez.com/products/shared-second'];
$invalidCases['member identity collision'] = $case;
$case = $valid;
$case['series'][0]['members'][] = ['externalId' => 'first-member', 'url' => 'https://toysez.com/products/shared-url'];
$case['series'][1]['members'][] = ['externalId' => 'second-member', 'url' => 'https://toysez.com/products/shared-url'];
$invalidCases['member URL collision'] = $case;
foreach ($invalidCases as $name => $catalog) $assertInvalid($writeJson(preg_replace('/[^a-z]+/', '-', $name) . '.json', $catalog), $name . ' must throw');

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $failures[] = 'pdo_sqlite is required for isolated persistence regressions';
} else {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [RejectsPhpBooleansStatement::class]);
    $pdo->sqliteCreateFunction('now', static fn (): string => '2026-10-04T00:00:00+00:00');
    $pdo->exec(<<<'SQL'
        CREATE TABLE collectible_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand TEXT NOT NULL,
            source_key TEXT NOT NULL,
            external_id TEXT NOT NULL,
            title TEXT NOT NULL,
            product_url TEXT NOT NULL,
            image_url TEXT NULL,
            price_cents INTEGER NULL,
            currency TEXT NULL,
            price_kind TEXT NULL,
            price_source_url TEXT NULL,
            price_observed_on TEXT NULL,
            release_year INTEGER NULL,
            first_seen_at TEXT NOT NULL DEFAULT '2026-10-04T00:00:00+00:00',
            last_seen_at TEXT NOT NULL DEFAULT '2026-10-04T00:00:00+00:00',
            UNIQUE (source_key, external_id)
        );
        CREATE TABLE collectible_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            is_secret INTEGER NOT NULL,
            image_url TEXT NULL,
            price_cents INTEGER NULL,
            currency TEXT NULL,
            price_kind TEXT NULL,
            price_source_url TEXT NULL,
            price_observed_on TEXT NULL,
            position INTEGER NOT NULL
        );
    SQL);
    $repository = new CollectiblesRepository($pdo);
    $product = static function (string $externalId, string $title, string $url, array $variants, bool $preserve = false): array {
        return [
            'external_id' => $externalId,
            'title' => $title,
            'product_url' => $url,
            'image_url' => $preserve ? null : 'https://cdn.example.test/product.jpg',
            'price_cents' => $preserve ? null : 2499,
            'currency' => $preserve ? null : 'USD',
            'price_kind' => $preserve ? null : 'retail',
            'price_source_url' => $preserve ? null : $url,
            'price_observed_on' => $preserve ? null : '2026-10-04',
            'release_year' => 2026,
            'preserve_existing' => $preserve,
            'variants' => array_map(static fn (string $name): array => [
                'name' => $name,
                'is_secret' => false,
                'image_url' => null,
                'price_cents' => null,
                'currency' => null,
                'price_kind' => null,
                'price_source_url' => null,
                'price_observed_on' => null,
            ], $variants),
        ];
    };

    $matchedUrl = 'https://toysez.com/collections/test-matched';
    $repository->upsertSourceCatalog('toysez-nommi', 'nommi', [$product('retail-101', 'Retail Series', $matchedUrl, ['Alpha', 'Beta'])]);
    $originalProduct = $pdo->query("SELECT id, image_url, price_cents FROM collectible_products WHERE external_id = 'retail-101'")->fetch(PDO::FETCH_ASSOC);
    $originalAlpha = $pdo->query("SELECT id FROM collectible_variants WHERE name = 'Alpha'")->fetchColumn();

    $repository->upsertSourceCatalog('toysez-nommi', 'nommi', [
        $product('catalog:matched', 'Canonical Matched Series', $matchedUrl, ['alpha'], true),
        $product('catalog:absent', 'Canonical Absent Series', 'https://toysez.com/collections/test-absent', [], true),
    ]);
    $matchedRows = $pdo->query("SELECT id, external_id, image_url, price_cents FROM collectible_products WHERE product_url = 'https://toysez.com/collections/test-matched'")->fetchAll(PDO::FETCH_ASSOC);
    $assertSame(1, count($matchedRows), 'existing URL match must not create a duplicate product');
    $assertSame('retail-101', $matchedRows[0]['external_id'] ?? null, 'existing URL match must retain the storefront identity');
    $assertSame($originalProduct['id'] ?? null, $matchedRows[0]['id'] ?? null, 'existing URL match must preserve product ID');
    $assertSame($originalProduct['image_url'] ?? null, $matchedRows[0]['image_url'] ?? null, 'catalog merge must preserve existing image');
    $assertSame((int) ($originalProduct['price_cents'] ?? 0), (int) ($matchedRows[0]['price_cents'] ?? 0), 'catalog merge must preserve existing price');
    $assertSame(1, (int) $pdo->query("SELECT count(*) FROM collectible_products WHERE external_id = 'catalog:absent'")->fetchColumn(), 'absent match must create the authored product');
    $assertSame(1, (int) $pdo->query("SELECT count(*) FROM collectible_variants WHERE product_id = " . (int) ($originalProduct['id'] ?? 0) . " AND lower(name) = 'alpha'")->fetchColumn(), 'case-equivalent variant must merge without duplication');
    $assertSame((string) $originalAlpha, (string) $pdo->query("SELECT id FROM collectible_variants WHERE product_id = " . (int) ($originalProduct['id'] ?? 0) . " AND lower(name) = 'alpha'")->fetchColumn(), 'case-equivalent merge must preserve variant ID');
    $assertSame(1, (int) $pdo->query("SELECT count(*) FROM collectible_variants WHERE product_id = " . (int) ($originalProduct['id'] ?? 0) . " AND name = 'Beta'")->fetchColumn(), 'partial roster must preserve omitted figures');

    $repository->upsertSourceCatalog('toysez-nommi', 'nommi', [$product('catalog:matched', 'Canonical Matched Series', $matchedUrl, [], true)]);
    $assertSame(2, (int) $pdo->query("SELECT count(*) FROM collectible_variants WHERE product_id = " . (int) ($originalProduct['id'] ?? 0))->fetchColumn(), 'unknown roster must preserve existing figures');
    $productCount = (int) $pdo->query('SELECT count(*) FROM collectible_products')->fetchColumn();
    $variantCount = (int) $pdo->query('SELECT count(*) FROM collectible_variants')->fetchColumn();
    $repository->upsertSourceCatalog('toysez-nommi', 'nommi', [$product('catalog:matched', 'Canonical Matched Series', $matchedUrl, ['ALPHA'], true)]);
    $assertSame($productCount, (int) $pdo->query('SELECT count(*) FROM collectible_products')->fetchColumn(), 'repeated imports must not duplicate products');
    $assertSame($variantCount, (int) $pdo->query('SELECT count(*) FROM collectible_variants')->fetchColumn(), 'repeated imports must not duplicate variants');

    $beforeRollbackProducts = (int) $pdo->query('SELECT count(*) FROM collectible_products')->fetchColumn();
    $pdo->exec("CREATE TRIGGER fail_catalog_insert BEFORE INSERT ON collectible_products WHEN NEW.title = 'Rollback' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END");
    try {
        $repository->upsertSourceCatalog('toysez-nommi', 'nommi', [
            $product('transaction-first', 'Transaction First', 'https://toysez.com/collections/transaction-first', []),
            $product('transaction-failure', 'Rollback', 'https://toysez.com/collections/transaction-failure', []),
        ]);
        $assert(false, 'transaction failure must throw');
    } catch (Throwable) {
        $assertSame($beforeRollbackProducts, (int) $pdo->query('SELECT count(*) FROM collectible_products')->fetchColumn(), 'transaction failure must roll back every product');
        $assert(!$pdo->inTransaction(), 'transaction failure must close the transaction');
    }

    $emptySonnyPath = $writeJson('empty-sonny.json', ['series' => [], 'figures' => []]);
    $assertSame([], ShopifyCollectionSource::parseProductsPage('{"products":[]}'), 'empty remote payload must remain empty');
    $remoteFailure = new ShopifyCollectionSource(
        new CollectibleHttpClient(['allowed.invalid']),
        'remote-failure',
        'nommi',
        'https://blocked.invalid/collections/nommi',
        'USD',
        'nommi',
    );
    $isolationPdo = new PDO('sqlite::memory:');
    $isolationPdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $isolationPdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [RejectsPhpBooleansStatement::class]);
    $isolationPdo->sqliteCreateFunction('now', static fn (): string => '2026-10-04T00:00:00+00:00');
    foreach ($pdo->query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name IN ('collectible_products', 'collectible_variants') ORDER BY name DESC")->fetchAll(PDO::FETCH_COLUMN) as $sql) $isolationPdo->exec((string) $sql);
    $sync = new CollectiblesSync(new CollectiblesRepository($isolationPdo), [
        new CollectibleCatalogSupplement($root . '/htdocs/assets/data/skullpanda-catalog.json'),
        new SonnyAngelCatalogSource($emptySonnyPath),
        $remoteFailure,
    ]);
    $results = $sync->run();
    $assertSame(['ok', 'failed', 'failed'], array_column($results, 'status'), 'successful, empty, and failed sources must remain isolated');
    $assertSame(6, (int) $isolationPdo->query('SELECT count(*) FROM collectible_products')->fetchColumn(), 'empty and failed sources must not erase the successful catalog import');
}

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}
fwrite(STDOUT, "collectibles catalog supplement regressions passed\n");
