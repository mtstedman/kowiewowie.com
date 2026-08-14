<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Recipes - wowiekowie.com';
$metaDescription = 'Recipe notes, repeatable meals, and kitchen wins from wowiekowie.com.';
?>
<?php require __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Recipe drawer</p>
                <h1>Dependable things to make again.</h1>
                <p class="lede">Kitchen notes for repeatable wins, tiny triumphs, and meals that made the fork nod.</p>
            </section>

            <section class="foundation" aria-labelledby="recipe-list-title">
                <div class="section-heading">
                    <p class="eyebrow">All recipes</p>
                    <h2 id="recipe-list-title">Cook from the scribbles.</h2>
                </div>

                <div class="feature-grid" id="recipe-list" aria-live="polite">
                    <p>Warming the recipe drawer...</p>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/recipes-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/recipes-index.js') ?>"></script>
</body>
</html>
