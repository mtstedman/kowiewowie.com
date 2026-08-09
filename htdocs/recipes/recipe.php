<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Recipe - wowiekowie.com';
$metaDescription = 'Recipe detail from wowiekowie.com.';
require __DIR__ . '/../partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main id="recipe-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Recipe</p>
                <h1>Loading recipe...</h1>
                <p class="lede">Fetching the recipe notes.</p>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/recipe-detail.js" defer></script>
</body>
</html>
