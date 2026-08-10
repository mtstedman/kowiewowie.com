(() => {
    const container = document.getElementById('games-list');

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
            renderMessage('No games are available yet.');
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'feature-grid';

        games.forEach((game) => {
            const slug = typeof game.slug === 'string' ? game.slug : '';
            const name = typeof game.name === 'string' ? game.name : 'Untitled game';
            const description = typeof game.shortDescription === 'string' ? game.shortDescription : '';

            const article = document.createElement('article');

            const label = document.createElement('span');
            label.className = 'feature-number';
            label.textContent = 'Game';
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
                link.append('Strategy notes ');

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
            renderGames(Array.isArray(data) ? data : data.games);
        })
        .catch(() => {
            renderMessage('Games could not be loaded right now.');
        });
})();
