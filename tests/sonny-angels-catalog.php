<?php

declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/bootstrap.php';

use Wowie\Api\Collectibles\CollectiblesSync;
use Wowie\Api\Collectibles\PopMartCollectionSource;
use Wowie\Api\Collectibles\SonnyAngelCatalogSource;

$catalogPath = $root . '/htdocs/assets/data/sonny-angels.json';
$catalog = json_decode((string) file_get_contents($catalogPath), true, 512, JSON_THROW_ON_ERROR);
$page = (string) file_get_contents($root . '/htdocs/collectibles/index.php');
$legacyPage = (string) file_get_contents($root . '/htdocs/sonny-angels/index.php');
$script = (string) file_get_contents($root . '/htdocs/assets/js/collectibles.js');
$styles = (string) file_get_contents($root . '/htdocs/assets/css/collectibles.css');

$failures = [];
$assert = static function (bool $condition, string $message) use (&$failures): void {
    if (!$condition) {
        $failures[] = $message;
    }
};

$images = [];
foreach (array_merge($catalog['series'], $catalog['figures']) as $record) {
    foreach ($record['images'] as $image) {
        $url = $image['url'];
        $assert(str_starts_with($url, '/assets/images/sonny-angels/'), "External image URL remains: {$url}");
        $assert(!str_contains($url, '..'), "Unsafe image URL: {$url}");
        $file = $root . '/htdocs' . $url;
        $assert(is_file($file), "Missing local image: {$url}");
        if (is_file($file)) {
            $mime = mime_content_type($file);
            $assert(is_string($mime) && str_starts_with($mime, 'image/'), "Non-image asset: {$url}");
        }
        $images[$url] = true;
    }
}

$pricedFigures = 0;
$exactRetailSources = [];
$marketplaceAskingSources = ['www.mercari.com' => 0, 'www.depop.com' => 0];
foreach ($catalog['figures'] as $figure) {
    if ($figure['prices']) {
        $pricedFigures++;
    }
    foreach ($figure['prices'] as $price) {
        if ($price['kind'] === 'retail' && str_starts_with($price['sourceUrl'], 'https://sonnyangelusa.com/collections/mini-figure/products/')) {
            $exactRetailSources[$price['sourceUrl']] = true;
        }
        $host = parse_url($price['sourceUrl'], PHP_URL_HOST);
        if ($price['kind'] === 'asking' && is_string($host) && array_key_exists($host, $marketplaceAskingSources)) {
            $marketplaceAskingSources[$host]++;
        }
    }
}

$assert(count($images) === 747, 'Expected 747 unique locally hosted catalog images.');
$assert($pricedFigures >= 202, 'Expected at least 202 figures with pricing observations.');
$assert(count($exactRetailSources) === 18, 'Expected exact official retail sources for 18 series.');
$assert($marketplaceAskingSources['www.mercari.com'] === 6, 'Expected six Mercari asking-price observations.');
$assert($marketplaceAskingSources['www.depop.com'] === 7, 'Expected seven Depop asking-price observations.');
$source = new SonnyAngelCatalogSource($catalogPath);
$products = CollectiblesSync::normalizeProducts($source->fetchProducts());
$assert(count($products) === 138, 'Expected 138 Sonny Angel series products for the unified shelf.');
$assert(array_sum(array_map(static fn (array $product): int => count($product['variants']), $products)) === 737, 'Expected 737 Sonny Angel figure variants for the unified shelf.');
$assert(str_contains($page, 'value="sonny-angel"'), 'Unified collectibles page is missing the Sonny Angel filter.');
$assert(str_contains($legacyPage, '/collectibles/?brand=sonny-angel'), 'Legacy Sonny Angel route does not redirect to the unified shelf.');
$assert(str_contains($page, 'collectibles-export-pdf'), 'PDF export control is missing.');
$assert(str_contains($page, 'name="inventory"') && str_contains($page, 'collectibles-storage-status'), 'Browser inventory controls are missing.');
$assert(str_contains($script, 'window.print()') && str_contains($script, 'afterprint'), 'PDF export behavior is incomplete.');
$assert(str_contains($script, 'collectible-inventory-table') && str_contains($script, 'collectible-thumbnail-toggle'), 'Spreadsheet inventory rendering is missing.');
$assert(str_contains($styles, '@media print') && str_contains($styles, '@page'), 'PDF print layout is missing.');
$popMartImage = 'https://prod-america-res.popmart.com/default/skullpanda-listing.jpg';
$assert(
    PopMartCollectionSource::parseMainImage('<meta property="og:image" content="' . $popMartImage . '">') === $popMartImage,
    'Pop Mart US listing images must be preferred over the repeated global navigation image.',
);

if ($failures) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo "Sonny Angels catalog assets and prices passed.\n";
