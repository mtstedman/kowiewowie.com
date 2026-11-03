<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Stratego - wowiekowie.com';
$metaDescription = 'Start a Stratego game, invite an opponent with a link, and pick up your boards on wowiekowie.com.';
$pageStyles = ['/assets/css/stratego.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell stratego-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="stratego-page" data-stratego-lobby>
            <section class="stratego-hero" aria-labelledby="stratego-title">
                <p class="eyebrow">Stratego lobby</p>
                <h1 id="stratego-title">Stratego invite links.</h1>
                <p class="lede">Start a game, send the invite link to an opponent, then deploy your army in secret.</p>
            </section>

            <p class="stratego-alert" id="stratego-join-message" role="alert" hidden></p>

            <section class="stratego-layout" aria-label="Stratego lobby">
                <section class="stratego-panel" aria-labelledby="stratego-new-game-title">
                    <div class="stratego-section-heading">
                        <p class="eyebrow">New game</p>
                        <h2 id="stratego-new-game-title">Start a battle</h2>
                    </div>

                    <form class="stratego-form stratego-new-game-form" id="stratego-new-game-form">
                        <label class="stratego-field" for="stratego-creator-color">
                            <span>Your army</span>
                            <select id="stratego-creator-color" name="creator_color">
                                <option value="red">Red (moves first)</option>
                                <option value="blue">Blue</option>
                                <option value="random" selected>Random</option>
                            </select>
                        </label>

                        <button class="stratego-button stratego-button-primary" type="submit" id="stratego-new-game-button">
                            New game
                        </button>
                    </form>

                    <div class="stratego-copy-box" id="stratego-invite-box" hidden>
                        <label class="stratego-field" for="stratego-invite-url">
                            <span>Invite link for your opponent</span>
                            <input id="stratego-invite-url" type="text" readonly>
                        </label>
                        <button class="stratego-button" type="button" id="stratego-copy-invite-button">Copy</button>
                        <a class="stratego-button stratego-button-primary" id="stratego-open-game-link" href="/stratego/" hidden>Open game</a>
                    </div>

                    <p class="stratego-message" id="stratego-create-message" role="status" aria-live="polite"></p>
                </section>

                <section class="stratego-panel" aria-labelledby="stratego-games-title">
                    <div class="stratego-section-heading">
                        <p class="eyebrow">Your boards</p>
                        <h2 id="stratego-games-title">Your games</h2>
                    </div>

                    <div class="stratego-games-list" id="stratego-games-list" aria-live="polite">
                        <p class="stratego-state-message">Loading your games...</p>
                    </div>
                </section>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/stratego-index.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/stratego-index.js') ?: time() ?>"></script>
</body>
</html>
