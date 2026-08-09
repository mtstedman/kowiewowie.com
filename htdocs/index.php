<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) ? rtrim($path, '/') ?: '/' : '/';

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
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="A developer bio page for wowiekowie.com.">
    <title><?= $isNotFound ? 'Page not found — ' : '' ?>wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <?php require __DIR__ . '/partials/header.php'; ?>

        <main>
            <?php if ($isNotFound): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">404 / off the map</p>
                    <h1>This page hasn’t been imagined yet.</h1>
                    <p class="lede">The site is up. This particular path isn’t.</p>
                    <a class="button" href="/">Back to the beginning <span aria-hidden="true">→</span></a>
                </section>
            <?php else: ?>
                <section class="hero bio-hero">
                    <p class="eyebrow">Developer bio</p>
                    <h1>I’m a developer and I’m awesome.</h1>
                    <p class="lede">
                        I build useful things for the web with clean code, practical systems,
                        and enough curiosity to keep making the next version better.
                    </p>
                    <p class="aside">Also, I’m watching <cite>Hackers</cite>.</p>
                    <div class="hero-actions" aria-label="Site sections">
                        <a class="button" href="/recipes/">Recipes <span aria-hidden="true">→</span></a>
                        <a class="text-link" href="/decks/">Decks</a>
                        <a class="text-link" href="/games/">Games</a>
                        <a class="text-link" href="/music/">Music</a>
                    </div>
                </section>

                <section class="bio-section" aria-labelledby="bio-title">
                    <div class="section-heading">
                        <p class="eyebrow">What goes here</p>
                        <h2 id="bio-title">A small home base for projects and obsessions.</h2>
                    </div>
                    <div class="feature-grid">
                        <article>
                            <span class="feature-number">01</span>
                            <h3>Recipes</h3>
                            <p>Notes from experiments that worked well enough to make again.</p>
                        </article>
                        <article>
                            <span class="feature-number">02</span>
                            <h3>Decks</h3>
                            <p>Ideas, talks, and structured thoughts when a single page is not enough.</p>
                        </article>
                        <article>
                            <span class="feature-number">03</span>
                            <h3>Games and music</h3>
                            <p>Playful builds, sounds, and side quests from the rest of the desk.</p>
                        </article>
                    </div>
                </section>
            <?php endif; ?>
        </main>

        <?php require __DIR__ . '/partials/footer.php'; ?>
    </div>
</body>
</html>
