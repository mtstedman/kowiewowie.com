<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Risk - wowiekowie.com';
$metaDescription = 'Play classic Risk on the 42-territory world board against one to five game-tree bots, with territory cards and animated dice.';
$pageStyles = ['/assets/css/risk.css'];
$dongerCatalog = require dirname(__DIR__) . '/dongs/dongers.php';
$riskAvatarCatalog = array_map(
    static fn (array $donger): array => [
        'name' => $donger['name'],
        'text' => $donger['text'],
    ],
    $dongerCatalog
);
$riskAvatarCatalogJson = json_encode(
    $riskAvatarCatalog,
    JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
);
$riskMapPath = dirname(__DIR__) . '/assets/img/risk-map.svg';
$riskMapSvg = is_readable($riskMapPath) ? (string) file_get_contents($riskMapPath) : '';
$riskMapSvg = (string) preg_replace('/^\s*<\?xml[^>]*>\s*/', '', $riskMapSvg);
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell risk-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="risk-page" data-risk-game>
            <section class="risk-hero" aria-labelledby="risk-title">
                <p class="eyebrow">Risk table</p>
                <h1 id="risk-title">Risk: world domination</h1>
                <p class="lede">The classic 42-territory world board, played solo against one to five bots that plan their turns with a game-tree search. Deploy, trade cards, roll real Risk dice, and be the last seat standing.</p>
            </section>

            <section class="risk-layout" aria-label="Playable Risk game">
                <section class="risk-panel risk-board-panel" aria-labelledby="risk-board-title">
                    <div class="risk-panel-heading">
                        <div>
                            <p class="eyebrow">World map</p>
                            <h2 id="risk-board-title">Territories</h2>
                        </div>
                        <div class="risk-turn-summary" aria-label="Current game state">
                            <span>Turn <strong id="risk-turn-value">0</strong></span>
                            <span id="risk-phase-value">Ready</span>
                        </div>
                    </div>

                    <div class="risk-scoreboard" aria-label="Territory counts, cards and player avatars">
                        <div id="risk-scoreboard-seats" class="risk-scoreboard-seats"></div>
                        <span class="risk-reserve"><strong id="risk-reinforcements-value">0</strong> <small id="risk-reinforcements-owner" class="risk-reserve-owner">Armies to place</small></span>
                    </div>

                    <p id="risk-map-hint" class="risk-map-hint" hidden><span aria-hidden="true">&#8644;</span> The map is wider than the screen: scroll it sideways to see every territory.</p>
                    <div id="risk-map" class="risk-map"><?= $riskMapSvg ?></div>
                    <p id="risk-status-message" class="risk-status-message">Start a new game to deal the world.</p>
                    <p class="risk-map-legend">
                        <span id="risk-legend-owners" class="risk-legend-owners"></span>
                        <span><strong>FROM</strong> / <strong>TO</strong> mark source and target</span>
                        <span>Blue ring: territory you can act from</span>
                        <span>Dashed ring: legal destination</span>
                        <span>Dashed gold line: sea route</span>
                    </p>
                    <p id="risk-announcer" class="risk-visually-hidden" role="status" aria-live="polite" aria-atomic="true"></p>
                </section>

                <aside class="risk-panel risk-command-panel" aria-labelledby="risk-command-title" data-phase="setup">
                    <section class="risk-subpanel" aria-labelledby="risk-command-title">
                        <p class="eyebrow">Command</p>
                        <h2 id="risk-command-title">Game</h2>
                        <div class="risk-actions" aria-label="Risk game controls">
                            <label class="risk-opponent-field" for="risk-opponent-count">
                                <span>Opponents</span>
                                <select id="risk-opponent-count" class="risk-opponent-select" aria-describedby="risk-start-note">
                                    <option value="1" selected>1</option>
                                    <option value="2">2</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5</option>
                                </select>
                            </label>
                            <button class="risk-button risk-button-primary" type="button" id="risk-start-button" aria-describedby="risk-start-note">New game</button>
                            <button class="risk-button risk-button-invite" type="button" id="risk-invite-button" aria-describedby="risk-invite-note">Invite players</button>
                            <p id="risk-start-note" class="risk-start-note">New game deals the world with the setup below.</p>
                            <p id="risk-invite-note" class="risk-start-note">Invite players replaces the game on the table with an online lobby, one seat per opponent. Copy the invite link and send it to your friends: each friend who opens it takes the next open seat. When you press Start game, open seats become bots.</p>
                        </div>

                        <details id="risk-setup-panel" class="risk-subpanel risk-setup-settings" open>
                            <summary class="risk-setup-toggle">
                                <span id="risk-setup-title" class="risk-setup-heading">Game setup</span>
                                <span id="risk-setup-summary" class="risk-setup-summary">1 bot · Random placement · Incremental cards</span>
                            </summary>
                            <div class="risk-setup-body">
                                <fieldset id="risk-placement-options" class="risk-dice-choice risk-setting-choice">
                                    <legend>Placement</legend>
                                    <label><input type="radio" name="risk-placement" value="random" checked> Random</label>
                                    <label><input type="radio" name="risk-placement" value="manual"> Manual</label>
                                </fieldset>
                                <fieldset id="risk-card-mode-options" class="risk-dice-choice risk-setting-choice">
                                    <legend>Cards</legend>
                                    <label><input type="radio" name="risk-card-mode" value="incremental" checked> Incremental</label>
                                    <label><input type="radio" name="risk-card-mode" value="fixed"> Fixed</label>
                                </fieldset>
                                <p id="risk-setup-note" class="risk-setting-note">These settings are used when you press New game. Changes made during a game apply to the next game.</p>
                            </div>
                        </details>

                        <section id="risk-lobby-panel" class="risk-subpanel risk-lobby" aria-labelledby="risk-lobby-title" hidden>
                            <h3 id="risk-lobby-title">Online lobby</h3>
                            <p id="risk-lobby-status" class="risk-lobby-status" role="status" aria-live="polite" aria-atomic="true"></p>
                            <div id="risk-lobby-invite" class="risk-lobby-invite" hidden>
                                <label for="risk-invite-url">Invite link</label>
                                <div class="risk-lobby-link">
                                    <input id="risk-invite-url" class="risk-lobby-url" type="text" readonly spellcheck="false" autocomplete="off" aria-describedby="risk-lobby-note">
                                    <button class="risk-button" type="button" id="risk-invite-copy-button">Copy link</button>
                                </div>
                            </div>
                            <button class="risk-button" type="button" id="risk-invite-retry-button" hidden>Try again</button>
                            <ol id="risk-lobby-roster" class="risk-lobby-roster" aria-label="Seats in this online game"></ol>
                            <p id="risk-lobby-note" class="risk-lobby-note">Copy the invite link and send it to your friends: each friend who opens it takes the next open seat. When you press Start game, open seats become bots.</p>
                            <div class="risk-lobby-actions">
                                <button class="risk-button risk-button-primary" type="button" id="risk-lobby-start-button" hidden>Start game</button>
                                <button class="risk-button" type="button" id="risk-lobby-leave-button">Leave lobby</button>
                            </div>
                        </section>
                    </section>

                    <section class="risk-objective" aria-labelledby="risk-objective-label">
                        <p id="risk-objective-label" class="risk-objective-label">Current objective</p>
                        <h3 id="risk-objective-title">Ready to play</h3>
                        <p id="risk-objective-text" class="risk-objective-text">Choose your Game setup above, then press New game to deal the world.</p>
                        <p id="risk-objective-blocker" class="risk-objective-blocker" hidden></p>
                        <p id="risk-feedback" class="risk-feedback"></p>
                    </section>

                    <ol id="risk-phase-stepper" class="risk-phase-stepper" aria-label="Turn phases">
                        <li class="risk-phase-step is-active" data-phase="setup" aria-current="step">Setup</li>
                        <li class="risk-phase-step" data-phase="reinforce">Reinforce</li>
                        <li class="risk-phase-step" data-phase="attack">Attack</li>
                        <li class="risk-phase-step" data-phase="fortify">Fortify</li>
                    </ol>

                    <p id="risk-turn-guidance" class="risk-turn-guidance" aria-live="polite">Choose your game setup and start a new game.</p>
                    <div class="risk-primary-actions">
                        <button class="risk-button risk-button-primary" type="button" id="risk-end-button" disabled>End phase</button>
                    </div>

                    <section class="risk-subpanel risk-cards-panel" aria-labelledby="risk-cards-title" data-risk-phase-panel="reinforce,setup">
                        <h3 id="risk-cards-title">Reinforce</h3>
                        <button class="risk-button" type="button" id="risk-reinforce-button" disabled>Place all here</button>
                        <button class="risk-button" type="button" id="risk-auto-setup-button" disabled>Auto-place setup</button>
                        <p id="risk-trade-value" class="risk-trade-value">Next set: 4 armies</p>
                        <ul id="risk-hand" class="risk-hand" aria-label="Your territory cards"></ul>
                        <p id="risk-hand-help" class="risk-hand-help">Select three cards to trade during reinforcement.</p>
                        <button class="risk-button" type="button" id="risk-trade-button" disabled>Trade selected set</button>
                    </section>

                    <section class="risk-subpanel risk-attack-controls" aria-labelledby="risk-attack-title" data-risk-phase-panel="attack,conquer">
                        <h3 id="risk-attack-title">Battle</h3>
                        <fieldset id="risk-attack-dice-options" class="risk-dice-choice">
                            <legend>Attack dice</legend>
                            <label><input type="radio" name="risk-attack-dice" value="1"> 1</label>
                            <label><input type="radio" name="risk-attack-dice" value="2"> 2</label>
                            <label><input type="radio" name="risk-attack-dice" value="3" checked> 3</label>
                        </fieldset>
                        <button class="risk-button risk-button-attack" type="button" id="risk-attack-button" disabled>Roll attack</button>

                        <section id="risk-conquest-panel" class="risk-subpanel risk-subpanel-alert" aria-labelledby="risk-conquest-title" hidden>
                            <h3 id="risk-conquest-title">Territory conquered</h3>
                            <p id="risk-conquest-help">Choose how many armies move in.</p>
                            <div class="risk-inline-field">
                                <label for="risk-conquest-count">Armies to move</label>
                                <input id="risk-conquest-count" type="number" inputmode="numeric" min="1" max="1" step="1" value="1" aria-describedby="risk-conquest-help">
                                <button class="risk-button risk-button-primary" type="button" id="risk-conquest-button">Move armies</button>
                            </div>
                        </section>

                        <section id="risk-defense-panel" class="risk-subpanel risk-subpanel-alert" aria-labelledby="risk-defense-title" aria-describedby="risk-defense-help" hidden>
                            <h3 id="risk-defense-title">You are under attack</h3>
                            <p id="risk-defense-help">Choose your defense dice.</p>
                            <div class="risk-inline-field">
                                <button class="risk-button" type="button" id="risk-defend-one-button">Defend with 1 die</button>
                                <button class="risk-button risk-button-primary" type="button" id="risk-defend-two-button">Defend with 2 dice</button>
                            </div>
                        </section>
                        <label class="risk-check"><input type="checkbox" id="risk-auto-defend"> Always defend with maximum dice</label>

                        <section id="risk-dice-tray" class="risk-dice-tray" aria-labelledby="risk-dice-title">
                            <h3 id="risk-dice-title">Dice tray</h3>
                            <div class="risk-dice-side risk-dice-side-attack">
                                <span id="risk-dice-attack-label" class="risk-dice-label">Attacker</span>
                                <div id="risk-dice-attack" class="risk-dice-row"></div>
                            </div>
                            <div class="risk-dice-side risk-dice-side-defend">
                                <span id="risk-dice-defend-label" class="risk-dice-label">Defender</span>
                                <div id="risk-dice-defend" class="risk-dice-row"></div>
                            </div>
                            <ol id="risk-dice-comparisons" class="risk-dice-comparisons"></ol>
                            <p id="risk-dice-result" class="risk-dice-result">No battle yet.</p>
                        </section>
                    </section>

                    <section class="risk-subpanel" aria-labelledby="risk-fortify-title" data-risk-phase-panel="fortify">
                        <h3 id="risk-fortify-title">Fortify</h3>
                        <div class="risk-inline-field">
                            <label for="risk-fortify-count">Armies to move</label>
                            <input id="risk-fortify-count" type="number" inputmode="numeric" min="1" max="1" step="1" value="1" disabled>
                            <button class="risk-button" type="button" id="risk-fortify-button" disabled>Fortify</button>
                        </div>
                    </section>

                    <section class="risk-territory-card" aria-labelledby="risk-selection-title">
                        <h3 id="risk-selection-title">Selection</h3>
                        <figure id="risk-selection-figure" class="risk-selection-figure">
                            <img id="risk-selection-art" src="/assets/img/risk-selection-art.png" alt="" aria-hidden="true" decoding="async" loading="lazy">
                            <svg id="risk-selection-shape" class="risk-selection-shape" viewBox="0 0 40 40" aria-hidden="true" focusable="false"></svg>
                            <figcaption id="risk-selection-caption">Select a territory</figcaption>
                        </figure>
                        <div id="risk-territory-card">No territory selected.</div>
                    </section>

                    <details class="risk-log-panel" open>
                        <summary><h3 id="risk-log-title">Battle log</h3></summary>
                        <ol id="risk-log" class="risk-log"></ol>
                    </details>
                </aside>
            </section>

            <section class="risk-panel risk-rules" aria-labelledby="risk-rules-title">
                <p class="eyebrow">How to play</p>
                <h2 id="risk-rules-title">Classic rules against one to five bots</h2>
                <div class="risk-rules-grid">
                    <div>
                        <h3>Seats</h3>
                        <p>A game seats <strong>2 to 6 players</strong>. Pick <strong>1 to 5 bot opponents</strong> in the selector beside New game: you take seat 1 and every other seat is filled by a bot. Turns pass around the seats in order, from you to Bot 1 through the last bot, and each bot plans its moves with a game-tree search. With <strong>one bot</strong> the classic two-player variant applies: a third, neutral army holds territory and defends with the most dice allowed, but never takes turns, receives reinforcements, or holds cards, and leftover neutral territories do not need to be conquered. With <strong>two or more bots</strong> there is no neutral army. You win when you are the last seat standing and lose as soon as your last territory falls.</p>
                    </div>
                    <div>
                        <h3>Playing online</h3>
                        <p>Press <strong>Invite players</strong> to replace the game on the table with an online lobby, one seat per opponent. Copy the invite link and send it to your friends: each friend who opens it takes the next open seat. When you press <strong>Start game</strong>, open seats become bots. Reloading the lobby keeps the same invite link. Each player acts only on their own turn and sees only their own cards. Defenders always roll the most dice allowed. The host's browser plays the bot seats. If the host goes quiet for 20 seconds, another player's browser takes over the bots. Reload the page or reopen its link to return to your seat.</p>
                    </div>
                    <div>
                        <h3>Setup</h3>
                        <p>The 42 territories are dealt at random with one army on each. With one bot, you, Bot 1 and Neutral get 14 territories each and every color ends setup with 40 armies. With two, three, four or five bots, all 42 territories are dealt among the seats and every seat ends setup with 35, 30, 25 or 20 armies. The first player is chosen at random. With <strong>Random</strong> placement, every remaining army is spread at random, at most 4 per territory, and play starts at once. With <strong>Manual</strong> placement, the seats take turns adding two of their own armies per step, plus one neutral army in the one-bot game, until all armies are placed; Auto-place setup finishes your share at random, at most 4 per territory. The opponent count and Game setup choices apply when you start a new game.</p>
                    </div>
                    <div>
                        <h3>Reinforce</h3>
                        <p>At the start of each turn you receive your territories ÷ 3 (rounded down, minimum 3), plus bonuses for whole continents: North America 5, South America 2, Europe 5, Africa 3, Asia 7, Australia 2.</p>
                    </div>
                    <div>
                        <h3>Cards</h3>
                        <p>If you conquer at least one territory during your turn, including a neutral one, you draw one card at the end of it. Three of a kind, one of each, or any two cards plus a wild make a set. With <strong>Incremental</strong> cards, sets are worth 4, 6, 8, 10, 12 and 15 armies, then 5 more each time; this count is shared by every seat, so each trade raises the value of the next set for everyone. With <strong>Fixed</strong> cards, a set is always worth the same by type: 3 infantry 4, 3 cavalry 6, 3 artillery 8, one of each 10, and a wild counts as whichever gives the best value. Holding five or more cards forces a trade at the start of your turn. If you own a territory pictured on a traded card, it gets 2 extra armies (once per turn).</p>
                    </div>
                    <div>
                        <h3>Attack</h3>
                        <p>Attack a hostile territory that is adjacent or connected by a sea route. The attacker rolls 1–3 dice and must have more armies than dice; the defender rolls 1–2 dice, no more than their armies. Dice are sorted highest first and compared in pairs, with ties going to the defender. After a conquest, move in at least as many armies as dice you rolled, always leaving one behind. You choose your defense dice when a bot attacks you; bots and the neutral army always defend with the most dice allowed.</p>
                    </div>
                    <div>
                        <h3>Elimination</h3>
                        <p>A seat that loses its last territory is eliminated: the scoreboard marks it and it drops out of the turn order. The seat that conquered it captures all of its cards. If that leaves the conqueror holding five or more, the forced trade applies at the start of its next turn.</p>
                    </div>
                    <div>
                        <h3>Fortify &amp; controls</h3>
                        <p>Once per turn, you may move any number of armies from one territory to another, as long as the route passes only through your own territories and at least one army stays behind. Click a territory or its marker, or Tab to a marker and press Enter. On narrow screens, scroll the board sideways.</p>
                    </div>
                </div>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script id="risk-avatar-catalog" type="application/json"><?= $riskAvatarCatalogJson ?></script>
    <script type="module" src="/assets/js/risk-game.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/risk-game.js') ?: time() ?>"></script>
</body>
</html>
