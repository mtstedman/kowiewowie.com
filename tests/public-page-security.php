<?php

declare(strict_types=1);

require __DIR__ . '/support/public-page.php';

$root = dirname(__DIR__);
$securityContractPages = [
    'htdocs/index.php' => '/',
    'htdocs/decks/index.php' => '/decks/',
    'htdocs/decks/deck.php' => '/decks/deck.php',
    'htdocs/decks/guides.php' => '/decks/guides.php',
    'htdocs/decks/guide.php' => '/decks/guide.php',
    'htdocs/chess/index.php' => '/chess/',
    'htdocs/chess/game.php' => '/chess/game.php',
    'htdocs/trivia/index.php' => '/trivia/',
    'htdocs/trivia/game.php' => '/trivia/game.php',
    'htdocs/dongs/index.php' => '/dongs/',
    'htdocs/games/index.php' => '/games/',
    'htdocs/games/game.php' => '/games/game.php',
    'htdocs/music/index.php' => '/music/',
    'htdocs/recipes/index.php' => '/recipes/',
    'htdocs/recipes/recipe.php' => '/recipes/recipe.php',
    'htdocs/videos/index.php' => '/videos/',
    'htdocs/videos/video.php' => '/videos/video.php',
];

foreach ($securityContractPages as $scriptPath => $requestUri) {
    $html = render_public_page($root, $scriptPath, $requestUri);
    public_ux_assert(
        strpos($html, '<script src="/assets/js/public-shell.js?v=') !== false,
        $scriptPath . ' must load the external public shell script.'
    );
    public_ux_assert(
        !preg_match('/<script\b(?![^>]*\bsrc=)[^>]*>/i', $html),
        $scriptPath . ' must not render inline script bodies.'
    );
    public_ux_assert(
        !preg_match('/\s+on[a-z]+\s*=/i', $html),
        $scriptPath . ' must not render inline event handlers.'
    );
}

fwrite(STDOUT, 'Public page security regressions passed.' . PHP_EOL);
