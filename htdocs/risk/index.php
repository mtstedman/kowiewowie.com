<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Risk - wowiekowie.com';
$metaDescription = 'Play classic Risk on the 42-territory world board against the browser, with a neutral army, territory cards and animated dice.';
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
                <p class="lede">The classic 42-territory world board, played solo against the browser with a neutral third army. Deploy, trade cards, roll real Risk dice, and eliminate your rival.</p>
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
                        <span class="risk-scoreboard-side owner-human">
                            <span class="risk-owner-glyph" aria-hidden="true">&#9679;</span>
                            <strong id="risk-human-count">0</strong> Player
                            <span class="risk-scoreboard-cards"><strong id="risk-human-cards">0</strong> cards</span>
                            <span class="risk-scoreboard-avatar">
                                <span class="risk-scoreboard-avatar-name">Avatar: <span id="risk-human-avatar-name">Assigned when a game starts</span></span>
                                <span id="risk-human-avatar-face" class="risk-scoreboard-avatar-face" aria-label="Player avatar face">—</span>
                            </span>
                        </span>
                        <span class="risk-scoreboard-side owner-ai">
                            <span class="risk-owner-glyph" aria-hidden="true">&#9670;</span>
                            <strong id="risk-ai-count">0</strong> Browser
                            <span class="risk-scoreboard-cards"><strong id="risk-ai-cards">0</strong> cards</span>
                            <span class="risk-scoreboard-avatar">
                                <span class="risk-scoreboard-avatar-name">Avatar: <span id="risk-ai-avatar-name">Assigned when a game starts</span></span>
                                <span id="risk-ai-avatar-face" class="risk-scoreboard-avatar-face" aria-label="Browser avatar face">—</span>
                            </span>
                        </span>
                        <span class="owner-neutral"><span class="risk-owner-glyph" aria-hidden="true">&#9632;</span><strong id="risk-neutral-count">0</strong> Neutral</span>
                        <span><strong id="risk-reinforcements-value">0</strong> To place</span>
                    </div>

                    <div id="risk-map" class="risk-map"><?= $riskMapSvg ?></div>
                    <p class="risk-map-legend">
                        <span><span class="risk-owner-glyph owner-human" aria-hidden="true">&#9679;</span> Player circle</span>
                        <span><span class="risk-owner-glyph owner-ai" aria-hidden="true">&#9670;</span> Browser diamond</span>
                        <span><span class="risk-owner-glyph owner-neutral" aria-hidden="true">&#9632;</span> Neutral square</span>
                        <span><strong>FROM</strong> / <strong>TO</strong> mark source and target</span>
                        <span>Dashed ring: legal destination</span>
                        <span>Dashed gold line: sea route</span>
                    </p>
                    <p id="risk-status-message" class="risk-status-message" role="status" aria-live="polite">Start a new game to deal the world.</p>

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
                        <p id="risk-dice-result" class="risk-dice-result" aria-live="polite">No battle yet.</p>
                    </section>
                </section>

                <aside class="risk-panel risk-command-panel" aria-labelledby="risk-command-title">
                    <div class="risk-panel-heading">
                        <div>
                            <p class="eyebrow">Command</p>
                            <h2 id="risk-command-title">Turn actions</h2>
                        </div>
                    </div>

                    <div class="risk-actions" aria-label="Risk game controls">
                        <button class="risk-button risk-button-primary" type="button" id="risk-start-button">New game</button>
                        <button class="risk-button" type="button" id="risk-end-button" disabled>End phase</button>
                        <button class="risk-button" type="button" id="risk-reinforce-button" disabled>Place all here</button>
                        <button class="risk-button" type="button" id="risk-auto-setup-button" disabled>Auto-place setup</button>
                    </div>

                    <section class="risk-subpanel risk-attack-controls" aria-labelledby="risk-attack-title">
                        <h3 id="risk-attack-title">Attack</h3>
                        <fieldset id="risk-attack-dice-options" class="risk-dice-choice">
                            <legend>Attack dice</legend>
                            <label><input type="radio" name="risk-attack-dice" value="1"> 1</label>
                            <label><input type="radio" name="risk-attack-dice" value="2"> 2</label>
                            <label><input type="radio" name="risk-attack-dice" value="3" checked> 3</label>
                        </fieldset>
                        <button class="risk-button risk-button-attack" type="button" id="risk-attack-button" disabled>Roll attack</button>
                    </section>

                    <section id="risk-conquest-panel" class="risk-subpanel risk-subpanel-alert" aria-labelledby="risk-conquest-title" hidden>
                        <h3 id="risk-conquest-title">Territory conquered</h3>
                        <p id="risk-conquest-help">Choose how many armies move in.</p>
                        <div class="risk-inline-field">
                            <label for="risk-conquest-count">Armies to move</label>
                            <input id="risk-conquest-count" type="number" inputmode="numeric" min="1" max="1" step="1" value="1">
                            <button class="risk-button risk-button-primary" type="button" id="risk-conquest-button">Move armies</button>
                        </div>
                    </section>

                    <section id="risk-defense-panel" class="risk-subpanel risk-subpanel-alert" aria-labelledby="risk-defense-title" hidden>
                        <h3 id="risk-defense-title">You are under attack</h3>
                        <p id="risk-defense-help">Choose your defense dice.</p>
                        <div class="risk-inline-field">
                            <button class="risk-button" type="button" id="risk-defend-one-button">Defend with 1 die</button>
                            <button class="risk-button risk-button-primary" type="button" id="risk-defend-two-button">Defend with 2 dice</button>
                        </div>
                    </section>
                    <label class="risk-check"><input type="checkbox" id="risk-auto-defend"> Always defend with maximum dice</label>

                    <section class="risk-subpanel" aria-labelledby="risk-fortify-title">
                        <h3 id="risk-fortify-title">Fortify</h3>
                        <div class="risk-inline-field">
                            <label for="risk-fortify-count">Armies to move</label>
                            <input id="risk-fortify-count" type="number" inputmode="numeric" min="1" max="1" step="1" value="1" disabled>
                            <button class="risk-button" type="button" id="risk-fortify-button" disabled>Fortify</button>
                        </div>
                    </section>

                    <section class="risk-subpanel risk-cards-panel" aria-labelledby="risk-cards-title">
                        <h3 id="risk-cards-title">Your cards</h3>
                        <p id="risk-trade-value" class="risk-trade-value">Next set: 4 armies</p>
                        <ul id="risk-hand" class="risk-hand" aria-label="Your territory cards"></ul>
                        <p id="risk-hand-help" class="risk-hand-help">Select three cards to trade during reinforcement.</p>
                        <button class="risk-button" type="button" id="risk-trade-button" disabled>Trade selected set</button>
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

                    <section class="risk-log-panel" aria-labelledby="risk-log-title">
                        <h3 id="risk-log-title">Battle log</h3>
                        <ol id="risk-log" class="risk-log"></ol>
                    </section>
                </aside>
            </section>

            <section class="risk-panel risk-rules" aria-labelledby="risk-rules-title">
                <p class="eyebrow">How to play</p>
                <h2 id="risk-rules-title">Classic two-player rules with a neutral army</h2>
                <div class="risk-rules-grid">
                    <div>
                        <h3>Variant</h3>
                        <p>You and the Browser are the only active players. A third, neutral army holds territory and defends with the most dice allowed, but never takes turns, receives reinforcements, or holds cards. You win by eliminating the Browser; leftover neutral territories do not need to be conquered.</p>
                    </div>
                    <div>
                        <h3>Setup</h3>
                        <p>The 42 territories are dealt at random: 14 each to you, the Browser and Neutral, with one army on each. Each placement step, the active player adds two of their own armies and one neutral army. Steps alternate until every color has 40 armies. The first player is chosen at random.</p>
                    </div>
                    <div>
                        <h3>Reinforce</h3>
                        <p>At the start of each turn you receive your territories ÷ 3 (rounded down, minimum 3), plus bonuses for whole continents: North America 5, South America 2, Europe 5, Africa 3, Asia 7, Australia 2.</p>
                    </div>
                    <div>
                        <h3>Cards</h3>
                        <p>If you conquer at least one territory during your turn, including a neutral one, you draw one card at the end of it. Three of a kind, one of each, or any two cards plus a wild make a set. Sets are worth 4, 6, 8, 10, 12 and 15 armies, then 5 more each time; this count is shared by both players. Holding five or more cards forces a trade at the start of your turn. If you own a territory pictured on a traded card, it gets 2 extra armies (once per turn).</p>
                    </div>
                    <div>
                        <h3>Attack</h3>
                        <p>Attack a hostile territory that is adjacent or connected by a sea route. The attacker rolls 1–3 dice and must have more armies than dice; the defender rolls 1–2 dice, no more than their armies. Dice are sorted highest first and compared in pairs, with ties going to the defender. After a conquest, move in at least as many armies as dice you rolled, always leaving one behind.</p>
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
