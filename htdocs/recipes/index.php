<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Recipes - wowiekowie.com';
$metaDescription = 'Recipes from wowiekowie.com.';
require __DIR__ . '/../partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Recipe manager</p>
                <h1>Recipes</h1>
                <p class="lede">A small collection of dependable things to make again.</p>
            </section>

            <section class="foundation" aria-labelledby="recipe-list-title">
                <div class="section-heading">
                    <p class="eyebrow">All recipes</p>
                    <h2 id="recipe-list-title">Cook from the notes.</h2>
                </div>

                <div class="feature-grid" id="recipe-list" aria-live="polite">
                    <p>Loading recipes...</p>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/recipes-index.js" defer></script>
</body>
</html>
