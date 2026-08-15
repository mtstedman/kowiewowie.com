(() => {
    const content = document.getElementById('game-content');
    const slug = new URLSearchParams(window.location.search).get('slug')?.trim() ?? '';

    if (!(content instanceof HTMLElement)) {
        return;
    }

    const textValue = (value, fallback = '') => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback);
    const stringList = (value) => (Array.isArray(value) ? value.map((item) => textValue(item)).filter((item) => item !== '') : []);

    const normalizeGame = (data) => {
        const candidate = data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'game') ? data.game : data;

        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return null;
        }

        if (textValue(candidate.name) === '' && textValue(candidate.shortDescription) === '' && stringList(candidate.strategyNotes).length === 0) {
            return null;
        }

        return candidate;
    };

    const appendTextElement = (parent, tagName, className, text) => {
        const element = document.createElement(tagName);

        if (className !== '') {
            element.className = className;
        }

        element.textContent = text;
        parent.append(element);

        return element;
    };

    const appendArrowLink = (parent, className, href, text) => {
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
    };

    const renderNotFound = () => {
        document.title = 'Game not found - wowiekowie.com';
        content.replaceChildren();

        const section = document.createElement('section');
        section.className = 'hero hero-compact';

        appendTextElement(section, 'p', 'eyebrow', 'Game not found');
        appendTextElement(section, 'h1', '', 'That game box is not on the shelf.');
        appendTextElement(section, 'p', 'lede', 'Choose another board game to see its table notes.');
        appendArrowLink(section, 'button', '/games/', 'Back to games');

        content.append(section);
    };

    const renderError = () => {
        document.title = 'Game unavailable - wowiekowie.com';
        content.replaceChildren();

        const section = document.createElement('section');
        section.className = 'hero hero-compact';

        appendTextElement(section, 'p', 'eyebrow', 'Loading error');
        appendTextElement(section, 'h1', '', 'The table notes would not load.');
        appendTextElement(section, 'p', 'lede', 'Try the games shelf again in a moment.');
        appendArrowLink(section, 'button', '/games/', 'Back to games');

        content.append(section);
    };

    const renderGame = (game) => {
        const name = textValue(game.name, 'Board game');
        const description = textValue(game.shortDescription);
        const notes = stringList(game.strategyNotes);

        document.title = `${name} strategy notes - wowiekowie.com`;

        content.replaceChildren();

        const hero = document.createElement('section');
        hero.className = 'hero hero-compact';

        appendTextElement(hero, 'p', 'eyebrow', 'Strategy notes');
        appendTextElement(hero, 'h1', '', name);

        if (description !== '') {
            appendTextElement(hero, 'p', 'lede', description);
        }

        content.append(hero);

        const section = document.createElement('section');
        section.className = 'foundation';
        section.setAttribute('aria-labelledby', 'strategy-title');

        const heading = document.createElement('div');
        heading.className = 'section-heading';
        appendTextElement(heading, 'p', 'eyebrow', 'Table notes');

        const title = appendTextElement(heading, 'h2', '', `How to approach ${name}`);
        title.id = 'strategy-title';
        section.append(heading);

        if (notes.length === 0) {
            appendTextElement(section, 'p', 'lede', 'No table notes have been tucked into this box yet.');
        } else {
            const grid = document.createElement('div');
            grid.className = 'feature-grid';

            notes.forEach((note, index) => {
                const article = document.createElement('article');
                appendTextElement(article, 'span', 'feature-number', String(index + 1).padStart(2, '0'));
                appendTextElement(article, 'p', '', note);
                grid.append(article);
            });

            section.append(grid);
        }

        const backParagraph = document.createElement('p');
        backParagraph.className = 'content-back-link';
        appendArrowLink(backParagraph, 'text-link', '/games/', 'Back to all games');
        section.append(backParagraph);

        content.append(section);
    };

    const loadGame = async () => {
        if (slug === '') {
            renderNotFound();
            return;
        }

        try {
            const response = await fetch(`/api/games/${encodeURIComponent(slug)}`);
            if (response.status === 404) {
                renderNotFound();
                return;
            }

            if (!response.ok) {
                throw new Error('Unable to load game.');
            }

            const game = normalizeGame(await response.json());
            if (game === null) {
                renderError();
                return;
            }

            renderGame(game);
        } catch (error) {
            renderError();
        }
    };

    loadGame();
})();
