<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Murder Trivia Party - wowiekowie.com';
$metaDescription = 'Play a live haunted trivia party with killing-floor minigames and a ghost-race finale.';
$pageStyles = ['/assets/css/trivia.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell trivia-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="trivia-page trivia-game-page" data-trivia-game>
            <section class="trivia-hero trivia-game-hero" aria-labelledby="trivia-game-title">
                <p class="eyebrow">Murder trivia party</p>
                <h1 id="trivia-game-title">Outsmart the mansion.</h1>
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

                    <figure class="trivia-scene" id="trivia-scene" data-phase="waiting">
                        <img id="trivia-scene-image" src="/assets/img/trivia/murder-trivia-lobby.png" alt="Friendly ghosts and skeletons gathering around a glowing question mark in a haunted game room.">
                        <figcaption class="trivia-scene-caption">
                            <span id="trivia-phase-label">The lobby</span>
                            <strong id="trivia-phase-title">Gather the living</strong>
                        </figcaption>
                    </figure>

                    <p class="trivia-phase-instructions" id="trivia-phase-instructions">Share the invite links. The host can begin when at least two souls are seated.</p>

                    <div class="trivia-timer" id="trivia-timer" aria-label="Round timer">
                        <span id="trivia-timer-value">--</span>
                        <span>seconds</span>
                    </div>

                    <section class="trivia-prompt" aria-labelledby="trivia-question-text">
                        <p class="eyebrow" id="trivia-round-label">Round --</p>
                        <h2 id="trivia-question-text">Waiting for the first prompt.</h2>
                        <p class="trivia-message" id="trivia-round-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="trivia-memory-preview" id="trivia-memory-preview" aria-labelledby="trivia-memory-preview-title" role="status" aria-live="assertive" aria-atomic="true" hidden>
                        <p class="eyebrow">Memorize now</p>
                        <h3 id="trivia-memory-preview-title">These symbols vanish in five seconds</h3>
                        <div class="trivia-memory-symbols" id="trivia-memory-symbols"></div>
                    </section>

                    <form class="trivia-answer-form" id="trivia-answer-form">
                        <fieldset id="trivia-choice-fieldset">
                            <legend id="trivia-choice-legend">Choose an answer</legend>
                            <div class="trivia-choice-grid" id="trivia-choice-grid"></div>
                        </fieldset>
                        <button class="trivia-button trivia-button-primary" type="submit" id="trivia-submit-answer-button" disabled>Lock answer</button>
                    </form>

                    <div class="trivia-result-panel" id="trivia-result-panel" hidden></div>

                    <section class="trivia-race-panel" id="trivia-race-panel" aria-labelledby="trivia-race-title" hidden>
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Escape meter</p>
                            <h3 id="trivia-race-title">Body versus ghosts</h3>
                        </div>
                        <div class="trivia-race-track" id="trivia-race-track"></div>
                    </section>

                    <div class="trivia-host-actions trivia-game-host-actions" id="trivia-game-host-actions" hidden>
                        <button class="trivia-button trivia-button-primary" type="button" id="trivia-start-game-button">Start game</button>
                        <button class="trivia-button" type="button" id="trivia-resolve-round-button">Resolve round</button>
                        <button class="trivia-button trivia-button-primary" type="button" id="trivia-advance-round-button">Next round</button>
                        <button class="trivia-button trivia-button-primary" type="button" id="trivia-replay-game-button">Play again</button>
                    </div>

                    <section class="trivia-rematch-panel" id="trivia-rematch-panel" aria-labelledby="trivia-rematch-title" hidden>
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Fresh room</p>
                            <h3 id="trivia-rematch-title">Copy these rematch invites now</h3>
                        </div>
                        <div class="trivia-invite-list" id="trivia-rematch-invites"></div>
                        <p class="trivia-message" id="trivia-rematch-message" role="status" aria-live="polite"></p>
                    </section>
                </div>

                <aside class="trivia-side-panel" aria-label="Trivia game details">
                    <section class="trivia-panel" aria-labelledby="trivia-game-roster-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Players</p>
                            <h2 id="trivia-game-roster-title">Survivors</h2>
                        </div>
                        <div class="trivia-roster" id="trivia-game-roster" aria-live="polite"></div>
                    </section>

                    <section class="trivia-panel" aria-labelledby="trivia-game-rejoin-title" id="trivia-rejoin-section" hidden>
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Recovery</p>
                            <h2 id="trivia-game-rejoin-title">Rejoin link</h2>
                        </div>
                        <label class="trivia-field" for="trivia-rejoin-url">
                            <span>Seat link</span>
                            <input id="trivia-rejoin-url" type="text" readonly>
                        </label>
                        <button class="trivia-button" type="button" id="trivia-copy-rejoin-button">Copy rejoin</button>
                        <p class="trivia-message" id="trivia-rejoin-message" role="status" aria-live="polite"></p>
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
                            <dt>Phase</dt>
                            <dd id="trivia-meta-phase">Lobby</dd>
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
