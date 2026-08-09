<?php

declare(strict_types=1);

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function loadDecks(): array
{
    $path = __DIR__ . '/../data/decks.json';
    $json = file_get_contents($path);

    if ($json === false) {
        return [];
    }

    $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);

    return is_array($data) ? $data : [];
}

$decks = loadDecks();
$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Browse Magic: The Gathering decks.">
    <title>Decks - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
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

                <?php if ($decks === []): ?>
                    <p>No decks are available yet.</p>
                <?php else: ?>
                    <div class="feature-grid">
                        <?php foreach ($decks as $deck): ?>
                            <?php
                            $slug = is_string($deck['slug'] ?? null) ? $deck['slug'] : '';
                            $name = is_string($deck['name'] ?? null) ? $deck['name'] : 'Untitled deck';
                            $format = is_string($deck['format'] ?? null) ? $deck['format'] : 'Unknown format';
                            $colors = is_array($deck['colors'] ?? null) ? implode(' / ', $deck['colors']) : 'Colorless';
                            $cardCount = is_int($deck['card_count'] ?? null) ? (string) $deck['card_count'] : '0';
                            $summary = is_string($deck['summary'] ?? null) ? $deck['summary'] : '';
                            ?>
                            <article>
                                <span class="feature-number"><?= e($cardCount) ?> cards</span>
                                <h3><a href="/decks/deck.php?slug=<?= e(rawurlencode($slug)) ?>"><?= e($name) ?></a></h3>
                                <p><?= e($format) ?> - <?= e($colors) ?></p>
                                <?php if ($summary !== ''): ?>
                                    <p><?= e($summary) ?></p>
                                <?php endif; ?>
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
