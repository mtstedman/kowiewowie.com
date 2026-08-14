(() => {
    const container = document.getElementById('games-list');

    if (!(container instanceof HTMLElement)) {
        return;
    }

    const renderMessage = (message) => {
        container.replaceChildren();
        const paragraph = document.createElement('p');
        paragraph.className = 'lede';
        paragraph.textContent = message;
        container.append(paragraph);
    };

    const renderGames = (games) => {
        container.replaceChildren();

        if (!Array.isArray(games) || games.length === 0) {
            renderMessage('The game shelf is waiting for its first box.');
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'feature-grid';

        games.forEach((game) => {
            const safeGame = game && typeof game === 'object' ? game : {};
            const slug = typeof safeGame.slug === 'string' ? safeGame.slug : '';
            const name = typeof safeGame.name === 'string' ? safeGame.name : 'Untitled game';
            const description = typeof safeGame.shortDescription === 'string' ? safeGame.shortDescription : '';

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

                const arrow = document.createElement('span');
                arrow.setAttribute('aria-hidden', 'true');
                arrow.textContent = '->';
                link.append(arrow);

                article.append(link);
            }

            grid.append(article);
        });

        container.append(grid);
    };

    fetch('/api/games')
        .then((response) => {
            if (!response.ok) {
                throw new Error('Unable to load games.');
            }

            return response.json();
        })
        .then((data) => {
            const games = data && typeof data === 'object' ? data.games : [];
            renderGames(Array.isArray(data) ? data : games);
        })
        .catch(() => {
            renderMessage('The game shelf would not load. Try again in a moment.');
        });
})();
