<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Videos - wowiekowie.com';
$metaDescription = 'Browse public videos, filters, tags, channels, and watch pages on wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact videos-hero">
                <p class="eyebrow">Video shelf</p>
                <h1>Watch pages for the latest uploads.</h1>
                <p class="lede">Search, filter, and jump into public videos without rummaging through the whole internet drawer.</p>
            </section>

            <section class="videos-surface" aria-labelledby="videos-title">
                <div class="videos-toolbar">
                    <div class="section-heading videos-section-heading">
                        <p class="eyebrow">Public library</p>
                        <h2 id="videos-title">Fresh from the watch drawer.</h2>
                    </div>

                    <label class="videos-search" for="videos-search">
                        <span class="videos-visually-hidden">Search videos</span>
                        <input id="videos-search" type="search" name="search" placeholder="Search titles, channels, tags" autocomplete="off" aria-controls="videos-results" aria-describedby="videos-results-status">
                    </label>
                </div>

                <div id="videos-filters" class="videos-chips" aria-label="Video filters">
                    <button class="videos-chip is-active" type="button" data-topic="All" aria-pressed="true" aria-controls="videos-results" aria-describedby="videos-results-status">All</button>
                </div>

                <p id="videos-results-status" class="videos-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Tuning the video shelf...</p>
                <div id="videos-results" role="region" aria-labelledby="videos-title" aria-describedby="videos-results-status">
                    <p class="videos-state">Tuning the video shelf...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/videos-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/videos-index.js') ?>"></script>
</body>
</html>
