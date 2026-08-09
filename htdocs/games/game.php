<?php

declare(strict_types=1);

function escape_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

/**
 * @return array<int, array<string, mixed>>
 */
function load_games(): array
{
    $dataPath = dirname(__DIR__) . '/data/games.json';
    $contents = file_get_contents($dataPath);

    if ($contents === false) {
        return [];
    }

    try {
        $games = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($games) ? $games : [];
}

/**
 * @param array<int, array<string, mixed>> $games
 * @return array<string, mixed>|null
 */
function find_game_by_slug(array $games, string $slug): ?array
{
    foreach ($games as $game) {
        if (($game['slug'] ?? null) === $slug) {
            return $game;
        }
    }

    return null;
}

$slug = $_GET['slug'] ?? '';
$slug = is_string($slug) ? trim($slug) : '';
$games = load_games();
$game = $slug === '' ? null : find_game_by_slug($games, $slug);
$isNotFound = $game === null;

if ($isNotFound) {
    http_response_code(404);
}

$name = is_string($game['name'] ?? null) ? $game['name'] : 'Board game';
$description = is_string($game['shortDescription'] ?? null) ? $game['shortDescription'] : '';
$notes = is_array($game['strategyNotes'] ?? null) ? $game['strategyNotes'] : [];
$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Strategy notes for <?= escape_html($name) ?> on wowiekowie.com.">
    <title><?= $isNotFound ? 'Game not found' : escape_html($name) . ' strategy notes' ?> - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <?php if ($isNotFound): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Game not found</p>
                    <h1>Those strategy notes are not on the shelf.</h1>
                    <p class="lede">Choose a board game from the games list to see its notes.</p>
                    <a class="button" href="/games/">Back to games <span aria-hidden="true">-&gt;</span></a>
                </section>
            <?php else: ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">Strategy notes</p>
                    <h1><?= escape_html($name) ?></h1>
                    <?php if ($description !== ''): ?>
                        <p class="lede"><?= escape_html($description) ?></p>
                    <?php endif; ?>
                </section>

                <section class="foundation" aria-labelledby="strategy-title">
                    <div class="section-heading">
                        <p class="eyebrow">Per-game notes</p>
                        <h2 id="strategy-title">How to approach <?= escape_html($name) ?></h2>
                    </div>

                    <?php if ($notes === []): ?>
                        <p class="lede">No strategy notes have been added for this game yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($notes as $index => $note): ?>
                                <?php if (!is_string($note) || $note === '') {
                                    continue;
                                } ?>
                                <article>
                                    <span class="feature-number"><?= str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT) ?></span>
                                    <p><?= escape_html($note) ?></p>
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
