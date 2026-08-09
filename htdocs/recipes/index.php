<?php

declare(strict_types=1);

/**
 * @return array<int, array<string, mixed>>
 */
function loadRecipes(): array
{
    $recipeJson = file_get_contents(__DIR__ . '/../data/recipes.json');
    if ($recipeJson === false) {
        return [];
    }

    $recipes = json_decode($recipeJson, true, 512, JSON_THROW_ON_ERROR);
    return is_array($recipes) ? $recipes : [];
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

$recipes = loadRecipes();
$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Recipes from wowiekowie.com.">
    <title>Recipes - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
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

                <div class="feature-grid">
                    <?php foreach ($recipes as $recipe): ?>
                        <?php
                        $slug = is_string($recipe['slug'] ?? null) ? $recipe['slug'] : '';
                        $title = is_string($recipe['title'] ?? null) ? $recipe['title'] : 'Untitled recipe';
                        $summary = is_string($recipe['summary'] ?? null) ? $recipe['summary'] : '';
                        $image = is_string($recipe['image'] ?? null) ? $recipe['image'] : '/assets/recipes/placeholder.svg';
                        ?>
                        <article>
                            <img src="<?= e($image) ?>" alt="" width="640" height="360" loading="lazy">
                            <h3><a href="/recipes/recipe.php?slug=<?= e(rawurlencode($slug)) ?>"><?= e($title) ?></a></h3>
                            <p><?= e($summary) ?></p>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
