(() => {
    const detail = document.getElementById('recipe-detail');
    const fallbackImage = '/assets/recipes/placeholder.svg';
    const slug = new URLSearchParams(window.location.search).get('slug')?.trim() || '';

    if (!(detail instanceof HTMLElement)) {
        return;
    }

    function textValue(value, fallback = '') {
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
    }

    function stringList(value) {
        return Array.isArray(value) ? value.map((item) => textValue(item)).filter((item) => item !== '') : [];
    }

    function hasRecipeContent(recipe) {
        return textValue(recipe.title) !== '' || stringList(recipe.ingredients).length > 0 || stringList(recipe.instructions).length > 0;
    }

    function normalizeRecipe(data) {
        const candidate = data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'recipe') ? data.recipe : data;

        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !hasRecipeContent(candidate)) {
            return null;
        }

        return candidate;
    }

    function appendArrowLink(parent, className, href, text) {
        const link = document.createElement('a');
        link.className = className;
        link.href = href;
        link.append(`${text} `);

        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '->';
        link.append(arrow);

        parent.append(link);
        return link;
    }

    function renderMessage(eyebrowText, headingText, ledeText, titleText) {
        document.title = `${titleText} - wowiekowie.com`;
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

        section.append(eyebrow, heading, lede);
        appendArrowLink(section, 'button', '/recipes/', 'Back to recipes');
        detail.append(section);
    }

    function renderNotFound() {
        renderMessage('Recipe not found', 'That recipe slipped behind the fridge.', 'Pick another note from the recipe drawer and try again.', 'Recipe not found');
    }

    function renderError() {
        renderMessage('Recipe unavailable', 'The recipe drawer stuck halfway open.', 'Try the list again in a moment.', 'Recipe unavailable');
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

        const backParagraph = document.createElement('p');
        backParagraph.className = 'content-back-link';
        appendArrowLink(backParagraph, 'text-link', '/recipes/', 'Back to all recipes');

        article.append(
            hero,
            renderListSection('Prep', 'ingredients-title', 'Ingredients', ingredients, 'ul', 'No ingredients have been added to this note yet.'),
            renderListSection('Cook', 'instructions-title', 'Instructions', instructions, 'ol', 'No cooking steps have been added to this note yet.'),
            backParagraph
        );
        detail.append(article);
    }

    function renderListSection(eyebrowText, headingId, headingText, items, listTag, emptyText) {
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

        headingWrap.append(eyebrow, heading);
        section.append(headingWrap);

        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'lede';
            empty.textContent = emptyText;
            section.append(empty);
            return section;
        }

        const list = document.createElement(listTag);
        items.forEach((item) => {
            const listItem = document.createElement('li');
            listItem.textContent = item;
            list.append(listItem);
        });

        section.append(list);
        return section;
    }

    async function loadRecipe() {
        if (slug === '') {
            renderNotFound();
            return;
        }

        try {
            const response = await fetch(`/api/recipes/${encodeURIComponent(slug)}`);
            if (response.status === 404) {
                renderNotFound();
                return;
            }

            if (!response.ok) {
                throw new Error('Recipe request failed.');
            }

            const recipe = normalizeRecipe(await response.json());
            if (recipe === null) {
                renderError();
                return;
            }

            renderRecipe(recipe);
        } catch (error) {
            renderError();
        }
    }

    loadRecipe();
})();
