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

$slug = is_string($_GET['slug'] ?? null) ? $_GET['slug'] : '';
$deck = null;

foreach (loadDecks() as $candidate) {
    if (($candidate['slug'] ?? null) === $slug) {
        $deck = $candidate;
        break;
    }
}

if ($deck === null) {
    http_response_code(404);
}

$year = gmdate('Y');
$name = is_array($deck) && is_string($deck['name'] ?? null) ? $deck['name'] : 'Deck not found';
$pageTitle = $name . ' - Decks - wowiekowie.com';
$metaDescription = 'Magic: The Gathering deck detail.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <?php if ($deck === null): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Deck manager</p>
                    <h1>Deck not found</h1>
                    <p class="lede">No deck matches the requested slug.</p>
                    <a class="button" href="/decks/">Back to decks</a>
                </section>
            <?php else: ?>
                <?php
                $format = is_string($deck['format'] ?? null) ? $deck['format'] : 'Unknown format';
                $colors = is_array($deck['colors'] ?? null) ? implode(' / ', $deck['colors']) : 'Colorless';
                $commander = is_string($deck['commander'] ?? null) ? $deck['commander'] : '';
                $cardCount = is_int($deck['card_count'] ?? null) ? (string) $deck['card_count'] : '0';
                $summary = is_string($deck['summary'] ?? null) ? $deck['summary'] : '';
                $strategy = is_string($deck['strategy'] ?? null) ? $deck['strategy'] : '';
                $decklist = is_array($deck['decklist'] ?? null) ? $deck['decklist'] : [];
                ?>
                <section class="hero hero-compact">
                    <p class="eyebrow"><?= e($format) ?> - <?= e($colors) ?> - <?= e($cardCount) ?> cards</p>
                    <h1><?= e($name) ?></h1>
                    <?php if ($summary !== ''): ?>
                        <p class="lede"><?= e($summary) ?></p>
                    <?php endif; ?>
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
                    <?php if ($commander !== ''): ?>
                        <p><strong>Commander:</strong> <?= e($commander) ?></p>
                    <?php endif; ?>
                    <?php if ($strategy !== ''): ?>
                        <p><?= e($strategy) ?></p>
                    <?php endif; ?>
                </section>

                <section class="foundation" aria-labelledby="decklist-title">
                    <div class="section-heading">
                        <p class="eyebrow">Decklist</p>
                        <h2 id="decklist-title">Cards</h2>
                    </div>
                    <?php if ($decklist === []): ?>
                        <p>This deck does not have cards listed yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($decklist as $section => $cards): ?>
                                <?php if (!is_array($cards)) { continue; } ?>
                                <article>
                                    <h3><?= e((string) $section) ?></h3>
                                    <ul>
                                        <?php foreach ($cards as $card): ?>
                                            <?php
                                            if (!is_array($card)) {
                                                continue;
                                            }

                                            $quantity = is_int($card['quantity'] ?? null) ? (string) $card['quantity'] : '1';
                                            $cardName = is_string($card['name'] ?? null) ? $card['name'] : 'Unknown card';
                                            ?>
                                            <li><?= e($quantity) ?> <?= e($cardName) ?></li>
                                        <?php endforeach; ?>
                                    </ul>
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
