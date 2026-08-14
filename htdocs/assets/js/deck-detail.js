(() => {
    const detailRoot = document.getElementById('deck-detail');
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug') || '';

    if (!(detailRoot instanceof HTMLElement)) {
        return;
    }

    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const renderNotFound = (message) => {
        detailRoot.innerHTML = `
            <section class="hero hero-compact">
                <p class="eyebrow">Decklist</p>
                <h1>That deck box is missing</h1>
                <p class="lede">${escapeHtml(message)}</p>
                <a class="button" href="/decks/">Back to decks</a>
            </section>
        `;
    };

    const renderError = (message) => {
        detailRoot.innerHTML = `
            <section class="hero hero-compact">
                <p class="eyebrow">Decklist</p>
                <h1>The deck box stuck shut</h1>
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
                ${sections.length === 0 ? '<p>This deck box is still waiting for its card list.</p>' : `
                    <div class="feature-grid">
                        ${sections.map(([section, cards]) => `
                            <article>
                                <h3>${escapeHtml(section)}</h3>
                                <ul>
                                    ${cards.filter((card) => card && typeof card === 'object').map((card) => {
                                        const quantity = Number.isInteger(card.quantity) ? String(card.quantity) : '1';
                                        const cardName = typeof card.name === 'string' ? card.name : 'Unknown card';
                                        const cardId = typeof card.card_id === 'string' ? card.card_id : '';
                                        const imageUrl = typeof card.image_url === 'string' ? card.image_url.trim() : '';
                                        const cardArt = imageUrl !== ''
                                            ? `<img class="deck-card-thumb" data-card-image src="${escapeHtml(imageUrl)}" alt="${escapeHtml(`${cardName} card art`)}" loading="lazy">`
                                            : '<span class="deck-card-thumb deck-card-thumb-placeholder" data-card-image aria-hidden="true">No image</span>';

                                        return `<li class="deck-card" data-card-id="${escapeHtml(cardId)}">${cardArt}<span>${escapeHtml(quantity)} ${escapeHtml(cardName)}</span></li>`;
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
        renderNotFound('No deck matches that link.');
    } else {
        fetch(`/api/decks/${encodeURIComponent(slug)}`)
            .then((response) => {
                if (response.status === 404) {
                    throw new Error('No deck matches that link.');
                }

                if (!response.ok) {
                    throw new Error('Unable to load this deck. Please try again later.');
                }

                return response.json();
            })
            .then((deck) => renderDeck(deck && typeof deck === 'object' ? deck : {}))
            .catch((error) => {
                if (error.message === 'No deck matches that link.') {
                    renderNotFound(error.message);
                    return;
                }

                renderError(error.message);
            });
    }
})();
