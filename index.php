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
    <meta name="description" content="wowiekowie.com is taking shape.">
    <title><?= $isNotFound ? 'Page not found — ' : '' ?>wowiekowie.com</title>
    <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
    <div class="page-shell">
        <header class="site-header">
            <a class="wordmark" href="/" aria-label="wowiekowie.com home">
                <span class="wordmark-mark" aria-hidden="true">w</span>
                <span>wowiekowie.com</span>
            </a>
            <span class="status"><span class="status-dot" aria-hidden="true"></span>online</span>
        </header>

        <main>
            <?php if ($isNotFound): ?>
                <section class="hero hero-compact">
                    <p class="eyebrow">404 / off the map</p>
                    <h1>This page hasn’t been imagined yet.</h1>
                    <p class="lede">The site is up. This particular path isn’t.</p>
                    <a class="button" href="/">Back to the beginning <span aria-hidden="true">→</span></a>
                </section>
            <?php else: ?>
                <section class="hero">
                    <p class="eyebrow">A fresh plot of internet</p>
                    <h1>Something <em>wowie</em><br>starts here.</h1>
                    <p class="lede">
                        The foundation is live and the canvas is clean. This is the starting point
                        for whatever wowiekowie.com becomes next.
                    </p>
                    <div class="hero-actions">
                        <a class="button" href="#foundation">See the foundation <span aria-hidden="true">↓</span></a>
                        <a class="text-link" href="/health">System health <span aria-hidden="true">↗</span></a>
                    </div>
                </section>

                <section class="foundation" id="foundation" aria-labelledby="foundation-title">
                    <div class="section-heading">
                        <p class="eyebrow">Ready to build</p>
                        <h2 id="foundation-title">Simple by design.</h2>
                    </div>
                    <div class="feature-grid">
                        <article>
                            <span class="feature-number">01</span>
                            <h3>Fast PHP core</h3>
                            <p>A tiny front controller with no framework or dependency overhead.</p>
                        </article>
                        <article>
                            <span class="feature-number">02</span>
                            <h3>Clean routes</h3>
                            <p>Nginx passes friendly URLs to one clear application entry point.</p>
                        </article>
                        <article>
                            <span class="feature-number">03</span>
                            <h3>Production ready</h3>
                            <p>Secure defaults, health checks, structured logs, and HTTPS-ready hosting.</p>
                        </article>
                    </div>
                </section>
            <?php endif; ?>
        </main>

        <footer>
            <span>© <?= htmlspecialchars($year, ENT_QUOTES, 'UTF-8') ?> wowiekowie.com</span>
            <span>Built from a blank page.</span>
        </footer>
    </div>
</body>
</html>
