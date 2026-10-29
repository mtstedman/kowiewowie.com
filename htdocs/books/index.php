<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Books - wowiekowie.com';
$metaDescription = 'Book recommendations with covers, prices, back-cover overviews, and Amazon links from wowiekowie.com.';
$pageStyles = ['/assets/css/books.css'];
?>
<?php include __DIR__ . '/../partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include __DIR__ . '/../partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Reading shelf</p>
                <h1>Books worth passing hand to hand.</h1>
                <p class="lede">Recommendations with the cover, the price, and the back-cover pitch, so you can judge a book by more than one thing.</p>
            </section>

            <section class="foundation" aria-labelledby="books-title">
                <div class="section-heading">
                    <p class="eyebrow">Recommended reading</p>
                    <h2 id="books-title">Pulled from the shelf.</h2>
                </div>

                <div id="books-list" class="books-list" aria-live="polite" aria-busy="true">
                    <p class="books-status">Dusting off the shelf...</p>
                </div>
            </section>
        </main>

        <?php include __DIR__ . '/../partials/footer.php'; ?>
    </div>

    <script src="/assets/js/books-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/books-index.js') ?>"></script>
</body>
</html>
