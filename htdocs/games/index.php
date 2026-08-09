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

$games = load_games();
$year = gmdate('Y');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Board games and per-game strategy notes from wowiekowie.com.">
    <title>Board games - wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Board games</p>
                <h1>Tabletop notes for the next game night.</h1>
                <p class="lede">A small library of games with strategy notes kept separate for each title.</p>
            </section>

            <section class="foundation" aria-labelledby="games-title">
                <div class="section-heading">
                    <p class="eyebrow">Games shelf</p>
                    <h2 id="games-title">Board games</h2>
                </div>

                <?php if ($games === []): ?>
                    <p class="lede">No games are available yet.</p>
                <?php else: ?>
                    <div class="feature-grid">
                        <?php foreach ($games as $game): ?>
                            <?php
                            $slug = is_string($game['slug'] ?? null) ? $game['slug'] : '';
                            $name = is_string($game['name'] ?? null) ? $game['name'] : 'Untitled game';
                            $description = is_string($game['shortDescription'] ?? null) ? $game['shortDescription'] : '';
                            ?>
                            <article>
                                <span class="feature-number">Game</span>
                                <h3><?= escape_html($name) ?></h3>
                                <?php if ($description !== ''): ?>
                                    <p><?= escape_html($description) ?></p>
                                <?php endif; ?>
                                <?php if ($slug !== ''): ?>
                                    <a class="text-link" href="/games/game.php?slug=<?= rawurlencode($slug) ?>">Strategy notes <span aria-hidden="true">-&gt;</span></a>
                                <?php endif; ?>
                            </article>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
