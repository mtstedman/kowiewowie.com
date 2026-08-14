<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Music - wowiekowie.com';
$metaDescription = 'Songs worth keeping nearby, with Spotify links from wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Music shelf</p>
                <h1>Tracks worth keeping within arm's reach.</h1>
                <p class="lede">A compact stack of songs for when the room needs a better pulse.</p>
            </section>

            <section class="foundation" aria-labelledby="music-title">
                <div class="section-heading">
                    <p class="eyebrow">Now playing elsewhere</p>
                    <h2 id="music-title">Small queue, good mileage.</h2>
                </div>

                <div id="music-list" aria-live="polite">
                    <p>Needle dropping...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/music-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/music-index.js') ?>"></script>
</body>
</html>
