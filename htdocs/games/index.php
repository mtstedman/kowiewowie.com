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
                    <p class="lede">Loading games...</p>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script src="/assets/js/games-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/games-index.js') ?>"></script>
</body>
</html>
