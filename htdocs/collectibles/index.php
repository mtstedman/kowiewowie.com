<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Collectibles - wowiekowie.com';
$metaDescription = 'Browse Sonny Angel, SKULLPANDA, Nommi, and POP BEAN series, figures, secrets, images, and sourced prices in one catalog.';
$pageStyles = ['/assets/css/collectibles.css'];
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact collectibles-hero" aria-labelledby="collectibles-title">
                <p class="eyebrow">Blind box shelf</p>
                <h1 id="collectibles-title">Every Sonny Angel, SKULLPANDA, Nommi, and POP BEAN—one shelf.</h1>
                <p class="lede">Search every line, compare sourced prices, sort by price or time, and peek at each variant before the box gets shaken.</p>
            </section>

            <section class="foundation collectibles-library" aria-labelledby="collectibles-list-title">
                <h2 id="collectibles-list-title" class="collectibles-sr-only">Series and figures</h2>

                <form class="collectibles-form" id="collectibles-form" action="/collectibles/" method="get">
                    <div class="collectibles-controls" role="search" aria-label="Search collectibles">
                        <fieldset class="collectibles-lines">
                            <legend class="collectibles-sr-only">Line</legend>
                            <label class="collectibles-line-tab">
                                <input type="radio" name="brand" value="" checked>
                                <span>All lines</span>
                            </label>
                            <label class="collectibles-line-tab" data-brand="skullpanda">
                                <input type="radio" name="brand" value="skullpanda">
                                <span>SKULLPANDA</span>
                            </label>
                            <label class="collectibles-line-tab" data-brand="nommi">
                                <input type="radio" name="brand" value="nommi">
                                <span>Nommi</span>
                            </label>
                            <label class="collectibles-line-tab" data-brand="sonny-angel">
                                <input type="radio" name="brand" value="sonny-angel">
                                <span>Sonny Angel</span>
                            </label>
                            <label class="collectibles-line-tab" data-brand="pop-bean">
                                <input type="radio" name="brand" value="pop-bean">
                                <span>POP BEAN</span>
                            </label>
                        </fieldset>
                        <div class="collectibles-fields">
                            <div class="collectibles-search">
                                <label for="collectibles-search-input" class="collectibles-sr-only">Search series or figure names</label>
                                <input id="collectibles-search-input" name="q" type="search" maxlength="100" autocomplete="off" spellcheck="false" placeholder="Search series and figures">
                            </div>
                            <div class="collectibles-picker collectibles-year-picker" data-picker="year">
                                <div class="collectibles-field collectibles-picker-field">
                                    <label for="collectibles-year-input" class="collectibles-field-label">Year</label>
                                    <span class="collectibles-picker-chips" id="collectibles-year-chips"></span>
                                    <input id="collectibles-year-input" class="collectibles-picker-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="collectibles-year-options" aria-describedby="collectibles-picker-help" autocomplete="off" spellcheck="false" placeholder="All years">
                                </div>
                                <ul id="collectibles-year-options" class="collectibles-picker-options" role="listbox" aria-multiselectable="true" aria-label="Year choices" hidden></ul>
                            </div>
                            <div class="collectibles-picker collectibles-series-picker" data-picker="series">
                                <div class="collectibles-field collectibles-picker-field">
                                    <label for="collectibles-series-input" class="collectibles-field-label">Series</label>
                                    <span class="collectibles-picker-chips" id="collectibles-series-chips"></span>
                                    <input id="collectibles-series-input" class="collectibles-picker-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="collectibles-series-options" aria-describedby="collectibles-picker-help" autocomplete="off" spellcheck="false" placeholder="All series">
                                </div>
                                <ul id="collectibles-series-options" class="collectibles-picker-options" role="listbox" aria-multiselectable="true" aria-label="Series choices" hidden></ul>
                            </div>
                        </div>
                        <p id="collectibles-picker-help" class="collectibles-sr-only">Type to filter, Enter or click to add or remove a choice, Backspace removes the last one.</p>
                    </div>

                    <div class="collectibles-toolbar">
                        <div class="collectibles-meta">
                            <p id="collectibles-status" class="collectibles-status" role="status" aria-live="polite" aria-atomic="true">Unboxing the catalog...</p>
                            <p class="collectibles-meta-note">
                                <span id="collectibles-updated" class="collectibles-updated" hidden></span>
                                <span id="collectibles-storage-status" class="collectibles-storage-status">Loading your collection…</span>
                            </p>
                        </div>
                        <div class="collectibles-view">
                            <fieldset class="collectibles-segmented collectibles-inventory-filter">
                                <legend class="collectibles-sr-only">Inventory</legend>
                                <label class="collectibles-segment">
                                    <input type="radio" name="inventory" value="all" checked>
                                    <span>All figures</span>
                                </label>
                                <label class="collectibles-segment">
                                    <input type="radio" name="inventory" value="owned">
                                    <span>Owned</span>
                                </label>
                                <label class="collectibles-segment">
                                    <input type="radio" name="inventory" value="missing">
                                    <span>Not owned</span>
                                </label>
                            </fieldset>
                            <div class="collectibles-field collectibles-sort">
                                <label for="collectibles-sort" class="collectibles-field-label">Sort</label>
                                <select id="collectibles-sort" name="sort">
                                    <option value="name-asc">Name A–Z</option>
                                    <option value="name-desc">Name Z–A</option>
                                    <option value="price-asc">Price: low to high</option>
                                    <option value="price-desc">Price: high to low</option>
                                    <option value="newest">Newest first</option>
                                    <option value="oldest">Oldest first</option>
                                </select>
                            </div>
                            <div class="collectibles-export" id="collectibles-export">
                                <button id="collectibles-export-toggle" class="collectibles-export-toggle" type="button" aria-expanded="false" aria-controls="collectibles-export-menu">Export</button>
                                <div id="collectibles-export-menu" class="collectibles-export-menu" hidden>
                                    <button id="collectibles-export-csv" class="collectibles-export-option" type="button">
                                        <span class="collectibles-export-name">Shown figures (CSV)</span>
                                        <span id="collectibles-export-csv-detail" class="collectibles-export-detail">Every figure on screen, with owned and quantity columns.</span>
                                    </button>
                                    <button id="collectibles-export-collection" class="collectibles-export-option" type="button">
                                        <span class="collectibles-export-name">My collection (CSV)</span>
                                        <span id="collectibles-export-collection-detail" class="collectibles-export-detail">Every figure you own, across all lines and years.</span>
                                    </button>
                                    <button id="collectibles-export-pdf" class="collectibles-export-option" type="button">
                                        <span class="collectibles-export-name">Printable PDF</span>
                                        <span class="collectibles-export-detail">The series on screen with figure lists. Choose Save as PDF in the print dialog.</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>

                <div id="collectibles-results" class="collectibles-results" aria-busy="true"></div>

                <div class="collectibles-more">
                    <button id="collectibles-load-more" class="button" type="button" hidden>Load more</button>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/collectibles.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/collectibles.js') ?>"></script>
</body>
</html>
