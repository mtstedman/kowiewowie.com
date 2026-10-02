<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Path of Exile 2 passive-tree planner - wowiekowie.com';
$metaDescription = 'Explore a pinned Path of Exile 2 passive-tree export and test legal class and ascendancy allocations.';
$pageStyles = ['/assets/css/path-of-exile-2.css'];
$plannerPath = dirname(__DIR__) . '/assets/js/path-of-exile-2/planner.js';
$plannerVersion = is_file($plannerPath) ? (string) filemtime($plannerPath) : '1';
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell poe2-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="poe2-page">
            <section class="hero hero-compact poe2-hero">
                <p class="eyebrow">Path of Exile 2 / Passive planner</p>
                <h1>Trace a path through the passive tree.</h1>
                <p class="lede">Pick a class and ascendancy, mark the passives you must have, and the planner finds the shortest legal route that reaches all of them.</p>
            </section>

            <p id="poe2-status" class="poe2-notice" role="status" aria-live="polite" aria-atomic="true">Loading the passive tree…</p>
            <noscript><p class="poe2-notice poe2-notice--error">Enable JavaScript to load and use the passive-tree planner.</p></noscript>

            <section class="poe2-workspace" aria-label="Passive-tree planner">
                <aside class="poe2-panel poe2-controls" aria-labelledby="poe2-build-title">
                    <h2 id="poe2-build-title" class="poe2-panel-title">Build</h2>

                    <fieldset id="poe2-build-controls" disabled>
                        <legend class="public-visually-hidden">Class and ascendancy</legend>
                        <label for="poe2-class">Class
                            <select id="poe2-class"></select>
                        </label>
                        <label for="poe2-ascendancy">Ascendancy
                            <select id="poe2-ascendancy"></select>
                        </label>
                    </fieldset>

                    <form id="poe2-search" class="poe2-search" role="search">
                        <label for="poe2-node-query">Find a node</label>
                        <div>
                            <input id="poe2-node-query" type="search" placeholder="Name or node ID" autocomplete="off" disabled>
                            <button type="submit" disabled>Find</button>
                        </div>
                    </form>

                    <div class="poe2-totals" aria-label="Allocated point totals">
                        <span><strong id="poe2-passive-total">0</strong> passive</span>
                        <span><strong id="poe2-ascendancy-total">0</strong> ascendancy</span>
                        <span class="poe2-totals__estimate"><strong id="poe2-level-estimate">—</strong> <small id="poe2-level-estimate-note">Level estimate unavailable while the tree loads.</small></span>
                    </div>
                    <details class="poe2-more">
                        <summary>How the level estimate works</summary>
                        <p class="poe2-help">The level estimate counts paid passive points only and assumes all 24 ordinary campaign passive points are collected, plus one point per level gained up to level 100 (123 in total). Those rewards are earned through Acts 1–4 and the Interludes, so a character at that level may not have them all yet. League or endgame bonus points and ascendancy-granted extra passives are not counted, and nothing here limits what you can allocate.</p>
                    </details>

                    <section class="poe2-must-haves" aria-labelledby="poe2-must-have-title">
                        <h3 id="poe2-must-have-title">Must-have passives</h3>
                        <p id="poe2-must-have-empty" class="poe2-must-have-empty">Select a node and choose <strong>Mark must-have</strong>. Marked passives glow pink on the tree.</p>
                        <button id="poe2-find-route" type="button" disabled>Find shortest route</button>
                        <details id="poe2-must-have-details" class="poe2-must-have-details" hidden>
                            <summary>Marked passives (<span id="poe2-must-have-count">0</span>)</summary>
                            <ul id="poe2-must-have-list" class="poe2-must-have-list" aria-label="Marked must-have passives"></ul>
                            <button id="poe2-clear-must-haves" type="button" disabled>Clear must-haves</button>
                        </details>
                        <div id="poe2-route-summary" class="poe2-route-summary" hidden></div>
                        <button id="poe2-clear-route" type="button" disabled>Clear route</button>
                        <details class="poe2-more">
                            <summary>How routes are found</summary>
                            <p class="poe2-help">The planner finds the shortest route that reaches every marked passive. There is no limit on how many you mark; very large sets get a short route that is not proven shortest. After a route is found, clicking a node connects it to the allocated tree, and clicking an allocated node removes it.</p>
                        </details>
                    </section>

                    <div class="poe2-actions">
                        <button id="poe2-reset" type="button" disabled>Reset allocations</button>
                        <button id="poe2-retry" type="button" hidden>Retry loading</button>
                    </div>

                    <details class="poe2-section">
                        <summary><h3 id="poe2-saved-builds-title">Saved builds</h3></summary>
                        <div class="poe2-saved-builds">
                            <form id="poe2-saved-build-form" class="poe2-saved-build-form">
                                <label for="poe2-character-name">Character name
                                    <input id="poe2-character-name" name="character_name" type="text" maxlength="64" autocomplete="off" required>
                                </label>
                                <label for="poe2-build-name">Build name
                                    <input id="poe2-build-name" name="build_name" type="text" maxlength="80" autocomplete="off" required>
                                </label>
                                <div class="poe2-actions poe2-saved-build-actions">
                                    <button id="poe2-save-build" type="submit" disabled>Save build</button>
                                    <button id="poe2-save-build-as-new" type="button" hidden disabled>Save as new</button>
                                </div>
                            </form>
                            <p id="poe2-saved-build-owner" class="poe2-help">Checking where builds will be saved…</p>
                            <p id="poe2-saved-build-status" class="poe2-saved-build-status" role="status" aria-live="polite" aria-atomic="true"></p>
                            <p id="poe2-saved-build-empty" class="poe2-saved-build-empty">No saved builds yet.</p>
                            <ul id="poe2-saved-build-list" class="poe2-saved-build-list" aria-label="Saved builds" hidden></ul>
                        </div>
                    </details>

                    <details class="poe2-more">
                        <summary>Controls</summary>
                        <p class="poe2-help">Drag or use the arrow keys to pan. Use the mouse wheel or the + and − keys to zoom; zoom in to see each passive's icon. Hover over a node to see what it does; select it to inspect, allocate or mark it as a must-have. Clicking an allocated node removes it.</p>
                    </details>
                </aside>

                <section class="poe2-panel poe2-tree-panel" aria-labelledby="poe2-tree-title" aria-busy="true">
                    <h2 id="poe2-tree-title" class="public-visually-hidden">Passive tree</h2>
                    <div class="poe2-tree-toolbar" aria-label="Tree view controls">
                        <button id="poe2-zoom-out" type="button" aria-label="Zoom out" disabled>−</button>
                        <button id="poe2-zoom-in" type="button" aria-label="Zoom in" disabled>+</button>
                        <button id="poe2-fit" type="button" disabled>Fit tree</button>
                    </div>
                    <svg id="poe2-tree" class="poe2-tree" role="application" aria-label="Interactive Path of Exile 2 passive tree" tabindex="0">
                        <defs id="poe2-art-defs"></defs>
                        <g id="poe2-viewport">
                            <g id="poe2-backdrop"></g>
                            <g id="poe2-edges"></g>
                            <g id="poe2-nodes"></g>
                        </g>
                    </svg>
                    <div id="poe2-tooltip" class="poe2-tooltip" aria-hidden="true" hidden></div>
                </section>

                <aside class="poe2-panel poe2-details" aria-labelledby="poe2-details-title">
                    <p class="eyebrow">Node details</p>
                    <h2 id="poe2-details-title">Select a node</h2>
                    <p id="poe2-node-meta" class="poe2-node-meta">Choose any visible node to see its stats and allocation state.</p>
                    <ul id="poe2-node-stats" class="poe2-node-stats"></ul>
                    <div class="poe2-detail-actions">
                        <button id="poe2-toggle-node" type="button" disabled>Allocate node</button>
                        <button id="poe2-toggle-must-have" type="button" aria-pressed="false" disabled>Mark must-have</button>
                    </div>

                    <section class="poe2-bonuses" aria-labelledby="poe2-bonuses-title">
                        <h3 id="poe2-bonuses-title">Net bonuses</h3>
                        <div id="poe2-bonus-summary" class="poe2-bonus-summary" aria-live="polite">
                            <p class="poe2-bonus-empty">No passives allocated yet.</p>
                        </div>
                    </section>
                </aside>
            </section>

            <aside class="poe2-credits" aria-label="Data source and notices">
                <p><strong>Data:</strong> Grinding Gear Games official passive-tree <span id="poe2-version">export</span>, pinned and stored in this site's database. This does not claim parity with the current live game.</p>
                <p>Path of Exile 2, passive-tree names, stat text, and passive-tree artwork © Grinding Gear Games; the artwork is GGG's official tree export, served unmodified. This unofficial fan tool is not affiliated with or endorsed by Grinding Gear Games.</p>
                <p>Ordinary shared allocations only. Weapon-set allocations, attribute choices, items, jewels, and item-granted passives are not modelled. Point budgets are not enforced: the estimated level is a guide based on one passive point per level gained plus up to 24 ordinary campaign-granted points, and allocations beyond that standard budget are flagged rather than blocked.</p>
            </aside>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
    <script type="module" src="/assets/js/path-of-exile-2/planner.js?v=<?= rawurlencode($plannerVersion) ?>"></script>
</body>
</html>