<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Big Dongs - wowiekowie.com';
$metaDescription = 'A static holding page for the future Big Dongs wing of wowiekowie.com.';
$pageStyles = ['/assets/css/dongs-index.css'];
$dongers = require __DIR__ . '/dongers.php';
$dongersByCategory = [];

foreach ($dongers as $entry) {
    $dongersByCategory[$entry['category']][] = $entry;
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact">
                <p class="eyebrow">Big Dongs</p>
                <h1>The grand hall is open, even if the exhibits are not.</h1>
                <p class="lede">This corner of the site has the sign, the velvet rope, and absolutely zero structured content behind it yet.</p>
            </section>

            <section class="foundation" aria-labelledby="dongs-title">
                <div class="section-heading">
                    <p class="eyebrow">Placeholder energy</p>
                    <h2 id="dongs-title">Big Dongs</h2>
                </div>

                <p class="lede">Expect a proper collection later. For now, this is a static promise that the tab exists and the bit has room to grow.</p>
                <p>Until then, please imagine something enormous, ridiculous, and lovingly shelved for public viewing.</p>
            </section>

            <section class="foundation dongs-library" aria-labelledby="donger-library-title" data-donger-library>
                <div class="section-heading">
                    <p class="eyebrow">Shelf-ready nonsense</p>
                    <h2 id="donger-library-title">Browsable donger library</h2>
                </div>

                <p class="lede">Tap any kaomoji to copy it. The collection stays typographic, portable, and ready for whatever extremely serious business awaits.</p>
                <p class="dongs-copy-status" id="dongs-copy-status" role="status" aria-live="polite" aria-atomic="true" data-copy-status></p>

                <div class="donger-groups">
                    <?php $categoryIndex = 0; ?>
                    <?php foreach ($dongersByCategory as $category => $entries): ?>
                        <?php $categoryIndex++; ?>
                        <?php $categoryId = 'donger-category-' . $categoryIndex; ?>
                        <section class="donger-category" aria-labelledby="<?= e($categoryId) ?>">
                            <div class="section-heading donger-category-heading">
                                <p class="eyebrow">Category <?= e((string) $categoryIndex) ?></p>
                                <h3 id="<?= e($categoryId) ?>"><?= e($category) ?></h3>
                            </div>

                            <div class="donger-grid">
                                <?php foreach ($entries as $entry): ?>
                                    <button
                                        type="button"
                                        class="donger-button"
                                        data-donger="<?= e($entry['text']) ?>"
                                        data-donger-name="<?= e($entry['name']) ?>"
                                    >
                                        <span class="donger-button__text"><?= e($entry['text']) ?></span>
                                        <span class="donger-button__name"><?= e($entry['name']) ?></span>
                                    </button>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script src="/assets/js/dongs-index.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/dongs-index.js') ?>"></script>
</body>
</html>
