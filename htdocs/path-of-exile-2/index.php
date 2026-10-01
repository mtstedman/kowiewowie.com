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
                <p class="lede">Choose a class and ascendancy, inspect the pinned export, and test allocations with the tree's existing rule model. Mark the passives you must have and the planner finds the shortest legal route that reaches all of them.</p>
            </section>

            <p id="poe2-status" class="poe2-notice" role="status" aria-live="polite" aria-atomic="true">Loading the passive tree…</p>
            <noscript><p class="poe2-notice poe2-notice--error">Enable JavaScript to load and use the passive-tree planner.</p></noscript>

            <section class="poe2-workspace" aria-label="Passive-tree planner">
                <aside class="poe2-panel poe2-controls" aria-labelledby="poe2-build-title">
                    <div>
                        <p class="eyebrow">Build</p>
                        <h2 id="poe2-build-title">Choose your starting point</h2>
                    </div>

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
                    </div>

                    <div class="poe2-actions">
                        <button id="poe2-fit" type="button" disabled>Fit tree</button>
                        <button id="poe2-reset" type="button" disabled>Reset allocations</button>
                        <button id="poe2-retry" type="button" hidden>Retry loading</button>
                    </div>

                    <section class="poe2-must-haves" aria-labelledby="poe2-must-have-title">
                        <h3 id="poe2-must-have-title">Must-have passives</h3>
                        <p class="poe2-help">Select a node and choose <strong>Mark must-have</strong>, then find the shortest route that reaches every marked passive. Up to <span id="poe2-must-have-limit">8</span> nodes.</p>
                        <p id="poe2-must-have-empty" class="poe2-must-have-empty">No must-have passives marked yet.</p>
                        <ul id="poe2-must-have-list" class="poe2-must-have-list" aria-label="Marked must-have passives" hidden></ul>
                        <div class="poe2-actions">
                            <button id="poe2-find-route" type="button" disabled>Find shortest route</button>
                            <button id="poe2-clear-must-haves" type="button" disabled>Clear must-haves</button>
                        </div>
                        <div id="poe2-route-summary" class="poe2-route-summary" hidden></div>
                    </section>

                    <p class="poe2-help">Drag or use the arrow keys to pan. Use the mouse wheel or the + and − keys to zoom. Select a node to inspect, allocate or mark it as a must-have.</p>
                </aside>

                <section class="poe2-panel poe2-tree-panel" aria-labelledby="poe2-tree-title" aria-busy="true">
                    <div class="poe2-panel-heading">
                        <div>
                            <p class="eyebrow">Tree</p>
                            <h2 id="poe2-tree-title">Passive overview</h2>
                        </div>
                        <div class="poe2-zoom" aria-label="Tree zoom controls">
                            <button id="poe2-zoom-out" type="button" aria-label="Zoom out" disabled>−</button>
                            <button id="poe2-zoom-in" type="button" aria-label="Zoom in" disabled>+</button>
                        </div>
                    </div>
                    <svg id="poe2-tree" class="poe2-tree" role="application" aria-label="Interactive Path of Exile 2 passive tree" tabindex="0">
                        <g id="poe2-viewport">
                            <g id="poe2-edges"></g>
                            <g id="poe2-nodes"></g>
                        </g>
                    </svg>
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
                </aside>
            </section>

            <aside class="poe2-credits" aria-label="Data source and notices">
                <p><strong>Data:</strong> Grinding Gear Games official passive-tree <span id="poe2-version">export 0.5.5</span>, pinned locally. This does not claim parity with the current live game.</p>
                <p>Path of Exile 2, passive-tree names, and stat text © Grinding Gear Games. This unofficial fan tool is not affiliated with or endorsed by Grinding Gear Games.</p>
                <p>Ordinary shared allocations only. Weapon-set allocations, point budgets, attribute choices, items, jewels, and item-granted passives are not modelled.</p>
            </aside>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
    <script type="module" src="/assets/js/path-of-exile-2/planner.js?v=<?= rawurlencode($plannerVersion) ?>"></script>
</body>
</html>