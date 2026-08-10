<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'Browse Magic: The Gathering decks.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Magic: The Gathering</p>
                <h1>Deck Manager</h1>
                <p class="lede">Browse read-only decklists, formats, colors, and card counts from JSON data.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/guides.php">Read play guides</a>
                    <a class="text-link" href="/">Back home</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="deck-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Decklists</p>
                    <h2 id="deck-list-title">Saved decks</h2>
                </div>

                <div id="deck-list" aria-live="polite">
                    <p>Loading decks...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/decks-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/decks-index.js') ?>"></script>
</body>
</html>
