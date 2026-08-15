(() => {
    const recipeList = document.getElementById('recipe-list');
    const recipeStatus = document.getElementById('recipe-list-status');
    const fallbackImage = '/assets/recipes/placeholder.svg';

    if (!(recipeList instanceof HTMLElement)) {
        return;
    }

    function textValue(value, fallback = '') {
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
    }

    function normalizeRecipes(data) {
        if (Array.isArray(data)) {
            return data;
        }

        return data && typeof data === 'object' && Array.isArray(data.recipes) ? data.recipes : [];
    }

    function setStatus(message) {
        if (recipeStatus instanceof HTMLElement) {
            recipeStatus.textContent = message;
        }
    }

    function appendArrow(link) {
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '->';
        link.append(arrow);
    }

    function renderState(title, description, modifier, statusText = `${title}. ${description}`) {
        recipeList.replaceChildren();
        setStatus(statusText);

        const section = document.createElement('section');
        section.className = `content-state content-state--${modifier}`;

        const heading = document.createElement('h3');
        heading.textContent = title;

        const paragraph = document.createElement('p');
        paragraph.textContent = description;

        section.append(heading, paragraph);
        recipeList.append(section);
    }

    function createSummary(count) {
        const countLabel = count === 1 ? '1 recipe ready' : `${count} recipes ready`;
        const section = document.createElement('section');
        section.className = 'content-summary';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'content-summary-eyebrow';
        eyebrow.textContent = countLabel;

        const description = document.createElement('p');
        description.className = 'content-summary-text';
        description.textContent = 'Kitchen notes stocked from the public recipe drawer.';

        section.append(eyebrow, description);
        return section;
    }

    function renderRecipes(recipes) {
        const safeRecipes = recipes.filter((recipe) => recipe && typeof recipe === 'object' && !Array.isArray(recipe));

        if (safeRecipes.length === 0) {
            renderState('No recipes yet', 'Fresh kitchen notes will land here when the recipe drawer gets stocked.', 'empty');
            return;
        }

        recipeList.replaceChildren();
        setStatus(safeRecipes.length === 1 ? '1 recipe loaded.' : `${safeRecipes.length} recipes loaded.`);
        recipeList.append(createSummary(safeRecipes.length));

        safeRecipes.forEach((recipe) => {
            const slug = textValue(recipe.slug);
            const title = textValue(recipe.title, 'Untitled recipe');
            const summary = textValue(recipe.summary);
            const image = textValue(recipe.image, fallbackImage);

            const article = document.createElement('article');
            article.className = 'recipe-card';

            const img = document.createElement('img');
            img.className = 'recipe-card-image';
            img.src = image;
            img.alt = '';
            img.width = 640;
            img.height = 360;
            img.loading = 'lazy';

            const heading = document.createElement('h3');
            heading.textContent = title;

            article.append(img, heading);

            if (summary !== '') {
                const paragraph = document.createElement('p');
                paragraph.textContent = summary;
                article.append(paragraph);
            }

            if (slug !== '') {
                const link = document.createElement('a');
                link.className = 'text-link';
                link.href = `/recipes/recipe.php?slug=${encodeURIComponent(slug)}`;
                link.append('Cook this recipe ');
                appendArrow(link);
                article.append(link);
            }

            recipeList.append(article);
        });
    }

    async function loadRecipeList() {
        setStatus('Warming the recipe drawer...');

        try {
            const response = await fetch('/api/recipes');
            if (!response.ok) {
                throw new Error('Recipe request failed.');
            }

            renderRecipes(normalizeRecipes(await response.json()));
        } catch (error) {
            renderState('Recipes unavailable', 'The recipe drawer jammed. Try again in a moment.', 'error');
        }
    }

    loadRecipeList();
})();
