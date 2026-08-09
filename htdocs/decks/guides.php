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

$guides = loadJsonFile(__DIR__ . '/../data/deck-guides.json');
$decksBySlug = [];

foreach (loadJsonFile(__DIR__ . '/../data/decks.json') as $deck) {
    if (is_array($deck) && is_string($deck['slug'] ?? null)) {
        $decksBySlug[$deck['slug']] = $deck;
    }
}

$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Magic: The Gathering deck walkthrough guides.">
    <title>Deck Guides - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
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

                <?php if ($guides === []): ?>
                    <p>No deck guides are available yet.</p>
                <?php else: ?>
                    <div class="feature-grid">
                        <?php foreach ($guides as $guide): ?>
                            <?php
                            if (!is_array($guide)) {
                                continue;
                            }

                            $slug = is_string($guide['slug'] ?? null) ? $guide['slug'] : '';
                            $title = is_string($guide['title'] ?? null) ? $guide['title'] : 'Untitled guide';
                            $summary = is_string($guide['summary'] ?? null) ? $guide['summary'] : '';
                            $published = is_string($guide['published'] ?? null) ? $guide['published'] : '';
                            $deckSlug = is_string($guide['deck_slug'] ?? null) ? $guide['deck_slug'] : '';
                            $deck = $decksBySlug[$deckSlug] ?? null;
                            $deckName = is_array($deck) && is_string($deck['name'] ?? null) ? $deck['name'] : 'Unknown deck';
                            ?>
                            <article>
                                <?php if ($published !== ''): ?>
                                    <span class="feature-number"><?= e($published) ?></span>
                                <?php endif; ?>
                                <h3><a href="/decks/guide.php?slug=<?= e(rawurlencode($slug)) ?>"><?= e($title) ?></a></h3>
                                <p><?= e($summary) ?></p>
                                <p>Linked deck: <a href="/decks/deck.php?slug=<?= e(rawurlencode($deckSlug)) ?>"><?= e($deckName) ?></a></p>
                            </article>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>
</body>
</html>
