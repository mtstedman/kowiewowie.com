<?php

declare(strict_types=1);

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

                <div class="feature-grid" id="recipe-list" aria-live="polite">
                    <p>Loading recipes...</p>
                </div>
            </section>
        </main>

        <?php require __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script>
        const recipeList = document.getElementById('recipe-list');
        const fallbackImage = '/assets/recipes/placeholder.svg';

        function textValue(value, fallback = '') {
            return typeof value === 'string' && value.trim() !== '' ? value : fallback;
        }

        function normalizeRecipes(data) {
            if (Array.isArray(data)) {
                return data;
            }

            return Array.isArray(data.recipes) ? data.recipes : [];
        }

        function renderRecipes(recipes) {
            recipeList.innerHTML = '';

            if (recipes.length === 0) {
                const empty = document.createElement('p');
                empty.textContent = 'No recipes are available yet.';
                recipeList.append(empty);
                return;
            }

            recipes.forEach((recipe) => {
                const slug = textValue(recipe.slug);
                const title = textValue(recipe.title, 'Untitled recipe');
                const summary = textValue(recipe.summary);
                const image = textValue(recipe.image, fallbackImage);

                const article = document.createElement('article');

                const img = document.createElement('img');
                img.src = image;
                img.alt = '';
                img.width = 640;
                img.height = 360;
                img.loading = 'lazy';

                const heading = document.createElement('h3');
                const link = document.createElement('a');
                link.href = `/recipes/recipe.php?slug=${encodeURIComponent(slug)}`;
                link.textContent = title;
                heading.append(link);

                const paragraph = document.createElement('p');
                paragraph.textContent = summary;

                article.append(img, heading, paragraph);
                recipeList.append(article);
            });
        }

        async function loadRecipeList() {
            try {
                const response = await fetch('/api/recipes');
                if (!response.ok) {
                    throw new Error('Recipe request failed.');
                }

                renderRecipes(normalizeRecipes(await response.json()));
            } catch (error) {
                recipeList.innerHTML = '';
                const message = document.createElement('p');
                message.textContent = 'Recipes could not be loaded right now.';
                recipeList.append(message);
            }
        }

        loadRecipeList();
    </script>
</body>
</html>
