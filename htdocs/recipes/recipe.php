<?php

declare(strict_types=1);

$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Recipe detail from wowiekowie.com.">
    <title>Recipe - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
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

    <script>
        const detail = document.getElementById('recipe-detail');
        const fallbackImage = '/assets/recipes/placeholder.svg';
        const slug = new URLSearchParams(window.location.search).get('slug')?.trim() || '';

        function textValue(value, fallback = '') {
            return typeof value === 'string' && value.trim() !== '' ? value : fallback;
        }

        function stringList(value) {
            return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
        }

        function normalizeRecipe(data) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return null;
            }

            if (Object.prototype.hasOwnProperty.call(data, 'recipe')) {
                return data.recipe && typeof data.recipe === 'object' && !Array.isArray(data.recipe) ? data.recipe : null;
            }

            return data;
        }

        function renderMessage(eyebrowText, headingText, ledeText) {
            detail.innerHTML = '';

            const section = document.createElement('section');
            section.className = 'hero hero-compact';

            const eyebrow = document.createElement('p');
            eyebrow.className = 'eyebrow';
            eyebrow.textContent = eyebrowText;

            const heading = document.createElement('h1');
            heading.textContent = headingText;

            const lede = document.createElement('p');
            lede.className = 'lede';
            lede.textContent = ledeText;

            const link = document.createElement('a');
            link.className = 'button';
            link.href = '/recipes/';
            link.textContent = 'Back to recipes ';

            const arrow = document.createElement('span');
            arrow.setAttribute('aria-hidden', 'true');
            arrow.textContent = '->';
            link.append(arrow);

            section.append(eyebrow, heading, lede, link);
            detail.append(section);
        }

        function renderNotFound() {
            renderMessage('Recipe not found', 'No recipe matched that link.', 'Choose a recipe from the list and try again.');
        }

        function renderError() {
            renderMessage('Recipe unavailable', 'Recipe could not be loaded right now.', 'Choose a recipe from the list and try again.');
        }

        function renderRecipe(recipe) {
            const title = textValue(recipe.title, 'Untitled recipe');
            const summary = textValue(recipe.summary);
            const image = textValue(recipe.image, fallbackImage);
            const ingredients = stringList(recipe.ingredients);
            const instructions = stringList(recipe.instructions);

            document.title = `${title} - wowiekowie.com`;
            detail.innerHTML = '';

            const article = document.createElement('article');
            const hero = document.createElement('section');
            hero.className = 'hero hero-compact';

            const eyebrow = document.createElement('p');
            eyebrow.className = 'eyebrow';
            eyebrow.textContent = 'Recipe';

            const heading = document.createElement('h1');
            heading.textContent = title;

            const lede = document.createElement('p');
            lede.className = 'lede';
            lede.textContent = summary;

            const img = document.createElement('img');
            img.src = image;
            img.alt = '';
            img.width = 960;
            img.height = 540;

            hero.append(eyebrow, heading, lede, img);
            article.append(hero, renderListSection('Prep', 'ingredients-title', 'Ingredients', ingredients, 'ul'), renderListSection('Cook', 'instructions-title', 'Instructions', instructions, 'ol'));
            detail.append(article);
        }

        function renderListSection(eyebrowText, headingId, headingText, items, listTag) {
            const section = document.createElement('section');
            section.className = 'foundation';
            section.setAttribute('aria-labelledby', headingId);

            const headingWrap = document.createElement('div');
            headingWrap.className = 'section-heading';

            const eyebrow = document.createElement('p');
            eyebrow.className = 'eyebrow';
            eyebrow.textContent = eyebrowText;

            const heading = document.createElement('h2');
            heading.id = headingId;
            heading.textContent = headingText;

            const list = document.createElement(listTag);
            items.forEach((item) => {
                const listItem = document.createElement('li');
                listItem.textContent = item;
                list.append(listItem);
            });

            headingWrap.append(eyebrow, heading);
            section.append(headingWrap, list);
            return section;
        }

        async function loadRecipe() {
            if (slug === '') {
                renderNotFound();
                return;
            }

            try {
                const response = await fetch(`/api/recipes/${encodeURIComponent(slug)}`);
                if (!response.ok) {
                    throw new Error('Recipe request failed.');
                }

                const recipe = normalizeRecipe(await response.json());
                if (recipe === null) {
                    renderNotFound();
                    return;
                }

                renderRecipe(recipe);
            } catch (error) {
                renderError();
            }
        }

        loadRecipe();
    </script>
</body>
</html>
