<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Big Dongs - wowiekowie.com';
$metaDescription = 'A static holding page for the future Big Dongs wing of wowiekowie.com.';
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
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
