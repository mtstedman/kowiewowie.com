<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Deck Guides - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck walkthrough.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main id="guide-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Deck guides</p>
                <h1>Loading guide...</h1>
                <p class="lede">Loading walkthrough details.</p>
                <a class="button" href="/decks/guides.php">Back to guides</a>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/deck-guide-detail.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/deck-guide-detail.js') ?>"></script>
</body>
</html>
