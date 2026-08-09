<?php

declare(strict_types=1);

$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Magic: The Gathering deck detail.">
    <title>Decks - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main id="deck-detail" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Deck manager</p>
                <h1>Loading deck...</h1>
                <p class="lede">Loading deck details...</p>
                <a class="button" href="/decks/">Back to decks</a>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script>
        const detailRoot = document.getElementById('deck-detail');
        const params = new URLSearchParams(window.location.search);
        const slug = params.get('slug') || '';

        const escapeHtml = (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const renderNotFound = (message) => {
            detailRoot.innerHTML = `
                <section class="hero hero-compact">
                    <p class="eyebrow">Deck manager</p>
                    <h1>Deck not found</h1>
                    <p class="lede">${escapeHtml(message)}</p>
                    <a class="button" href="/decks/">Back to decks</a>
                </section>
            `;
        };

        const renderError = (message) => {
            detailRoot.innerHTML = `
                <section class="hero hero-compact">
                    <p class="eyebrow">Deck manager</p>
                    <h1>Unable to load deck</h1>
                    <p class="lede">${escapeHtml(message)}</p>
                    <a class="button" href="/decks/">Back to decks</a>
                </section>
            `;
        };

        const renderDeck = (deck) => {
            const name = typeof deck.name === 'string' ? deck.name : 'Untitled deck';
            const format = typeof deck.format === 'string' ? deck.format : 'Unknown format';
            const colors = Array.isArray(deck.colors) && deck.colors.length > 0 ? deck.colors.join(' / ') : 'Colorless';
            const commander = typeof deck.commander === 'string' ? deck.commander : '';
            const cardCount = Number.isInteger(deck.card_count) ? String(deck.card_count) : '0';
            const summary = typeof deck.summary === 'string' ? deck.summary : '';
            const strategy = typeof deck.strategy === 'string' ? deck.strategy : '';
            const decklist = deck.decklist && typeof deck.decklist === 'object' && !Array.isArray(deck.decklist) ? deck.decklist : {};
            const sections = Object.entries(decklist).filter(([, cards]) => Array.isArray(cards));

            document.title = `${name} - Decks - wowiekowie.com`;
            detailRoot.innerHTML = `
                <section class="hero hero-compact">
                    <p class="eyebrow">${escapeHtml(format)} - ${escapeHtml(colors)} - ${escapeHtml(cardCount)} cards</p>
                    <h1>${escapeHtml(name)}</h1>
                    ${summary !== '' ? `<p class="lede">${escapeHtml(summary)}</p>` : ''}
                    <div class="hero-actions">
                        <a class="button" href="/decks/guides.php">Read play guides</a>
                        <a class="text-link" href="/decks/">Back to decks</a>
                    </div>
                </section>

                <section class="foundation" aria-labelledby="deck-overview-title">
                    <div class="section-heading">
                        <p class="eyebrow">Overview</p>
                        <h2 id="deck-overview-title">Game plan</h2>
                    </div>
                    ${commander !== '' ? `<p><strong>Commander:</strong> ${escapeHtml(commander)}</p>` : ''}
                    ${strategy !== '' ? `<p>${escapeHtml(strategy)}</p>` : ''}
                </section>

                <section class="foundation" aria-labelledby="decklist-title">
                    <div class="section-heading">
                        <p class="eyebrow">Decklist</p>
                        <h2 id="decklist-title">Cards</h2>
                    </div>
                    ${sections.length === 0 ? '<p>This deck does not have cards listed yet.</p>' : `
                        <div class="feature-grid">
                            ${sections.map(([section, cards]) => `
                                <article>
                                    <h3>${escapeHtml(section)}</h3>
                                    <ul>
                                        ${cards.filter((card) => card && typeof card === 'object').map((card) => {
                                            const quantity = Number.isInteger(card.quantity) ? String(card.quantity) : '1';
                                            const cardName = typeof card.name === 'string' ? card.name : 'Unknown card';

                                            return `<li>${escapeHtml(quantity)} ${escapeHtml(cardName)}</li>`;
                                        }).join('')}
                                    </ul>
                                </article>
                            `).join('')}
                        </div>
                    `}
                </section>
            `;
        };

        if (slug === '') {
            renderNotFound('No deck matches the requested slug.');
        } else {
            fetch(`/api/decks/${encodeURIComponent(slug)}`)
                .then((response) => {
                    if (response.status === 404) {
                        throw new Error('No deck matches the requested slug.');
                    }

                    if (!response.ok) {
                        throw new Error('Unable to load this deck. Please try again later.');
                    }

                    return response.json();
                })
                .then((deck) => renderDeck(deck && typeof deck === 'object' ? deck : {}))
                .catch((error) => {
                    if (error.message === 'No deck matches the requested slug.') {
                        renderNotFound(error.message);
                        return;
                    }

                    renderError(error.message);
                });
        }
    </script>
</body>
</html>
