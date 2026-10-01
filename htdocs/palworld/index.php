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
                <form id="palworld-form" class="palworld-panel palworld-bar" aria-labelledby="palworld-plan-title" data-palworld-revision="<?= htmlspecialchars($palworldDataRevision, ENT_QUOTES, 'UTF-8') ?>" data-palworld-cache-format="<?= htmlspecialchars((string) $palworldCacheFormat, ENT_QUOTES, 'UTF-8') ?>" data-palworld-data-bytes="<?= htmlspecialchars((string) $palworldDataBytes, ENT_QUOTES, 'UTF-8') ?>" novalidate>
                    <h2 id="palworld-plan-title" class="palworld-bar-title">Build your plan</h2>
                    <fieldset id="palworld-controls" class="palworld-controls" disabled>
                        <legend class="public-visually-hidden">Breeding plan inputs</legend>
                        <section class="palworld-bar-target" aria-labelledby="palworld-target-title">
                            <h3 id="palworld-target-title" class="palworld-visually-hidden">Pick your target</h3>
                            <div id="palworld-target-picker"></div>
                        </section>

                        <div id="palworld-addons" class="palworld-addons">
                            <span id="palworld-addons-caption" class="palworld-addons-caption">Add-ons (optional)</span>
                            <button id="palworld-addons-toggle" class="palworld-addons-toggle" type="button" aria-expanded="false" aria-controls="palworld-addons-panel" aria-labelledby="palworld-addons-caption palworld-addons-summary">
                                <span id="palworld-addons-summary" class="palworld-addons-summary">No traits · No owned pals</span>
                            </button>
                            <div id="palworld-addons-panel" class="palworld-addons-panel" role="group" aria-labelledby="palworld-addons-caption" hidden>
                                <section aria-labelledby="palworld-traits-title">
                                    <h3 id="palworld-traits-title">Choose your wanted traits</h3>
                                    <p id="palworld-traits-help" class="palworld-help">Traits are optional. Select 0 to 4 different passive traits from the dropdowns and leave unused slots on “No trait”.</p>
                                    <div class="palworld-trait-fields">
                                        <label for="palworld-trait-1">Trait 1 (optional)<select id="palworld-trait-1" name="trait-1" aria-describedby="palworld-traits-help"><option value="">No trait</option></select></label>
                                        <label for="palworld-trait-2">Trait 2 (optional)<select id="palworld-trait-2" name="trait-2" aria-describedby="palworld-traits-help"><option value="">No trait</option></select></label>
                                        <label for="palworld-trait-3">Trait 3 (optional)<select id="palworld-trait-3" name="trait-3" aria-describedby="palworld-traits-help"><option value="">No trait</option></select></label>
                                        <label for="palworld-trait-4">Trait 4 (optional)<select id="palworld-trait-4" name="trait-4" aria-describedby="palworld-traits-help"><option value="">No trait</option></select></label>
                                    </div>
                                </section>

                                <section aria-labelledby="palworld-owned-title">
                                    <h3 id="palworld-owned-title">Add the pals you own</h3>
                                    <p class="palworld-help">Choose each pal's species and the wanted traits it carries. Add separate rows for separate pals, even of the same species.</p>
                                    <div id="palworld-sources" class="palworld-sources"></div>
                                    <button id="palworld-add-source" type="button">Add owned pal</button>
                                </section>
                            </div>
                        </div>

                        <button id="palworld-find-route" class="palworld-primary" type="submit">Find breeding route</button>
                    </fieldset>
                </form>

                <section class="palworld-panel palworld-results" aria-labelledby="palworld-route-title" aria-busy="false">
                    <p class="eyebrow">Your breeding tree</p>
                    <h2 id="palworld-route-title">The path to your pal</h2>
                    <p id="palworld-route-status" role="status" aria-live="polite" aria-atomic="true">Fill in your plan to find a route.</p>
                    <div id="palworld-route-summary" class="palworld-summary" hidden></div>
                    <p id="palworld-route-help" class="palworld-help" hidden>Read from the top down: your target sits at the top, and each pal branches down to the two parents (joined by ×) that you breed together. Wide routes shrink to fit when possible and scroll sideways inside the tree when needed.</p>
                    <div id="palworld-route-tree"></div>
                    <section class="palworld-exclusions" aria-labelledby="palworld-excluded-title">
                        <h3 id="palworld-excluded-title">Unavailable helpers</h3>
                        <p class="palworld-help">Helpers are pals with none of your wanted traits that you can catch or already own. Choose “Don't have” on a helper to find another route.</p>
                        <p id="palworld-excluded-empty">No helpers excluded.</p>
                        <ul id="palworld-excluded-list"></ul>
                    </section>
                </section>
            </div>

            <aside class="palworld-credits" aria-label="Sources and assumptions">
                <p>Unofficial fan tool. Egg estimates assume parents carry no other passives; actual results vary.</p>
                <p>Breeding data from <a href="https://github.com/tylercamp/palcalc">Pal Calc</a>. Data version: <span id="palworld-data-version">loading</span>.</p>
                <p>Thumbnails from <a href="https://palworld.gg/pals">palworld.gg</a>. Pal artwork © Pocketpair.</p>
            </aside>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
    <script src="<?= $palworldScriptVersion('/assets/js/palworld-breeding-engine.js') ?>" defer></script>
    <script src="<?= $palworldScriptVersion('/assets/js/palworld-breeding.js') ?>" defer></script>
</body>
</html>
