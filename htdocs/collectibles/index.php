<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Collectibles - wowiekowie.com';
$metaDescription = 'Browse Sonny Angel, SKULLPANDA, and Nommi series, figures, secrets, images, and sourced prices in one catalog.';
$pageStyles = ['/assets/css/collectibles.css'];
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact" aria-labelledby="collectibles-title">
                <p class="eyebrow">Blind box shelf</p>
                <h1 id="collectibles-title">Every Sonny Angel, SKULLPANDA, and Nommi—one shelf.</h1>
                <p class="lede">Search every line, compare sourced prices, sort by price or time, and peek at each variant before the box gets shaken.</p>
                <div class="hero-actions">
                    <a class="text-link" href="/">Home base</a>
                </div>
            </section>

            <section class="foundation collectibles-library" aria-labelledby="collectibles-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Catalog</p>
                    <h2 id="collectibles-list-title">Series and variants</h2>
                </div>

                <form class="collectibles-controls" id="collectibles-form" action="/collectibles/" method="get" role="search" aria-label="Search collectibles">
                    <div class="collectibles-search">
                        <label for="collectibles-search-input">Search series or figure names</label>
                        <input id="collectibles-search-input" name="q" type="search" maxlength="100" autocomplete="off" spellcheck="false" placeholder="Try &quot;Dark Maze&quot; or &quot;secret&quot;">
                    </div>
                    <fieldset class="collectibles-filter">
                        <legend>Line</legend>
                        <div class="collectibles-filter-options">
                            <label class="collectibles-filter-option">
                                <input type="radio" name="brand" value="" checked>
                                <span>All</span>
                            </label>
                            <label class="collectibles-filter-option">
                                <input type="radio" name="brand" value="skullpanda">
                                <span>Skullpanda</span>
                            </label>
                            <label class="collectibles-filter-option">
                                <input type="radio" name="brand" value="nommi">
                                <span>Nommi</span>
                            </label>
                            <label class="collectibles-filter-option">
                                <input type="radio" name="brand" value="sonny-angel">
                                <span>Sonny Angel</span>
                            </label>
                        </div>
                    </fieldset>
                    <div class="collectibles-release-filter">
                        <label for="collectibles-release">Release</label>
                        <select id="collectibles-release" name="release" aria-busy="true" disabled>
                            <option value="">Loading releases…</option>
                        </select>
                    </div>
                    <fieldset class="collectibles-filter collectibles-inventory-filter">
                        <legend>Inventory</legend>
                        <div class="collectibles-filter-options">
                            <label class="collectibles-filter-option">
                                <input type="radio" name="inventory" value="all" checked>
                                <span>All</span>
                            </label>
                            <label class="collectibles-filter-option">
                                <input type="radio" name="inventory" value="owned">
                                <span>Owned</span>
                            </label>
                            <label class="collectibles-filter-option">
                                <input type="radio" name="inventory" value="missing">
                                <span>Not owned</span>
                            </label>
                        </div>
                    </fieldset>
                    <div class="collectibles-sort">
                        <label for="collectibles-sort">Sort</label>
                        <select id="collectibles-sort" name="sort">
                            <option value="name-asc">Name A–Z</option>
                            <option value="name-desc">Name Z–A</option>
                            <option value="price-asc">Price: low to high</option>
                            <option value="price-desc">Price: high to low</option>
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                        </select>
                    </div>
                    <button id="collectibles-export-pdf" class="button collectibles-export" type="button">Export PDF</button>
                </form>

                <div class="collectibles-meta">
                    <div>
                        <p id="collectibles-status" class="collectibles-status" role="status" aria-live="polite" aria-atomic="true">Unboxing the catalog...</p>
                        <p id="collectibles-storage-status" class="collectibles-storage-status">Inventory is saved in this browser.</p>
                    </div>
                    <p id="collectibles-updated" class="collectibles-updated" hidden></p>
                </div>

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
