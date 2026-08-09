<?php

declare(strict_types=1);

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function loadJsonFile(string $path): array
{
    $json = file_get_contents($path);

    if ($json === false) {
        return [];
    }

    $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);

    return is_array($data) ? $data : [];
}

$slug = is_string($_GET['slug'] ?? null) ? $_GET['slug'] : '';
$guide = null;
$decksBySlug = [];

foreach (loadJsonFile(__DIR__ . '/../data/decks.json') as $deck) {
    if (is_array($deck) && is_string($deck['slug'] ?? null)) {
        $decksBySlug[$deck['slug']] = $deck;
    }
}

foreach (loadJsonFile(__DIR__ . '/../data/deck-guides.json') as $candidate) {
    if (is_array($candidate) && ($candidate['slug'] ?? null) === $slug) {
        $guide = $candidate;
        break;
    }
}

if ($guide === null) {
    http_response_code(404);
}

$year = gmdate('Y');
$title = is_array($guide) && is_string($guide['title'] ?? null) ? $guide['title'] : 'Guide not found';
$pageTitle = $title . ' - Deck Guides - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck walkthrough.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <?php if ($guide === null): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Deck guides</p>
                    <h1>Guide not found</h1>
                    <p class="lede">No walkthrough matches the requested slug.</p>
                    <a class="button" href="/decks/guides.php">Back to guides</a>
                </section>
            <?php else: ?>
                <?php
                $summary = is_string($guide['summary'] ?? null) ? $guide['summary'] : '';
                $published = is_string($guide['published'] ?? null) ? $guide['published'] : '';
                $deckSlug = is_string($guide['deck_slug'] ?? null) ? $guide['deck_slug'] : '';
                $deck = $decksBySlug[$deckSlug] ?? null;
                $deckName = is_array($deck) && is_string($deck['name'] ?? null) ? $deck['name'] : 'Unknown deck';
                $sections = is_array($guide['sections'] ?? null) ? $guide['sections'] : [];
                ?>
                <section class="hero hero-compact">
                    <p class="eyebrow"><?= e($published) ?> - linked deck: <?= e($deckName) ?></p>
                    <h1><?= e($title) ?></h1>
                    <?php if ($summary !== ''): ?>
                        <p class="lede"><?= e($summary) ?></p>
                    <?php endif; ?>
                    <div class="hero-actions">
                        <a class="button" href="/decks/deck.php?slug=<?= e(rawurlencode($deckSlug)) ?>">View decklist</a>
                        <a class="text-link" href="/decks/guides.php">Back to guides</a>
                    </div>
                </section>

                <section class="foundation" aria-labelledby="walkthrough-title">
                    <div class="section-heading">
                        <p class="eyebrow">Walkthrough</p>
                        <h2 id="walkthrough-title">How to play</h2>
                    </div>

                    <?php if ($sections === []): ?>
                        <p>This guide does not have walkthrough sections yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($sections as $section): ?>
                                <?php
                                if (!is_array($section)) {
                                    continue;
                                }

                                $heading = is_string($section['heading'] ?? null) ? $section['heading'] : 'Guide section';
                                $body = is_string($section['body'] ?? null) ? $section['body'] : '';
                                ?>
                                <article>
                                    <h3><?= e($heading) ?></h3>
                                    <p><?= e($body) ?></p>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </section>
            <?php endif; ?>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
