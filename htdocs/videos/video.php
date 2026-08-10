<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Video - wowiekowie.com';
$metaDescription = 'Watch a public video on wowiekowie.com.';
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main id="video-page" aria-live="polite">
            <section class="hero hero-compact videos-watch-shell">
                <p class="eyebrow">Videos</p>
                <h1>Loading video...</h1>
                <p class="lede">Fetching the watch page and related uploads.</p>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/video-detail.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/video-detail.js') ?>"></script>
</body>
</html>
