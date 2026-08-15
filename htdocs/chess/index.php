<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Chess - wowiekowie.com';
$metaDescription = 'Create guest chess games, copy challenge links, and continue browser-tied boards on wowiekowie.com.';
$pageStyles = ['/assets/css/chess.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell chess-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="chess-page" data-chess-lobby>
            <section class="chess-hero" aria-labelledby="chess-title">
                <p class="eyebrow">Chess lobby</p>
                <h1 id="chess-title">Chess challenge links.</h1>
                <p class="lede">Create a game, copy an invite, or reopen a board tied to this browser.</p>
            </section>

            <section class="chess-layout" aria-label="Chess lobby">
                <div class="chess-stack">
                    <section class="chess-panel" aria-labelledby="chess-new-game-title">
                        <div class="chess-section-heading">
                            <p class="eyebrow">New game</p>
                            <h2 id="chess-new-game-title">Start a board</h2>
                        </div>

                        <form class="chess-form chess-new-game-form" id="chess-new-game-form">
                            <label class="chess-field" for="chess-game-mode">
                                <span>Mode</span>
                                <select id="chess-game-mode" name="mode">
                                    <option value="online" selected>Online challenge link</option>
                                    <option value="bot">Computer opponent (moderate strength)</option>
                                    <option value="local">Local same-device game</option>
                                </select>
                            </label>

                            <label class="chess-field" for="chess-creator-color">
                                <span>Your color</span>
                                <select id="chess-creator-color" name="creator_color">
                                    <option value="white" selected>White</option>
                                    <option value="black">Black</option>
                                    <option value="random">Random</option>
                                </select>
                            </label>

                            <button class="chess-button chess-button-primary" type="submit" id="chess-new-game-button">
                                New game
                            </button>
                        </form>

                        <div class="chess-copy-box" id="chess-link-box" hidden>
                            <label class="chess-field" for="chess-join-url">
                                <span>Challenge link</span>
                                <input id="chess-join-url" type="text" readonly>
                            </label>
                            <button class="chess-button" type="button" id="chess-copy-link-button">Copy link</button>
                            <a class="chess-text-link" id="chess-open-game-link" href="/chess/" hidden>Open game</a>
                        </div>

                        <p class="chess-message" id="chess-create-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="chess-panel" aria-labelledby="chess-games-title">
                        <div class="chess-section-heading">
                            <p class="eyebrow">Your boards</p>
                            <h2 id="chess-games-title">Browser-tied games</h2>
                        </div>

                        <div class="chess-games-list" id="chess-games-list" aria-live="polite">
                            <p class="lede chess-state-message chess-state-message-loading">Loading your browser-tied games...</p>
                        </div>
                    </section>
                </div>

                <aside class="chess-panel chess-identity-panel" aria-labelledby="chess-profile-title">
                    <div class="chess-section-heading">
                        <p class="eyebrow">Guest badge</p>
                        <h2 id="chess-profile-title">Display name</h2>
                    </div>

                    <p class="chess-identity-current">
                        Playing as <strong id="chess-current-name">Guest player</strong>
                    </p>

                    <form class="chess-form" id="chess-profile-form">
                        <label class="chess-field" for="chess-display-name">
                            <span>Name</span>
                            <input id="chess-display-name" name="display_name" type="text" maxlength="40" autocomplete="nickname" placeholder="Guest player">
                        </label>
                        <button class="chess-button" type="submit" id="chess-save-name-button">Save name</button>
                    </form>

                    <p class="chess-message" id="chess-profile-message" role="status" aria-live="polite"></p>
                </aside>
            </section>

            <p class="chess-alert" id="chess-join-message" role="alert" hidden></p>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/chess-index.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/chess-index.js') ?: time() ?>"></script>
</body>
</html>
