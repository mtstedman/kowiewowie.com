#!/usr/bin/env php
<?php

declare(strict_types=1);

function catalogDataAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function catalogDataAssertSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

/** @return array<string, mixed> */
function catalogDataRead(string $path): array
{
    $raw = file_get_contents($path);
    catalogDataAssert($raw !== false, 'Unable to read ' . $path);

    $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    catalogDataAssert(is_array($decoded), $path . ' must contain a JSON object');

    return $decoded;
}

/** @param list<string> $expected */
function catalogDataAssertKeys(array $expected, array $actual, string $message): void
{
    $actualKeys = array_keys($actual);
    sort($expected);
    sort($actualKeys);
    catalogDataAssertSame($expected, $actualKeys, $message);
}

function catalogDataAssertDate(mixed $value, string $message): void
{
    catalogDataAssert(is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) === 1, $message);
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    catalogDataAssert($date !== false && $date->format('Y-m-d') === $value, $message);
}

function catalogDataAssertHttps(mixed $value, string $message): void
{
    catalogDataAssert(is_string($value) && preg_match('#^https://[^\s]+$#D', $value) === 1, $message);
    catalogDataAssert(filter_var($value, FILTER_VALIDATE_URL) !== false, $message);
}

/** @param array<string, mixed> $source */
function catalogDataAssertSource(array $source, string $message): string
{
    catalogDataAssertKeys(['url', 'tier', 'checkedAt'], $source, $message . ' keys');
    catalogDataAssertHttps($source['url'] ?? null, $message . ' URL must be HTTPS');
    catalogDataAssert(in_array($source['tier'] ?? null, ['official', 'secondary'], true), $message . ' tier is invalid');
    catalogDataAssertDate($source['checkedAt'] ?? null, $message . ' checkedAt is invalid');

    return ($source['url'] ?? '') . '|' . ($source['tier'] ?? '') . '|' . ($source['checkedAt'] ?? '');
}

/**
 * @param array<string, mixed> $catalog
 * @return array<string, array<string, mixed>>
 */
function catalogDataValidate(array $catalog, string $brand, string $sourceKey): array
{
    catalogDataAssertKeys(['schemaVersion', 'checkedAt', 'brand', 'sourceKey', 'coverage', 'series'], $catalog, $brand . ' catalog keys');
    catalogDataAssertSame(1, $catalog['schemaVersion'] ?? null, $brand . ' schema version');
    catalogDataAssertDate($catalog['checkedAt'] ?? null, $brand . ' checkedAt');
    catalogDataAssertSame($brand, $catalog['brand'] ?? null, $brand . ' brand');
    catalogDataAssertSame($sourceKey, $catalog['sourceKey'] ?? null, $brand . ' source key');

    $coverage = $catalog['coverage'] ?? null;
    catalogDataAssert(is_array($coverage), $brand . ' coverage must be an object');
    catalogDataAssertKeys(['summary', 'gaps'], $coverage, $brand . ' coverage keys');
    catalogDataAssert(is_string($coverage['summary'] ?? null) && trim($coverage['summary']) !== '', $brand . ' coverage summary is required');
    catalogDataAssert(is_array($coverage['gaps'] ?? null) && $coverage['gaps'] !== [], $brand . ' coverage gaps must be explicit');
    foreach ($coverage['gaps'] as $gap) {
        catalogDataAssert(is_string($gap) && trim($gap) !== '', $brand . ' coverage gaps must be strings');
    }

    catalogDataAssert(is_array($catalog['series'] ?? null) && $catalog['series'] !== [], $brand . ' series must be a non-empty list');

    $seriesById = [];
    $productIds = [];
    $figureIds = [];
    foreach ($catalog['series'] as $seriesIndex => $series) {
        $prefix = $brand . ' series #' . $seriesIndex;
        catalogDataAssert(is_array($series), $prefix . ' must be an object');
        catalogDataAssertKeys(['id', 'name', 'releaseYear', 'rosterStatus', 'sources', 'product', 'members', 'figures'], $series, $prefix . ' keys');

        $seriesId = $series['id'] ?? null;
        catalogDataAssert(is_string($seriesId) && preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $seriesId) === 1, $prefix . ' ID is invalid');
        catalogDataAssert(!isset($seriesById[$seriesId]), $brand . ' duplicate series ID: ' . $seriesId);
        catalogDataAssert(is_string($series['name'] ?? null) && trim($series['name']) !== '', $seriesId . ' name is required');
        catalogDataAssert(is_int($series['releaseYear'] ?? null) || ($series['releaseYear'] ?? null) === null, $seriesId . ' releaseYear must be an integer or null');
        catalogDataAssert(in_array($series['rosterStatus'] ?? null, ['complete', 'partial', 'unknown'], true), $seriesId . ' rosterStatus is invalid');

        catalogDataAssert(is_array($series['sources'] ?? null) && $series['sources'] !== [], $seriesId . ' sources are required');
        $seriesSourceKeys = [];
        foreach ($series['sources'] as $sourceIndex => $source) {
            catalogDataAssert(is_array($source), $seriesId . ' source #' . $sourceIndex . ' must be an object');
            $sourceIdentity = catalogDataAssertSource($source, $seriesId . ' source #' . $sourceIndex);
            catalogDataAssert(!isset($seriesSourceKeys[$sourceIdentity]), $seriesId . ' has a duplicate source');
            $seriesSourceKeys[$sourceIdentity] = true;
        }

        $product = $series['product'] ?? null;
        catalogDataAssert(is_array($product), $seriesId . ' product must be an object');
        catalogDataAssertKeys(['externalId', 'title', 'url'], $product, $seriesId . ' product keys');
        catalogDataAssert(is_string($product['externalId'] ?? null) && trim($product['externalId']) !== '', $seriesId . ' product externalId is required');
        catalogDataAssert(is_string($product['title'] ?? null) && trim($product['title']) !== '', $seriesId . ' product title is required');
        catalogDataAssertHttps($product['url'] ?? null, $seriesId . ' product URL must be HTTPS');
        $productIdentity = $sourceKey . '|' . $product['externalId'];
        catalogDataAssert(!isset($productIds[$productIdentity]), $brand . ' duplicate product identity: ' . $productIdentity);
        $productIds[$productIdentity] = true;

        catalogDataAssert(is_array($series['members'] ?? null), $seriesId . ' members must be a list');
        $memberUrls = [];
        foreach ($series['members'] as $memberIndex => $member) {
            catalogDataAssert(is_array($member), $seriesId . ' member #' . $memberIndex . ' must be an object');
            catalogDataAssertKeys(['externalId', 'url'], $member, $seriesId . ' member #' . $memberIndex . ' keys');
            catalogDataAssert(($member['externalId'] ?? null) === null || (is_string($member['externalId']) && trim($member['externalId']) !== ''), $seriesId . ' member externalId must be a string or null');
            catalogDataAssertHttps($member['url'] ?? null, $seriesId . ' member URL must be HTTPS');
            catalogDataAssert(!isset($memberUrls[$member['url']]), $seriesId . ' has a duplicate member URL');
            $memberUrls[$member['url']] = true;
        }

        catalogDataAssert(is_array($series['figures'] ?? null), $seriesId . ' figures must be a list');
        if ($series['rosterStatus'] === 'complete') {
            catalogDataAssert($series['figures'] !== [], $seriesId . ' complete roster must have figures');
        }
        if ($series['rosterStatus'] === 'unknown') {
            catalogDataAssertSame([], $series['figures'], $seriesId . ' unknown roster must not invent figures');
        }

        $figureNames = [];
        foreach ($series['figures'] as $figureIndex => $figure) {
            catalogDataAssert(is_array($figure), $seriesId . ' figure #' . $figureIndex . ' must be an object');
            catalogDataAssertKeys(['id', 'name', 'isSecret', 'sources'], $figure, $seriesId . ' figure #' . $figureIndex . ' keys');
            $figureId = $figure['id'] ?? null;
            catalogDataAssert(is_string($figureId) && str_starts_with($figureId, $seriesId . ':'), $seriesId . ' figure ID must be namespaced');
            catalogDataAssert(!isset($figureIds[$figureId]), $brand . ' duplicate figure ID: ' . $figureId);
            $figureIds[$figureId] = true;
            catalogDataAssert(is_string($figure['name'] ?? null) && trim($figure['name']) !== '', $figureId . ' name is required');
            catalogDataAssert(!isset($figureNames[$figure['name']]), $seriesId . ' duplicate figure name: ' . $figure['name']);
            $figureNames[$figure['name']] = true;
            catalogDataAssert(is_bool($figure['isSecret'] ?? null), $figureId . ' isSecret must be boolean');
            catalogDataAssert(is_array($figure['sources'] ?? null) && $figure['sources'] !== [], $figureId . ' sources are required');
            foreach ($figure['sources'] as $sourceIndex => $source) {
                catalogDataAssert(is_array($source), $figureId . ' source #' . $sourceIndex . ' must be an object');
                $sourceIdentity = catalogDataAssertSource($source, $figureId . ' source #' . $sourceIndex);
                catalogDataAssert(isset($seriesSourceKeys[$sourceIdentity]), $figureId . ' source must reference its series provenance');
            }
        }

        $seriesById[$seriesId] = $series;
    }

    return $seriesById;
}

/** @param list<string> $regulars */
function catalogDataAssertRoster(array $series, array $regulars, string $secret, string $message): void
{
    $actualRegulars = [];
    $actualSecrets = [];
    foreach ($series['figures'] as $figure) {
        if ($figure['isSecret']) {
            $actualSecrets[] = $figure['name'];
        } else {
            $actualRegulars[] = $figure['name'];
        }
    }

    catalogDataAssertSame($regulars, $actualRegulars, $message . ' regular roster');
    catalogDataAssertSame([$secret], $actualSecrets, $message . ' secret roster');
}

$root = dirname(__DIR__);
$skullpanda = catalogDataValidate(
    catalogDataRead($root . '/htdocs/assets/data/skullpanda-catalog.json'),
    'skullpanda',
    'popmart-us',
);
$nommi = catalogDataValidate(
    catalogDataRead($root . '/htdocs/assets/data/nommi-catalog.json'),
    'nommi',
    'toysez-nommi',
);
$popBean = catalogDataValidate(
    catalogDataRead($root . '/htdocs/assets/data/pop-bean-catalog.json'),
    'pop-bean',
    'popmart-us-pop-bean',
);
catalogDataAssert(count($popBean) >= 20, 'POP BEAN lists its US blind-box series');

$skullpandaExpectations = [
    'image-of-reality' => [2024, '953', ['The Duality (Black)', 'The Philosophy', 'The Paradox', 'The Pivot', 'The Disguise', 'The Imagination', 'The Constraint', 'The Soar', 'The Timelapse', 'The Duality (White)', 'The Merchant', 'The Antigravity'], 'The Onlooker'],
    'the-sound' => [2024, '1317', ['The Joy', 'The Anger', 'The Serenity', 'The Pensiveness', 'The Trust', 'The Disgust', 'The Ecstasy', 'The Grief', 'The Admiration', 'The Terror', 'The Vigilance', 'The Awe'], 'The Equilibrium'],
    'the-ink-plum-blossom' => [2023, '720', ['The Forest', 'The Moss', 'The Bamboo', 'The Snow', 'The Wind', 'The Bridge', 'The Moon', 'The Root', 'The Valley', 'The Spring', 'The Scene', 'The Courtyard'], 'The Plum Blossom'],
    'the-feast-begins' => [2025, '4080', ['The Dinner Knife', 'The Silver Fork', 'The Caddy Spoon', 'The Spoon Warmer', 'The Napkin', 'The Silver Claret Jug', 'The Sugar Tongs', 'The Crumb Scoop', 'The Aspic Server', 'The Knife Rest', 'The Egg Cup', 'The Grape Scissors'], 'Fine Dining'],
    'petals-in-four-acts' => [2026, '6201', ["The Fairy's Trick", 'The Budding Fable', 'The Fatal Entwining', 'The Burning Gloom', 'The Invitation of Light', 'The Vow', 'The Withered Innocence', 'The Submerged Wreath', 'The Elegiac Witness', 'The Decay Awaited', 'The Crown in Ashes', 'The Threefold Requiem'], "Chronos' Gardener"],
    'where-time-dwells' => [2026, '8890', ['Colonnade Contemplation', 'Mystic Veil', 'Spire Vigil', 'Beneath Flying Eaves', 'Spiral Minuet', 'Jazz Age Sheen', 'Breathing Veins', 'Bare Imprint', 'Beyond Light Trace'], 'Grain of Time'],
];

// The six series first verified from live official pages keep their exact
// rosters; the researched back catalog (2020-2026) joins them, every roster
// complete and dated.
catalogDataAssertSame([], array_values(array_diff(array_keys($skullpandaExpectations), array_keys($skullpanda))), 'Skullpanda core series present');
catalogDataAssertSame(26, count($skullpanda), 'Skullpanda series count');
foreach ($skullpanda as $seriesId => $series) {
    catalogDataAssertSame('complete', $series['rosterStatus'], $seriesId . ' roster status');
    catalogDataAssertSame(true, is_int($series['releaseYear']), $seriesId . ' release year');
}
foreach ($skullpandaExpectations as $seriesId => [$releaseYear, $externalId, $regulars, $secret]) {
    catalogDataAssertSame('complete', $skullpanda[$seriesId]['rosterStatus'], $seriesId . ' roster status');
    catalogDataAssertSame($releaseYear, $skullpanda[$seriesId]['releaseYear'], $seriesId . ' release year');
    catalogDataAssertSame($externalId, $skullpanda[$seriesId]['product']['externalId'], $seriesId . ' upstream product ID');
    catalogDataAssertSame('official', $skullpanda[$seriesId]['sources'][0]['tier'], $seriesId . ' source tier');
    catalogDataAssertRoster($skullpanda[$seriesId], $regulars, $secret, $seriesId);
}

catalogDataAssertSame(9, count(array_filter($skullpanda['where-time-dwells']['figures'], static fn (array $figure): bool => !$figure['isSecret'])), 'WHERE TIME DWELLS regular count');
catalogDataAssertSame(1, count(array_filter($skullpanda['where-time-dwells']['figures'], static fn (array $figure): bool => $figure['isSecret'])), 'WHERE TIME DWELLS secret count');

catalogDataAssertRoster($nommi['fantasy-world'], ['Nepenthe', 'Morpheus', 'Solace', 'Aurora', 'Reverie', 'Eclipse'], 'Starflare', 'Fantasy World');
catalogDataAssertRoster($nommi['interesting-fruits'], ['Orange', 'Avocado', 'Blueberry', 'Apple', 'Lemon', 'Strawberries'], 'Toffee', 'Interesting Fruits');
catalogDataAssertSame('secondary', $nommi['fantasy-world']['sources'][0]['tier'], 'Fantasy World source tier');
catalogDataAssertSame('secondary', $nommi['interesting-fruits']['sources'][0]['tier'], 'Interesting Fruits source tier');
catalogDataAssertSame('catalog:fantasy-world', $nommi['fantasy-world']['product']['externalId'], 'Fantasy World catalog identity');
catalogDataAssertSame('catalog:interesting-fruits', $nommi['interesting-fruits']['product']['externalId'], 'Interesting Fruits catalog identity');
catalogDataAssertSame('https://toysez.com/collections/nommi-interesting-fruits-vinyl-plush-doll-series', $nommi['interesting-fruits']['product']['url'], 'Interesting Fruits companion provenance');
catalogDataAssertSame(9, count($nommi['fantasy-world']['members']), 'Fantasy World retail member count');
catalogDataAssertSame(9, count($nommi['interesting-fruits']['members']), 'Interesting Fruits retail member count');

// Researched 2026-10-04: these were title-only records; each now carries a
// sourced roster (complete, or partial where a name could not be verified).
$researchedNommiSeries = [
    'sitting-zoo',
    'magical-christmas-eve',
    'weather-forecast',
    'mibao-town',
    'about-the-childhood',
    'collecting-cutie-bags',
    'good-night-bear-400',
    'glutinous-rice-100-sweetness',
    'a-bite-of-sweetheart',
    'loveliness-never-ends',
    'baby-sweetheart-bunny',
    'mushroom-hat-400',
    'puppy-diary',
    'forest-kingdom',
    'pinky-energy',
    'treasure-collector',
];
foreach ($researchedNommiSeries as $seriesId) {
    catalogDataAssert(isset($nommi[$seriesId]), 'Missing researched Nommi series: ' . $seriesId);
    catalogDataAssert(in_array($nommi[$seriesId]['rosterStatus'], ['complete', 'partial'], true), $seriesId . ' must carry a researched roster');
    catalogDataAssert($nommi[$seriesId]['figures'] !== [], $seriesId . ' must list its sourced figures');
    catalogDataAssertSame('catalog:' . $seriesId, $nommi[$seriesId]['product']['externalId'], $seriesId . ' catalog identity');
}

foreach ($nommi as $seriesId => $series) {
    foreach ($series['figures'] as $figure) {
        catalogDataAssert(preg_match('/whole set|opened|plastic/i', $figure['name']) !== 1, $seriesId . ' retail bundle was fabricated as a figure');
    }
}
foreach (['fantasy-world', 'interesting-fruits'] as $seriesId) {
    catalogDataAssert(
        count(array_filter($nommi[$seriesId]['members'], static fn (array $member): bool => str_contains($member['url'], 'whole-set'))) === 2,
        $seriesId . ' must retain opened and sealed retail bundles only as members',
    );
}

fwrite(STDOUT, 'Collectibles catalog data regressions passed.' . PHP_EOL);
