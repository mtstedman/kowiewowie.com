<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectibleCatalogSupplement;
use Wowie\Api\Collectibles\CollectibleListingClassifier;

require __DIR__ . '/../api/bootstrap.php';

// Store listings captured from the live shelf on 2026-10-04 (Pop Mart US and
// TOYSEZ wording), so every rule is pinned to real titles.
$failures = [];
$assertSame = static function (mixed $expected, mixed $actual, string $message) use (&$failures): void {
    if ($expected !== $actual) $failures[] = $message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true);
};

$root = dirname(__DIR__);
$mappings = CollectibleCatalogSupplement::mappings($root);
$listings = json_decode((string) file_get_contents(__DIR__ . '/fixtures/collectibles-store-listings.json'), true, 512, JSON_THROW_ON_ERROR);
$byTitle = [];
$classified = [];
foreach ($listings as $listing) {
    $result = CollectibleListingClassifier::classify($mappings, $listing['source_key'], $listing['brand'], '', $listing['product_url'], $listing['title']);
    $byTitle[$listing['title']] = $result;
    $classified[] = [$listing, $result];
}
$check = static function (string $title, ?string $seriesId, string $kind, ?string $figure = null, ?string $line = null) use ($byTitle, $assertSame): void {
    $result = $byTitle[$title] ?? null;
    $assertSame(true, $result !== null, 'fixture listing present: ' . $title);
    if ($result === null) return;
    $assertSame($seriesId, $result['series_id'], $title . ' series');
    $assertSame($kind, $result['listing_kind'], $title . ' kind');
    $assertSame($figure, $result['listing_figure'], $title . ' figure');
    if ($line !== null) $assertSame($line, $result['line'], $title . ' line');
};

// Nommi: single figures, whole sets, and the series box all join their set;
// TOYSEZ's own collection slug resolves "Sweetness 100%".
$check('Nommi About the Childhood Plush Dolls Blind Box Series: Bear Claw Machine (Confirmed Style)', 'nommi:about-the-childhood', 'figure', 'Bear Claw Machine');
$check('Nommi About the Childhood Plush Dolls Blind Box Series: Whole Set (Opened Box)', 'nommi:about-the-childhood', 'whole-set');
$check('Nommi About the Childhood Plush Dolls Blind Box Series', 'nommi:about-the-childhood', 'box');
$check('Nommi Sweetness 100% Vinyl Plush Pendant Series Barista', 'nommi:glutinous-rice-100-sweetness', 'figure', 'Barista');
$check('Nommi Sweetness 100% Vinyl Plush Pendant Series Secret Salty Sugus (1/108)', 'nommi:glutinous-rice-100-sweetness', 'figure', 'Salty Sugus');
$check('Nommi Good Night,Bear 400% Vinyl Plush Doll Series Accompany', 'nommi:good-night-bear-400', 'figure', 'Accompany', 'large');

// SKULLPANDA: series merchandise joins its series as an accessory, even when
// a figure name follows ("Mini Bag-The Sugar Tongs").
$check('SKULLPANDA Image Of Reality Series-Badge Blind Box', 'skullpanda:image-of-reality', 'accessory');
$check('SKULLPANDA The Feast Begins Series Mini Bag-The Sugar Tongs', 'skullpanda:the-feast-begins', 'accessory');
$check('SKULLPANDA The Mirage Series Phone Case', 'skullpanda:the-mirage', 'accessory');
$check('SKULLPANDA Tell Me What You Want Series Plush Pendant', 'skullpanda:tell-me-what-you-want-plush-pendant', 'box');
// Items that belong to no series stay standalone, filed by product line.
$check('MEGA α SKULLPANDA 1000% Red Crystal', null, 'standalone', null, 'large');
$check('SKULLPANDA Aisling Figure', null, 'standalone', null, 'standalone');
$check('SKULLPANDA × KUROMI Plush', null, 'standalone', null, 'plush');
$check('SKULLPANDA Amid Flowers Plush Doll Pendant', null, 'standalone', null, 'pendants');
$check('SKULLPANDA CHEERS TO MYSELF SERIES-Mini Bag', null, 'standalone', null, 'accessories');

$unmatched = ['nommi' => 0, 'skullpanda' => 0];
foreach ($classified as [$listing, $result]) {
    if ($result['series_id'] === null) $unmatched[$listing['brand']]++;
    // A listing only ever joins a series of its own brand.
    if ($result['series_id'] !== null) $assertSame(true, str_starts_with($result['series_id'], $listing['brand'] . ':'), $listing['title'] . ' brand scope');
    $assertSame(true, in_array($result['line'], ['figures', 'plush', 'pendants', 'large', 'accessories', 'standalone'], true), $listing['title'] . ' line vocabulary');
}
$assertSame(0, $unmatched['nommi'], 'every captured Nommi listing joins a set');
$assertSame(30, $unmatched['skullpanda'], 'only SKULLPANDA items outside any series stay standalone');

// An exact catalog identity is the series' own card.
$assertSame('series', CollectibleListingClassifier::classify($mappings, 'popmart-us', 'skullpanda', '953', 'https://www.popmart.com/us/products/953/skullpanda-image-of-reality-series-figures', 'SKULLPANDA Image Of Reality Series Figures')['listing_kind'], 'series product kind');
// Sonny Angel lines are its archive families.
$assertSame('limited', CollectibleListingClassifier::classify($mappings, 'sonny-angels-catalog', 'sonny-angel', 'halloween-series-2015', '', 'Halloween Series 2015')['line'], 'Sonny Angel family line');
$assertSame('sweetness 100 vinyl plush', CollectibleListingClassifier::normalize('Sweetness 100% Vinyl-Plush'), 'normalization');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}
fwrite(STDOUT, "collectibles listing classifier regressions passed\n");
