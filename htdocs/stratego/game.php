<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Stratego game - wowiekowie.com';
$metaDescription = 'Deploy your army and play a hidden-information Stratego game against a friend on wowiekowie.com.';
$pageStyles = ['/assets/css/stratego.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell stratego-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="stratego-page stratego-game-page" data-stratego-game data-phase="loading">
            <section class="stratego-hero stratego-game-hero" aria-labelledby="stratego-game-title">
                <p class="eyebrow"><a class="stratego-text-link" href="/stratego/">Stratego lobby</a></p>
                <h1 id="stratego-game-title">Stratego game.</h1>
                <p class="lede" id="stratego-game-summary">Loading the battlefield...</p>
            </section>

            <section class="stratego-board-shell" aria-label="Stratego board and controls">
                <div class="stratego-board-panel">
                    <div class="stratego-status-row" aria-live="polite">
                        <span class="stratego-status-pill" id="stratego-turn-status" data-tone="neutral">Loading</span>
                        <span class="stratego-status-pill" id="stratego-phase-status">Loading</span>
                        <span class="stratego-status-pill" id="stratego-seat-status">Spectating</span>
                        <button class="stratego-button stratego-button-small stratego-button-danger" type="button" id="stratego-resign-button" hidden>Resign</button>
                    </div>

                    <p class="stratego-alert" id="stratego-game-error" role="alert" hidden></p>
                    <p class="stratego-combat-banner" id="stratego-combat-banner" role="status" aria-live="polite" hidden></p>

                    <div class="stratego-board" id="stratego-board" role="grid" aria-label="Stratego board" aria-describedby="stratego-board-help"></div>

                    <p class="stratego-board-help" id="stratego-board-help">Use the arrow keys to move between squares. Press Enter to select.</p>
                    <p class="stratego-message" id="stratego-board-message" role="status" aria-live="polite"></p>
                </div>

                <aside class="stratego-side-panel" aria-label="Stratego game details">
                    <section class="stratego-detail-section" id="stratego-result-section" aria-labelledby="stratego-result-title" hidden>
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Game over</p>
                            <h2 id="stratego-result-title">Result</h2>
                        </div>
                        <p class="stratego-result" id="stratego-result-text"></p>
                    </section>

                    <section class="stratego-detail-section" id="stratego-invite-section" aria-labelledby="stratego-invite-title" hidden>
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Invite</p>
                            <h2 id="stratego-invite-title">Waiting for an opponent</h2>
                        </div>
                        <p class="stratego-note">Send this link to your opponent. The game starts with setup once they join.</p>
                        <label class="stratego-field" for="stratego-invite-url">
                            <span>Invite link</span>
                            <input id="stratego-invite-url" type="text" readonly>
                        </label>
                        <div class="stratego-button-row">
                            <button class="stratego-button" type="button" id="stratego-copy-invite-button" disabled>Copy</button>
                            <button class="stratego-button stratego-button-small" type="button" id="stratego-new-invite-button">New link</button>
                        </div>
                        <p class="stratego-message" id="stratego-invite-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="stratego-detail-section" id="stratego-setup-section" aria-labelledby="stratego-setup-title" hidden>
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Deployment</p>
                            <h2 id="stratego-setup-title">Place your army</h2>
                        </div>
                        <p class="stratego-note" id="stratego-setup-help">Pick a piece, then click a square in your four highlighted rows. Click a placed piece to return it to the tray.</p>
                        <p class="stratego-setup-count" id="stratego-setup-count">0 / 40 placed</p>
                        <div class="stratego-tray" id="stratego-tray" role="group" aria-label="Pieces left to place"></div>
                        <div class="stratego-button-row">
                            <button class="stratego-button stratego-button-small" type="button" id="stratego-randomise-button">Randomise</button>
                            <button class="stratego-button stratego-button-small" type="button" id="stratego-clear-button">Clear</button>
                            <button class="stratego-button stratego-button-primary" type="button" id="stratego-ready-button" disabled>Ready</button>
                        </div>
                        <p class="stratego-status-pill" id="stratego-opponent-ready">Opponent is deploying</p>
                    </section>

                    <section class="stratego-detail-section" aria-labelledby="stratego-players-title">
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Players</p>
                            <h2 id="stratego-players-title">Armies</h2>
                        </div>
                        <dl class="stratego-meta">
                            <dt><span class="stratego-swatch stratego-swatch--red" aria-hidden="true"></span>Red</dt>
                            <dd id="stratego-red-player">Open seat</dd>
                            <dt><span class="stratego-swatch stratego-swatch--blue" aria-hidden="true"></span>Blue</dt>
                            <dd id="stratego-blue-player">Open seat</dd>
                            <dt>You</dt>
                            <dd id="stratego-viewer-player">Spectator</dd>
                        </dl>
                    </section>

                    <section class="stratego-detail-section" aria-labelledby="stratego-captured-title">
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Casualties</p>
                            <h2 id="stratego-captured-title">Captured pieces</h2>
                        </div>
                        <div class="stratego-captured" id="stratego-captured"></div>
                    </section>

                    <section class="stratego-detail-section" aria-labelledby="stratego-alerts-title">
                        <div class="stratego-section-heading">
                            <p class="eyebrow">Alerts</p>
                            <h2 id="stratego-alerts-title">Notifications</h2>
                        </div>
                        <label class="stratego-check" for="stratego-move-notifications">
                            <input id="stratego-move-notifications" name="move_notifications" type="checkbox">
                            <span>Alert me when it is my turn</span>
                        </label>
                        <p class="stratego-message" id="stratego-notification-message" role="status" aria-live="polite"></p>
                    </section>
                </aside>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/stratego-game.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/stratego-game.js') ?: time() ?>"></script>
</body>
</html>
