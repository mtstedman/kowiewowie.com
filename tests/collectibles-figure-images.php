<?php

declare(strict_types=1);

use Wowie\Api\Collectibles\CollectibleFigureImages;

require __DIR__ . '/../api/bootstrap.php';

// Downloaded figure pictures ship with the site: every manifest entry must name
// a real local WebP under the collectibles image root, for a known set, and
// figure names must match however the store punctuated them.
$failures = [];
$assertSame = static function (mixed $expected, mixed $actual, string $message) use (&$failures): void {
    if ($expected !== $actual) $failures[] = $message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true);
};

$assertSame("chronos' gardener", CollectibleFigureImages::key("Chronos’ Gardener（Secret）"), 'curly quotes, full-width brackets, and the secret marker normalize away');
$assertSame('bear claw machine', CollectibleFigureImages::key('  Bear  Claw Machine (secret) '), 'spacing and case normalize');
$assertSame('jingle all the way (green)', CollectibleFigureImages::key('Jingle All the Way(Green)'), 'a bracket without a space matches the spaced form');
$assertSame('getting dressed (pink)', CollectibleFigureImages::key('Getting Dressed（Pink）'), 'full-width brackets match');
$assertSame('as i wish', CollectibleFigureImages::key('As I Wish (Super Secret)'), 'the super secret marker normalizes away');

$images = new CollectibleFigureImages(['nommi:dream' => [
    'cloud nine' => ['path' => '/assets/images/collectibles/nommi/dream/cloud-nine.webp'],
    'escape' => ['path' => '/assets/images/collectibles/nommi/../../secret.webp'],
]]);
$assertSame('/assets/images/collectibles/nommi/dream/cloud-nine.webp', $images->forFigure('nommi:dream', 'Cloud  Nine'), 'a figure finds its picture by normalized name');
$assertSame(null, $images->forFigure('nommi:other', 'Cloud Nine'), 'pictures belong to their own set');
$assertSame(null, $images->forFigure(null, 'Cloud Nine'), 'set-less listings have no catalog pictures');
$assertSame(null, $images->forFigure('nommi:dream', 'Escape'), 'a path outside the image root is refused');

$root = dirname(__DIR__);
$manifest = json_decode((string) file_get_contents($root . '/htdocs/assets/data/collectible-figure-images.json'), true, flags: JSON_THROW_ON_ERROR);
$sets = [];
foreach (['skullpanda-catalog.json', 'nommi-catalog.json'] as $file) {
    $catalog = json_decode((string) file_get_contents($root . '/htdocs/assets/data/' . $file), true, flags: JSON_THROW_ON_ERROR);
    foreach ($catalog['series'] as $series) $sets[$catalog['brand'] . ':' . $series['id']] = true;
}
$count = 0;
$paths = [];
foreach ($manifest['images'] as $seriesId => $figures) {
    if (!isset($sets[$seriesId])) $failures[] = "manifest set {$seriesId} is not in a catalog";
    foreach ($figures as $key => $entry) {
        $count++;
        $label = "{$seriesId} / {$key}";
        if ($key !== CollectibleFigureImages::key((string) ($entry['name'] ?? ''))) $failures[] = "{$label}: key does not match its normalized name";
        $path = (string) ($entry['path'] ?? '');
        if (preg_match(CollectibleFigureImages::PATH_PATTERN, $path) !== 1) $failures[] = "{$label}: bad path {$path}";
        elseif (!str_starts_with($path, '/assets/images/collectibles/' . explode(':', $seriesId)[0] . '/')) $failures[] = "{$label}: stored under another brand";
        elseif (!is_file($root . '/htdocs' . $path) || substr((string) file_get_contents($root . '/htdocs' . $path, false, null, 8, 4), 0, 4) !== 'WEBP') $failures[] = "{$label}: {$path} is not a WebP file";
        if (isset($paths[$path])) $failures[] = "{$label}: shares {$path} with {$paths[$path]}";
        $paths[$path] = $label;
        foreach (['source', 'page'] as $field) {
            if (!str_starts_with((string) ($entry[$field] ?? ''), 'https://')) $failures[] = "{$label}: {$field} must cite an https URL";
        }
    }
}
$assertSame(true, $count > 0, 'the manifest lists pictures');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", array_slice($failures, 0, 40)) . "\n");
    exit(1);
}
fwrite(STDOUT, "collectibles figure image regressions passed ({$count} pictures)\n");
