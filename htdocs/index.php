<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) ? rtrim($path, '/') ?: '/' : '/';

if (PHP_SAPI === 'cli-server' && $path !== '/') {
    $documentPath = realpath(__DIR__ . '/' . ltrim(rawurldecode($path), '/'));
    if ($documentPath !== false && str_starts_with($documentPath, __DIR__ . DIRECTORY_SEPARATOR)) {
        return false;
    }
}

if ($path === '/health') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    echo json_encode(
        [
            'status' => 'ok',
            'service' => 'wowiekowie.com',
            'time' => gmdate(DATE_ATOM),
        ],
        JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($path !== '/') {
    http_response_code(404);
}

$isNotFound = http_response_code() === 404;
$year = gmdate('Y');
$pageTitle = ($isNotFound ? 'Page not found - ' : '') . 'wowiekowie.com';
$metaDescription = $isNotFound
    ? 'A small detour on wowiekowie.com.'
    : 'A playful personal site for recipes, decks, open-deck scheduling, games, music, videos, kaomoji, and experiments.';
require __DIR__ . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/partials/header.php'; ?>

        <main>
            <?php if ($isNotFound): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">404 / tiny fog machine incident</p>
                    <h1>This hallway is all confetti and no door.</h1>
                    <p class="lede">The site is humming. This particular path wandered off with a juice box.</p>
                    <a class="button" href="/">Back to the fun <span aria-hidden="true">-&gt;</span></a>
                </section>
            <?php else: ?>
                <section class="hero bio-hero" aria-labelledby="home-title">
                    <p class="eyebrow">Welcome to the countertop laboratory</p>
                    <h1 id="home-title">wowiekowie.com keeps the buttons fed.</h1>
                    <p class="lede">
                        Recipes, games, trivia rooms, decks, open-deck scheduling, music, videos, dongs, and tiny experiments,
                        all stacked like snacks in a very opinionated drawer.
                    </p>
                    <p class="aside" data-silly-output>Current mood: sorting ideas by crunch level.</p>
                    <div class="hero-actions" aria-label="Site sections and nonsense controls">
                        <a class="button" href="/recipes/">Open the recipe drawer <span aria-hidden="true">-&gt;</span></a>
                        <button class="button" type="button" data-silly-button>Shuffle the tiny chaos</button>
                        <a class="text-link" href="/decks/">Decks</a>
                        <a class="text-link" href="/open-deck/">Open Deck</a>
                        <a class="text-link" href="/games/">Games</a>
                        <a class="text-link" href="/trivia/">Trivia</a>
                        <a class="text-link" href="/music/">Music</a>
                        <a class="text-link" href="/videos/">Videos</a>
                        <a class="text-link" href="/dongs/">Dongs</a>
                    </div>
                </section>

                <?php require __DIR__ . '/partials/counter-9-11.php'; ?>

                <section class="bio-section" aria-labelledby="bio-title">
                    <div class="section-heading">
                        <p class="eyebrow">Pick a drawer</p>
                        <h2 id="bio-title">A tidy-ish shelf for serious unserious things.</h2>
                    </div>
                    <div class="feature-grid">
                        <article>
                            <span class="feature-number">01</span>
                            <h3>Recipes</h3>
                            <p>Kitchen notes for repeatable wins, tiny triumphs, and meals that made the fork nod.</p>
                        </article>
                        <article>
                            <span class="feature-number">02</span>
                            <h3>Decks</h3>
                            <p>Slides and structured thoughts, because sometimes an idea needs a little stage lighting.</p>
                        </article>
                        <article>
                            <span class="feature-number">03</span>
                            <h3>Open Deck</h3>
                            <p>Public time slots where nominated sets climb by vote and filled picks can face eviction votes.</p>
                        </article>
                        <article>
                            <span class="feature-number">04</span>
                            <h3>Games, trivia, music, videos</h3>
                            <p>Playable bits, shared-link trivia rooms, sound bookmarks, watch pages, and side quests from the rest of the desk.</p>
                        </article>
                    </div>
                </section>

                <section class="bio-section" aria-labelledby="about-title">
                    <div class="section-heading">
                        <p class="eyebrow">About the proprietor</p>
                        <h2 id="about-title">Built by a person who thinks curiosity should have better table manners.</h2>
                    </div>
                    <p class="lede">
                        This place exists because it is more fun to leave the workshop light on than to pretend every idea needs a board meeting.
                        Some things arrive neatly labeled. Others show up wearing roller skates and asking difficult questions.
                    </p>
                    <p class="aside">
                        The general practice is simple: make things with care, keep the weird parts polished, and leave enough room for surprise to sit down with a sandwich.
                    </p>
                </section>
            <?php endif; ?>
        </main>

        <?php require __DIR__ . '/partials/footer.php'; ?>
    </div>
    <?php if (!$isNotFound): ?>
        <script src="/assets/js/home.js" defer></script>
        <script src="/assets/js/counter-9-11.js" defer></script>
    <?php endif; ?>
</body>
</html>
