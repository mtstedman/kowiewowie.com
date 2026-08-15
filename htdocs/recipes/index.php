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

                <p id="recipe-list-status" class="public-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Warming the recipe drawer...</p>
                <div class="feature-grid content-grid" id="recipe-list" role="region" aria-labelledby="recipe-list-title" aria-describedby="recipe-list-status">
                    <section class="content-state content-state--loading" aria-label="Recipes loading">
                        <h3>Warming the recipe drawer.</h3>
                        <p>Fetching the kitchen notes that are ready to cook from.</p>
                    </section>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/recipes-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/recipes-index.js') ?>"></script>
</body>
</html>
