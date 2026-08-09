<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Deck Guides - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck walkthrough guides.';
?>
<!doctype html>
<html lang="en">
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Magic: The Gathering</p>
                <h1>Deck Guides</h1>
                <p class="lede">Blog-style walkthroughs for how to pilot each JSON-backed deck.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/">Browse deck manager</a>
                    <a class="text-link" href="/">Back home</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="guide-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Walkthroughs</p>
                    <h2 id="guide-list-title">How to play</h2>
                </div>

                <div id="guide-list" aria-live="polite">
                    <p>Loading deck guides...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script>
        const guideList = document.querySelector('#guide-list');

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
                guideList.innerHTML = '<p>No deck guides are available yet.</p>';
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
                            <p>Linked deck: <a href="/decks/deck.php?slug=${encodeURIComponent(deckSlug)}">${escapeHtml(deckName)}</a></p>
                        </article>
                    `;
                })
                .join('');

            guideList.innerHTML = articles === ''
                ? '<p>No deck guides are available yet.</p>'
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
                guideList.innerHTML = '<p>Deck guides could not be loaded. Please try again later.</p>';
            }
        }

        loadGuides();
    </script>
</body>
</html>
