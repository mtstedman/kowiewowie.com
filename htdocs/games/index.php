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

$games = load_games();
$pageTitle = 'Board games - wowiekowie.com';
$metaDescription = 'Board games and per-game strategy notes from wowiekowie.com.';
require dirname(__DIR__) . '/partials/head.php';
?>
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

                <div id="games-list" aria-live="polite">
                    <?php if ($games === []): ?>
                        <p class="lede">No games are available yet.</p>
                    <?php else: ?>
                        <div class="feature-grid">
                            <?php foreach ($games as $game): ?>
                                <?php
                                $slug = is_array($game) && isset($game['slug']) && is_string($game['slug']) ? $game['slug'] : '';
                                $name = is_array($game) && isset($game['name']) && is_string($game['name']) ? $game['name'] : 'Untitled game';
                                $description = is_array($game) && isset($game['shortDescription']) && is_string($game['shortDescription']) ? $game['shortDescription'] : '';
                                ?>
                                <article>
                                    <span class="feature-number">Game</span>
                                    <h3><?= htmlspecialchars($name, ENT_QUOTES, 'UTF-8') ?></h3>
                                    <?php if ($description !== ''): ?>
                                        <p><?= htmlspecialchars($description, ENT_QUOTES, 'UTF-8') ?></p>
                                    <?php endif; ?>
                                    <?php if ($slug !== ''): ?>
                                        <a class="text-link" href="/games/game.php?slug=<?= htmlspecialchars(rawurlencode($slug), ENT_QUOTES, 'UTF-8') ?>">Strategy notes <span aria-hidden="true">-&gt;</span></a>
                                    <?php endif; ?>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
