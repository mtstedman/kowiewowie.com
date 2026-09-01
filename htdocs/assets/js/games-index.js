(() => {
    const container = document.getElementById('games-list');
    const gamesStatus = document.getElementById('games-list-status');

    if (!(container instanceof HTMLElement)) {
        return;
    }

    const textValue = (value, fallback = '') => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback);

    const normalizeGames = (data) => {
        if (Array.isArray(data)) {
            return data;
        }

        return data && typeof data === 'object' && Array.isArray(data.games) ? data.games : [];
    };

    const setStatus = (message) => {
        if (gamesStatus instanceof HTMLElement) {
            gamesStatus.textContent = message;
        }
    };

    const appendArrow = (link) => {
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '->';
        link.append(arrow);
    };

    const renderState = (title, description, modifier, statusText = `${title}. ${description}`) => {
        container.replaceChildren();
        setStatus(statusText);

        const section = document.createElement('section');
        section.className = `content-state content-state--${modifier}`;

        const heading = document.createElement('h3');
        heading.textContent = title;

        const paragraph = document.createElement('p');
        paragraph.textContent = description;

        section.append(heading, paragraph);
        container.append(section);
    };

    const createSummary = (count) => {
        const countLabel = count === 1 ? '1 guide ready' : `${count} guides ready`;
        const section = document.createElement('section');
        section.className = 'content-summary';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'content-summary-eyebrow';
        eyebrow.textContent = countLabel;

        const description = document.createElement('p');
        description.className = 'content-summary-text';
        description.textContent = 'Board game notes stocked from the public shelf.';

        section.append(eyebrow, description);
        return section;
    };

    const renderGames = (games) => {
        const safeGames = games.filter((game) => game && typeof game === 'object' && !Array.isArray(game));
        container.replaceChildren();

        if (safeGames.length === 0) {
            renderState('No guides yet', 'The game shelf is waiting for its first box of table notes.', 'empty');
            return;
        }

        setStatus(safeGames.length === 1 ? '1 guide loaded.' : `${safeGames.length} guides loaded.`);
        container.append(createSummary(safeGames.length));

        const grid = document.createElement('div');
        grid.className = 'feature-grid';

        safeGames.forEach((game) => {
            const slug = textValue(game.slug);
            const name = textValue(game.name, 'Untitled game');
            const description = textValue(game.shortDescription);

            const article = document.createElement('article');

            const label = document.createElement('span');
            label.className = 'feature-number';
            label.textContent = 'Board game';
            article.append(label);

            const heading = document.createElement('h3');
            heading.textContent = name;
            article.append(heading);

            if (description !== '') {
                const paragraph = document.createElement('p');
                paragraph.textContent = description;
                article.append(paragraph);
            }

            if (slug !== '') {
                const link = document.createElement('a');
                link.className = 'text-link';
                link.href = `/games/game.php?slug=${encodeURIComponent(slug)}`;
                link.append('Read table notes ');
                appendArrow(link);
                article.append(link);
            }

            grid.append(article);
        });

        container.append(grid);
    };

    setStatus('Checking the game shelf...');

    fetch('/api/games')
        .then((response) => {
            if (!response.ok) {
                throw new Error('Unable to load games.');
            }

            return response.json();
        })
        .then((data) => {
            renderGames(normalizeGames(data));
        })
        .catch(() => {
            renderState('Games unavailable', 'The game shelf would not load. Try again in a moment.', 'error');
        });
})();
