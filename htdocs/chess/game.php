<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Chess game - wowiekowie.com';
$metaDescription = 'Play a guest chess game with browser-tied seats on wowiekowie.com.';
$pageStyles = ['/assets/css/chess.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell chess-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="chess-page chess-game-page" data-chess-game>
            <section class="chess-hero chess-game-hero" aria-labelledby="chess-game-title">
                <p class="eyebrow">Chess board</p>
                <h1 id="chess-game-title">Chess game.</h1>
                <p class="lede" id="chess-game-summary">Loading the position, seats, and move history...</p>
            </section>

            <section class="chess-board-shell" aria-label="Chess game board and controls">
                <div class="chess-board-panel">
                    <div class="chess-board-frame">
                        <div class="chess-status-row chess-game-status-bar" aria-live="polite">
                            <p class="chess-alert" id="chess-game-error" role="alert" hidden></p>
                            <span class="chess-status-pill" id="chess-turn-status">Loading</span>
                            <span class="chess-status-pill" id="chess-rule-status">Waiting</span>
                            <span class="chess-status-pill" id="chess-control-status">Spectating</span>
                            <button class="chess-button chess-button-small" type="button" id="chess-takeback-button" hidden>Takeback</button>
                            <button class="chess-button chess-button-small" type="button" id="chess-resign-button" hidden>Resign</button>
                        </div>

                        <button class="chess-button chess-button-small chess-fullscreen-toggle" type="button" id="chess-fullscreen-toggle" aria-controls="chess-board" aria-expanded="false">Fullscreen board</button>
                        <div class="chess-board" id="chess-board" role="grid" aria-label="Chess board" aria-describedby="chess-board-help"></div>
                        <div class="chess-board-actions" id="chess-board-actions" aria-label="Fullscreen board controls">
                            <button class="chess-button chess-button-small" type="button" id="chess-fullscreen-exit">Exit fullscreen</button>
                        </div>
                        <p class="chess-board-help" id="chess-board-help">Select one of your pieces, then choose a highlighted square.</p>
                        <p class="chess-message" id="chess-board-message" role="status" aria-live="polite"></p>
                    </div>
                </div>

                <aside class="chess-move-panel" aria-label="Chess game details">
                    <section class="chess-game-detail-section" aria-labelledby="chess-players-title">
                        <div class="chess-section-heading">
                            <p class="eyebrow">Players</p>
                            <h2 id="chess-players-title">Seats</h2>
                        </div>

                        <dl class="chess-game-meta chess-player-meta">
                            <dt>White</dt>
                            <dd id="chess-white-player">White</dd>
                            <dt>Black</dt>
                            <dd id="chess-black-player">Black</dd>
                            <dt>You</dt>
                            <dd id="chess-viewer-player">Guest player</dd>
                        </dl>
                    </section>

                    <section class="chess-game-detail-section" aria-labelledby="chess-profile-title">
                        <div class="chess-section-heading">
                            <p class="eyebrow">Guest badge</p>
                            <h2 id="chess-profile-title">Display name</h2>
                        </div>

                        <p class="chess-identity-current">Playing as <strong id="chess-current-name">Guest player</strong></p>

                        <form class="chess-form" id="chess-profile-form">
                            <label class="chess-field" for="chess-display-name">
                                <span>Name</span>
                                <input id="chess-display-name" name="display_name" type="text" maxlength="40" autocomplete="nickname" placeholder="Guest player">
                            </label>
                            <button class="chess-button" type="submit" id="chess-save-name-button">Save name</button>
                        </form>

                        <label class="chess-field chess-notification-control" for="chess-move-notifications">
                            <span>Notifications</span>
                            <span><input id="chess-move-notifications" name="move_notifications" type="checkbox"> Alert me when it is my move</span>
                        </label>
                        <p class="chess-message" id="chess-notification-message" role="status" aria-live="polite"></p>
                        <p class="chess-message" id="chess-profile-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="chess-game-detail-section" aria-labelledby="chess-history-title">
                        <div class="chess-section-heading">
                            <p class="eyebrow">Moves</p>
                            <h2 id="chess-history-title">History</h2>
                        </div>

                        <div class="chess-move-list" id="chess-move-list" aria-live="polite">
                            <p class="lede chess-state-message">No moves yet. The first move will appear here.</p>
                        </div>
                    </section>
                </aside>
            </section>

            <div class="chess-promotion-dialog" id="chess-promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="chess-promotion-title" hidden>
                <div class="chess-promotion-card">
                    <div class="chess-section-heading">
                        <p class="eyebrow">Promotion</p>
                        <h2 id="chess-promotion-title">Choose a piece</h2>
                    </div>
                    <div class="chess-promotion-options" id="chess-promotion-options"></div>
                    <button class="chess-button chess-button-small" type="button" id="chess-promotion-cancel">Cancel</button>
                </div>
            </div>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/chess-game.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/chess-game.js') ?: time() ?>"></script>
</body>
</html>
