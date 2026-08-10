<?php

declare(strict_types=1);

$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Board games and per-game strategy notes from wowiekowie.com.">
    <title>Board games - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Board games</p>
                <h1>Tabletop notes for the next game night.</h1>
                <p class="lede">A small library of games with strategy notes kept separate for each title.</p>
            </section>

            <section class="foundation" aria-labelledby="games-title">
                <div class="section-heading">
                    <p class="eyebrow">Games shelf</p>
                    <h2 id="games-title">Board games</h2>
                </div>

                <div id="games-list" aria-live="polite">
                    <p class="lede">Loading games...</p>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script>
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
    </script>
</body>
</html>
