<?php

declare(strict_types=1);

$year = gmdate('Y');

function load_recipes(): array
{
    $recipesPath = __DIR__ . '/../data/recipes.json';
    if (!is_file($recipesPath)) {
        return [];
    }

    $recipesJson = file_get_contents($recipesPath);
    if ($recipesJson === false) {
        return [];
    }

    $recipes = json_decode($recipesJson, true);
    return is_array($recipes) ? $recipes : [];
}

$recipes = load_recipes();
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
                    <?php if ($recipes === []): ?>
                        <p>No recipes are available yet.</p>
                    <?php else: ?>
                        <?php foreach ($recipes as $recipe): ?>
                            <?php
                            $slug = is_array($recipe) && isset($recipe['slug']) && is_string($recipe['slug']) ? $recipe['slug'] : '';
                            $title = is_array($recipe) && isset($recipe['title']) && is_string($recipe['title']) && trim($recipe['title']) !== '' ? $recipe['title'] : 'Untitled recipe';
                            $summary = is_array($recipe) && isset($recipe['summary']) && is_string($recipe['summary']) ? $recipe['summary'] : '';
                            $image = is_array($recipe) && isset($recipe['image']) && is_string($recipe['image']) && trim($recipe['image']) !== '' ? $recipe['image'] : '/assets/recipes/placeholder.svg';
                            ?>
                            <article>
                                <img src="<?= htmlspecialchars($image, ENT_QUOTES, 'UTF-8') ?>" alt="" width="640" height="360" loading="lazy">
                                <h3>
                                    <?php if ($slug !== ''): ?>
                                        <a href="/recipes/recipe.php?slug=<?= htmlspecialchars(rawurlencode($slug), ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></a>
                                    <?php else: ?>
                                        <?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?>
                                    <?php endif; ?>
                                </h3>
                                <?php if ($summary !== ''): ?>
                                    <p><?= htmlspecialchars($summary, ENT_QUOTES, 'UTF-8') ?></p>
                                <?php endif; ?>
                            </article>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
