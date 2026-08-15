<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$publicPages = [
    'htdocs/index.php' => ['requestUri' => '/', 'currentSection' => null],
    'htdocs/decks/index.php' => ['requestUri' => '/decks/', 'currentSection' => 'decks'],
    'htdocs/decks/deck.php' => ['requestUri' => '/decks/deck.php', 'currentSection' => 'decks'],
    'htdocs/decks/guides.php' => ['requestUri' => '/decks/guides.php', 'currentSection' => 'decks'],
    'htdocs/decks/guide.php' => ['requestUri' => '/decks/guide.php', 'currentSection' => 'decks'],
    'htdocs/chess/index.php' => ['requestUri' => '/chess/', 'currentSection' => 'chess'],
    'htdocs/chess/game.php' => ['requestUri' => '/chess/game.php', 'currentSection' => 'chess'],
    'htdocs/dongs/index.php' => ['requestUri' => '/dongs/', 'currentSection' => 'dongs'],
    'htdocs/games/index.php' => ['requestUri' => '/games/', 'currentSection' => 'games'],
    'htdocs/games/game.php' => ['requestUri' => '/games/game.php', 'currentSection' => 'games'],
    'htdocs/music/index.php' => ['requestUri' => '/music/', 'currentSection' => 'music'],
    'htdocs/recipes/index.php' => ['requestUri' => '/recipes/', 'currentSection' => 'recipes'],
    'htdocs/recipes/recipe.php' => ['requestUri' => '/recipes/recipe.php', 'currentSection' => 'recipes'],
    'htdocs/videos/index.php' => ['requestUri' => '/videos/', 'currentSection' => 'videos'],
    'htdocs/videos/video.php' => ['requestUri' => '/videos/video.php', 'currentSection' => 'videos'],
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

function public_ux_assert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function render_public_page(string $root, string $scriptPath, ?string $requestUri): string
{
    $script = $root . '/' . $scriptPath;
    $requestUriCode = $requestUri === null
        ? 'unset($_SERVER["REQUEST_URI"]);'
        : '$_SERVER["REQUEST_URI"] = ' . var_export($requestUri, true) . ';';
    $code = $requestUriCode
        . '$_SERVER["REQUEST_METHOD"] = "GET";'
        . 'require ' . var_export($script, true) . ';';
    $process = proc_open(
        [PHP_BINARY, '-d', 'display_errors=1', '-r', $code],
        [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes,
        $root
    );

    public_ux_assert(is_resource($process), 'Unable to render ' . $scriptPath);

    $html = stream_get_contents($pipes[1]);
    $errorOutput = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);

    $status = proc_close($process);
    public_ux_assert($status === 0, $scriptPath . ' failed to render: ' . trim($errorOutput));

    return $html;
}

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
    public_ux_assert(strpos($html, '<script src="/assets/js/public-shell.js?v=') !== false, $scriptPath . ' must load the public shell script.');
    public_ux_assert(!preg_match('/<script\b(?![^>]*\bsrc=)[^>]*>/i', $html), $scriptPath . ' must not render inline script bodies.');
    public_ux_assert(!preg_match('/\s+on[a-z]+\s*=/i', $html), $scriptPath . ' must not render inline event handlers.');
    assert_primary_nav_current($html, $routeExpectation['currentSection'], $scriptPath);
}

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
    (bool) preg_match('/\bflex\s*:\s*0\s+1\s+auto\s*;/', $mobileNavRule['rule'])
        && (bool) preg_match('/\bmin-width\s*:\s*0\s*;/', $mobileNavRule['rule']),
    'The mobile site nav must reset the desktop flex basis so it cannot reserve a full screen of vertical space.'
);

$publicShellScript = file_get_contents($root . '/htdocs/assets/js/public-shell.js');
public_ux_assert(is_string($publicShellScript), 'Unable to read public shell script.');
public_ux_assert(strpos($publicShellScript, '<script') === false, 'Public shell script must not contain HTML script tags.');
public_ux_assert(strpos($publicShellScript, "addEventListener('click'") !== false, 'Public shell script must handle skip-link activation externally.');
public_ux_assert(strpos($publicShellScript, 'target.focus') !== false, 'Public shell script must transfer focus to the skip target.');
public_ux_assert(strpos($publicShellScript, 'requestAnimationFrame') !== false, 'Public shell script must host the shimmer animation behavior.');
public_ux_assert(strpos($publicShellScript, "'--glass-mx'") !== false, 'Public shell script must update panel shimmer coordinates.');
public_ux_assert(strpos($publicShellScript, "'--glass-x'") !== false, 'Public shell script must update header shimmer coordinates.');
public_ux_assert(!preg_match('/\son[a-z]+\s*=/', $publicShellScript), 'Public shell script must not contain inline-handler markup.');

fwrite(STDOUT, 'Public UX/accessibility regression checks passed.' . PHP_EOL);
