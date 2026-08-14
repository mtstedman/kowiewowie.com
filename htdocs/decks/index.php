<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'Browse Magic: The Gathering decklists, colors, counts, and game plans.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Magic shelf</p>
                <h1>Decklists with their sleeves rolled up.</h1>
                <p class="lede">Formats, colors, counts, and game plans without the spreadsheet faceplant.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/guides.php">Read play guides</a>
                    <a class="text-link" href="/">Home base</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="deck-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Decklists</p>
                    <h2 id="deck-list-title">Ready for goldfishing.</h2>
                </div>

                <div id="deck-list" aria-live="polite">
                    <p>Shuffling deck boxes...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/decks-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/decks-index.js') ?>"></script>
</body>
</html>
