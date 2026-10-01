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

            <p id="palworld-load-status" class="palworld-notice" role="status" aria-live="polite">Loading breeding data (about 9 MB). This may take a moment.</p>
            <noscript><p class="palworld-notice">Enable JavaScript to load the breeding data and use this planner.</p></noscript>

            <div class="palworld-layout">
                <form id="palworld-form" class="palworld-panel" aria-labelledby="palworld-plan-title" novalidate>
                    <h2 id="palworld-plan-title">Build your plan</h2>
                    <fieldset id="palworld-controls" class="palworld-controls" disabled>
                        <legend class="public-visually-hidden">Breeding plan inputs</legend>
                        <section aria-labelledby="palworld-target-title">
                            <h3 id="palworld-target-title">1. Pick your target</h3>
                            <div id="palworld-target-picker"></div>
                        </section>

                        <section aria-labelledby="palworld-traits-title">
                            <h3 id="palworld-traits-title">2. Name your wanted traits</h3>
                            <p id="palworld-traits-help" class="palworld-help">Enter 1 to 4 different passive trait names. Leave unused slots blank.</p>
                            <div class="palworld-trait-fields">
                                <label for="palworld-trait-1">Trait 1<input id="palworld-trait-1" name="trait-1" type="text" autocomplete="off" aria-describedby="palworld-traits-help"></label>
                                <label for="palworld-trait-2">Trait 2 (optional)<input id="palworld-trait-2" name="trait-2" type="text" autocomplete="off" aria-describedby="palworld-traits-help"></label>
                                <label for="palworld-trait-3">Trait 3 (optional)<input id="palworld-trait-3" name="trait-3" type="text" autocomplete="off" aria-describedby="palworld-traits-help"></label>
                                <label for="palworld-trait-4">Trait 4 (optional)<input id="palworld-trait-4" name="trait-4" type="text" autocomplete="off" aria-describedby="palworld-traits-help"></label>
                            </div>
                        </section>

                        <section aria-labelledby="palworld-owned-title">
                            <h3 id="palworld-owned-title">3. Add the pals you own</h3>
                            <p class="palworld-help">Choose each pal's species and the wanted traits it carries. Add separate rows for separate pals, even of the same species.</p>
                            <div id="palworld-sources" class="palworld-sources"></div>
                            <button id="palworld-add-source" type="button">Add owned pal</button>
                        </section>
                        <button id="palworld-find-route" class="palworld-primary" type="submit">Find breeding route</button>
                    </fieldset>
                </form>

                <section class="palworld-panel palworld-results" aria-labelledby="palworld-route-title" aria-busy="false">
                    <p class="eyebrow">Your breeding tree</p>
                    <h2 id="palworld-route-title">The path to your pal</h2>
                    <p id="palworld-route-status" role="status" aria-live="polite" aria-atomic="true">Fill in your plan to find a route.</p>
                    <div id="palworld-route-summary" class="palworld-summary" hidden></div>
                    <p id="palworld-route-help" class="palworld-help" hidden>Read from the top down: your target sits at the top, and each pal branches down to the two parents (joined by ×) that you breed together. Wide routes scroll sideways inside the tree.</p>
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
