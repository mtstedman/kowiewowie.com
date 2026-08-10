<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Big Dongs - wowiekowie.com';
$metaDescription = 'Browse the Big Dongs library of copy-ready kaomoji on wowiekowie.com.';
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
                <h1>The grand hall is open and fully stocked.</h1>
                <p class="lede">The velvet rope is gone. Browse the library, copy a kaomoji, and carry on with whatever extremely serious business needs a properly enormous face.</p>
            </section>

            <section class="foundation dongs-library" aria-label="Donger library" data-donger-library>

                <p class="lede">Tap any kaomoji to copy it. The collection stays typographic, portable, and ready for whatever extremely serious business awaits.</p>

                <form role="search" aria-label="Search dongers" data-donger-search-form>
                    <label for="donger-search-input">Search the library</label>
                    <input
                        id="donger-search-input"
                        name="donger-search"
                        type="search"
                        placeholder="Search by name or kaomoji"
                        autocomplete="off"
                        aria-controls="donger-groups"
                        data-donger-search-input
                    >
                    <button type="button" data-donger-search-clear>Clear</button>
                </form>

                <p role="status" aria-live="polite" aria-atomic="true" data-donger-search-status></p>
                <p hidden data-donger-search-empty>No dongers matched that search yet. Try a name or part of the kaomoji.</p>
                <p class="dongs-copy-status" id="dongs-copy-status" role="status" aria-live="polite" aria-atomic="true" data-copy-status></p>

                <div class="donger-groups" id="donger-groups">
                    <?php $categoryIndex = 0; ?>
                    <?php foreach ($dongersByCategory as $category => $entries): ?>
                        <?php $categoryIndex++; ?>
                        <?php $categoryId = 'donger-category-' . $categoryIndex; ?>
                        <section class="donger-category" aria-labelledby="<?= e($categoryId) ?>">
                            <div class="section-heading donger-category-heading">
                                <p class="eyebrow">Category <?= e((string) $categoryIndex) ?></p>
                                <h2 id="<?= e($categoryId) ?>"><?= e($category) ?></h2>
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
    <script src="/assets/js/dongs-search.js?v=<?= filemtime(dirname(__DIR__) . '/assets/js/dongs-search.js') ?>"></script>
</body>
</html>
