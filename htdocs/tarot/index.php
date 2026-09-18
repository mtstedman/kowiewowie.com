<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Tarot - wowiekowie.com';
$metaDescription = 'Deal classic tarot spreads, browse all 78 cards, and explore position-by-position meanings on wowiekowie.com.';
$pageStyles = ['/assets/css/tarot.css'];

$tarotScriptVersion = static function (string $href): string {
    $scriptPath = dirname(__DIR__) . $href;
    $version = is_file($scriptPath) ? (string) filemtime($scriptPath) : '1';

    return htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '?v=' . rawurlencode($version);
};
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell tarot-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main id="main-content" class="tarot-page" data-tarot-app>
            <section class="tarot-hero" aria-labelledby="tarot-title">
                <p class="eyebrow">Tarot table</p>
                <h1 id="tarot-title">Tarot deck &amp; spreads</h1>
                <p class="lede">Pick a spread, shuffle, and draw each card from a face-down fan, then turn them over one by one. Browse all 78 cards or trace what any card means in any position whenever you like.</p>
            </section>

            <p id="tarot-load-error" class="tarot-panel tarot-load-error" role="alert" hidden>The tarot deck could not be loaded. Refresh the page to try again.</p>

            <div class="tarot-tabs" role="tablist" aria-label="Tarot views" data-tarot-tabs>
                <button class="tarot-tab" type="button" role="tab" id="tarot-tab-dealer" aria-controls="tarot-panel-dealer" aria-selected="true">
                    <span class="tarot-tab-glyph" aria-hidden="true">✦</span>
                    <span>Deal a spread</span>
                </button>
                <button class="tarot-tab" type="button" role="tab" id="tarot-tab-deck" aria-controls="tarot-panel-deck" aria-selected="false" tabindex="-1">
                    <span class="tarot-tab-glyph" aria-hidden="true">★</span>
                    <span>Deck</span>
                </button>
                <button class="tarot-tab" type="button" role="tab" id="tarot-tab-map" aria-controls="tarot-panel-map" aria-selected="false" tabindex="-1">
                    <span class="tarot-tab-glyph" aria-hidden="true">◈</span>
                    <span>Meaning map</span>
                </button>
            </div>

            <section id="tarot-panel-dealer" class="tarot-panel tarot-tab-panel tarot-spreads" role="tabpanel" aria-labelledby="tarot-tab-dealer" tabindex="0">
                <div class="tarot-panel-heading">
                    <div>
                        <p class="eyebrow">Setups</p>
                        <h2 id="tarot-spreads-title">Deal a spread</h2>
                    </div>
                    <p class="tarot-panel-note">Shuffle to fan the deck out face-down, then pick a card for each glowing spot in order.</p>
                </div>

                <div class="tarot-spread-layout">
                    <div class="tarot-spread-controls">
                        <fieldset class="tarot-spread-picker">
                            <legend>Choose a spread</legend>
                            <div id="tarot-spread-options" class="tarot-spread-options"></div>
                        </fieldset>
                        <p id="tarot-spread-description" class="tarot-spread-description"></p>
                        <div class="tarot-actions">
                            <button class="tarot-button tarot-button-primary" type="button" id="tarot-deal-button">Shuffle &amp; deal</button>
                            <button class="tarot-button" type="button" id="tarot-reveal-all-button" disabled>Reveal all</button>
                        </div>
                        <p id="tarot-deal-status" class="tarot-deal-status" role="status" aria-live="polite">Pick a spread, then shuffle to fan the deck out face-down.</p>
                    </div>

                    <div class="tarot-table">
                        <div id="tarot-fan" class="tarot-fan" role="group" aria-label="Shuffled deck, face down" hidden></div>
                        <div id="tarot-board" class="tarot-board" role="group" aria-label="Spread layout"></div>
                    </div>
                </div>

                <section class="tarot-readings" aria-labelledby="tarot-readings-title">
                    <h3 id="tarot-readings-title">Reading</h3>
                    <ol id="tarot-readings-list" class="tarot-readings-list" aria-live="polite"></ol>
                </section>
            </section>

            <section id="tarot-panel-deck" class="tarot-panel tarot-tab-panel tarot-gallery" role="tabpanel" aria-labelledby="tarot-tab-deck" tabindex="0" hidden>
                <div class="tarot-panel-heading">
                    <div>
                        <p class="eyebrow">Deck gallery</p>
                        <h2 id="tarot-gallery-title">All 78 cards</h2>
                    </div>
                    <p class="tarot-panel-note">Select a card to read its keywords, upright meaning, and reversed meaning.</p>
                </div>
                <div id="tarot-gallery-groups" class="tarot-gallery-groups"></div>
            </section>

            <section id="tarot-panel-map" class="tarot-panel tarot-tab-panel tarot-map" role="tabpanel" aria-labelledby="tarot-tab-map" tabindex="0" hidden>
                <div class="tarot-panel-heading">
                    <div>
                        <p class="eyebrow">Meaning map</p>
                        <h2 id="tarot-map-title">Explore any card in any position</h2>
                    </div>
                    <p class="tarot-panel-note">No deal needed: choose a card, spread, position, and orientation.</p>
                </div>

                <div class="tarot-map-layout">
                    <form id="tarot-map-form" class="tarot-map-form" novalidate>
                        <label class="tarot-field">
                            <span>Card</span>
                            <select id="tarot-map-card" name="card"></select>
                        </label>
                        <label class="tarot-field">
                            <span>Spread</span>
                            <select id="tarot-map-spread" name="spread"></select>
                        </label>
                        <label class="tarot-field">
                            <span>Position</span>
                            <select id="tarot-map-position" name="position"></select>
                        </label>
                        <fieldset class="tarot-field tarot-orientation-field">
                            <legend>Orientation</legend>
                            <div class="tarot-orientation-options" id="tarot-map-orientation"></div>
                        </fieldset>
                    </form>

                    <div class="tarot-map-result" aria-live="polite">
                        <div id="tarot-map-card-preview" class="tarot-map-card-preview"></div>
                        <div class="tarot-map-copy">
                            <h3 id="tarot-map-result-title"></h3>
                            <ul id="tarot-map-keywords" class="tarot-keywords" aria-label="Keywords"></ul>
                            <p id="tarot-map-meaning" class="tarot-map-meaning"></p>
                        </div>
                    </div>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <dialog id="tarot-card-dialog" class="tarot-card-dialog" aria-labelledby="tarot-dialog-title">
        <div class="tarot-dialog-body">
            <div id="tarot-dialog-card" class="tarot-dialog-card"></div>
            <div class="tarot-dialog-copy">
                <p id="tarot-dialog-eyebrow" class="eyebrow"></p>
                <h2 id="tarot-dialog-title"></h2>
                <ul id="tarot-dialog-keywords" class="tarot-keywords" aria-label="Keywords"></ul>
                <dl class="tarot-dialog-meanings">
                    <div>
                        <dt>Upright</dt>
                        <dd id="tarot-dialog-upright"></dd>
                    </div>
                    <div>
                        <dt>Reversed</dt>
                        <dd id="tarot-dialog-reversed"></dd>
                    </div>
                </dl>
                <div class="tarot-actions">
                    <button class="tarot-button" type="button" id="tarot-dialog-map-button">Open in meaning map</button>
                    <button class="tarot-button tarot-button-primary" type="button" id="tarot-dialog-close">Close</button>
                </div>
            </div>
        </div>
    </dialog>

    <script src="<?= $tarotScriptVersion('/assets/js/tarot-data.js') ?>" defer></script>
    <script src="<?= $tarotScriptVersion('/assets/js/tarot.js') ?>" defer></script>
</body>
</html>
