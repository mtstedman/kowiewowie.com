<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$publicPages = [
    'htdocs/index.php' => '/',
    'htdocs/decks/index.php' => '/decks/',
    'htdocs/decks/deck.php' => '/decks/deck.php',
    'htdocs/decks/guides.php' => '/decks/guides.php',
    'htdocs/decks/guide.php' => '/decks/guide.php',
    'htdocs/chess/index.php' => '/chess/',
    'htdocs/chess/game.php' => '/chess/game.php',
    'htdocs/dongs/index.php' => '/dongs/',
    'htdocs/games/index.php' => '/games/',
    'htdocs/games/game.php' => '/games/game.php',
    'htdocs/music/index.php' => '/music/',
    'htdocs/recipes/index.php' => '/recipes/',
    'htdocs/recipes/recipe.php' => '/recipes/recipe.php',
    'htdocs/videos/index.php' => '/videos/',
    'htdocs/videos/video.php' => '/videos/video.php',
];

function public_ux_assert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function render_public_page(string $root, string $scriptPath, string $requestUri): string
{
    $script = $root . '/' . $scriptPath;
    $code = '$_SERVER["REQUEST_URI"] = ' . var_export($requestUri, true) . ';'
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

foreach ($publicPages as $scriptPath => $requestUri) {
    $html = render_public_page($root, $scriptPath, $requestUri);
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
}

$css = file_get_contents($root . '/htdocs/assets/styles.css');
public_ux_assert(is_string($css), 'Unable to read public CSS.');
public_ux_assert((bool) preg_match('/--step-3\s*:\s*clamp\([^;]*,\s*([0-9.]+)rem\s*\)/', $css, $stepMatches), 'Missing --step-3 clamp token.');
public_ux_assert((float) $stepMatches[1] <= 2.25, '--step-3 maximum must stay at or below 2.25rem.');
public_ux_assert((bool) preg_match('/h2\s*\{[^}]*font-size:\s*var\(--step-3\)/s', $css), 'h2 must keep the shared compact step-3 size.');
public_ux_assert((bool) preg_match('/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-warm\)/s', $css), 'Global focus-visible style must use the shared focus token.');

foreach (['.skip-link', '.wordmark', '.site-nav a'] as $selector) {
    public_ux_assert((bool) preg_match('/' . preg_quote($selector, '/') . '\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $css), $selector . ' must preserve a 44px minimum tap target.');
}

foreach (['@media (max-width: 900px)', '@media (max-width: 760px)', '@media (max-width: 640px)', '@media (prefers-reduced-motion: reduce)'] as $mediaRule) {
    public_ux_assert(strpos($css, $mediaRule) !== false, 'Expected responsive rule missing: ' . $mediaRule);
}

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
