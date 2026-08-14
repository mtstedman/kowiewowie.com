<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Recipe - wowiekowie.com';
$metaDescription = 'A recipe note from the wowiekowie.com kitchen drawer.';
?>
<?php require __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main id="recipe-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Recipe drawer</p>
                <h1>Warming the recipe page.</h1>
                <p class="lede">Fetching the notes, crumbs, and useful little measurements.</p>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/recipe-detail.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/recipe-detail.js') ?>"></script>
</body>
</html>
