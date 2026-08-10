<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck detail.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main id="deck-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Deck manager</p>
                <h1>Loading deck...</h1>
                <p class="lede">Loading deck details...</p>
                <a class="button" href="/decks/">Back to decks</a>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/deck-detail.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/deck-detail.js') ?>"></script>
</body>
</html>
