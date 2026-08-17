<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Open Deck Scheduler - wowiekowie.com';
$metaDescription = 'Nominate sets, vote to fill open-deck time slots, and vote on evictions for filled sets.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact open-deck-hero" aria-labelledby="open-deck-title">
                <p class="eyebrow">Open deck scheduler</p>
                <h1 id="open-deck-title">Vote the next set onto the table.</h1>
                <p class="lede">Open slots collect nominations and fill by vote. Filled sets stay visible, including eviction votes when the table wants a different pick.</p>
                <div class="hero-actions">
                    <a class="button" href="#open-deck-scheduler">See open times <span aria-hidden="true">-&gt;</span></a>
                    <a class="text-link" href="/decks/">Browse decks</a>
                </div>
            </section>

            <section class="foundation open-deck-surface" id="open-deck-scheduler" aria-labelledby="open-deck-scheduler-title">
                <div class="open-deck-toolbar">
                    <div class="section-heading open-deck-section-heading">
                        <p class="eyebrow">Public voting queue</p>
                        <h2 id="open-deck-scheduler-title">Upcoming open deck times.</h2>
                    </div>
                    <button class="button open-deck-refresh" type="button" data-open-deck-refresh>Refresh slots</button>
                </div>

                <p class="open-deck-status" data-open-deck-status role="status" aria-live="polite">Loading open deck times...</p>
                <div class="open-deck-slots" data-open-deck-slots aria-live="polite"></div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/open-deck-scheduler.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/open-deck-scheduler.js') ?>" defer></script>
</body>
</html>
