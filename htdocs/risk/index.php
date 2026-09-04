<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Risk - wowiekowie.com';
$metaDescription = 'Play a polished browser-only Risk strategy game on wowiekowie.com.';
$pageStyles = ['/assets/css/risk.css'];

$dongerCatalogPath = dirname(__DIR__) . '/dongs/dongers.php';
$dongerCatalog = is_file($dongerCatalogPath) ? (require $dongerCatalogPath) : [];
$riskAvatars = [];

if (is_array($dongerCatalog)) {
    foreach ($dongerCatalog as $donger) {
        if (!is_array($donger) || !isset($donger['name'], $donger['text']) || !is_string($donger['name']) || !is_string($donger['text'])) {
            continue;
        }

        $riskAvatars[] = [
            'name' => $donger['name'],
            'text' => $donger['text'],
        ];
    }
}

$riskAvatarBootData = json_encode(
    $riskAvatars,
    JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
) ?: '[]';
?>
<?php include dirname(__DIR__) . '/partials/head.php'; ?>
<body>
    <div class="page-shell risk-page-shell">
        <?php include dirname(__DIR__) . '/partials/header.php'; ?>

        <main class="risk-page" data-risk-game>
            <section class="risk-hero" aria-labelledby="risk-title">
                <p class="eyebrow">Risk table</p>
                <h1 id="risk-title">Risk command map</h1>
                <p class="lede">Reinforce your front, attack adjacent territory, fortify the line, and outlast the browser across a compact tactical map.</p>
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

                    <div class="risk-scoreboard" aria-label="Territory counts">
                        <div class="risk-identity" id="risk-human-identity" aria-label="Player, 0 territories">
                            <strong class="risk-identity-count" id="risk-human-count">0</strong>
                            <span class="risk-identity-details">
                                <span class="risk-identity-role">Player</span>
                                <span class="risk-avatar" id="risk-human-avatar" hidden>
                                    <span class="risk-avatar-face" id="risk-human-avatar-face" aria-hidden="true"></span>
                                    <span class="risk-avatar-name" id="risk-human-avatar-name"></span>
                                </span>
                            </span>
                        </div>
                        <div class="risk-identity" id="risk-ai-identity" aria-label="Browser, 0 territories">
                            <strong class="risk-identity-count" id="risk-ai-count">0</strong>
                            <span class="risk-identity-details">
                                <span class="risk-identity-role">Browser</span>
                                <span class="risk-avatar" id="risk-ai-avatar" hidden>
                                    <span class="risk-avatar-face" id="risk-ai-avatar-face" aria-hidden="true"></span>
                                    <span class="risk-avatar-name" id="risk-ai-avatar-name"></span>
                                </span>
                            </span>
                        </div>
                        <span class="risk-reinforcements"><strong id="risk-reinforcements-value">0</strong> Reinforcements</span>
                    </div>

                    <div id="risk-map" class="risk-map" role="group" aria-label="Risk territory map"></div>
                    <p id="risk-status-message" class="risk-status-message" role="status" aria-live="polite">Start a new game to deploy armies.</p>
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
                        <button class="risk-button" type="button" id="risk-reinforce-button" disabled>Reinforce</button>
                        <button class="risk-button" type="button" id="risk-attack-button" disabled>Attack</button>
                        <button class="risk-button" type="button" id="risk-fortify-button" disabled>Fortify</button>
                        <button class="risk-button" type="button" id="risk-end-button" disabled>End turn</button>
                    </div>

                    <section class="risk-territory-card" aria-labelledby="risk-selection-title">
                        <h3 id="risk-selection-title">Selection</h3>
                        <div id="risk-territory-card">No territory selected.</div>
                    </section>

                    <section class="risk-log-panel" aria-labelledby="risk-log-title">
                        <h3 id="risk-log-title">Battle log</h3>
                        <ol id="risk-log" class="risk-log" aria-live="polite"></ol>
                    </section>
                </aside>
            </section>
        </main>

        <?php include dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>

    <script type="application/json" id="risk-avatar-data"><?= $riskAvatarBootData ?></script>
    <script type="module" src="/assets/js/risk-game.js?v=<?= @filemtime(dirname(__DIR__) . '/assets/js/risk-game.js') ?: time() ?>"></script>
</body>
</html>
