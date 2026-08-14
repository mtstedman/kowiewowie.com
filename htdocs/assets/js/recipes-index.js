(() => {
    const recipeList = document.getElementById('recipe-list');
    const fallbackImage = '/assets/recipes/placeholder.svg';

    if (!(recipeList instanceof HTMLElement)) {
        return;
    }

    function textValue(value, fallback = '') {
        return typeof value === 'string' && value.trim() !== '' ? value : fallback;
    }

    function normalizeRecipes(data) {
        if (Array.isArray(data)) {
            return data;
        }

        return data && typeof data === 'object' && Array.isArray(data.recipes) ? data.recipes : [];
    }

    function renderRecipes(recipes) {
        recipeList.innerHTML = '';

        if (recipes.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'The recipe drawer is empty for now.';
            recipeList.append(empty);
            return;
        }

        recipes.forEach((recipe) => {
            const safeRecipe = recipe && typeof recipe === 'object' ? recipe : {};
            const slug = textValue(safeRecipe.slug);
            const title = textValue(safeRecipe.title, 'Untitled recipe');
            const summary = textValue(safeRecipe.summary);
            const image = textValue(safeRecipe.image, fallbackImage);

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
            message.textContent = 'The recipe drawer jammed. Try again in a moment.';
            recipeList.append(message);
        }
    }

    loadRecipeList();
})();
