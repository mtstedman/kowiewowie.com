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

function find_recipe_by_slug(array $recipes, string $slug): ?array
{
    foreach ($recipes as $recipe) {
        if (!is_array($recipe)) {
            continue;
        }

        if (($recipe['slug'] ?? null) === $slug) {
            return $recipe;
        }
    }

    return null;
}

$slug = isset($_GET['slug']) && is_string($_GET['slug']) ? trim($_GET['slug']) : '';
$recipe = $slug !== '' ? find_recipe_by_slug(load_recipes(), $slug) : null;
$title = $recipe !== null && isset($recipe['title']) && is_string($recipe['title']) && trim($recipe['title']) !== '' ? $recipe['title'] : 'Untitled recipe';
$summary = $recipe !== null && isset($recipe['summary']) && is_string($recipe['summary']) ? $recipe['summary'] : '';
$image = $recipe !== null && isset($recipe['image']) && is_string($recipe['image']) && trim($recipe['image']) !== '' ? $recipe['image'] : '/assets/recipes/placeholder.svg';
$ingredients = $recipe !== null && isset($recipe['ingredients']) && is_array($recipe['ingredients']) ? array_values(array_filter($recipe['ingredients'], static fn ($item): bool => is_string($item))) : [];
$instructions = $recipe !== null && isset($recipe['instructions']) && is_array($recipe['instructions']) ? array_values(array_filter($recipe['instructions'], static fn ($item): bool => is_string($item))) : [];

$pageTitle = $recipe !== null ? $title . ' - wowiekowie.com' : 'Recipe - wowiekowie.com';
$metaDescription = $summary !== '' ? $summary : 'Recipe detail from wowiekowie.com.';
require __DIR__ . '/../partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/../partials/header.php'; ?>

        <main id="recipe-detail" aria-live="polite">
            <?php if ($recipe === null): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Recipe not found</p>
                    <h1>No recipe matched that link.</h1>
                    <p class="lede">Choose a recipe from the list and try again.</p>
                    <a class="button" href="/recipes/">Back to recipes <span aria-hidden="true">-&gt;</span></a>
                </section>
            <?php else: ?>
                <article>
                    <section class="hero hero-compact">
                        <p class="eyebrow">Recipe</p>
                        <h1><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></h1>
                        <?php if ($summary !== ''): ?>
                            <p class="lede"><?= htmlspecialchars($summary, ENT_QUOTES, 'UTF-8') ?></p>
                        <?php endif; ?>
                        <img src="<?= htmlspecialchars($image, ENT_QUOTES, 'UTF-8') ?>" alt="" width="960" height="540">
                    </section>

                    <section class="foundation" aria-labelledby="ingredients-title">
                        <div class="section-heading">
                            <p class="eyebrow">Prep</p>
                            <h2 id="ingredients-title">Ingredients</h2>
                        </div>

                        <?php if ($ingredients === []): ?>
                            <p class="lede">No ingredients have been added for this recipe yet.</p>
                        <?php else: ?>
                            <ul>
                                <?php foreach ($ingredients as $ingredient): ?>
                                    <li><?= htmlspecialchars($ingredient, ENT_QUOTES, 'UTF-8') ?></li>
                                <?php endforeach; ?>
                            </ul>
                        <?php endif; ?>
                    </section>

                    <section class="foundation" aria-labelledby="instructions-title">
                        <div class="section-heading">
                            <p class="eyebrow">Cook</p>
                            <h2 id="instructions-title">Instructions</h2>
                        </div>

                        <?php if ($instructions === []): ?>
                            <p class="lede">No instructions have been added for this recipe yet.</p>
                        <?php else: ?>
                            <ol>
                                <?php foreach ($instructions as $instruction): ?>
                                    <li><?= htmlspecialchars($instruction, ENT_QUOTES, 'UTF-8') ?></li>
                                <?php endforeach; ?>
                            </ol>
                        <?php endif; ?>
                    </section>
                </article>
            <?php endif; ?>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
