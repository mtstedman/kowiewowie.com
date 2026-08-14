(() => {
    const deckList = document.getElementById('deck-list');

    if (!(deckList instanceof HTMLElement)) {
        return;
    }

    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const normalizeDecks = (payload) => Array.isArray(payload) ? payload : [];

    const renderDecks = (decks) => {
        if (decks.length === 0) {
            deckList.innerHTML = '<p>No decks are available yet.</p>';
            return;
        }

        deckList.innerHTML = `
            <div class="feature-grid">
                ${decks.map((deck) => {
                    const safeDeck = deck && typeof deck === 'object' ? deck : {};
                    const slug = typeof safeDeck.slug === 'string' ? safeDeck.slug : '';
                    const name = typeof safeDeck.name === 'string' ? safeDeck.name : 'Untitled deck';
                    const format = typeof safeDeck.format === 'string' ? safeDeck.format : 'Unknown format';
                    const colors = Array.isArray(safeDeck.colors) && safeDeck.colors.length > 0 ? safeDeck.colors.join(' / ') : 'Colorless';
                    const cardCount = Number.isInteger(safeDeck.card_count) ? String(safeDeck.card_count) : '0';
                    const summary = typeof safeDeck.summary === 'string' ? safeDeck.summary : '';

                    return `
                        <article>
                            <span class="feature-number">${escapeHtml(cardCount)} cards</span>
                            <h3><a href="/decks/deck.php?slug=${encodeURIComponent(slug)}">${escapeHtml(name)}</a></h3>
                            <p>${escapeHtml(format)} - ${escapeHtml(colors)}</p>
                            ${summary !== '' ? `<p>${escapeHtml(summary)}</p>` : ''}
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    };

    const renderError = (message) => {
        deckList.innerHTML = `<p>${escapeHtml(message)}</p>`;
    };

    fetch('/api/decks')
        .then((response) => {
            if (response.status === 404) {
                throw new Error('No decks are available yet.');
            }

            if (!response.ok) {
                throw new Error('Unable to load decks. Please try again later.');
            }

            return response.json();
        })
        .then((payload) => renderDecks(normalizeDecks(payload)))
        .catch((error) => renderError(error.message));
})();
