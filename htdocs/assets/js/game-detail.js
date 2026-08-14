(() => {
    const content = document.getElementById('game-content');
    const slug = new URLSearchParams(window.location.search).get('slug')?.trim() ?? '';

    if (!(content instanceof HTMLElement)) {
        return;
    }

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
        const safeGame = game && typeof game === 'object' ? game : {};
        const name = typeof safeGame.name === 'string' ? safeGame.name : 'Board game';
        const description = typeof safeGame.shortDescription === 'string' ? safeGame.shortDescription : '';
        const notes = Array.isArray(safeGame.strategyNotes) ? safeGame.strategyNotes : [];

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

        const validNotes = notes.filter((note) => typeof note === 'string' && note !== '');

        if (validNotes.length === 0) {
            appendTextElement(section, 'p', 'lede', 'No table notes have been tucked into this box yet.');
        } else {
            const grid = document.createElement('div');
            grid.className = 'feature-grid';

            validNotes.forEach((note, index) => {
                const article = document.createElement('article');
                appendTextElement(article, 'span', 'feature-number', String(index + 1).padStart(2, '0'));
                appendTextElement(article, 'p', '', note);
                grid.append(article);
            });

            section.append(grid);
        }

        const backParagraph = document.createElement('p');
        appendArrowLink(backParagraph, 'text-link', '/games/', 'Back to all games');
        section.append(backParagraph);

        content.append(section);
    };

    if (slug === '') {
        renderNotFound();
        return;
    }

    fetch(`/api/games/${encodeURIComponent(slug)}`)
        .then((response) => {
            if (response.status === 404) {
                renderNotFound();
                return null;
            }

            if (!response.ok) {
                throw new Error('Unable to load game.');
            }

            return response.json();
        })
        .then((game) => {
            if (game !== null) {
                renderGame(game && typeof game === 'object' && 'game' in game ? game.game : game);
            }
        })
        .catch(renderError);
})();
