<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Videos - wowiekowie.com';
$metaDescription = 'Browse public videos on wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact videos-hero">
                <p class="eyebrow">Videos</p>
                <h1>Watch the latest uploads</h1>
                <p class="lede">Browse public videos with quick filters, search, and a watch page for each upload.</p>
            </section>

            <section class="videos-surface" aria-labelledby="videos-title">
                <div class="videos-toolbar">
                    <div class="section-heading videos-section-heading">
                        <p class="eyebrow">Public library</p>
                        <h2 id="videos-title">Latest videos</h2>
                    </div>

                    <label class="videos-search" for="videos-search">
                        <span class="videos-visually-hidden">Search videos</span>
                        <input id="videos-search" type="search" name="search" placeholder="Search videos, channels, and tags" autocomplete="off" aria-controls="videos-results" aria-describedby="videos-results-status">
                    </label>
                </div>

                <div id="videos-filters" class="videos-chips" aria-label="Video filters">
                    <button class="videos-chip is-active" type="button" data-topic="All" aria-pressed="true" aria-controls="videos-results" aria-describedby="videos-results-status">All</button>
                </div>

                <p id="videos-results-status" class="videos-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Loading videos...</p>
                <div id="videos-results" role="region" aria-labelledby="videos-title" aria-describedby="videos-results-status">
                    <p class="videos-state">Loading videos...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/videos-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/videos-index.js') ?>"></script>
</body>
</html>
