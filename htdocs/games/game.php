<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Board game strategy notes - wowiekowie.com';
$metaDescription = 'Strategy notes for a board game on wowiekowie.com.';
require dirname(__DIR__) . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main id="game-content" aria-live="polite">
            <section class="hero hero-compact">
                <p class="eyebrow">Strategy notes</p>
                <h1>Loading game...</h1>
                <p class="lede">Fetching the latest strategy notes.</p>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script src="/assets/js/game-detail.js" defer></script>
</body>
</html>
