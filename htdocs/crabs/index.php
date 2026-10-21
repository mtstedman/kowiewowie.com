<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Crabs - wowiekowie.com';
$metaDescription = 'The day enormous, sentient crabs marched out of the Gulf and took over Florida.';
require dirname(__DIR__) . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact" aria-labelledby="crabs-title">
                <p class="eyebrow">Shell shock</p>
                <h1 id="crabs-title">The crabs have taken Florida.</h1>
                <p class="lede">Large, sentient, and extremely organized. The Sunshine State is now a claw-run territory.</p>
            </section>

            <section class="foundation" aria-labelledby="crabs-story-title">
                <div class="section-heading">
                    <p class="eyebrow">How it happened</p>
                    <h2 id="crabs-story-title">A very pinchy takeover.</h2>
                </div>

                <div class="feature-grid">
                    <article>
                        <h3>The landing</h3>
                        <p>They rose out of the Gulf at low tide, each one the size of a pickup truck, and politely asked to speak to the manager of the beach.</p>
                    </article>
                    <article>
                        <h3>The council</h3>
                        <p>By morning the crabs had seized every boardwalk, formed a governing council, and declared sideways the only legal direction of travel.</p>
                    </article>
                    <article>
                        <h3>The new order</h3>
                        <p>Theme parks now run on shell time, the swamps belong to the molting class, and tourists are welcome so long as they bring snacks.</p>
                    </article>
                </div>
            </section>

            <section class="bio-section" aria-labelledby="crab-notes-title">
                <div class="section-heading">
                    <p class="eyebrow">Field notes</p>
                    <h2 id="crab-notes-title">A small salute to the ocean's finest little weirdos.</h2>
                </div>
                <p class="lede">Crabs bring strong claws, excellent hats, and the quiet confidence to scuttle wherever the day takes them.</p>
                <p class="aside">Today's crab wisdom: when forward feels overrated, sideways still counts.</p>
            </section>
        </main>

        <?php require dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
</body>
</html>
