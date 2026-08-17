<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Trivia - wowiekowie.com';
$metaDescription = 'Create a shared-link elimination trivia room for 2 to 6 players on wowiekowie.com.';
$pageStyles = ['/assets/css/trivia.css'];
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell trivia-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="trivia-page" data-trivia-lobby>
            <section class="trivia-hero" aria-labelledby="trivia-title">
                <p class="eyebrow">Trivia lobby</p>
                <h1 id="trivia-title">Shared-link elimination trivia.</h1>
                <p class="lede">Host a timed question room for 2 to 6 players, share the join link, and keep going until one survivor remains.</p>
            </section>

            <p class="trivia-alert" id="trivia-join-message" role="alert" hidden></p>

            <section class="trivia-layout" aria-label="Trivia lobby">
                <div class="trivia-stack">
                    <section class="trivia-panel" aria-labelledby="trivia-new-room-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">New room</p>
                            <h2 id="trivia-new-room-title">Host a table</h2>
                        </div>

                        <form class="trivia-form trivia-new-room-form" id="trivia-new-room-form">
                            <label class="trivia-field" for="trivia-max-players">
                                <span>Players</span>
                                <select id="trivia-max-players" name="max_players">
                                    <option value="2">2 players</option>
                                    <option value="3">3 players</option>
                                    <option value="4" selected>4 players</option>
                                    <option value="5">5 players</option>
                                    <option value="6">6 players</option>
                                </select>
                            </label>

                            <label class="trivia-field" for="trivia-answer-window">
                                <span>Timer</span>
                                <select id="trivia-answer-window" name="answer_window_seconds">
                                    <option value="15">15 seconds</option>
                                    <option value="30" selected>30 seconds</option>
                                    <option value="45">45 seconds</option>
                                    <option value="60">60 seconds</option>
                                </select>
                            </label>

                            <button class="trivia-button trivia-button-primary" type="submit" id="trivia-new-room-button">Create room</button>
                        </form>

                        <div class="trivia-copy-box" id="trivia-link-box" hidden>
                            <label class="trivia-field" for="trivia-join-url">
                                <span>Join link</span>
                                <input id="trivia-join-url" type="text" readonly>
                            </label>
                            <button class="trivia-button" type="button" id="trivia-copy-link-button">Copy link</button>
                            <a class="trivia-text-link" id="trivia-open-game-link" href="/trivia/game.php" hidden>Open room</a>
                        </div>

                        <div class="trivia-copy-box" id="trivia-rejoin-box" hidden>
                            <label class="trivia-field" for="trivia-rejoin-url">
                                <span>Your rejoin link</span>
                                <input id="trivia-rejoin-url" type="text" readonly>
                            </label>
                            <button class="trivia-button" type="button" id="trivia-copy-rejoin-button">Copy rejoin</button>
                            <a class="trivia-text-link" id="trivia-open-rejoin-link" href="/trivia/game.php" hidden>Open rejoin</a>
                        </div>

                        <div class="trivia-invite-list" id="trivia-invite-list" hidden></div>

                        <p class="trivia-message" id="trivia-create-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="trivia-panel" aria-labelledby="trivia-roster-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Room state</p>
                            <h2 id="trivia-roster-title">Roster and readiness</h2>
                        </div>

                        <div class="trivia-room-summary" id="trivia-room-summary" aria-live="polite">
                            <p class="lede trivia-state-message">Create a room or claim an invite to see the roster here.</p>
                        </div>
                        <div class="trivia-roster" id="trivia-roster" aria-live="polite"></div>
                        <div class="trivia-host-actions" id="trivia-host-actions" hidden>
                            <button class="trivia-button trivia-button-primary" type="button" id="trivia-start-button">Start game</button>
                            <a class="trivia-text-link" id="trivia-host-game-link" href="/trivia/game.php">Open live game</a>
                        </div>
                        <p class="trivia-message" id="trivia-roster-message" role="status" aria-live="polite"></p>
                    </section>

                    <section class="trivia-panel" aria-labelledby="trivia-rooms-title">
                        <div class="trivia-section-heading">
                            <p class="eyebrow">Your rooms</p>
                            <h2 id="trivia-rooms-title">Saved trivia</h2>
                        </div>

                        <div class="trivia-room-list" id="trivia-room-list" aria-live="polite">
                            <p class="lede trivia-state-message trivia-state-message-loading">Loading your trivia rooms...</p>
                        </div>
                    </section>
                </div>

                <aside class="trivia-panel trivia-rules-panel" aria-labelledby="trivia-rules-title">
                    <div class="trivia-section-heading">
                        <p class="eyebrow">How it plays</p>
                        <h2 id="trivia-rules-title">Last correct player standing</h2>
                    </div>
                    <ul class="trivia-rule-list">
                        <li>Everyone sees the same timed prompt.</li>
                        <li>Wrong answers eliminate a player immediately.</li>
                        <li>Late answers do not count once the timer closes.</li>
                        <li>The host resolves and opens rounds until a winner remains.</li>
                    </ul>
                </aside>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="module" src="/assets/js/trivia-index.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/trivia-index.js') ?: time() ?>"></script>
</body>
</html>
