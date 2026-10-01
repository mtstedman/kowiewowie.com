<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$catalogPath = $root . '/htdocs/assets/data/sonny-angels.json';
$catalog = json_decode((string) file_get_contents($catalogPath), true, 512, JSON_THROW_ON_ERROR);

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
foreach ($catalog['figures'] as $figure) {
    if ($figure['prices']) {
        $pricedFigures++;
    }
    foreach ($figure['prices'] as $price) {
        if ($price['kind'] === 'retail' && str_starts_with($price['sourceUrl'], 'https://sonnyangelusa.com/collections/mini-figure/products/')) {
            $exactRetailSources[$price['sourceUrl']] = true;
        }
    }
}

$assert(count($images) === 747, 'Expected 747 unique locally hosted catalog images.');
$assert($pricedFigures >= 202, 'Expected at least 202 figures with pricing observations.');
$assert(count($exactRetailSources) === 18, 'Expected exact official retail sources for 18 series.');

if ($failures) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo "Sonny Angels catalog assets and prices passed.\n";
