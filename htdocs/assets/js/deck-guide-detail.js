(() => {
    const guideDetail = document.querySelector('#guide-detail');
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug') || '';

    if (!(guideDetail instanceof HTMLElement)) {
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
            const error = new Error(`Request failed: ${response.status}`);
            error.status = response.status;
            throw error;
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

    function renderNotFound() {
        document.title = 'Guide not found - Deck Guides - wowiekowie.com';
        guideDetail.innerHTML = `
            <section class="hero hero-compact">
                <p class="eyebrow">Deck guides</p>
                <h1>Guide not found</h1>
                <p class="lede">No walkthrough matches the requested slug.</p>
                <a class="button" href="/decks/guides.php">Back to guides</a>
            </section>
        `;
    }

    function renderGuide(guide, decks) {
        if (!guide || typeof guide !== 'object') {
            renderNotFound();
            return;
        }

        const title = typeof guide.title === 'string' ? guide.title : 'Guide not found';
        const summary = typeof guide.summary === 'string' ? guide.summary : '';
        const published = typeof guide.published === 'string' ? guide.published : '';
        const deckSlug = typeof guide.deck_slug === 'string' ? guide.deck_slug : '';
        const decksBySlug = deckMapBySlug(Array.isArray(decks) ? decks : []);
        const deck = decksBySlug.get(deckSlug);
        const deckName = deck && typeof deck.name === 'string' ? deck.name : 'Unknown deck';
        const sections = Array.isArray(guide.sections) ? guide.sections : [];
        const sectionArticles = sections
            .filter((section) => section && typeof section === 'object')
            .map((section) => {
                const heading = typeof section.heading === 'string' ? section.heading : 'Guide section';
                const body = typeof section.body === 'string' ? section.body : '';

                return `
                    <article>
                        <h3>${escapeHtml(heading)}</h3>
                        <p>${escapeHtml(body)}</p>
                    </article>
                `;
            })
            .join('');

        document.title = `${title} - Deck Guides - wowiekowie.com`;
        guideDetail.innerHTML = `
            <section class="hero hero-compact">
                <p class="eyebrow">${escapeHtml(published)} - linked deck: ${escapeHtml(deckName)}</p>
                <h1>${escapeHtml(title)}</h1>
                ${summary !== '' ? `<p class="lede">${escapeHtml(summary)}</p>` : ''}
                <div class="hero-actions">
                    <a class="button" href="/decks/deck.php?slug=${encodeURIComponent(deckSlug)}">View decklist</a>
                    <a class="text-link" href="/decks/guides.php">Back to guides</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="walkthrough-title">
                <div class="section-heading">
                    <p class="eyebrow">Walkthrough</p>
                    <h2 id="walkthrough-title">How to play</h2>
                </div>

                ${sectionArticles === ''
                    ? '<p>This guide does not have walkthrough sections yet.</p>'
                    : `<div class="feature-grid">${sectionArticles}</div>`}
            </section>
        `;
    }

    async function loadGuide() {
        if (slug === '') {
            renderNotFound();
            return;
        }

        try {
            const [guide, decks] = await Promise.all([
                fetchJson(`/api/guides/${encodeURIComponent(slug)}`),
                fetchJson('/api/decks')
            ]);

            renderGuide(guide, decks);
        } catch (error) {
            if (error.status === 404) {
                renderNotFound();
                return;
            }

            guideDetail.innerHTML = `
                <section class="hero hero-compact">
                    <p class="eyebrow">Deck guides</p>
                    <h1>Guide unavailable</h1>
                    <p class="lede">This walkthrough could not be loaded. Please try again later.</p>
                    <a class="button" href="/decks/guides.php">Back to guides</a>
                </section>
            `;
        }
    }

    loadGuide();
})();
