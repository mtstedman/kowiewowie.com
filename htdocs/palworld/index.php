<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Palworld breeding optimizer - wowiekowie.com';
$metaDescription = 'Plan a Palworld breeding route that combines the passive traits from pals you own.';
$pageStyles = ['/assets/css/palworld.css'];
$palworldScriptVersion = static function (string $href): string {
    $scriptPath = dirname(__DIR__) . $href;
    $version = is_file($scriptPath) ? (string) filemtime($scriptPath) : '1';

    return htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '?v=' . rawurlencode($version);
};

// Revision of the three bulk JSON inputs. The browser reuses its saved copy only
// while this matches; bump the cache format when the saved record shape changes.
$palworldCacheFormat = 1;
$palworldDataBytes = 0;
$palworldRevisionParts = ['cache-format:' . $palworldCacheFormat];
foreach (['palcalc-db.json', 'palcalc-breeding.json', 'pal-thumbnails.json'] as $palworldDataFile) {
    $palworldDataPath = dirname(__DIR__) . '/assets/data/palworld/' . $palworldDataFile;
    $palworldDataSize = is_file($palworldDataPath) ? filesize($palworldDataPath) : false;
    $palworldDataTime = is_file($palworldDataPath) ? filemtime($palworldDataPath) : false;
    if ($palworldDataSize === false || $palworldDataTime === false) {
        // No trustworthy revision: the page falls back to downloading without saving.
        $palworldRevisionParts = null;
        $palworldDataBytes = 0;
        break;
    }
    $palworldDataBytes += $palworldDataSize;
    $palworldRevisionParts[] = $palworldDataFile . ':' . $palworldDataSize . ':' . $palworldDataTime;
}
$palworldDataRevision = $palworldRevisionParts === null
    ? ''
    : substr(hash('sha256', implode('|', $palworldRevisionParts)), 0, 32);
$palworldDataSizeLabel = $palworldDataBytes > 0
    ? 'about ' . number_format($palworldDataBytes / 1000000, 1) . ' MB'
    : 'several MB';

// Spawn map files load only when a "Where to find" map first opens, so they stay out
// of the revision above. The zone list's modified time versions those requests, and the
// source record supplies the credit line.
$palworldMapDataDir = dirname(__DIR__) . '/assets/data/palworld/';
$palworldMapZonesPath = $palworldMapDataDir . 'pal-spawn-zones.json';
$palworldMapZonesTime = is_file($palworldMapZonesPath) ? filemtime($palworldMapZonesPath) : false;
$palworldMapVersion = $palworldMapZonesTime === false ? '' : (string) $palworldMapZonesTime;
$palworldMapSource = [];
$palworldMapSourcePath = $palworldMapDataDir . 'pal-map-source.json';
if (is_file($palworldMapSourcePath)) {
    $palworldMapSourceJson = file_get_contents($palworldMapSourcePath);
    $palworldMapSourceData = $palworldMapSourceJson === false ? null : json_decode($palworldMapSourceJson, true);
    if (is_array($palworldMapSourceData)) {
        $palworldMapSource = $palworldMapSourceData;
    }
}
$palworldMapField = static function (string $name, string $fallback) use ($palworldMapSource): string {
    $value = $palworldMapSource[$name] ?? null;

    return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
};
$palworldMapRepository = $palworldMapField('repository', 'https://github.com/Nifrendil/pal-atlas');
if (preg_match('#^https://[A-Za-z0-9._~/-]+$#', $palworldMapRepository) !== 1) {
    $palworldMapRepository = 'https://github.com/Nifrendil/pal-atlas';
}
$palworldMapLicense = $palworldMapField('license', 'MIT');
$palworldMapCopyright = $palworldMapField('copyright', 'Copyright (c) 2026 Ryexha, JenAri');
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell palworld-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Palworld / Breeding planner</p>
                <h1>Your next pal starts here.</h1>
                <p class="lede">Pick a pal, choose the passives you want, and trace a breeding route from the pals you already own.</p>
            </section>

            <p id="palworld-load-status" class="palworld-notice" role="status" aria-live="polite">Preparing the breeding planner. The first visit downloads <?= htmlspecialchars($palworldDataSizeLabel, ENT_QUOTES, 'UTF-8') ?> of breeding data; later visits load the copy saved in this browser.</p>
            <noscript><p class="palworld-notice">Enable JavaScript to load the breeding data and use this planner.</p></noscript>

            <div class="palworld-layout">
                <form id="palworld-form" class="palworld-panel palworld-bar" aria-labelledby="palworld-plan-title" data-palworld-revision="<?= htmlspecialchars($palworldDataRevision, ENT_QUOTES, 'UTF-8') ?>" data-palworld-cache-format="<?= htmlspecialchars((string) $palworldCacheFormat, ENT_QUOTES, 'UTF-8') ?>" data-palworld-data-bytes="<?= htmlspecialchars((string) $palworldDataBytes, ENT_QUOTES, 'UTF-8') ?>" data-palworld-map-version="<?= htmlspecialchars($palworldMapVersion, ENT_QUOTES, 'UTF-8') ?>" novalidate>
                    <h2 id="palworld-plan-title" class="palworld-bar-title">Build your breeding plan</h2>
                    <p class="palworld-help palworld-plan-intro">Work through the setup in order, then find a route. You can revise any choice without losing your last successful route.</p>
                    <fieldset id="palworld-controls" class="palworld-controls" disabled>
                        <legend class="public-visually-hidden">Breeding plan inputs</legend>
                        <section class="palworld-setup-step palworld-bar-target" aria-labelledby="palworld-target-title">
                            <h3 id="palworld-target-title"><span class="palworld-step-number" aria-hidden="true">1</span> Choose your target Pal</h3>
                            <p class="palworld-help">Search for the Pal you want to breed.</p>
                            <div id="palworld-target-picker"></div>
                        </section>

                        <section id="palworld-addons" class="palworld-setup-step palworld-addons" aria-labelledby="palworld-traits-title">
                            <h3 id="palworld-traits-title"><span class="palworld-step-number" aria-hidden="true">2</span> Choose desired passives <span class="palworld-optional">(optional)</span></h3>
                            <p id="palworld-traits-help" class="palworld-help">Select up to four passive traits. Each selected passive becomes a checkbox on every owned Pal, so you can mark exactly which desired traits that Pal already carries.</p>
                            <p id="palworld-addons-summary" class="palworld-addons-summary" aria-live="polite">No desired passives selected.</p>
                            <div id="palworld-addons-panel" class="palworld-addons-panel" role="group" aria-labelledby="palworld-traits-title">
                                <div class="palworld-trait-fields">
                                    <label for="palworld-trait-1">Passive 1 (optional)<select id="palworld-trait-1" name="trait-1" aria-describedby="palworld-traits-help"><option value="">No passive</option></select></label>
                                    <label for="palworld-trait-2">Passive 2 (optional)<select id="palworld-trait-2" name="trait-2" aria-describedby="palworld-traits-help"><option value="">No passive</option></select></label>
                                    <label for="palworld-trait-3">Passive 3 (optional)<select id="palworld-trait-3" name="trait-3" aria-describedby="palworld-traits-help"><option value="">No passive</option></select></label>
                                    <label for="palworld-trait-4">Passive 4 (optional)<select id="palworld-trait-4" name="trait-4" aria-describedby="palworld-traits-help"><option value="">No passive</option></select></label>
                                </div>
                            </div>
                        </section>

                        <section class="palworld-setup-step palworld-owned" aria-labelledby="palworld-owned-title">
                            <h3 id="palworld-owned-title"><span class="palworld-step-number" aria-hidden="true">3</span> Add the Pals you own</h3>
                            <p class="palworld-help">Choose each Pal's species, then check the desired passives it carries. Add separate rows for separate Pals, even when they are the same species.</p>
                            <div id="palworld-sources" class="palworld-sources"></div>
                            <button id="palworld-add-source" type="button">Add another owned Pal</button>
                        </section>

                        <div class="palworld-actions">
                            <p>Setup complete? Find the best route from your current choices.</p>
                            <button id="palworld-find-route" class="palworld-primary" type="submit">Find route</button>
                        </div>
                    </fieldset>
                </form>

                <section class="palworld-panel palworld-results" aria-labelledby="palworld-results-title" aria-busy="false" data-route-state="empty" hidden>
                    <h2 id="palworld-results-title" tabindex="-1">Breeding route result</h2>
                    <p id="palworld-route-status" role="status" aria-live="polite" aria-atomic="true"></p>
                    <div id="palworld-route-tree"></div>
                    <footer id="palworld-route-summary" class="palworld-route-summary" hidden></footer>
                    <section class="palworld-exclusions" aria-labelledby="palworld-excluded-title" hidden>
                        <h3 id="palworld-excluded-title">Unavailable helpers</h3>
                        <p class="palworld-help">Helpers are Pals with none of your desired passives that you can catch or already own. Choose “Don't have” on a helper to find another route.</p>
                        <p id="palworld-excluded-empty">No helpers excluded.</p>
                        <ul id="palworld-excluded-list"></ul>
                    </section>
                </section>
            </div>

            <aside class="palworld-credits" aria-label="Sources and assumptions">
                <p>Unofficial fan tool. Egg estimates assume parents carry no other passives; actual results vary.</p>
                <p>Breeding data from <a href="https://github.com/tylercamp/palcalc">Pal Calc</a>. Data version: <span id="palworld-data-version">loading</span>.</p>
                <p>Thumbnails from <a href="https://palworld.gg/pals">palworld.gg</a>. Pal artwork © Pocketpair.</p>
                <p>Spawn maps and spawn locations from <a href="<?= htmlspecialchars($palworldMapRepository, ENT_QUOTES, 'UTF-8') ?>">pal-atlas</a>, <?= htmlspecialchars($palworldMapLicense, ENT_QUOTES, 'UTF-8') ?> license. <?= htmlspecialchars($palworldMapCopyright, ENT_QUOTES, 'UTF-8') ?>.</p>
            </aside>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
    <script src="<?= $palworldScriptVersion('/assets/js/palworld-breeding-engine.js') ?>" defer></script>
    <script src="<?= $palworldScriptVersion('/assets/js/palworld-breeding.js') ?>" defer></script>
</body>
</html>
