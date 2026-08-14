(() => {
    const guideList = document.querySelector('#guide-list');

    if (!(guideList instanceof HTMLElement)) {
        return;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#039;',
            '"': '&quot;'
        }[character]));
    }

    async function fetchJson(url) {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        return response.json();
    }

    function deckMapBySlug(decks) {
        return decks.reduce((mappedDecks, deck) => {
            if (deck && typeof deck.slug === 'string') {
                mappedDecks.set(deck.slug, deck);
            }

            return mappedDecks;
        }, new Map());
    }

    function renderGuides(guides, decks) {
        if (!Array.isArray(guides) || guides.length === 0) {
            guideList.innerHTML = '<p>No play guides are on the lectern yet.</p>';
            return;
        }

        const decksBySlug = deckMapBySlug(Array.isArray(decks) ? decks : []);
        const articles = guides
            .filter((guide) => guide && typeof guide === 'object')
            .map((guide) => {
                const slug = typeof guide.slug === 'string' ? guide.slug : '';
                const title = typeof guide.title === 'string' ? guide.title : 'Untitled guide';
                const summary = typeof guide.summary === 'string' ? guide.summary : '';
                const published = typeof guide.published === 'string' ? guide.published : '';
                const deckSlug = typeof guide.deck_slug === 'string' ? guide.deck_slug : '';
                const deck = decksBySlug.get(deckSlug);
                const deckName = deck && typeof deck.name === 'string' ? deck.name : 'Unknown deck';

                return `
                    <article>
                        ${published !== '' ? `<span class="feature-number">${escapeHtml(published)}</span>` : ''}
                        <h3><a href="/decks/guide.php?slug=${encodeURIComponent(slug)}">${escapeHtml(title)}</a></h3>
                        <p>${escapeHtml(summary)}</p>
                        <p>Deck box: <a href="/decks/deck.php?slug=${encodeURIComponent(deckSlug)}">${escapeHtml(deckName)}</a></p>
                    </article>
                `;
            })
            .join('');

        guideList.innerHTML = articles === ''
            ? '<p>No play guides are on the lectern yet.</p>'
            : `<div class="feature-grid">${articles}</div>`;
    }

    async function loadGuides() {
        try {
            const [guides, decks] = await Promise.all([
                fetchJson('/api/guides'),
                fetchJson('/api/decks')
            ]);

            renderGuides(guides, decks);
        } catch (error) {
            guideList.innerHTML = '<p>The play guides wandered off the lectern. Try again in a moment.</p>';
        }
    }

    loadGuides();
})();
