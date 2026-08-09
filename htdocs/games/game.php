<?php

declare(strict_types=1);

$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Strategy notes for a board game on wowiekowie.com.">
    <title>Board game strategy notes - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main id="game-content" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Strategy notes</p>
                <h1>Loading game...</h1>
                <p class="lede">Fetching the latest strategy notes.</p>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script>
        (() => {
            const content = document.getElementById('game-content');
            const slug = new URLSearchParams(window.location.search).get('slug')?.trim() ?? '';

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
                appendTextElement(section, 'h1', '', 'Those strategy notes are not on the shelf.');
                appendTextElement(section, 'p', 'lede', 'Choose a board game from the games list to see its notes.');
                appendArrowLink(section, 'button', '/games/', 'Back to games');

                content.append(section);
            };

            const renderError = () => {
                content.replaceChildren();

                const section = document.createElement('section');
                section.className = 'hero hero-compact';

                appendTextElement(section, 'p', 'eyebrow', 'Loading error');
                appendTextElement(section, 'h1', '', 'Those strategy notes could not be loaded.');
                appendTextElement(section, 'p', 'lede', 'Try the games list again in a moment.');
                appendArrowLink(section, 'button', '/games/', 'Back to games');

                content.append(section);
            };

            const renderGame = (game) => {
                const name = typeof game.name === 'string' ? game.name : 'Board game';
                const description = typeof game.shortDescription === 'string' ? game.shortDescription : '';
                const notes = Array.isArray(game.strategyNotes) ? game.strategyNotes : [];

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
                appendTextElement(heading, 'p', 'eyebrow', 'Per-game notes');

                const title = appendTextElement(heading, 'h2', '', `How to approach ${name}`);
                title.id = 'strategy-title';
                section.append(heading);

                const validNotes = notes.filter((note) => typeof note === 'string' && note !== '');

                if (validNotes.length === 0) {
                    appendTextElement(section, 'p', 'lede', 'No strategy notes have been added for this game yet.');
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
    </script>
</body>
</html>
