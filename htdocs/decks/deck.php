<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'A Magic: The Gathering decklist and game plan from wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main id="deck-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Decklist</p>
                <h1>Unsleeving the deck.</h1>
                <p class="lede">Fetching colors, counts, and the game plan.</p>
                <a class="button" href="/decks/">Back to decks</a>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/deck-detail.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/deck-detail.js') ?>"></script>
</body>
</html>
