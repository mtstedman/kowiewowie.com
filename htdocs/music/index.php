<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Music - wowiekowie.com';
$metaDescription = 'A simple list of songs liked by wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Music</p>
                <h1>Liked songs</h1>
                <p class="lede">A short list of tracks worth keeping nearby.</p>
            </section>

            <section class="foundation" aria-labelledby="music-title">
                <div class="section-heading">
                    <p class="eyebrow">Now playing elsewhere</p>
                    <h2 id="music-title">Songs list</h2>
                </div>

                <div id="music-list" aria-live="polite">
                    <p>Loading songs...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/music-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/music-index.js') ?>"></script>
</body>
</html>
