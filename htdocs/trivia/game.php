<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Trivia game - wowiekowie.com';
$metaDescription = 'Play a live shared-link trivia elimination game on wowiekowie.com.';
$pageStyles = ['/assets/css/trivia.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell trivia-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="trivia-page trivia-game-page" data-trivia-game>
            <section class="trivia-hero trivia-game-hero" aria-labelledby="trivia-game-title">
                <p class="eyebrow">Live trivia</p>
                <h1 id="trivia-game-title">Timed question table.</h1>
                <p class="lede" id="trivia-game-summary">Loading the room, roster, and current prompt...</p>
            </section>

            <p class="trivia-alert" id="trivia-game-error" role="alert" hidden></p>

            <section class="trivia-game-layout" aria-label="Trivia game board and controls">
                <div class="trivia-question-panel">
                    <div class="trivia-status-row" aria-live="polite">
                        <span class="trivia-status-pill" id="trivia-room-status">Loading</span>
                        <span class="trivia-status-pill" id="trivia-player-status">Spectating</span>
                        <span class="trivia-status-pill" id="trivia-answer-status">Waiting</span>
                    </div>

                    <div class="trivia-timer" aria-label="Round timer">
                        <span id="trivia-timer-value">--</span>
                        <span>seconds</span>
                    </div>

                    <section class="trivia-prompt" aria-labelledby="trivia-question-text">
                        <p class="eyebrow" id="trivia-round-label">Round --</p>
                        <h2 id="trivia-question-text">Waiting for the first prompt.</h2>
                        <p class="trivia-message" id="trivia-round-message" role="status" aria-live="polite"></p>
                    </section>

                    <form class="trivia-answer-form" id="trivia-answer-form">
                        <fieldset id="trivia-choice-fieldset">
                            <legend>Choose an answer</legend>
                            <div class="trivia-choice-grid" id="trivia-choice-grid"></div>
                        </fieldset>
                        <button class="trivia-button trivia-button-primary" type="submit" id="trivia-submit-answer-button" disabled>Lock answer</button>
                    </form>

                    <div class="trivia-result-panel" id="trivia-result-panel" hidden></div>

                    <div class="trivia-host-actions trivia-game-host-actions" id="trivia-game-host-actions" hidden>
                        <button class="trivia-button" type="button" id="trivia-resolve-round-button">Resolve round</button>
                        <button class="trivia-button trivia-button-primary" type="button" id="trivia-advance-round-button">Next round</button>
                    </div>
                </div>

                <aside class="trivia-side-panel" aria-label="Trivia game details">
                    <section class="trivia-panel" aria-labelledby="trivia-game-roster-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Players</p>
                            <h2 id="trivia-game-roster-title">Survivors</h2>
                        </div>
                        <div class="trivia-roster" id="trivia-game-roster" aria-live="polite"></div>
                    </section>

                    <section class="trivia-panel" aria-labelledby="trivia-game-meta-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Table</p>
                            <h2 id="trivia-game-meta-title">Room details</h2>
                        </div>
                        <dl class="trivia-game-meta">
                            <dt>Players</dt>
                            <dd id="trivia-meta-players">--</dd>
                            <dt>Round</dt>
                            <dd id="trivia-meta-round">--</dd>
                            <dt>Answers</dt>
                            <dd id="trivia-meta-answers">--</dd>
                            <dt>You</dt>
                            <dd id="trivia-meta-viewer">Spectator</dd>
                        </dl>
                        <a class="trivia-text-link" href="/trivia/">Back to lobby</a>
                    </section>
                </aside>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/trivia-game.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/trivia-game.js') ?: time() ?>"></script>
</body>
</html>
