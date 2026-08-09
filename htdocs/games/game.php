<?php

declare(strict_types=1);

$year = gmdate('Y');

function load_games(): array
{
    $gamesPath = dirname(__DIR__) . '/data/games.json';
    if (!is_file($gamesPath)) {
        return [];
    }

    $gamesJson = file_get_contents($gamesPath);
    if ($gamesJson === false) {
        return [];
    }

    $games = json_decode($gamesJson, true);
    return is_array($games) ? $games : [];
}

function find_game_by_slug(array $games, string $slug): ?array
{
    foreach ($games as $game) {
        if (!is_array($game)) {
            continue;
        }

        if (($game['slug'] ?? null) === $slug) {
            return $game;
        }
    }

    return null;
}

$slug = isset($_GET['slug']) && is_string($_GET['slug']) ? trim($_GET['slug']) : '';
$game = $slug !== '' ? find_game_by_slug(load_games(), $slug) : null;
$name = $game !== null && isset($game['name']) && is_string($game['name']) ? $game['name'] : '';
$description = $game !== null && isset($game['shortDescription']) && is_string($game['shortDescription']) ? $game['shortDescription'] : '';
$notes = $game !== null && isset($game['strategyNotes']) && is_array($game['strategyNotes']) ? $game['strategyNotes'] : [];

$pageTitle = $game !== null ? $name . ' strategy notes - wowiekowie.com' : 'Board game strategy notes - wowiekowie.com';
$metaDescription = $description !== '' ? $description : 'Strategy notes for a board game on wowiekowie.com.';
require dirname(__DIR__) . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main id="game-content" aria-live="polite">
            <?php if ($game === null): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Game not found</p>
                    <h1>Those strategy notes are not on the shelf.</h1>
                    <p class="lede">Choose a board game from the games list to see its notes.</p>
                    <a class="button" href="/games/">Back to games <span aria-hidden="true">-&gt;</span></a>
                </section>
            <?php else: ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Strategy notes</p>
                    <h1><?= htmlspecialchars($name, ENT_QUOTES, 'UTF-8') ?></h1>
                    <?php if ($description !== ''): ?>
                        <p class="lede"><?= htmlspecialchars($description, ENT_QUOTES, 'UTF-8') ?></p>
                    <?php endif; ?>
                </section>

                <section class="foundation" aria-labelledby="strategy-title">
                    <div class="section-heading">
                        <p class="eyebrow">Per-game notes</p>
                        <h2 id="strategy-title">How to approach <?= htmlspecialchars($name, ENT_QUOTES, 'UTF-8') ?></h2>
                    </div>

                    <?php $validNotes = array_values(array_filter($notes, static fn ($note): bool => is_string($note) && $note !== '')); ?>
                    <?php if ($validNotes === []): ?>
                        <p class="lede">No strategy notes have been added for this game yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($validNotes as $index => $note): ?>
                                <article>
                                    <span class="feature-number"><?= htmlspecialchars(str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT), ENT_QUOTES, 'UTF-8') ?></span>
                                    <p><?= htmlspecialchars($note, ENT_QUOTES, 'UTF-8') ?></p>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>

                    <p><a class="text-link" href="/games/">Back to all games <span aria-hidden="true">-&gt;</span></a></p>
                </section>
            <?php endif; ?>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
