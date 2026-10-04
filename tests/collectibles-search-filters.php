<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectibleCatalogSupplement;
use Wowie\Api\Collectibles\CollectibleListingClassifier;
use Wowie\Api\Collectibles\CollectiblesRepository;

require __DIR__ . '/../api/bootstrap.php';

// The shelf asks the API for one release year (or one set) at a time instead
// of downloading the whole catalog, so the year/set filters, their facets,
// and paging over the filtered listings are pinned here against the live
// store titles in the classifier fixture.
$failures = [];
$assertSame = static function (mixed $expected, mixed $actual, string $message) use (&$failures): void {
    if ($expected !== $actual) $failures[] = $message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true);
};

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
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
        sku TEXT NULL,
        barcode TEXT NULL,
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
        sku TEXT NULL,
        barcode TEXT NULL,
        position INTEGER NOT NULL
    );
SQL);

$listings = json_decode((string) file_get_contents(__DIR__ . '/fixtures/collectibles-store-listings.json'), true, flags: JSON_THROW_ON_ERROR);
$insert = $pdo->prepare('INSERT INTO collectible_products (brand, source_key, external_id, title, product_url, release_year) VALUES (?, ?, ?, ?, ?, ?)');
foreach ($listings as $index => $listing) {
    // One undated store listing carries its own year, which must count when
    // its set (if any) has none.
    $insert->execute([$listing['brand'], $listing['source_key'], 'fixture-' . $index, $listing['title'], $listing['product_url'], $index === 0 ? 2024 : null]);
}
$pdo->exec("INSERT INTO collectible_variants (product_id, name, is_secret, position) VALUES (1, 'Alpha', 0, 0), (1, 'Beta', 1, 1)");

// Independent expectations: the classifier's set and year for every listing.
$mappings = CollectibleCatalogSupplement::mappings(dirname(__DIR__));
$expected = [];
foreach ($pdo->query('SELECT * FROM collectible_products ORDER BY title, id')->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $mapping = CollectibleListingClassifier::classify($mappings, $row['source_key'], $row['brand'], $row['external_id'], $row['product_url'], $row['title']);
    $expected[(string) $row['id']] = [
        'brand' => $row['brand'],
        'group' => $mapping['series_id'] ?? 'unclassified:' . $row['brand'] . ':' . $mapping['line'],
        'year' => $mapping['series_release_year'] ?? ($row['release_year'] === null ? null : (int) $row['release_year']),
    ];
}
$expectedIds = static fn (callable $keep): array => array_map('strval', array_keys(array_filter($expected, $keep)));
$repository = new CollectiblesRepository($pdo);
$ids = static fn (array $result): array => array_column($result['items'], 'id');

$all = $repository->search(null, null, 'name-asc', 1000, 0);
$assertSame(count($expected), $all['total'], 'no filter returns every listing');
$assertSame(count($expected), array_sum(array_column($all['facets']['years'], 'listings')), 'year facets account for every listing');
$facetYears = array_column($all['facets']['years'], 'year');
$assertSame(null, end($facetYears), 'undated listings are the last year facet');
$dated = array_values(array_filter($facetYears, 'is_int'));
$sorted = $dated;
rsort($sorted);
$assertSame($sorted, $dated, 'year facets run newest first');
$assertSame(['Alpha', 'Beta'], array_column($repository->search(null, null, 'name-asc', 1000, 0, 'all', null)['items'][array_search('1', $ids($all), true)]['variants'] ?? [], 'name'), 'figures load for the page');

$nommi2025 = $repository->search(null, 'nommi', 'name-asc', 1000, 0, '2025');
$want = $expectedIds(static fn (array $listing): bool => $listing['brand'] === 'nommi' && $listing['year'] === 2025);
$assertSame(true, count($want) > 0, 'the fixture has 2025 Nommi listings');
$assertSame(count($want), $nommi2025['total'], 'a year filter counts only that year');
$assertSame($want, $ids($nommi2025), 'a year filter returns only that year, in sort order');
$assertSame(
    array_column($repository->search(null, 'nommi', 'name-asc', 1000, 0)['facets']['years'], 'listings'),
    array_column($nommi2025['facets']['years'], 'listings'),
    'year facets ignore the year filter',
);
$facetSets = array_column($nommi2025['facets']['series'], 'id');
$assertSame(
    array_values(array_unique(array_map(static fn (string $id): string => $expected[$id]['group'], $want))),
    array_values(array_intersect(array_unique(array_map(static fn (string $id): string => $expected[$id]['group'], $want)), $facetSets)),
    'set facets list every set in the chosen year',
);
$assertSame(count($facetSets), count(array_unique(array_map(static fn (string $id): string => $expected[$id]['group'], $want))), 'set facets list only sets in the chosen year');

$undated = $repository->search(null, 'skullpanda', 'name-asc', 1000, 0, 'unknown');
$assertSame($expectedIds(static fn (array $listing): bool => $listing['brand'] === 'skullpanda' && $listing['year'] === null), $ids($undated), 'year=unknown returns undated listings');
$own = $repository->search(null, null, 'name-asc', 1000, 0, '2024');
$assertSame(true, in_array('1', $ids($own), true) === ($expected['1']['year'] === 2024), "a listing's own year counts when its set has none");

$someSet = $nommi2025['items'][0]['series_id'] ?? null;
$assertSame(true, is_string($someSet), 'a 2025 Nommi listing belongs to a set');
$bySet = $repository->search(null, null, 'name-asc', 1000, 0, 'all', $someSet);
$assertSame($expectedIds(static fn (array $listing): bool => $listing['group'] === $someSet), $ids($bySet), 'a set filter returns that set across all brands and years');
$assertSame($someSet, $bySet['series'], 'the chosen set is echoed');
$legacy = $repository->search(null, null, 'name-asc', 1000, 0, 'all', $ids($bySet)[0]);
$assertSame([$someSet, $ids($bySet)], [$legacy['series'], $ids($legacy)], 'a listing id from an older link resolves to its set');
$large = $repository->search(null, null, 'name-asc', 1000, 0, 'all', 'unclassified:skullpanda:large');
$assertSame($expectedIds(static fn (array $listing): bool => $listing['group'] === 'unclassified:skullpanda:large'), $ids($large), 'a set-less group filters by brand and line');
$assertSame(true, $large['total'] > 0, 'the fixture has MEGA pieces');

$paged = [];
for ($offset = 0; $offset < $all['total']; $offset += 7) {
    $page = $repository->search(null, null, 'name-asc', 7, $offset);
    $assertSame($all['total'], $page['total'], 'every page reports the filtered total');
    $paged = [...$paged, ...$ids($page)];
}
$assertSame($ids($all), $paged, 'pages concatenate to the whole result in order');
$assertSame([], $repository->search(null, 'nommi', 'name-asc', 1000, 0, '1999')['items'], 'an empty year returns nothing');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}
fwrite(STDOUT, "collectibles search filter regressions passed\n");
