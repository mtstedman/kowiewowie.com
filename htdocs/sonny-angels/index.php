<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Sonny Angels - wowiekowie.com';
$metaDescription = 'Browse Sonny Angel figures, series, packaging identifiers and dated price observations, with sources and coverage notes.';
$pageStyles = ['/assets/css/sonny-angels.css'];
$families = ['regular' => 'Regular', 'hippers' => 'HIPPERS', 'limited' => 'Limited', 'artist' => 'Artist Collection', 'master' => 'Master Collection', 'other' => 'Other'];

function saEscape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function saUrl(string $value): bool
{
    if (filter_var($value, FILTER_VALIDATE_URL) === false) {
        return false;
    }
    $parts = parse_url($value);
    return is_array($parts) && ($parts['scheme'] ?? '') === 'https'
        && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass']);
}

function saDate($value): bool
{
    if (!is_string($value) || !preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/D', $value, $parts)) {
        return false;
    }
    return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
}

function saStrings($values): bool
{
    if (!is_array($values) || !array_is_list($values)) {
        return false;
    }
    foreach ($values as $value) {
        if (!is_string($value)) {
            return false;
        }
    }
    return true;
}

// Validate the structures used by the view before rendering any catalog content.
function saRecord($record): bool
{
    if (!is_array($record) || !is_string($record['id'] ?? null) || $record['id'] === ''
        || !is_string($record['name'] ?? null) || $record['name'] === ''
        || !saStrings($record['sources'] ?? null) || !array_key_exists('notes', $record)
        || !(is_string($record['notes']) || $record['notes'] === null)) {
        return false;
    }
    foreach (['identifiers', 'images'] as $field) {
        if (!isset($record[$field]) || !is_array($record[$field]) || !array_is_list($record[$field])) {
            return false;
        }
    }
    foreach ($record['identifiers'] as $identifier) {
        if (!is_array($identifier) || !in_array($identifier['kind'] ?? null, ['SKU', 'JAN', 'UPC'], true)
            || !is_string($identifier['value'] ?? null)
            || !in_array($identifier['scope'] ?? null, ['figure', 'blind_box', 'assortment', 'product'], true)
            || !is_string($identifier['sourceUrl'] ?? null) || !array_key_exists('region', $identifier)
            || !(is_string($identifier['region']) || $identifier['region'] === null)) {
            return false;
        }
    }
    foreach ($record['images'] as $image) {
        if (!is_array($image) || !is_string($image['url'] ?? null) || !is_string($image['sourceUrl'] ?? null)
            || !is_string($image['alt'] ?? null) || !in_array($image['scope'] ?? null, ['figure', 'series'], true)) {
            return false;
        }
    }
    return true;
}

function saPrice($price): bool
{
    return is_array($price) && array_key_exists('condition', $price)
        && array_key_exists('notes', $price) && array_key_exists('shippingAmount', $price)
        && in_array($price['kind'] ?? null, ['sold', 'asking', 'retail'], true)
        && (is_int($price['amount'] ?? null) || is_float($price['amount'] ?? null))
        && is_finite((float) $price['amount']) && $price['amount'] >= 0
        && is_string($price['currency'] ?? null) && preg_match('/^[A-Z]{3}$/D', $price['currency']) === 1
        && saDate($price['date'] ?? null) && is_string($price['sourceUrl'] ?? null)
        && (is_string($price['condition'] ?? null) || ($price['condition'] ?? null) === null)
        && (is_string($price['notes'] ?? null) || ($price['notes'] ?? null) === null)
        && (($price['shippingAmount'] ?? null) === null
            || ((is_int($price['shippingAmount']) || is_float($price['shippingAmount']))
                && is_finite((float) $price['shippingAmount']) && $price['shippingAmount'] >= 0));
}

function saSources(array $sources): void
{
    $safe = array_values(array_unique(array_filter($sources, 'saUrl')));
    if (!$safe) {
        return;
    }
    echo '<ul class="sa-sources">';
    foreach ($safe as $index => $url) {
        echo '<li><a href="' . saEscape($url) . '" rel="noopener noreferrer">Source ' . ($index + 1)
            . ' · ' . saEscape((string) parse_url($url, PHP_URL_HOST)) . '</a></li>';
    }
    echo '</ul>';
}

function saIdentifiers(array $identifiers): void
{
    $scopes = ['figure' => 'individual figure', 'blind_box' => 'random blind box', 'assortment' => 'assortment / case', 'product' => 'product'];
    echo '<ul class="sa-identifiers">';
    foreach ($identifiers as $identifier) {
        echo '<li><strong>' . saEscape($identifier['kind']) . '</strong> <span>' . saEscape($identifier['value']) . '</span>'
            . ' — ' . saEscape($scopes[$identifier['scope']])
            . ($identifier['region'] ? ' (' . saEscape($identifier['region']) . ')' : ' (region not recorded)');
        if (saUrl($identifier['sourceUrl'])) {
            echo ' · <a href="' . saEscape($identifier['sourceUrl']) . '" rel="noopener noreferrer">Identifier source</a>';
        }
        echo '</li>';
    }
    echo '</ul>';
}

function saImage(array $images, string $name, bool $seriesOnly = false): void
{
    $selected = null;
    foreach ($images as $image) {
        if (saUrl($image['url']) && saUrl($image['sourceUrl'])) {
            $selected = $image;
            break;
        }
    }
    echo '<figure class="sa-image">';
    if ($selected === null) {
        echo '<div class="sa-image-placeholder">Image unavailable</div>';
    } else {
        $representative = $seriesOnly || $selected['scope'] === 'series';
        $alt = ($representative ? 'Representative series image for ' : 'Catalog image for ') . $name;
        if ($selected['alt'] !== '') {
            $alt .= ' — ' . $selected['alt'];
        }
        echo '<div class="sa-image-frame"><span class="sa-image-placeholder">Image unavailable if it cannot load</span>'
            . '<img src="' . saEscape($selected['url']) . '" alt="' . saEscape($alt)
            . '" loading="lazy" decoding="async" width="360" height="320" referrerpolicy="no-referrer" data-sa-image></div>';
        echo '<figcaption>' . ($representative ? 'Representative series image; not the individual figure. ' : '')
            . '<a href="' . saEscape($selected['sourceUrl']) . '" rel="noopener noreferrer">Image source</a></figcaption>';
    }
    echo '</figure>';
}

function saPrices(array $prices, string $kind): void
{
    $observations = array_values(array_filter($prices, static function (array $price) use ($kind): bool {
        return $price['kind'] === $kind && saUrl($price['sourceUrl']);
    }));
    $labels = ['sold' => 'Sold evidence', 'asking' => 'Asking prices', 'retail' => 'Retail prices'];
    echo '<div class="sa-price-block"><h4>' . $labels[$kind] . '</h4>';
    if (!$observations) {
        echo '<p>' . ($kind === 'sold' ? 'Market value unknown — no reliable sold evidence recorded.' : 'No ' . ($kind === 'asking' ? 'asking' : 'retail') . ' price recorded.') . '</p></div>';
        return;
    }
    if ($kind === 'sold') {
        echo '<p><strong>' . (count($observations) === 1 ? 'One observed sale' : count($observations) . ' individual observed sales') . '</strong> — historical evidence, not a current appraisal.</p>';
    } else {
        echo '<p>' . ($kind === 'asking' ? 'Seller requests, not completed sales.' : 'Retail observations, not resale value. Check notes for randomized packaging.') . '</p>';
    }
    // Keep observations separate: currencies, conditions and editions may not be comparable.
    echo '<ul class="sa-observations">';
    foreach ($observations as $price) {
        echo '<li><a href="' . saEscape($price['sourceUrl']) . '" rel="noopener noreferrer"><strong>'
            . saEscape($price['currency']) . ' ' . saEscape(number_format((float) $price['amount'], 2))
            . '</strong> · <time datetime="' . saEscape($price['date']) . '">' . saEscape($price['date']) . '</time></a>'
            . '<span>Condition: ' . saEscape($price['condition'] ?: 'not recorded') . '.</span>'
            . '<span>Shipping: ' . ($price['shippingAmount'] === null ? 'not recorded; not included in the amount above'
                : saEscape($price['currency']) . ' ' . saEscape(number_format((float) $price['shippingAmount'], 2))) . '.</span>';
        if ($price['notes']) {
            echo '<span>' . saEscape($price['notes']) . '</span>';
        }
        echo '</li>';
    }
    echo '</ul></div>';
}

$catalog = null;
$seriesById = [];
$figuresBySeries = [];
try {
    $raw = @file_get_contents(dirname(__DIR__) . '/assets/data/sonny-angels.json');
    if ($raw === false) {
        throw new RuntimeException('Catalog unavailable');
    }
    $catalog = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($catalog) || ($catalog['schemaVersion'] ?? null) !== 1 || !saDate($catalog['checkedAt'] ?? null)
        || !is_array($catalog['coverage'] ?? null) || !is_string($catalog['coverage']['summary'] ?? null)
        || !saStrings($catalog['coverage']['gaps'] ?? null) || !saStrings($catalog['coverage']['sources'] ?? null)
        || !is_array($catalog['series'] ?? null) || !array_is_list($catalog['series'])
        || !is_array($catalog['figures'] ?? null) || !array_is_list($catalog['figures'])) {
        throw new RuntimeException('Invalid catalog');
    }
    foreach ($catalog['series'] as $series) {
        if (!saRecord($series) || !is_string($series['family'] ?? null) || !isset($families[$series['family']])
            || !in_array($series['status'] ?? null, ['current', 'discontinued', 'unknown'], true)
            || !array_key_exists('releaseYear', $series)
            || !(is_int($series['releaseYear']) || $series['releaseYear'] === null)
            || isset($seriesById[$series['id']])) {
            throw new RuntimeException('Invalid series');
        }
        $seriesById[$series['id']] = $series;
        $figuresBySeries[$series['id']] = [];
    }
    $figureIds = [];
    foreach ($catalog['figures'] as $figure) {
        if (!saRecord($figure) || !is_string($figure['seriesId'] ?? null) || !isset($seriesById[$figure['seriesId']])
            || !in_array($figure['variant'] ?? null, ['regular', 'secret', 'robby', 'special', 'unknown'], true)
            || !is_array($figure['prices'] ?? null) || !array_is_list($figure['prices']) || isset($figureIds[$figure['id']])) {
            throw new RuntimeException('Invalid figure');
        }
        foreach ($figure['prices'] as $price) {
            if (!saPrice($price)) {
                throw new RuntimeException('Invalid price');
            }
        }
        $figureIds[$figure['id']] = true;
        $figuresBySeries[$figure['seriesId']][] = $figure;
    }
} catch (Throwable $error) {
    $catalog = null;
    $seriesById = [];
    $figuresBySeries = [];
}

$scriptPath = dirname(__DIR__) . '/assets/js/sonny-angels.js';
$scriptVersion = is_file($scriptPath) ? (string) filemtime($scriptPath) : '1';
require __DIR__ . '/../partials/head.php';
?>
<body>
<div class="page-shell">
    <?php require __DIR__ . '/../partials/header.php'; ?>
    <main class="sa-catalog" data-sa-catalog>
        <section class="hero hero-compact">
            <p class="eyebrow">The little collector shelf</p>
            <h1>Sonny Angels</h1>
            <p class="lede">Find a familiar face, explore a series, and see what the price evidence actually says.</p>
            <p>Prices are dated observations, not guaranteed current market values. Retail and asking prices are separate from completed sales.</p>
        </section>
        <?php if ($catalog === null): ?>
            <section class="sa-notice" aria-labelledby="sa-unavailable-title">
                <h2 id="sa-unavailable-title">The catalog is temporarily unavailable.</h2>
                <p>We couldn’t read the catalog data. Please try again later; the rest of the site is still available.</p>
            </section>
        <?php else: ?>
            <section class="sa-coverage" aria-labelledby="sa-coverage-title">
                <h2 id="sa-coverage-title">A growing catalog, with known gaps</h2>
                <p>Catalog checked <time datetime="<?= saEscape($catalog['checkedAt']) ?>"><?= saEscape($catalog['checkedAt']) ?></time> · <?= count($catalog['figures']) ?> figures · <?= count($seriesById) ?> series.</p>
                <p><?= saEscape($catalog['coverage']['summary']) ?></p>
                <p>Images are linked from the catalog’s sources. Image/name pairings have not been visually verified; external images may become unavailable.</p>
                <details>
                    <summary>Coverage gaps and catalog sources</summary>
                    <ul><?php foreach ($catalog['coverage']['gaps'] as $gap): ?><li><?= saEscape($gap) ?></li><?php endforeach; ?></ul>
                    <?php saSources($catalog['coverage']['sources']); ?>
                </details>
            </section>
            <form class="sa-filters" data-sa-form hidden role="search" aria-label="Search Sonny Angels">
                <div class="sa-search-field">
                    <label for="sa-query">Name, series or identifier</label>
                    <input type="search" id="sa-query" data-sa-query placeholder="Try Koala, Dreaming or a JAN" aria-controls="sa-results">
                </div>
                <div>
                    <label for="sa-family">Family</label>
                    <select id="sa-family" data-sa-family aria-controls="sa-results">
                        <option value="">All families</option>
                        <?php foreach ($families as $value => $label): ?><option value="<?= saEscape($value) ?>"><?= saEscape($label) ?></option><?php endforeach; ?>
                    </select>
                </div>
                <div>
                    <label for="sa-series">Series / edition</label>
                    <select id="sa-series" data-sa-series aria-controls="sa-results">
                        <option value="">All series / editions</option>
                        <?php foreach ($seriesById as $series): ?><option value="<?= saEscape($series['id']) ?>" data-family="<?= saEscape($series['family']) ?>"><?= saEscape($series['name']) ?><?= $series['releaseYear'] !== null ? ' · ' . $series['releaseYear'] : '' ?></option><?php endforeach; ?>
                    </select>
                </div>
                <button type="button" class="button" data-sa-clear>Clear all</button>
            </form>
            <noscript><p class="sa-notice">All catalog entries are shown below. Use your browser’s Find command to search; interactive filters need JavaScript.</p></noscript>
            <p class="sa-count" data-sa-count role="status" aria-live="polite" aria-atomic="true"><?= count($catalog['figures']) ?> figures across <?= count($seriesById) ?> series.</p>
            <div class="sa-notice" data-sa-empty hidden>
                <h2>No matching entries</h2>
                <p>Try a shorter name, another identifier, or clear all filters. Some series have no documented figure lineup.</p>
                <button type="button" class="button" data-sa-clear>Clear all filters</button>
            </div>
            <div id="sa-results">
                <?php foreach ($seriesById as $series):
                    $figures = $figuresBySeries[$series['id']];
                    $seriesSearch = $series['name'] . ' ' . ($series['releaseYear'] ?? '') . ' ' . implode(' ', array_column($series['identifiers'], 'value'));
                ?>
                    <section class="sa-series" data-sa-group data-series="<?= saEscape($series['id']) ?>" data-family="<?= saEscape($series['family']) ?>" data-search="<?= saEscape($seriesSearch) ?>" aria-labelledby="sa-series-<?= saEscape($series['id']) ?>">
                        <div class="sa-series-heading">
                            <p class="eyebrow"><?= saEscape($families[$series['family']]) ?> · <?= $series['releaseYear'] !== null ? $series['releaseYear'] : 'Release year unknown' ?></p>
                            <h2 id="sa-series-<?= saEscape($series['id']) ?>"><?= saEscape($series['name']) ?></h2>
                            <p>Status at catalog check: <?= saEscape($series['status']) ?> · <?= count($figures) ?> documented figures</p>
                            <?php if ($series['notes']): ?><p><?= saEscape($series['notes']) ?></p><?php endif; ?>
                            <details><summary>Series sources and packaging identifiers</summary>
                                <?php if ($series['identifiers']): saIdentifiers($series['identifiers']); else: ?><p>No series packaging identifiers recorded.</p><?php endif; ?>
                                <?php saSources($series['sources']); ?>
                            </details>
                        </div>
                        <?php if (!$figures): ?>
                            <div class="sa-undocumented">
                                <?php saImage($series['images'], $series['name'], true); ?>
                                <p>Individual figure lineup not documented. Market value and individual SKUs are unknown.</p>
                            </div>
                        <?php else: ?>
                            <div class="sa-grid">
                                <?php foreach ($figures as $figure):
                                    $identifiers = array_merge($figure['identifiers'], $series['identifiers']);
                                    $search = $figure['name'] . ' ' . $seriesSearch . ' ' . implode(' ', array_column($figure['identifiers'], 'value'));
                                    $figureImages = array_values(array_filter($figure['images'], static function (array $image): bool {
                                        return $image['scope'] === 'figure';
                                    }));
                                    $seriesImages = array_values(array_filter(array_merge($figure['images'], $series['images']), static function (array $image): bool {
                                        return $image['scope'] === 'series';
                                    }));
                                ?>
                                    <article class="sa-card" data-sa-card data-search="<?= saEscape($search) ?>" aria-labelledby="sa-figure-<?= saEscape($figure['id']) ?>">
                                        <?php saImage(array_merge($figureImages, $seriesImages), $figure['name'] . ' · ' . $series['name']); ?>
                                        <div class="sa-card-body">
                                            <p class="sa-variant"><?= saEscape(ucfirst($figure['variant'])) ?> variant</p>
                                            <h3 id="sa-figure-<?= saEscape($figure['id']) ?>"><?= saEscape($figure['name']) ?></h3>
                                            <p class="sa-edition"><?= saEscape($series['name']) ?><?= $series['releaseYear'] !== null ? ' · ' . $series['releaseYear'] : '' ?></p>
                                            <?php saPrices($figure['prices'], 'sold'); ?>
                                            <h4>Identifiers</h4>
                                            <?php if (!array_filter($figure['identifiers'], static function (array $identifier): bool { return $identifier['kind'] === 'SKU' && $identifier['scope'] === 'figure'; })): ?>
                                                <p>Individual figure SKU unavailable.</p>
                                            <?php endif; ?>
                                            <?php if ($identifiers): saIdentifiers($identifiers); else: ?><p>No SKU, JAN or UPC recorded.</p><?php endif; ?>
                                            <details class="sa-details"><summary>Retail, asking prices and sources</summary>
                                                <?php saPrices($figure['prices'], 'retail'); saPrices($figure['prices'], 'asking'); saSources($figure['sources']); ?>
                                            </details>
                                            <?php if ($figure['notes']): ?><p class="sa-note"><?= saEscape($figure['notes']) ?></p><?php endif; ?>
                                        </div>
                                    </article>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>
                    </section>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </main>
    <?php require __DIR__ . '/../partials/footer.php'; ?>
</div>
<script src="/assets/js/sonny-angels.js?v=<?= rawurlencode($scriptVersion) ?>" defer></script>
</body>
</html>
