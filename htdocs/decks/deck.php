<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck detail.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<style>
    .deck-card {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        margin-block: 0.75rem;
    }

    .deck-card-thumb {
        aspect-ratio: 488 / 680;
        border-radius: 0.35rem;
        flex: 0 0 4.5rem;
        max-width: 4.5rem;
        object-fit: cover;
        width: 4.5rem;
    }

    .deck-card-thumb-placeholder {
        align-items: center;
        background: color-mix(in srgb, currentColor 8%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
        color: inherit;
        display: flex;
        font-size: 0.75rem;
        justify-content: center;
        min-height: 6.25rem;
        text-align: center;
    }
</style>
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
