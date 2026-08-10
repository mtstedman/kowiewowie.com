<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Deck Guides - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck walkthrough guides.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Magic: The Gathering</p>
                <h1>Deck Guides</h1>
                <p class="lede">Blog-style walkthroughs for how to pilot each JSON-backed deck.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/">Browse deck manager</a>
                    <a class="text-link" href="/">Back home</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="guide-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Walkthroughs</p>
                    <h2 id="guide-list-title">How to play</h2>
                </div>

                <div id="guide-list" aria-live="polite">
                    <p>Loading deck guides...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/deck-guides-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/deck-guides-index.js') ?>"></script>
</body>
</html>
