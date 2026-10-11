<?php

declare(strict_types=1);

require __DIR__ . '/support/public-page.php';

$root = dirname(__DIR__);
$publicPages = [
    'htdocs/index.php' => ['requestUri' => '/', 'currentSection' => null],
    'htdocs/decks/index.php' => ['requestUri' => '/decks/', 'currentSection' => 'games'],
    'htdocs/decks/deck.php' => ['requestUri' => '/decks/deck.php', 'currentSection' => 'games'],
    'htdocs/decks/guides.php' => ['requestUri' => '/decks/guides.php', 'currentSection' => 'games'],
    'htdocs/decks/guide.php' => ['requestUri' => '/decks/guide.php', 'currentSection' => 'games'],
    'htdocs/chess/index.php' => ['requestUri' => '/chess/', 'currentSection' => 'games'],
    'htdocs/chess/game.php' => ['requestUri' => '/chess/game.php', 'currentSection' => 'games'],
    'htdocs/trivia/index.php' => ['requestUri' => '/trivia/', 'currentSection' => 'games'],
    'htdocs/trivia/game.php' => ['requestUri' => '/trivia/game.php', 'currentSection' => 'games'],
    'htdocs/dongs/index.php' => ['requestUri' => '/dongs/', 'currentSection' => 'dongs'],
    'htdocs/games/index.php' => ['requestUri' => '/games/', 'currentSection' => 'games'],
    'htdocs/games/game.php' => ['requestUri' => '/games/game.php', 'currentSection' => 'games'],
    'htdocs/music/index.php' => ['requestUri' => '/music/', 'currentSection' => 'music'],
    'htdocs/recipes/index.php' => ['requestUri' => '/recipes/', 'currentSection' => 'recipes'],
    'htdocs/recipes/recipe.php' => ['requestUri' => '/recipes/recipe.php', 'currentSection' => 'recipes'],
    'htdocs/videos/index.php' => ['requestUri' => '/videos/', 'currentSection' => 'videos'],
    'htdocs/videos/video.php' => ['requestUri' => '/videos/video.php', 'currentSection' => 'videos'],
];

$focusedHeaderPages = [
    'htdocs/login/index.php' => ['requestUri' => '/login/', 'currentSection' => null, 'gameAlias' => null],
    'htdocs/risk/index.php' => ['requestUri' => '/risk/', 'currentSection' => 'games', 'gameAlias' => '/risk/'],
    'htdocs/palworld/index.php' => ['requestUri' => '/palworld/', 'currentSection' => 'games', 'gameAlias' => '/palworld/'],
];

$currentSectionRequestUriCases = [
    ['requestUri' => null, 'currentSection' => null, 'label' => 'missing REQUEST_URI'],
    ['requestUri' => '', 'currentSection' => null, 'label' => 'empty REQUEST_URI'],
    ['requestUri' => '/?section=recipes', 'currentSection' => null, 'label' => 'home query string'],
    ['requestUri' => '/#recipes', 'currentSection' => null, 'label' => 'home fragment'],
    ['requestUri' => '/recipes/?section=decks#videos', 'currentSection' => 'recipes', 'label' => 'section path with query and fragment'],
    ['requestUri' => '/recipes/recipe.php?section=decks#videos', 'currentSection' => 'recipes', 'label' => 'detail path with query and fragment'],
    ['requestUri' => '/not-recipes/', 'currentSection' => null, 'label' => 'unrelated path'],
    ['requestUri' => '/deck/', 'currentSection' => null, 'label' => 'unknown near-match path'],
    ['requestUri' => '/recipes-and-more/', 'currentSection' => null, 'label' => 'unknown prefix path'],
];

function primary_nav_html(string $html, string $context): string
{
    public_ux_assert(
        (bool) preg_match('/<nav class="site-nav" aria-label="Primary navigation">.*?<\/nav>/s', $html, $matches),
        $context . ' is missing primary navigation.'
    );

    return $matches[0];
}

function assert_primary_nav_current(string $html, ?string $expectedSection, string $context): void
{
    $navHtml = primary_nav_html($html, $context);
    preg_match_all('/<a\b[^>]*>/i', $navHtml, $linkMatches);

    $currentLinks = [];
    foreach ($linkMatches[0] as $link) {
        if (strpos($link, 'aria-current="page"') !== false) {
            $currentLinks[] = $link;
        }
    }

    $expectedCount = $expectedSection === null ? 0 : 1;
    public_ux_assert(
        substr_count($navHtml, 'aria-current') === $expectedCount,
        $context . ' must render aria-current only on the expected primary nav link.'
    );
    public_ux_assert(
        count($currentLinks) === $expectedCount,
        $context . ' must render exactly ' . $expectedCount . ' primary nav aria-current="page" links.'
    );

    if ($expectedSection !== null) {
        $expectedHref = 'href="/' . $expectedSection . '/"';
        public_ux_assert(
            strpos($currentLinks[0], $expectedHref) !== false,
            $context . ' current primary nav link must target ' . $expectedSection . '.'
        );
    }
}

function games_subnav_links(string $html, string $context): array
{
    public_ux_assert(
        (bool) preg_match('/<nav class="games-subnav" aria-label="Games navigation">.*?<\/nav>/s', $html, $matches),
        $context . ' is missing the games sub-navigation.'
    );
    preg_match_all('/<a\b[^>]*>/i', $matches[0], $linkMatches);

    return $linkMatches[0];
}

function assert_games_subnav_current(string $html, string $expectedPath, string $context): void
{
    $expectedLinks = [];
    $currentLinks = [];
    foreach (games_subnav_links($html, $context) as $link) {
        if (strpos($link, 'href="' . $expectedPath . '"') !== false) {
            $expectedLinks[] = $link;
        }
        if (strpos($link, 'aria-current="page"') !== false) {
            $currentLinks[] = $link;
        }
    }

    public_ux_assert(count($expectedLinks) === 1, $context . ' games sub-navigation must render exactly one ' . $expectedPath . ' link.');
    public_ux_assert(
        count($currentLinks) === 1 && $currentLinks[0] === $expectedLinks[0],
        $context . ' games sub-navigation must mark only ' . $expectedPath . ' aria-current="page".'
    );
}

function assert_account_header(string $html, bool $expectLoginCurrent, string $context): void
{
    public_ux_assert(substr_count($html, 'class="site-account-view" data-account-view=') === 4, $context . ' must render all account states.');
    public_ux_assert((bool) preg_match('/data-account-view="loading" hidden/', $html), $context . ' loading account state must start hidden.');
    public_ux_assert((bool) preg_match('/data-account-view="signed-out">/', $html), $context . ' signed-out account state must start visible.');
    public_ux_assert((bool) preg_match('/data-account-view="authenticated" hidden/', $html), $context . ' authenticated account state must start hidden.');
    public_ux_assert((bool) preg_match('/data-account-view="error" hidden/', $html), $context . ' error account state must start hidden.');
    public_ux_assert(
        (bool) preg_match('/data-account-login-link' . ($expectLoginCurrent ? ' aria-current="page"' : '') . '>Log in<\/a>/', $html),
        $context . ' login control current state is incorrect.'
    );
}

foreach ($publicPages as $scriptPath => $routeExpectation) {
    $html = render_public_page($root, $scriptPath, $routeExpectation['requestUri']);
    $skipLink = '<a class="skip-link" href="#main-content">Skip to main content</a>';
    $skipTarget = '<span id="main-content" class="skip-target" tabindex="-1"></span>';
    $skipPosition = strpos($html, $skipLink);
    $navPosition = strpos($html, '<nav class="site-nav" aria-label="Primary navigation">');

    public_ux_assert($skipPosition !== false, $scriptPath . ' is missing the skip link.');
    public_ux_assert($navPosition !== false, $scriptPath . ' is missing primary navigation.');
    public_ux_assert($skipPosition < $navPosition, $scriptPath . ' skip link must render before primary navigation.');
    public_ux_assert(substr_count($html, 'id="main-content"') === 1, $scriptPath . ' must render exactly one main-content target.');
    public_ux_assert(strpos($html, $skipTarget) !== false, $scriptPath . ' main-content target must be statically focusable.');
    assert_primary_nav_current($html, $routeExpectation['currentSection'], $scriptPath);
    $isLoginPage = $scriptPath === 'htdocs/login/index.php';
    assert_account_header($html, $isLoginPage, $scriptPath);
    $expectedReturnPath = parse_url($routeExpectation['requestUri'], PHP_URL_PATH) ?: '/';
    $expectedLoginHref = $isLoginPage ? '/login/' : '/login/?return_to=' . rawurlencode($expectedReturnPath);
    public_ux_assert(strpos($html, 'href="' . $expectedLoginHref . '" data-account-login-link') !== false, $scriptPath . ' login return destination is incorrect.');
    public_ux_assert(
        strpos(primary_nav_html($html, $scriptPath), 'href="/decks/"') === false,
        $scriptPath . ' primary navigation must not list Decks as a top-level section.'
    );

    if ($routeExpectation['currentSection'] === 'games') {
        $firstSegment = explode('/', trim($routeExpectation['requestUri'], '/'))[0];
        assert_games_subnav_current($html, '/' . $firstSegment . '/', $scriptPath);
    } else {
        public_ux_assert(strpos($html, 'class="games-subnav"') === false, $scriptPath . ' must not render the Games sub-navigation.');
    }
}

foreach ($focusedHeaderPages as $scriptPath => $routeExpectation) {
    $html = render_public_page($root, $scriptPath, $routeExpectation['requestUri']);
    $skipTarget = '<span id="main-content" class="skip-target" tabindex="-1"></span>';
    $isLoginPage = $scriptPath === 'htdocs/login/index.php';

    public_ux_assert(substr_count($html, 'id="main-content"') === 1, $scriptPath . ' must render exactly one main-content target.');
    public_ux_assert(strpos($html, $skipTarget) !== false, $scriptPath . ' main-content target must be statically focusable.');
    assert_primary_nav_current($html, $routeExpectation['currentSection'], $scriptPath);
    assert_account_header($html, $isLoginPage, $scriptPath);

    $expectedReturnPath = parse_url($routeExpectation['requestUri'], PHP_URL_PATH) ?: '/';
    $expectedLoginHref = $isLoginPage ? '/login/' : '/login/?return_to=' . rawurlencode($expectedReturnPath);
    public_ux_assert(strpos($html, 'href="' . $expectedLoginHref . '" data-account-login-link') !== false, $scriptPath . ' login return destination is incorrect.');

    if ($routeExpectation['gameAlias'] !== null) {
        assert_games_subnav_current($html, $routeExpectation['gameAlias'], $scriptPath);
    } else {
        public_ux_assert(strpos($html, 'class="games-subnav"') === false, $scriptPath . ' must not render the Games sub-navigation.');
    }
}

$palworldHtml = render_public_page($root, 'htdocs/palworld/index.php', '/palworld/');
$palworldTargetPosition = strpos($palworldHtml, 'class="palworld-setup-step palworld-bar-target"');
$palworldTraitsPosition = strpos($palworldHtml, 'id="palworld-addons"');
$palworldOwnedPosition = strpos($palworldHtml, 'class="palworld-setup-step palworld-owned"');
$palworldActionPosition = strpos($palworldHtml, 'id="palworld-find-route"');
public_ux_assert(
    $palworldTargetPosition !== false
        && $palworldTraitsPosition !== false
        && $palworldOwnedPosition !== false
        && $palworldActionPosition !== false
        && $palworldTargetPosition < $palworldTraitsPosition
        && $palworldTraitsPosition < $palworldOwnedPosition
        && $palworldOwnedPosition < $palworldActionPosition,
    'Palworld setup must present target, desired passives, owned Pals, and the route action in order.'
);
public_ux_assert(
    (bool) preg_match('/<section\b(?=[^>]*class="palworld-panel palworld-results")(?=[^>]*role="tabpanel")(?=[^>]*aria-labelledby="palworld-view-route palworld-results-title")(?=[^>]*\bhidden\b)[^>]*>/', $palworldHtml),
    'Palworld results must start hidden as a labelled tab panel with an accessible visible heading.'
);
public_ux_assert(
    strpos($palworldHtml, '<h2 id="palworld-results-title" tabindex="-1">Breeding route result</h2>') !== false,
    'Palworld results must provide a focusable visible result heading.'
);
public_ux_assert(
    strpos($palworldHtml, 'class="palworld-view-switch" role="tablist" aria-label="Breeding planner view"') !== false
        && strpos($palworldHtml, 'id="palworld-view-setup" type="button" role="tab" aria-selected="true" aria-controls="palworld-form"') !== false
        && strpos($palworldHtml, 'id="palworld-view-route" type="button" role="tab" aria-selected="false" aria-controls="palworld-results" aria-disabled="true" disabled') !== false
        && strpos($palworldHtml, 'id="palworld-form" class="palworld-panel palworld-bar" role="tabpanel" aria-labelledby="palworld-view-setup palworld-plan-title"') !== false,
    'Palworld mobile Setup and Route navigation must expose a complete initial tab and panel relationship.'
);
public_ux_assert(
    strpos($palworldHtml, 'id="palworld-target-error" class="palworld-field-error" role="alert" hidden') !== false,
    'Palworld target validation must provide an initially hidden inline alert associated by the UI script.'
);
public_ux_assert(
    strpos($palworldHtml, 'id="palworld-excluded-title"') !== false
        && strpos($palworldHtml, 'class="palworld-exclusions" aria-labelledby="palworld-excluded-title" hidden') !== false,
    'Palworld helper controls must remain hidden until a route is available.'
);

foreach ($currentSectionRequestUriCases as $case) {
    $html = render_public_page($root, 'htdocs/index.php', $case['requestUri']);
    assert_primary_nav_current($html, $case['currentSection'], $case['label']);
}

$riskHtml = render_public_page($root, 'htdocs/risk/index.php', '/risk/');
public_ux_assert(
    strpos($riskHtml, '<nav class="risk-table-nav" aria-label="Risk table navigation">') !== false
        && strpos($riskHtml, '<a href="#risk-board-title">Board</a>') !== false
        && strpos($riskHtml, '<a href="#risk-objective-title">Current decision</a>') !== false,
    'Risk must provide narrow-screen navigation between the board and current decision.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-command-panel" class="risk-panel risk-command-panel" aria-labelledby="risk-command-title"') !== false,
    'Risk command controls must retain a named, directly targetable region.'
);
public_ux_assert(
    (bool) preg_match('/<details id="risk-setup-panel" class="risk-subpanel risk-setup-settings" open>.*?<summary class="risk-setup-toggle">.*?Game setup.*?<\/summary>/s', $riskHtml),
    'Risk setup must be an initially open disclosure that remains available during play.'
);
public_ux_assert(
    (bool) preg_match('/<section class="risk-turn-console" aria-label="Current turn">.*?<section class="risk-objective" aria-labelledby="risk-objective-title">.*?Current decision.*?<div class="risk-primary-actions">.*?Next action.*?id="risk-end-button".*?id="risk-turn-guidance" class="risk-turn-guidance" aria-live="polite"/s', $riskHtml),
    'Risk must group the current decision, next action, and live turn guidance in one turn console.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-objective-blocker" class="risk-objective-blocker" role="status" aria-live="polite" aria-atomic="true"') !== false,
    'Risk disabled-control reasons must have one visible polite status surface.'
);
public_ux_assert(
    strpos($riskHtml, '<h3 id="risk-cards-title">Setup placement</h3>') !== false
        && strpos($riskHtml, 'id="risk-place-amount-options" class="risk-dice-choice" hidden') !== false
        && strpos($riskHtml, 'id="risk-setup-placement-note" class="risk-setting-note">Setup places exactly one army per territory click.</p>') !== false,
    'Risk setup must name its placement panel and hide the reinforce-only amount chooser.'
);
foreach (['reinforce,setup', 'attack,conquer', 'fortify'] as $riskPhasePanel) {
    public_ux_assert(
        strpos($riskHtml, 'data-risk-phase-panel="' . $riskPhasePanel . '"') !== false,
        'Risk must retain phase controls for ' . $riskPhasePanel . '.'
    );
}
public_ux_assert(
    (bool) preg_match('/<details class="risk-territory-card risk-detail-disclosure">\s*<summary>.*?Selection details.*?<\/summary>/s', $riskHtml),
    'Risk selection details must start as a secondary disclosure with a visible summary.'
);
public_ux_assert(
    (bool) preg_match('/<details class="risk-log-panel risk-detail-disclosure">\s*<summary>.*?Battle history.*?<\/summary>/s', $riskHtml),
    'Risk battle history must start as a secondary disclosure with a visible summary.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-lobby-panel" class="risk-subpanel risk-lobby"') !== false
        && strpos($riskHtml, 'id="risk-lobby-start-button"') !== false
        && strpos($riskHtml, 'id="risk-lobby-leave-button"') !== false,
    'Risk must preserve online lobby start and leave controls.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-announcer" class="risk-visually-hidden" role="status" aria-live="polite" aria-atomic="true"') !== false,
    'Risk must preserve its consolidated live announcer.'
);

$riskArtwork = [
    'risk-board-backdrop.png' => [2000, 1400],
    'risk-terrain-texture.png' => [1024, 1024],
];
foreach ($riskArtwork as $assetName => $expectedDimensions) {
    $assetPath = $root . '/htdocs/assets/img/' . $assetName;
    public_ux_assert(is_file($assetPath), 'Risk artwork is missing: ' . $assetName . '.');
    $assetDimensions = getimagesize($assetPath);
    public_ux_assert(
        is_array($assetDimensions)
            && $assetDimensions[0] === $expectedDimensions[0]
            && $assetDimensions[1] === $expectedDimensions[1],
        'Risk artwork dimensions changed unexpectedly: ' . $assetName . '.'
    );
}

// Verified installed/original bytes: backdrop 1,347,057/4,587,248; terrain 392,184/2,430,720;
// selection 992,770/4,000,417; artillery 405,616/1,809,919; cavalry 373,861/642,454;
// infantry 357,420/409,402; wild 383,613/1,339,254. Each installed asset is below its budget.
$riskArtworkByteBudgets = [
    'risk-board-backdrop.png' => 1500000,
    'risk-terrain-texture.png' => 400000,
    'risk-selection-art.png' => 1000000,
    'risk-cards/artillery.png' => 450000,
    'risk-cards/cavalry.png' => 450000,
    'risk-cards/infantry.png' => 450000,
    'risk-cards/wild.png' => 450000,
];
foreach ($riskArtworkByteBudgets as $assetName => $byteBudget) {
    $assetPath = $root . '/htdocs/assets/img/' . $assetName;
    public_ux_assert(is_file($assetPath), 'Risk artwork is missing: ' . $assetName . '.');
    $assetSize = filesize($assetPath);
    public_ux_assert(
        is_int($assetSize) && $assetSize <= $byteBudget,
        'Risk artwork exceeds its byte-size budget: ' . $assetName . '.'
    );
}

$riskMapSvg = file_get_contents($root . '/htdocs/assets/img/risk-map.svg');
public_ux_assert(is_string($riskMapSvg), 'Unable to read the Risk map SVG.');
public_ux_assert(
    strpos($riskMapSvg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700"') !== false,
    'Risk map must preserve its 1000 by 700 viewBox.'
);
foreach (['risk-board-backdrop.png', 'risk-terrain-texture.png'] as $assetName) {
    public_ux_assert(
        (bool) preg_match(
            '/<image class="risk-board-art [^"]+" href="\/assets\/img\/' . preg_quote($assetName, '/') . '"[^>]*width="1000" height="700"[^>]*preserveAspectRatio="xMidYMid slice"[^>]*aria-hidden="true" pointer-events="none"\/>/',
            $riskMapSvg
        ),
        'Risk map must fit and hide decorative artwork from interaction: ' . $assetName . '.'
    );
}
public_ux_assert(
    strpos($riskMapSvg, '<clipPath id="risk-land-clip">') !== false
        && strpos($riskMapSvg, '<use href="#risk-land-geometry"/>') !== false
        && (bool) preg_match('/<image class="risk-board-art risk-terrain-texture"[^>]*clip-path="url\(#risk-land-clip\)"/', $riskMapSvg),
    'Risk terrain texture must be clipped to the existing land geometry.'
);
$expectedRiskTerritoryGeometry = <<<'GEOMETRY'
alaska=M22 80L96 66L100 142L84 160L62 156L34 178L42 142L20 118Z
northwest-territory=M96 66L152 54L206 46L252 60L242 104L236 142L170 142L100 142Z
greenland=M275 30L345 22L380 40L360 92L322 128L296 104L282 62Z
alberta=M100 142L170 142L172 212L112 212L84 160Z
ontario=M170 142L236 142L244 146L242 178L236 214L196 213L172 212Z
quebec=M244 146L282 120L306 148L294 194L264 214L236 214L242 178Z
western-united-states=M112 212L172 212L196 213L190 250L176 290L150 304L118 292L100 250Z
eastern-united-states=M196 213L236 214L264 214L272 236L252 266L236 292L230 322L218 300L196 302L176 290L190 250Z
central-america=M118 292L150 304L176 290L196 302L186 330L200 352L214 370L206 378L180 356L150 334L124 312Z
venezuela=M206 378L214 370L248 372L286 384L296 402L262 410L230 412L210 400Z
peru=M210 400L230 412L262 410L256 450L270 490L250 500L226 470L212 432Z
brazil=M262 410L296 402L330 420L352 446L340 486L310 520L286 530L270 490L256 450Z
argentina=M250 500L270 490L286 530L310 520L290 560L270 610L252 640L240 610L238 550Z
iceland=M392 92L418 82L438 96L422 112L398 110Z
great-britain=M420 150L436 128L452 140L450 172L440 198L422 198L430 176L418 166Z
scandinavia=M480 70L520 58L548 70L540 110L530 150L516 170L500 152L492 120L478 100Z
ukraine=M548 70L600 60L640 74L640 130L636 180L628 230L600 250L572 236L552 206L540 184L530 150L540 110Z
northern-europe=M470 188L500 176L516 170L530 150L540 184L552 206L522 220L486 222L468 206Z
western-europe=M468 206L486 222L492 250L478 280L446 290L436 262L446 234L452 212Z
southern-europe=M486 222L522 220L552 206L572 236L560 262L540 280L518 268L500 286L478 280L492 250Z
north-africa=M420 320L450 300L486 300L520 306L530 350L520 400L490 420L456 410L426 380L412 350Z
egypt=M520 306L560 304L580 322L574 352L530 350Z
east-africa=M530 350L574 352L590 380L616 410L598 440L572 470L546 470L536 440L520 400Z
congo=M490 420L520 400L536 440L546 470L520 490L492 478L484 446Z
south-africa=M492 478L520 490L546 470L572 470L566 520L540 570L512 580L498 540Z
madagascar=M592 500L606 488L614 520L600 556L586 540Z
ural=M640 74L684 64L694 110L700 160L690 190L636 180L640 130Z
siberia=M684 64L740 50L770 60L772 110L764 150L746 186L718 184L700 160L694 110Z
yakutsk=M770 60L840 52L860 70L850 110L772 110Z
kamchatka=M840 52L910 48L970 64L976 110L948 150L920 140L900 170L880 150L850 110L860 70Z
irkutsk=M772 110L850 110L880 150L860 170L810 172L764 150Z
mongolia=M764 150L810 172L860 170L880 150L900 170L880 210L840 228L790 226L746 186Z
japan=M916 182L934 172L942 200L928 242L912 238L922 210Z
afghanistan=M636 180L690 190L704 214L700 248L670 266L640 258L628 230Z
china=M690 190L700 160L718 184L746 186L790 226L840 228L850 262L820 300L780 310L744 300L716 276L700 248L704 214Z
middle-east=M560 262L572 236L600 250L628 230L640 258L670 266L664 300L640 330L610 350L592 334L580 322L560 304Z
india=M670 266L700 248L716 276L744 300L740 330L720 370L700 400L684 370L664 330L664 300Z
siam=M744 300L780 310L796 340L786 380L800 410L784 414L766 380L748 350L740 330Z
indonesia=M800 440L828 432L860 452L846 474L812 470Z
new-guinea=M890 432L940 430L962 452L932 464L896 458Z
western-australia=M840 520L880 500L900 510L904 580L870 600L838 590L824 556Z
eastern-australia=M880 500L920 494L948 510L966 546L958 590L930 620L904 606L904 580L900 510Z
GEOMETRY;
preg_match_all('/<path id="risk-land-([a-z-]+)" data-territory="([a-z-]+)" d="([^"]+)"\/>/', $riskMapSvg, $riskTerritoryMatches);
$currentRiskTerritoryGeometry = [];
foreach ($riskTerritoryMatches[1] as $territoryIndex => $territoryId) {
    $currentRiskTerritoryGeometry[] = $territoryId . '=' . $riskTerritoryMatches[3][$territoryIndex];
}
public_ux_assert(
    count($riskTerritoryMatches[1]) === 42
        && $riskTerritoryMatches[1] === $riskTerritoryMatches[2]
        && count(array_unique($riskTerritoryMatches[2])) === 42
        && substr_count($riskMapSvg, 'data-territory="') === 42
        && implode("\n", $currentRiskTerritoryGeometry) === $expectedRiskTerritoryGeometry,
    'Risk map must preserve all 42 unique territory IDs, data hooks, and exact path geometries.'
);
$fallbackPosition = strpos($riskMapSvg, '<rect width="1000" height="700" fill="url(#risk-ocean-fill)"/>');
$backdropPosition = strpos($riskMapSvg, 'class="risk-board-art risk-board-backdrop"');
$landPosition = strpos($riskMapSvg, 'id="risk-land-geometry" class="risk-lands"');
$texturePosition = strpos($riskMapSvg, 'class="risk-board-art risk-terrain-texture"');
$routePosition = strpos($riskMapSvg, 'class="risk-sea-links"');
public_ux_assert(
    $fallbackPosition !== false
        && $backdropPosition !== false
        && $landPosition !== false
        && $texturePosition !== false
        && $routePosition !== false
        && $fallbackPosition < $backdropPosition
        && $backdropPosition < $landPosition
        && $landPosition < $texturePosition
        && $texturePosition < $routePosition
        && substr_count($riskMapSvg, 'data-continent=') === 6,
    'Risk artwork must layer over vector fallbacks and below interactive routes while retaining continent fills.'
);
public_ux_assert(
    (bool) preg_match('/<g class="risk-sea-links" aria-hidden="true" pointer-events="none"/', $riskMapSvg)
        && (bool) preg_match('/<g class="risk-continent-labels" aria-hidden="true" pointer-events="none"/', $riskMapSvg),
    'Risk decorative route and label layers must not intercept board interaction.'
);

$riskCss = file_get_contents($root . '/htdocs/assets/css/risk.css');
public_ux_assert(is_string($riskCss), 'Unable to read Risk CSS.');
public_ux_assert(
    (bool) preg_match('/\.risk-board-art\s*\{[^}]*pointer-events:\s*none/s', $riskCss),
    'Risk artwork must remain noninteractive in CSS.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-board-backdrop\s*\{[^}]*opacity:\s*0\.82/s', $riskCss)
        && (bool) preg_match('/\.risk-terrain-texture\s*\{[^}]*opacity:\s*0\.16[^}]*mix-blend-mode:\s*soft-light/s', $riskCss),
    'Risk artwork opacity must preserve ownership and legal-action contrast.'
);
public_ux_assert(
    (bool) preg_match('/@media \(min-width: 941px\)\s*\{\s*\.risk-command-panel\s*\{(?P<rule>[^}]*)\}/s', $riskCss, $desktopRiskCommandRule),
    'Risk desktop command-panel rule is missing.'
);
public_ux_assert(
    strpos($desktopRiskCommandRule['rule'], 'position: sticky') !== false
        && strpos($desktopRiskCommandRule['rule'], 'overflow-y: auto') === false
        && strpos($desktopRiskCommandRule['rule'], 'max-height:') === false,
    'Risk desktop command panel must stay visible without a competing nested scrollbar.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-map\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-x:\s*contain/s', $riskCss),
    'Risk map must keep intentional, contained horizontal scrolling.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-page\s*\{[^}]*overflow-x:\s*clip/s', $riskCss),
    'Risk page must contain narrow-board overflow at the page boundary.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 940px\)\s*\{.*?\.risk-table-nav\s*\{[^}]*display:\s*flex/s', $riskCss),
    'Risk board/control navigation must appear at narrow widths.'
);
public_ux_assert(
    !preg_match('/\.risk-log\s*\{[^}]*(?:overflow:\s*auto|max-height:)/s', $riskCss),
    'Risk battle history must not introduce another nested scrolling region.'
);

$riskScript = file_get_contents($root . '/htdocs/assets/js/risk-game.js');
public_ux_assert(is_string($riskScript), 'Unable to read Risk game script.');
public_ux_assert(
    strpos($riskScript, 'setupPanel.open = !state.active;') !== false,
    'Risk setup disclosure must yield to the current decision when play starts and reopen after play.'
);
public_ux_assert(
    strpos($riskScript, 'const shouldShow = (state.active && isLocalTurn() && phasesForPanel.includes(state.phase))') !== false,
    'Risk must show only applicable phase controls outside pending battle decisions.'
);
public_ux_assert(
    strpos($riskScript, 'announce();') !== false && strpos($riskScript, 'syncDecisionFocus();') !== false,
    'Risk must preserve live announcements and decision-focus synchronization.'
);
public_ux_assert(
    strpos($riskScript, 'const phaseCopy =') !== false
        && strpos($riskScript, 'phaseCopy(null, { kind, details }).feedback') !== false
        && strpos($riskScript, 'setControlReason(asButton(elements.endButton), reasons.end)') !== false
        && strpos($riskScript, "markOnlineAction('reinforce')") !== false
        && strpos($riskScript, "markOnlineAction('trade')") !== false
        && strpos($riskScript, "markOnlineAction('fortify')") !== false
        && strpos($riskScript, 'runtime.selectionKey') !== false
        && strpos($riskScript, 'runtime.scoreboardKey') !== false,
    'Risk phase copy, visible disabled reasons, pending actions, and high-frequency detail renders must remain centralized and keyed.'
);

$css = file_get_contents($root . '/htdocs/assets/styles.css');
public_ux_assert(is_string($css), 'Unable to read public CSS.');
public_ux_assert((bool) preg_match('/--step-3\s*:\s*clamp\([^;]*,\s*([0-9.]+)rem\s*\)/', $css, $stepMatches), 'Missing --step-3 clamp token.');
public_ux_assert((float) $stepMatches[1] <= 2.25, '--step-3 maximum must stay at or below 2.25rem.');
public_ux_assert((bool) preg_match('/h2\s*\{[^}]*font-size:\s*var\(--step-3\)/s', $css), 'h2 must keep the shared compact step-3 size.');
public_ux_assert((bool) preg_match('/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-warm\)/s', $css), 'Global focus-visible style must use the shared focus token.');
public_ux_assert((bool) preg_match('/\.site-nav a\[aria-current="page"\]\s*\{(?P<rule>[^}]*)\}/s', $css, $currentNavRule), 'Primary nav current-link style is missing.');
public_ux_assert(strpos($currentNavRule['rule'], 'background:') !== false, 'Primary nav current-link style must include a visible background treatment.');
public_ux_assert(strpos($currentNavRule['rule'], 'box-shadow:') !== false, 'Primary nav current-link style must include a visible shadow treatment.');
foreach (['padding', 'min-height', 'min-width', 'display', 'gap', 'border-width'] as $layoutProperty) {
    public_ux_assert(
        !preg_match('/(^|[;\s])' . preg_quote($layoutProperty, '/') . '\s*:/', $currentNavRule['rule']),
        'Primary nav current-link style must not change layout metric ' . $layoutProperty . '.'
    );
}

foreach (['.skip-link', '.wordmark', '.site-nav a'] as $selector) {
    public_ux_assert((bool) preg_match('/' . preg_quote($selector, '/') . '\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $css), $selector . ' must preserve a 44px minimum tap target.');
}
public_ux_assert(
    (bool) preg_match('/\.site-header \.site-account-link,.*?\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $css),
    'Header account controls must preserve 44px minimum tap targets.'
);
public_ux_assert((bool) preg_match('/\.site-account-view\[hidden\]\s*\{[^}]*display:\s*none/s', $css), 'Hidden account views must remain removed from layout.');
public_ux_assert((bool) preg_match('/\.site-header \.site-account-link \[data-account-name\]\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s', $css), 'Long account names must remain contained.');
public_ux_assert(strpos($css, '.site-header::before') === false, 'The disabled header shimmer pseudo-element must not retain redundant CSS.');
foreach (['.site-nav', '.games-subnav'] as $scrollingNav) {
    public_ux_assert(
        (bool) preg_match('/' . preg_quote($scrollingNav, '/') . '\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-x:\s*contain/s', $css),
        $scrollingNav . ' must preserve contained local horizontal scrolling.'
    );
}

foreach (['@media (max-width: 900px)', '@media (max-width: 760px)', '@media (max-width: 640px)', '@media (prefers-reduced-motion: reduce)'] as $mediaRule) {
    public_ux_assert(strpos($css, $mediaRule) !== false, 'Expected responsive rule missing: ' . $mediaRule);
}

public_ux_assert(
    (bool) preg_match('/@media \(max-width: 900px\)\s*\{.*?\.site-header\s*\{(?P<rule>[^}]*)\}/s', $css, $mobileHeaderRule),
    'The mobile site-header rule is missing.'
);
public_ux_assert(
    (bool) preg_match('/\bposition\s*:\s*relative\s*;/', $mobileHeaderRule['rule'])
        && (bool) preg_match('/\btop\s*:\s*auto\s*;/', $mobileHeaderRule['rule'])
        && (bool) preg_match('/\bmin-height\s*:\s*0\s*;/', $mobileHeaderRule['rule']),
    'The mobile site header must remain compact and in document flow so it cannot cover page content.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 900px\)\s*\{.*?\.site-nav\s*\{(?P<rule>[^}]*)\}/s', $css, $mobileNavRule),
    'The mobile site-nav rule is missing.'
);
public_ux_assert(
    (bool) preg_match('/\bflex\s*:\s*1\s+0\s+100%\s*;/', $mobileNavRule['rule'])
        && (bool) preg_match('/\bwidth\s*:\s*100%\s*;/', $mobileNavRule['rule']),
    'The mobile site nav must occupy one bounded, horizontally scrollable row.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 900px\)\s*\{.*?\.site-header-main\s*\{(?P<rule>[^}]*)\}/s', $css, $mobileHeaderMainRule)
        && (bool) preg_match('/\bflex-wrap\s*:\s*wrap\s*;/', $mobileHeaderMainRule['rule']),
    'The mobile header row must wrap its wordmark and account controls without page overflow.'
);

$publicShellScript = file_get_contents($root . '/htdocs/assets/js/public-shell.js');
public_ux_assert(is_string($publicShellScript), 'Unable to read public shell script.');
public_ux_assert(strpos($publicShellScript, '<script') === false, 'Public shell script must not contain HTML script tags.');
public_ux_assert(strpos($publicShellScript, "addEventListener('click'") !== false, 'Public shell script must handle skip-link activation externally.');
public_ux_assert(strpos($publicShellScript, 'target.focus') !== false, 'Public shell script must transfer focus to the skip target.');
public_ux_assert(strpos($publicShellScript, 'requestAnimationFrame') !== false, 'Public shell script must host the shimmer animation behavior.');
public_ux_assert(strpos($publicShellScript, "'--glass-mx'") !== false, 'Public shell script must update panel shimmer coordinates.');
public_ux_assert(strpos($publicShellScript, "'--glass-x'") !== false, 'Public shell script must update panel shimmer coordinates.');
public_ux_assert(strpos($publicShellScript, "'.site-header'") === false, 'Public shell script must not attach pointer shimmer work to the site header.');
public_ux_assert(strpos($publicShellScript, "view.getAttribute('data-account-view') !== viewName") !== false, 'Public shell script must keep inactive account views hidden.');
public_ux_assert(strpos($publicShellScript, "accountRoot.setAttribute('data-account-state', viewName)") !== false, 'Public shell script must expose the active account state.');
public_ux_assert(!preg_match('/\son[a-z]+\s*=/', $publicShellScript), 'Public shell script must not contain inline-handler markup.');

fwrite(STDOUT, 'Public UX/accessibility regression checks passed.' . PHP_EOL);
