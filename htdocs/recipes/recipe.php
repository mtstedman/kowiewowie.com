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

/**
 * @param array<int, array<string, mixed>> $recipes
 * @return array<string, mixed>|null
 */
function findRecipeBySlug(array $recipes, string $slug): ?array
{
    foreach ($recipes as $recipe) {
        if (($recipe['slug'] ?? null) === $slug) {
            return $recipe;
        }
    }

    return null;
}

/**
 * @return array<int, string>
 */
function stringList($value): array
{
    if (!is_array($value)) {
        return [];
    }

    return array_values(array_filter($value, 'is_string'));
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

$slug = $_GET['slug'] ?? '';
$slug = is_string($slug) ? trim($slug) : '';
$recipe = $slug !== '' ? findRecipeBySlug(loadRecipes(), $slug) : null;

if ($recipe === null) {
    http_response_code(404);
}

$title = is_string($recipe['title'] ?? null) ? $recipe['title'] : 'Recipe not found';
$summary = is_string($recipe['summary'] ?? null) ? $recipe['summary'] : '';
$image = is_string($recipe['image'] ?? null) ? $recipe['image'] : '/assets/recipes/placeholder.svg';
$ingredients = stringList($recipe['ingredients'] ?? null);
$instructions = stringList($recipe['instructions'] ?? null);
$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="<?= e($summary !== '' ? $summary : 'Recipe detail from wowiekowie.com.') ?>">
    <title><?= e($title) ?> - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main>
            <?php if ($recipe === null): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Recipe not found</p>
                    <h1>No recipe matched that link.</h1>
                    <p class="lede">Choose a recipe from the list and try again.</p>
                    <a class="button" href="/recipes/">Back to recipes <span aria-hidden="true">-></span></a>
                </section>
            <?php else: ?>
                <article>
                    <section class="hero hero-compact">
                        <p class="eyebrow">Recipe</p>
                        <h1><?= e($title) ?></h1>
                        <p class="lede"><?= e($summary) ?></p>
                        <img src="<?= e($image) ?>" alt="" width="960" height="540">
                    </section>

                    <section class="foundation" aria-labelledby="ingredients-title">
                        <div class="section-heading">
                            <p class="eyebrow">Prep</p>
                            <h2 id="ingredients-title">Ingredients</h2>
                        </div>
                        <ul>
                            <?php foreach ($ingredients as $ingredient): ?>
                                <li><?= e($ingredient) ?></li>
                            <?php endforeach; ?>
                        </ul>
                    </section>

                    <section class="foundation" aria-labelledby="instructions-title">
                        <div class="section-heading">
                            <p class="eyebrow">Cook</p>
                            <h2 id="instructions-title">Instructions</h2>
                        </div>
                        <ol>
                            <?php foreach ($instructions as $instruction): ?>
                                <li><?= e($instruction) ?></li>
                            <?php endforeach; ?>
                        </ol>
                    </section>
                </article>
            <?php endif; ?>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
