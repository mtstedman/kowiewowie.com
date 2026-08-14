(() => {
    const detail = document.getElementById('recipe-detail');
    const fallbackImage = '/assets/recipes/placeholder.svg';
    const slug = new URLSearchParams(window.location.search).get('slug')?.trim() || '';

    if (!(detail instanceof HTMLElement)) {
        return;
    }

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
        renderMessage('Recipe not found', 'That recipe slipped behind the fridge.', 'Pick another note from the recipe drawer and try again.');
    }

    function renderError() {
        renderMessage('Recipe unavailable', 'The recipe drawer stuck halfway open.', 'Try the list again in a moment.');
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
})();
