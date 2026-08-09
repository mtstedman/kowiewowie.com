<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Decks - wowiekowie.com';
$metaDescription = 'Browse Magic: The Gathering decks.';
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
                <h1>Deck Manager</h1>
                <p class="lede">Browse read-only decklists, formats, colors, and card counts from JSON data.</p>
                <div class="hero-actions">
                    <a class="button" href="/decks/guides.php">Read play guides</a>
                    <a class="text-link" href="/">Back home</a>
                </div>
            </section>

            <section class="foundation" aria-labelledby="deck-list-title">
                <div class="section-heading">
                    <p class="eyebrow">Decklists</p>
                    <h2 id="deck-list-title">Saved decks</h2>
                </div>

                <div id="deck-list" aria-live="polite">
                    <p>Loading decks...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script>
        const deckList = document.getElementById('deck-list');

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
                        const slug = typeof deck.slug === 'string' ? deck.slug : '';
                        const name = typeof deck.name === 'string' ? deck.name : 'Untitled deck';
                        const format = typeof deck.format === 'string' ? deck.format : 'Unknown format';
                        const colors = Array.isArray(deck.colors) && deck.colors.length > 0 ? deck.colors.join(' / ') : 'Colorless';
                        const cardCount = Number.isInteger(deck.card_count) ? String(deck.card_count) : '0';
                        const summary = typeof deck.summary === 'string' ? deck.summary : '';

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
    </script>
</body>
</html>
