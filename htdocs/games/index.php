<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Board games - wowiekowie.com';
$metaDescription = 'Board games and per-game strategy notes from wowiekowie.com.';
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Board game shelf</p>
                <h1>Tabletop notes for the next "wait, how do we win?"</h1>
                <p class="lede">A small library of games with strategy notes kept tidy for each box on the shelf.</p>
            </section>

            <section class="foundation" aria-labelledby="games-title">
                <div class="section-heading">
                    <p class="eyebrow">Games shelf</p>
                    <h2 id="games-title">Pick a box, find the angle.</h2>
                </div>

                <p id="games-list-status" class="public-visually-hidden" role="status" aria-live="polite" aria-atomic="true">Checking the game shelf...</p>
                <div id="games-list" class="content-results" role="region" aria-labelledby="games-title" aria-describedby="games-list-status">
                    <section class="content-state content-state--loading" aria-label="Games loading">
                        <h3>Checking the game shelf.</h3>
                        <p>Fetching the boxes with table notes ready to read.</p>
                    </section>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script src="/assets/js/games-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/games-index.js') ?>"></script>
</body>
</html>
