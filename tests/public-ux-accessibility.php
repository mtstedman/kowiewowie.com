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
$palworldTargetPosition = strpos($palworldHtml, 'id="palworld-target-title"');
$palworldTraitsPosition = strpos($palworldHtml, 'id="palworld-traits-title"');
$palworldOwnedPosition = strpos($palworldHtml, 'id="palworld-owned-title"');
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
    (bool) preg_match('/<section class="palworld-panel palworld-results"[^>]*aria-labelledby="palworld-results-title"[^>]*hidden>/', $palworldHtml),
    'Palworld results must start hidden and use an accessible visible heading.'
);
public_ux_assert(
    strpos($palworldHtml, '<h2 id="palworld-results-title" tabindex="-1">Breeding route result</h2>') !== false,
    'Palworld results must provide a focusable visible result heading.'
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
