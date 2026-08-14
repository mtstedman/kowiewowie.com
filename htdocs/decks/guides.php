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
                <p class="eyebrow">Magic shelf</p>
                <h1>Play guides for better table decisions.</h1>
                <p class="lede">Walkthroughs for piloting each deck without turning the table into homework.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/">Browse decklists</a>
                    <a class="text-link" href="/">Home base</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="guide-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Walkthroughs</p>
                    <h2 id="guide-list-title">Pilot notes and table tricks.</h2>
                </div>

                <div id="guide-list" aria-live="polite">
                    <p>Finding the play patterns...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/deck-guides-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/deck-guides-index.js') ?>"></script>
</body>
</html>
