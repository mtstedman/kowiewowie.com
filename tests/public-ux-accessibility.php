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
    'htdocs/crabs/index.php' => ['requestUri' => '/crabs/', 'currentSection' => 'crabs'],
    'htdocs/trivia/index.php' => ['requestUri' => '/trivia/', 'currentSection' => 'games'],
    'htdocs/trivia/game.php' => ['requestUri' => '/trivia/game.php', 'currentSection' => 'games'],
    'htdocs/dongs/index.php' => ['requestUri' => '/dongs/', 'currentSection' => 'dongs'],
    'htdocs/games/index.php' => ['requestUri' => '/games/', 'currentSection' => 'games'],
    'htdocs/games/game.php' => ['requestUri' => '/games/game.php', 'currentSection' => 'games'],
    'htdocs/music/index.php' => ['requestUri' => '/music/', 'currentSection' => 'music'],
    'htdocs/books/index.php' => ['requestUri' => '/books/', 'currentSection' => 'books'],
    'htdocs/recipes/index.php' => ['requestUri' => '/recipes/', 'currentSection' => 'recipes'],
    'htdocs/recipes/recipe.php' => ['requestUri' => '/recipes/recipe.php', 'currentSection' => 'recipes'],
    'htdocs/videos/index.php' => ['requestUri' => '/videos/', 'currentSection' => 'videos'],
    'htdocs/videos/video.php' => ['requestUri' => '/videos/video.php', 'currentSection' => 'videos'],
    'htdocs/wedding-registry/index.php' => ['requestUri' => '/wedding-registry/', 'currentSection' => 'wedding-registry'],
];

$focusedHeaderPages = [
    'htdocs/login/index.php' => ['requestUri' => '/login/', 'currentSection' => null, 'gameAlias' => null],
    'htdocs/risk/index.php' => ['requestUri' => '/risk/', 'currentSection' => 'games', 'gameAlias' => '/risk/'],
    'htdocs/palworld/index.php' => ['requestUri' => '/palworld/', 'currentSection' => 'games', 'gameAlias' => '/palworld/'],
    'htdocs/stratego/index.php' => ['requestUri' => '/stratego/', 'currentSection' => 'games', 'gameAlias' => '/stratego/'],
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

$homeHtml = render_public_page($root, 'htdocs/index.php', '/');
public_ux_assert(
    (bool) preg_match('/<a href="\/crabs\/">Crabs<\/a>/', primary_nav_html($homeHtml, 'homepage')),
    'Primary navigation must include a Crabs link targeting /crabs/.'
);
public_ux_assert(
    (bool) preg_match('/<a href="\/books\/">Books<\/a>/', primary_nav_html($homeHtml, 'homepage')),
    'Primary navigation must include a Books link targeting /books/.'
);

$crabsHtml = render_public_page($root, 'htdocs/crabs/index.php', '/crabs/');
public_ux_assert(
    strpos(primary_nav_html($crabsHtml, 'crabs page'), '<a href="/crabs/" aria-current="page">Crabs</a>') !== false,
    'Crabs page must mark the Crabs primary nav link as the current page.'
);
public_ux_assert(
    (bool) preg_match('/<link rel="stylesheet" href="\/assets\/css\/crabs\.css\?v=[^"]+">/', $crabsHtml),
    'Crabs page must load its cache-versioned page stylesheet.'
);
public_ux_assert(
    strpos($homeHtml, '/assets/css/crabs.css') === false,
    'Crabs page stylesheet must not load on the homepage.'
);
public_ux_assert(
    (bool) preg_match('/<section class="foundation crab-gallery-section" aria-labelledby="crab-gallery-title">.*?<h2 id="crab-gallery-title">.*?<\/section>/s', $crabsHtml, $crabGallerySectionMatches),
    'Crabs page must render a gallery section labelled by crab-gallery-title.'
);
$crabGalleryHtml = $crabGallerySectionMatches[0] ?? '';
public_ux_assert(
    strpos($crabGalleryHtml, 'imagined illustrations from the takeover story, not photos') !== false
        && strpos($crabGalleryHtml, "no real crab's body is larger than a person") !== false,
    'Crab gallery must identify the takeover scenes as imagined illustrations rather than real photos.'
);
$crabStoryPosition = strpos($crabsHtml, 'aria-labelledby="crabs-story-title"');
$crabGalleryPosition = strpos($crabsHtml, 'aria-labelledby="crab-gallery-title"');
$crabFactsPosition = strpos($crabsHtml, 'aria-labelledby="crab-facts-title"');
public_ux_assert(
    $crabStoryPosition !== false
        && $crabGalleryPosition !== false
        && $crabFactsPosition !== false
        && $crabStoryPosition < $crabGalleryPosition
        && $crabGalleryPosition < $crabFactsPosition,
    'Crab gallery must appear between the takeover story and the real facts.'
);
preg_match_all('/<figure class="crab-gallery-item">.*?<\/figure>/s', $crabGalleryHtml, $crabGalleryItemMatches);
public_ux_assert(
    count($crabGalleryItemMatches[0]) === 6,
    'Crab gallery must render exactly six figures.'
);
$expectedCrabImageSources = [
    '/assets/img/crabs/crab-beach-lifeguard.png',
    '/assets/img/crabs/crab-boardwalk-council.png',
    '/assets/img/crabs/crab-everglades-airboat.png',
    '/assets/img/crabs/crab-highway-crossing.png',
    '/assets/img/crabs/crab-theme-park-gate.png',
    '/assets/img/crabs/crab-tourist-snacks.png',
];
$renderedCrabImageSources = [];
foreach ($crabGalleryItemMatches[0] as $crabGalleryItemHtml) {
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i', $crabGalleryItemHtml, $crabImageMatches),
        'Every crab gallery figure must contain an image.'
    );
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\balt="[^"]+"[^>]*>/i', $crabGalleryItemHtml),
        'Every crab gallery image must have non-empty alt text.'
    );
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\bloading="lazy"[^>]*\bdecoding="async"[^>]*>/i', $crabGalleryItemHtml),
        'Every crab gallery image must use lazy loading and asynchronous decoding.'
    );
    public_ux_assert(
        (bool) preg_match('/<figcaption>\s*[^<\s][^<]*<\/figcaption>/s', $crabGalleryItemHtml),
        'Every crab gallery figure must include a non-empty figcaption.'
    );

    $crabImageSource = html_entity_decode($crabImageMatches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    public_ux_assert(
        strncmp($crabImageSource, '/assets/img/crabs/', strlen('/assets/img/crabs/')) === 0,
        'Every crab gallery image must use a path under /assets/img/crabs/.'
    );
    $crabImageFile = $root . '/htdocs' . $crabImageSource;
    public_ux_assert(
        is_file($crabImageFile) && filesize($crabImageFile) > 0,
        'Crab gallery image must exist on disk as a non-empty file: ' . $crabImageSource
    );
    $renderedCrabImageSources[] = $crabImageSource;
}
sort($renderedCrabImageSources);
sort($expectedCrabImageSources);
public_ux_assert(
    $renderedCrabImageSources === $expectedCrabImageSources,
    'Crab gallery must render all six promoted crab images exactly once.'
);
public_ux_assert(
    strpos($crabsHtml, '<section class="foundation crab-facts-section" aria-labelledby="crab-facts-title">') !== false
        && strpos($crabsHtml, '<h2 id="crab-facts-title">') !== false
        && strpos($crabsHtml, 'The Florida takeover above is make-believe.') !== false,
    'Crabs page must label its real-facts section and distinguish it from the fictional takeover.'
);
public_ux_assert(
    strpos($crabsHtml, '<h3 id="crab-fact-group-0">Size records</h3>') !== false
        && strpos($crabsHtml, '<h3 id="crab-fact-group-1">Bodies and senses</h3>') !== false
        && strpos($crabsHtml, '<h3 id="crab-fact-group-2">Behaviour</h3>') !== false
        && strpos($crabsHtml, '<h3 id="crab-fact-group-3">Evolution and oddities</h3>') !== false,
    'Crab facts must be grouped under all four required themes.'
);
preg_match_all('/<article class="crab-fact">.*?<\/article>/s', $crabsHtml, $crabFactMatches);
public_ux_assert(
    count($crabFactMatches[0]) >= 16,
    'Crabs page must render at least 16 real crab facts.'
);
foreach ($crabFactMatches[0] as $crabFactHtml) {
    public_ux_assert(
        (bool) preg_match('/<a class="crab-fact-source" href="https:\/\/[^\"]+" target="_blank" rel="noopener noreferrer">/', $crabFactHtml),
        'Every crab fact must include an HTTPS source link with safe external-link attributes.'
    );
}
public_ux_assert(
    strpos($crabFactMatches[0][0] ?? '', 'about 3.7 m') !== false
        && strpos($crabFactMatches[0][0] ?? '', 'roughly twice the height of an adult human') !== false,
    'The first crab fact must lead with the person-sized Japanese spider crab comparison.'
);
public_ux_assert(
    strpos($crabsHtml, '<h2 id="crabs-story-title">A very pinchy takeover.</h2>') !== false,
    'Crabs page must retain the fictional takeover story heading.'
);
public_ux_assert(
    preg_match_all('/<h1\b/i', $crabsHtml) === 1,
    'Crabs page must retain exactly one h1.'
);
public_ux_assert(
    (bool) preg_match('/<section class="hero hero-compact" aria-labelledby="crabs-title">(?:(?!<\/section>).)*<a class="button" href="#crab-dark-universe">[^<]+<\/a>(?:(?!<\/section>).)*<\/section>/s', $crabsHtml),
    'Crabs hero must link to the dark universe with the shared button tap target.'
);
$crabNotesPosition = strpos($crabsHtml, 'aria-labelledby="crab-notes-title"');
$crabDarkPosition = strpos($crabsHtml, 'id="crab-dark-universe"');
public_ux_assert(
    $crabNotesPosition !== false
        && $crabDarkPosition !== false
        && $crabNotesPosition < $crabDarkPosition,
    'Crab dark universe must appear after Field notes.'
);
public_ux_assert(
    (bool) preg_match('/<section id="crab-dark-universe" class="foundation crab-dark-universe" aria-labelledby="crab-dark-title">(?P<dark_universe>.*)<\/section>\s*<\/main>/s', $crabsHtml, $crabDarkUniverseMatches),
    'Crabs page must end main with the contracted dark-universe section.'
);
$crabDarkUniverseHtml = $crabDarkUniverseMatches['dark_universe'] ?? '';
public_ux_assert(
    strpos($crabDarkUniverseHtml, '<h2 id="crab-dark-title">') !== false,
    'Crab dark universe must be labelled by crab-dark-title.'
);
public_ux_assert(
    stripos($crabDarkUniverseHtml, 'fiction') !== false
        && stripos($crabDarkUniverseHtml, 'graphic violence') !== false,
    'Crab dark universe must identify itself as fiction and warn about graphic violence.'
);
public_ux_assert(
    (bool) preg_match('/<div class="crab-dark-story">(.*?)<\/div>/s', $crabDarkUniverseHtml, $crabDarkStoryMatches),
    'Crab dark universe must contain the contracted story wrapper.'
);
$crabDarkStoryHtml = $crabDarkStoryMatches[1] ?? '';
preg_match_all('/<article>.*?<h3>[^<]+<\/h3>.*?<\/article>/s', $crabDarkStoryHtml, $crabDarkChapterMatches);
public_ux_assert(
    count($crabDarkChapterMatches[0]) >= 4,
    'Crab dark story must contain at least four chapters, each with an h3.'
);
public_ux_assert(
    stripos($crabDarkStoryHtml, 'high tide') !== false
        && stripos($crabDarkStoryHtml, 'never went out') !== false
        && stripos($crabDarkStoryHtml, 'crabs tore people apart') !== false
        && stripos($crabDarkStoryHtml, 'world ending') !== false,
    'Crab dark story must cover the endless high-tide arrival, violent attack, and end of the world.'
);
public_ux_assert(
    (bool) preg_match('/<div class="crab-dark-story">.*?<\/div>\s*(<section class="crab-dark-gallery-section" aria-labelledby="crab-dark-gallery-title">.*?<h3 id="crab-dark-gallery-title">[^<]+<\/h3>.*?<div class="crab-gallery crab-dark-gallery">.*?<\/div>\s*<\/section>)/s', $crabDarkUniverseHtml, $crabDarkGallerySectionMatches),
    'Crab dark gallery must appear after the story wrapper, use the contracted gallery classes, and be labelled by crab-dark-gallery-title.'
);
$crabDarkGalleryHtml = $crabDarkGallerySectionMatches[1] ?? '';
public_ux_assert(
    stripos($crabDarkGalleryHtml, 'imagined illustrations') !== false
        && stripos($crabDarkGalleryHtml, 'not photos') !== false,
    'Crab dark gallery must identify its scenes as imagined illustrations rather than photos.'
);
preg_match_all('/<figure class="crab-gallery-item">.*?<\/figure>/s', $crabDarkGalleryHtml, $crabDarkGalleryItemMatches);
public_ux_assert(
    count($crabDarkGalleryItemMatches[0]) === 6,
    'Crab dark gallery must render exactly six figures.'
);
$expectedCrabDarkImageSources = [
    '/assets/img/crabs/crab-dark-boardwalk-massacre.png',
    '/assets/img/crabs/crab-dark-drowned-city.png',
    '/assets/img/crabs/crab-dark-high-tide-surge.png',
    '/assets/img/crabs/crab-dark-highway-evacuation.png',
    '/assets/img/crabs/crab-dark-last-shore.png',
    '/assets/img/crabs/crab-dark-theme-park-flood.png',
];
$renderedCrabDarkImageSources = [];
foreach ($crabDarkGalleryItemMatches[0] as $crabDarkGalleryItemHtml) {
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i', $crabDarkGalleryItemHtml, $crabDarkImageMatches),
        'Every crab dark gallery figure must contain an image.'
    );
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\balt="[^"]+"[^>]*>/i', $crabDarkGalleryItemHtml),
        'Every crab dark gallery image must have non-empty alt text.'
    );
    public_ux_assert(
        (bool) preg_match('/<img\b[^>]*\bloading="lazy"[^>]*\bdecoding="async"[^>]*>/i', $crabDarkGalleryItemHtml),
        'Every crab dark gallery image must use lazy loading and asynchronous decoding.'
    );
    public_ux_assert(
        (bool) preg_match('/<figcaption>\s*[^<\s][^<]*<\/figcaption>/s', $crabDarkGalleryItemHtml),
        'Every crab dark gallery figure must include a non-empty figcaption.'
    );

    $crabDarkImageSource = html_entity_decode($crabDarkImageMatches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $crabDarkImageFile = $root . '/htdocs' . $crabDarkImageSource;
    public_ux_assert(
        is_file($crabDarkImageFile) && filesize($crabDarkImageFile) > 0,
        'Crab dark gallery image must exist on disk as a non-empty file: ' . $crabDarkImageSource
    );
    $renderedCrabDarkImageSources[] = $crabDarkImageSource;
}
sort($renderedCrabDarkImageSources);
sort($expectedCrabDarkImageSources);
public_ux_assert(
    $renderedCrabDarkImageSources === $expectedCrabDarkImageSources,
    'Crab dark gallery must render all six promoted dark crab images exactly once.'
);

$crabsCss = file_get_contents($root . '/htdocs/assets/css/crabs.css');
public_ux_assert(is_string($crabsCss), 'Unable to read Crabs CSS.');
public_ux_assert(
    (bool) preg_match('/\.crab-gallery-item img\s*\{[^}]*aspect-ratio:\s*3 \/ 2[^}]*object-fit:\s*cover/s', $crabsCss),
    'Crab gallery images must reserve a 3:2 frame and cover it.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 640px\).*?\.crab-gallery\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s', $crabsCss),
    'Crab gallery must stack into a single column on narrow screens.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 640px\)\s*\{\s*\.crab-fact-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s', $crabsCss),
    'Crab facts must stack into a single column on narrow screens.'
);
public_ux_assert(
    (bool) preg_match('/\.crab-dark-universe\s*\{[^}]*--ink-soft:\s*#[0-9a-f]{6}[^}]*--panel:\s*rgba?\([^}]*--panel-solid:\s*#[0-9a-f]{6}[^}]*--line:\s*rgba?\([^}]*--line-strong:\s*#[0-9a-f]{6}/is', $crabsCss),
    'Crab dark universe must provide the contracted scoped palette overrides.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 640px\).*?\.crab-dark-story\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s', $crabsCss),
    'Crab dark story must stack into a single column on narrow screens.'
);

$booksHtml = render_public_page($root, 'htdocs/books/index.php', '/books/');
public_ux_assert(
    strpos(primary_nav_html($booksHtml, 'books page'), '<a href="/books/" aria-current="page">Books</a>') !== false,
    'Books page must mark the Books primary nav link as the current page.'
);
public_ux_assert(
    (bool) preg_match('/<link rel="stylesheet" href="\/assets\/css\/books\.css\?v=[^"]+">/', $booksHtml),
    'Books page must load its cache-versioned page stylesheet.'
);
public_ux_assert(
    (bool) preg_match('/<script src="\/assets\/js\/books-index\.js\?v=[0-9]+"><\/script>/', $booksHtml),
    'Books page must load its cache-versioned external renderer script.'
);
public_ux_assert(
    substr_count($booksHtml, '<h1>') === 1
        && strpos($booksHtml, '<section class="foundation" aria-labelledby="books-title">') !== false
        && strpos($booksHtml, '<h2 id="books-title">') !== false,
    'Books page must expose one page heading and a labelled books region.'
);
public_ux_assert(
    (bool) preg_match('/<div id="books-list" class="books-list" aria-live="polite" aria-busy="true">\s*<p class="books-status">[^<]+<\/p>\s*<\/div>/', $booksHtml),
    'Books page must render a polite, busy live region with an understandable loading message.'
);

$booksCss = file_get_contents($root . '/htdocs/assets/css/books.css');
public_ux_assert(is_string($booksCss), 'Unable to read Books CSS.');
public_ux_assert(
    (bool) preg_match('/\.book-cover-frame\s*\{[^}]*aspect-ratio:\s*2 \/ 3/s', $booksCss)
        && (bool) preg_match('/\.book-cover\s*\{[^}]*object-fit:\s*cover/s', $booksCss),
    'Books covers must preserve book-cover proportions.'
);
public_ux_assert(
    (bool) preg_match('/@media \(max-width: 640px\)\s*\{\s*\.book-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s', $booksCss),
    'Books cards must stack into a single column on narrow screens.'
);
public_ux_assert(
    (bool) preg_match('/\.book-link\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $booksCss),
    'Books Amazon links must preserve a 44px minimum tap target.'
);

$booksScript = file_get_contents($root . '/htdocs/assets/js/books-index.js');
public_ux_assert(is_string($booksScript), 'Unable to read Books renderer script.');
public_ux_assert(
    strpos($booksScript, 'innerHTML') === false && strpos($booksScript, 'insertAdjacentHTML') === false,
    'Books renderer must build saved content as text nodes, never imported HTML.'
);
public_ux_assert(
    strpos($booksScript, "fetch('/api/books'") !== false,
    'Books renderer must consume the shared public books API.'
);

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
$riskTurnConsolePosition = strpos($riskHtml, '<section class="risk-turn-console" aria-label="Current turn">');
$riskBoardDetailsPosition = strpos($riskHtml, '<section id="risk-board-details" class="risk-panel risk-board-details" aria-labelledby="risk-board-details-title">');
$riskGameToolsPosition = strpos($riskHtml, '<section id="risk-game-tools" class="risk-panel risk-game-tools" aria-labelledby="risk-command-title">');
$riskBoardPanelPosition = strpos($riskHtml, '<section class="risk-panel risk-board-panel" aria-labelledby="risk-board-title">');
$riskHowToPlayPosition = strpos($riskHtml, '<details id="risk-how-to-play" class="risk-panel risk-how-to-play">');
public_ux_assert(
    (bool) preg_match('/<div id="risk-action-bar" class="risk-action-bar" role="region" aria-label="Turn quick actions">\s*<nav class="risk-action-bar-nav" aria-label="Risk table navigation">\s*<a href="#risk-board-title">Board<\/a>\s*<a href="#risk-objective-title">Decision<\/a>\s*<\/nav>.*?id="risk-action-bar-phase".*?id="risk-action-bar-reserve".*?id="risk-action-bar-primary" disabled>End phase<\/button>/s', $riskHtml)
        && strpos($riskHtml, 'class="risk-table-nav"') === false
        && strpos($riskHtml, '<h2 id="risk-board-title" tabindex="-1">Territories</h2>') !== false
        && strpos($riskHtml, '<h3 id="risk-objective-title" tabindex="-1">Ready to play</h3>') !== false,
    'Risk must replace the top jump nav with a bottom action bar holding phase, reserve, primary action and focusable Board/Decision destinations.'
);
public_ux_assert(
    $riskTurnConsolePosition !== false
        && $riskBoardDetailsPosition !== false
        && $riskGameToolsPosition !== false
        && $riskTurnConsolePosition < $riskBoardDetailsPosition
        && $riskBoardDetailsPosition < $riskGameToolsPosition,
    'Risk must place the turn dock, then board details, then setup and lobby tools in DOM reading order.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-command-panel" class="risk-panel risk-command-panel risk-turn-dock" aria-labelledby="risk-dock-title"') !== false
        && strpos($riskHtml, '<h2 id="risk-dock-title" class="risk-visually-hidden">Turn dock</h2>') !== false,
    'Risk command controls must retain a named, directly targetable turn dock region.'
);
public_ux_assert(
    (bool) preg_match('/<details id="risk-table-panel" class="risk-table-disclosure" open>\s*<summary class="risk-table-toggle">.*?<h2 id="risk-command-title" class="risk-table-heading">Game setup &amp; lobby<\/h2>.*?<\/summary>.*?id="risk-start-button".*?id="risk-invite-button".*?<details id="risk-setup-panel" class="risk-subpanel risk-setup-settings" open>.*?<summary class="risk-setup-toggle">.*?Game setup.*?<\/summary>.*?id="risk-lobby-panel".*?<\/details>\s*<\/section>/s', $riskHtml)
        && strpos($riskHtml, 'Choose your Game setup, then press New game to deal the world.') !== false
        && strpos($riskHtml, 'setup above') === false
        && strpos($riskHtml, 'setup below') === false,
    'Risk setup, table controls and lobby must share one initially open Game setup & lobby disclosure with position-independent instructions.'
);
public_ux_assert(
    (bool) preg_match('/<section class="risk-turn-console" aria-label="Current turn">\s*<section class="risk-objective" aria-labelledby="risk-objective-title">.*?Current decision.*?id="risk-objective-title".*?id="risk-objective-text".*?id="risk-turn-guidance" class="risk-turn-guidance" aria-live="polite".*?id="risk-objective-blocker".*?<\/section>\s*<ol id="risk-phase-stepper".*?<\/ol>\s*<div id="risk-action-row" class="risk-action-row" role="group" aria-label="Current phase actions">\s*<div class="risk-primary-actions">.*?Next action.*?id="risk-end-button".*?<div id="risk-action-stage" class="risk-action-stage risk-phase-controls">/s', $riskHtml),
    'Risk must order the turn dock as objective, phase stepper, then one action row that starts with the primary action.'
);
public_ux_assert(
    strpos($riskHtml, 'id="risk-objective-blocker" class="risk-objective-blocker" role="status" aria-live="polite" aria-atomic="true"') !== false,
    'Risk disabled-control reasons must have one visible polite status surface.'
);
public_ux_assert(
    strpos($riskHtml, '<h3 id="risk-cards-title" class="risk-visually-hidden">Setup placement</h3>') !== false
        && strpos($riskHtml, 'id="risk-place-amount-options" class="risk-dice-choice risk-compact-choice" hidden') !== false
        && strpos($riskHtml, 'id="risk-setup-placement-note" class="risk-setting-note">Setup places exactly one army per territory click.</p>') !== false,
    'Risk setup must name its placement group for assistive tech and hide the reinforce-only amount chooser.'
);
preg_match('/<div id="risk-action-stage" class="risk-action-stage risk-phase-controls">(?P<stage>.*?)<\/div>\s*<\/div>\s*<section id="risk-battle-panel"/s', $riskHtml, $riskActionStage);
public_ux_assert(isset($riskActionStage['stage']), 'Risk action row must keep its phase stage directly ahead of the battle dice.');
foreach (['reinforce,setup', 'attack,conquer', 'fortify'] as $riskPhasePanel) {
    public_ux_assert(
        strpos($riskActionStage['stage'], 'data-risk-phase-panel="' . $riskPhasePanel . '"') !== false,
        'Risk must keep phase controls for ' . $riskPhasePanel . ' inside the single action row.'
    );
}
public_ux_assert(
    !preg_match('/<h[2-6] id="risk-(?:cards|attack|fortify|conquest|defense)-title">/', $riskHtml)
        && !preg_match('/class="risk-subpanel[ "]/', $riskActionStage['stage'])
        && substr_count($riskActionStage['stage'], 'class="risk-visually-hidden"') === 5,
    'Risk phase groups must not render their own visible heading blocks or stacked sub-panels.'
);
public_ux_assert(
    (bool) preg_match('/<section id="risk-battle-panel" class="risk-battle-panel" aria-label="Battle dice" hidden>\s*<section id="risk-dice-tray" class="risk-dice-tray"/', $riskHtml),
    'Risk dice tray must sit in its own battle panel under the action row.'
);
foreach (['conquest', 'fortify'] as $riskMoverName) {
    $riskMoverPrefix = 'risk-' . $riskMoverName;
    public_ux_assert(
        strpos($riskActionStage['stage'], 'id="' . $riskMoverPrefix . '-mover"') !== false
            && (bool) preg_match(
                '/<div id="' . $riskMoverPrefix . '-mover" class="risk-army-mover" role="group" aria-labelledby="' . $riskMoverPrefix . '-count-label">'
                . '.*?<label id="' . $riskMoverPrefix . '-count-label" for="' . $riskMoverPrefix . '-count">Armies to move<\/label>'
                . '\s*<input id="' . $riskMoverPrefix . '-range" class="risk-army-range" type="range"[^>]*aria-label="[^"]+"[^>]*aria-describedby="' . $riskMoverPrefix . '-preview"[^>]*>'
                . '\s*<input id="' . $riskMoverPrefix . '-count" type="number"[^>]*aria-describedby="[^"]*' . $riskMoverPrefix . '-preview"[^>]*>'
                . '.*?id="' . $riskMoverPrefix . '-min" data-army-quick="min"[^>]*>Min<\/button>'
                . '.*?id="' . $riskMoverPrefix . '-half" data-army-quick="half"[^>]*>Half<\/button>'
                . '.*?id="' . $riskMoverPrefix . '-all" data-army-quick="all"[^>]*>All<\/button>'
                . '.*?<p id="' . $riskMoverPrefix . '-preview" class="risk-army-preview">/s',
                $riskHtml
            ),
        'Risk ' . $riskMoverName . ' must use the shared army mover: a labelled range slider and number field, Min/Half/All shortcuts and a split preview.'
    );
}
public_ux_assert(
    (bool) preg_match('/<div class="risk-primary-actions">.*?id="risk-end-button"[^>]*>End phase<\/button>\s*<div id="risk-confirm-strip" class="risk-confirm-strip" role="group" aria-labelledby="risk-confirm-message" hidden>\s*<p id="risk-confirm-message" class="risk-confirm-message">[^<]+<\/p>\s*<div class="risk-confirm-actions">\s*<button class="risk-button risk-button-primary" type="button" id="risk-confirm-yes">Confirm<\/button>\s*<button class="risk-button" type="button" id="risk-confirm-cancel">Cancel<\/button>\s*<\/div>\s*<\/div>\s*<\/div>\s*<div id="risk-action-stage"/s', $riskHtml),
    'Risk end-attacks and end-turn confirmations must render as an initially hidden inline strip with Confirm and Cancel inside the dock action row.'
);
public_ux_assert(
    (bool) preg_match('/id="risk-start-button".*?<div id="risk-restart-confirm" class="risk-confirm-strip risk-restart-confirm" role="group" aria-labelledby="risk-restart-confirm-message" hidden>\s*<p id="risk-restart-confirm-message" class="risk-confirm-message">[^<]+<\/p>\s*<div class="risk-confirm-actions">\s*<button class="risk-button risk-button-primary" type="button" id="risk-restart-confirm-yes">Confirm<\/button>\s*<button class="risk-button" type="button" id="risk-restart-confirm-cancel">Cancel<\/button>/s', $riskHtml),
    'Risk restart must keep an inline confirm strip with Confirm and Cancel beside the restart button.'
);
public_ux_assert(
    strpos($riskActionStage['stage'], '<button class="risk-button risk-button-undo" type="button" id="risk-undo-button" disabled>Undo placement</button>') !== false
        && (bool) preg_match('/data-risk-phase-panel="reinforce,setup".*?id="risk-undo-button".*?data-risk-phase-panel="attack,conquer"/s', $riskActionStage['stage']),
    'Risk reinforce and setup placement must offer an initially disabled Undo placement button.'
);
public_ux_assert(
    strpos($riskHtml, '<div id="risk-details-tabs" class="risk-tablist" role="tablist" aria-label="Board details">') !== false
        && strpos($riskHtml, '<button id="risk-tab-selection" class="risk-tab" type="button" role="tab" aria-selected="true" aria-controls="risk-tabpanel-selection" tabindex="0">') !== false
        && strpos($riskHtml, '<button id="risk-tab-log" class="risk-tab" type="button" role="tab" aria-selected="false" aria-controls="risk-tabpanel-log" tabindex="-1">') !== false,
    'Risk board details must be a tablist with Selection selected by default.'
);
public_ux_assert(
    (bool) preg_match('/<div id="risk-tabpanel-selection" class="risk-tabpanel risk-territory-card" role="tabpanel" aria-labelledby="risk-tab-selection" tabindex="0">.*?<div id="risk-territory-card">No territory selected\.<\/div>\s*<\/div>/s', $riskHtml)
        && strpos($riskHtml, '<span id="risk-selection-title" class="risk-detail-title">Selection</span>') !== false,
    'Risk selection details must render as the initially visible Selection tab panel.'
);
public_ux_assert(
    (bool) preg_match('/<div id="risk-tabpanel-log" class="risk-tabpanel risk-log-panel" role="tabpanel" aria-labelledby="risk-tab-log" tabindex="0" hidden>\s*<ol id="risk-log" class="risk-log"><\/ol>\s*<\/div>/', $riskHtml)
        && strpos($riskHtml, '<span id="risk-log-title" class="risk-detail-title">Battle history</span>') !== false
        && strpos($riskHtml, 'risk-detail-disclosure') === false,
    'Risk battle history must render as an initially hidden Battle history tab panel instead of a disclosure.'
);
public_ux_assert(
    $riskBoardPanelPosition !== false
        && $riskHowToPlayPosition !== false
        && $riskBoardPanelPosition < $riskHowToPlayPosition
        && (bool) preg_match('/<details id="risk-how-to-play" class="risk-panel risk-how-to-play">\s*<summary class="risk-how-to-play-toggle">.*?How to play.*?<\/summary>.*?<section class="risk-hero".*?<section class="risk-rules" aria-labelledby="risk-rules-title">.*?<\/section>\s*<\/details>/s', $riskHtml)
        && substr_count($riskHtml, '<h1') === 1,
    'Risk introduction and rules must sit below the board in a collapsed How to play disclosure, keeping one page heading.'
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
$riskScriptSource = file_get_contents($root . '/htdocs/assets/js/risk-game.js');
public_ux_assert(is_string($riskScriptSource), 'Unable to read Risk game script for its DOM contract.');
preg_match_all("/byElementId\\('([a-z0-9-]+)'\\)/", $riskScriptSource, $riskScriptIds);
public_ux_assert(count($riskScriptIds[1]) > 0, 'Risk game script DOM contract could not be read.');
foreach (array_unique($riskScriptIds[1]) as $riskScriptId) {
    public_ux_assert(
        strpos($riskHtml, 'id="' . $riskScriptId . '"') !== false,
        'Risk page must render every element id the game script looks up: ' . $riskScriptId . '.'
    );
}

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
    (bool) preg_match('/@media \(max-width: 940px\)\s*\{(?P<body>.*?)\n\}/s', $riskCss, $narrowRiskMedia)
        && (bool) preg_match('/\.risk-action-bar\s*\{(?P<rule>[^}]*)\}/s', $narrowRiskMedia['body'], $narrowRiskActionBar)
        && strpos($narrowRiskActionBar['rule'], 'position: sticky') !== false
        && strpos($narrowRiskActionBar['rule'], 'bottom: 0') !== false
        && strpos($narrowRiskActionBar['rule'], 'display: grid') !== false
        && (bool) preg_match('/\.risk-action-bar-nav a\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $narrowRiskMedia['body'])
        && (bool) preg_match('/\.risk-action-bar \.risk-action-bar-primary\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $narrowRiskMedia['body'])
        && (bool) preg_match('/\.risk-action-bar\s*\{\s*display:\s*none;\s*\}/', $riskCss)
        && strpos($riskCss, '.risk-table-nav') === false,
    'Risk must show a sticky bottom action bar with 44px targets at narrow widths, hide it on desktop, and drop the top jump nav.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-action-stage\s*\{[^}]*min-height:\s*[0-9.]+rem/s', $riskCss)
        && (bool) preg_match('/\.risk-phase-group\s*\{[^}]*animation:\s*risk-dock-fade-in/s', $riskCss)
        && (bool) preg_match('/\.risk-phase-group\[hidden\]\.is-leaving\s*\{[^}]*animation:\s*risk-dock-fade-out/s', $riskCss)
        && (bool) preg_match('/@media \(prefers-reduced-motion: reduce\)\s*\{.*?\.risk-phase-group,\s*\.risk-phase-idle\s*\{\s*animation:\s*none;.*?\.risk-phase-group\[hidden\]\.is-leaving\s*\{\s*display:\s*none;/s', $riskCss),
    'Risk dock action stage must keep a stable minimum height and crossfade phase groups, without motion under reduced-motion preferences.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-tab\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s', $riskCss)
        && (bool) preg_match('/\.risk-tabpanel\[hidden\]\s*\{\s*display:\s*none;/', $riskCss),
    'Risk board detail tabs must keep 44px targets and fully hide inactive tab panels.'
);
public_ux_assert(
    !preg_match('/\.risk-log\s*\{[^}]*(?:overflow:\s*auto|max-height:)/s', $riskCss),
    'Risk battle history must not introduce another nested scrolling region.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-confirm-strip\[hidden\]\s*\{\s*display:\s*none;/', $riskCss)
        && (bool) preg_match('/\.risk-army-range\s*\{[^}]*min-height:\s*44px/s', $riskCss)
        && (bool) preg_match('/\.risk-army-quick \.risk-button-quick\s*\{[^}]*min-height:\s*44px/s', $riskCss)
        && (bool) preg_match('/\.risk-confirm-actions \.risk-button\s*\{[^}]*min-height:\s*44px/s', $riskCss),
    'Risk confirm strips must hide fully when closed, and army mover and confirm controls must keep 44px targets.'
);
public_ux_assert(
    substr_count($riskHtml, 'role="tooltip"') === 1
        && (bool) preg_match('/<div class="risk-map-frame">\s*<div id="risk-map" class="risk-map">.*?<\/svg>\s*<\/div>\s*<div id="risk-map-tooltip" class="risk-map-tooltip" role="tooltip" hidden><\/div>\s*<\/div>/s', $riskHtml),
    'Risk must render one shared, initially hidden territory tooltip beside the scrolling board.'
);
public_ux_assert(
    (bool) preg_match('/<p class="risk-map-legend">\s*<span id="risk-legend-owners" class="risk-legend-owners"><\/span>(?P<items>.*?)<\/p>/s', $riskHtml, $riskLegend)
        && substr_count($riskLegend['items'], 'class="risk-legend-item"') === 4
        && substr_count($riskLegend['items'], 'class="risk-legend-swatch ') === 3
        && substr_count($riskLegend['items'], 'aria-hidden="true"') === 3
        && strpos($riskLegend['items'], '<strong class="risk-legend-badge">FROM</strong><strong class="risk-legend-badge is-target">TO</strong>') !== false
        && substr_count($riskLegend['items'], '<span class="risk-visually-hidden">') === 3,
    'Risk map legend must be a compact row of swatch icons with short text, naming each swatch for assistive tech.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-map-legend\s*\{[^}]*display:\s*flex;[^}]*flex-flow:\s*row wrap;/s', $riskCss)
        && (bool) preg_match('/\.risk-legend-swatch\s*\{[^}]*border-radius:\s*50%/s', $riskCss),
    'Risk map legend must lay out as one wrapping row with icon swatches.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-map-tooltip\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/s', $riskCss)
        && (bool) preg_match('/\.risk-map-tooltip\[hidden\]\s*\{\s*display:\s*none;/', $riskCss)
        && (bool) preg_match('/\.risk-map-frame\s*\{\s*position:\s*relative;/', $riskCss),
    'Risk territory tooltip must be a non-interactive overlay that hides fully.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-marker-count\s*\{[^}]*font-size:\s*clamp\(12\.5px,\s*calc\(14px \* var\(--risk-svg-unit, 1\)\),\s*22px\);/s', $riskCss)
        && (bool) preg_match('/\.risk-marker-name\s*\{[^}]*font-size:\s*clamp\(9\.5px,\s*calc\(11px \* var\(--risk-svg-unit, 1\)\),\s*15px\);/s', $riskCss)
        && (bool) preg_match('/\.risk-map\.is-names-hidden \.risk-marker-name\s*\{\s*display:\s*none;/', $riskCss)
        && strpos($riskCss, 'below 0.6 CSS px per SVG unit') !== false
        && (bool) preg_match('/\.risk-marker\.is-actionable \.risk-marker-ring\s*\{[^}]*stroke:/s', $riskCss),
    'Risk markers must render 14px counts and 11px names at Fit, hide names below the documented scale, and ring actionable territories persistently.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-map\s*\{[^}]*touch-action:\s*pan-y;/s', $riskCss)
        && (bool) preg_match('/\.risk-map\.is-scrollable\s*\{[^}]*cursor:\s*grab;[^}]*touch-action:\s*pan-x pan-y;/s', $riskCss)
        && (bool) preg_match('/\.risk-map\.is-dragging,[^{]*\{\s*cursor:\s*grabbing;/s', $riskCss),
    'Risk map must keep native vertical touch scrolling and show grab cursors while it can be dragged.'
);
public_ux_assert(
    (bool) preg_match('/\.risk-marker-count\.is-count-bump\s*\{[^}]*animation:\s*risk-count-bump/s', $riskCss)
        && (bool) preg_match('/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.risk-marker-count\.is-count-bump,[^{]*\{\s*animation:\s*none;/s', $riskCss),
    'Risk army count changes must bump briefly, with no motion under reduced-motion preferences.'
);
public_ux_assert(
    (bool) preg_match('/<div class="risk-primary-actions">\s*<p class="risk-next-action-label">Next action<\/p>\s*<button class="risk-button risk-button-skip" type="button" id="risk-skip-button" aria-pressed="false" hidden disabled>Skip to my turn<\/button>\s*<button class="risk-button risk-button-primary" type="button" id="risk-end-button" disabled>End phase<\/button>/', $riskHtml)
        && (bool) preg_match('/\.risk-button-skip\[hidden\]\s*\{\s*display:\s*none;/', $riskCss),
    'Risk must offer an initially hidden Skip to my turn button at the start of the dock action row.'
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
    (bool) preg_match('/const relocateHiddenFocus = \(\) => \{.*?!active\.closest\(\'\[hidden\]\'\).*?actionRowFocusTarget\(\)/s', $riskScript)
        && (bool) preg_match('/const renderPhaseUi = \(\) => \{.*?relocateHiddenFocus\(\);\n    \};/s', $riskScript)
        && (bool) preg_match('/const syncDecisionFocus = \(\) => \{.*?const relocatedFocus = relocateHiddenFocus\(\);/s', $riskScript)
        && strpos($riskScript, 'turnGuidance.focus(') === false
        && strpos($riskScript, 'elements.turnGuidance].find(canFocus)') === false,
    'Risk must only move focus when the focused dock control was hidden, and then to the first enabled action-row control, never the guidance paragraph.'
);
public_ux_assert(
    strpos($riskScript, "ArrowRight: index === last ? 0 : index + 1") !== false
        && strpos($riskScript, "ArrowLeft: index === 0 ? last : index - 1") !== false
        && strpos($riskScript, 'Home: 0') !== false
        && strpos($riskScript, 'End: last') !== false
        && strpos($riskScript, "candidate.setAttribute('aria-selected', selected ? 'true' : 'false');") !== false,
    'Risk board detail tabs must support arrow, Home and End keys and keep aria-selected in sync.'
);
public_ux_assert(
    strpos($riskScript, 'setTablePanelOpen(!state.active);') !== false
        && strpos($riskScript, "if (visible && elements.lobbyPanel.hidden && !state.active) {\n            setTablePanelOpen(true);") !== false,
    'Risk Game setup & lobby section must follow the setup disclosure and open when an online lobby appears.'
);
public_ux_assert(
    strpos($riskScript, "root.querySelectorAll('.risk-action-bar-nav a[href^=\"#\"]')") !== false
        && (bool) preg_match('/uxElements\.actionBarPrimary\?\.addEventListener\(\'click\', \(\) => \{\s*if \(!asButton\(elements\.endButton\)\.disabled\) \{\s*elements\.endButton\.click\(\);/', $riskScript)
        && strpos($riskScript, 'setText(primary, source.textContent') !== false,
    'Risk narrow-screen action bar must mirror the primary action and wire its Board/Decision jump links.'
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
public_ux_assert(
    (bool) preg_match('/if \(handleAttackSelection\(territory\)\) \{.*?humanAttack\(\);\s*return;/s', $riskScript)
        && (bool) preg_match('/const handleAttackSelection = \(territory\) => \{.*?if \(runtime\.blitzing\) \{\s*return false;.*?return true;\n    \};/s', $riskScript)
        && (bool) preg_match('/const selectTerritory = \(territoryId\) => \{.*?if \(state\.current_seat !== runtime\.localSeat\) \{.*?if \(state\.busy\) \{.*?handleAttackSelection\(territory\)/s', $riskScript)
        && strpos($riskScript, 'elements.attackButton.addEventListener(\'click\', humanAttack);') !== false
        && strpos($riskScript, 'uxElements.blitzButton?.addEventListener(\'click\', toggleBlitz);') !== false,
    'Risk must roll a battle when an adjacent enemy is activated with a legal attacker selected, never while busy or off-turn, and keep Roll attack and Blitz.'
);
public_ux_assert(
    strpos($riskScript, 'const createArmyMover = (') !== false
        && strpos($riskScript, "rangeInput.addEventListener('input'") !== false
        && strpos($riskScript, "numberInput.addEventListener('change', value);") !== false
        && strpos($riskScript, "if (event.key === 'Enter') {\n                    event.preventDefault();\n                    value();\n                    onConfirm();") !== false
        && strpos($riskScript, "quick === 'min'") !== false
        && strpos($riskScript, 'return Math.min(bounds.max, Math.max(bounds.min, whole));') !== false
        && strpos($riskScript, 'moveIntoConquest(runtime.localSeat, conquestMover.value())') !== false
        && strpos($riskScript, 'performFortify(runtime.localSeat, source, target, fortifyMover.value())') !== false
        && strpos($riskScript, 'stays in ${sourceName} · ${moves} moves to ${targetName}') !== false,
    'Risk conquest and fortify must share one clamping army mover with synced slider and number, Min/Half/All, a split preview and Enter to confirm.'
);
public_ux_assert(
    (bool) preg_match('/if \(hasLegalAttack\(runtime\.localSeat\)\) \{\s*openConfirmation\(\'end-attacks\'\);\s*return;\s*\}\s*endAttacks\(\);/', $riskScript)
        && (bool) preg_match('/if \(hasLegalFortify\(runtime\.localSeat\)\) \{\s*openConfirmation\(\'end-turn\'\);\s*return;\s*\}\s*endTurnWithoutFortify\(\);/', $riskScript)
        && strpos($riskScript, "openConfirmation('restart');") !== false
        && strpos($riskScript, "if (/** @type {KeyboardEvent} */ (event).key === 'Escape' && runtime.confirmation) {") !== false
        && strpos($riskScript, "elements.confirmCancel.addEventListener('click', closeConfirmation);") !== false
        && strpos($riskScript, "elements.confirmYes.addEventListener('click', resolveConfirmation);") !== false
        && strpos($riskScript, 'Confirm: end attacks') === false
        && strpos($riskScript, 'restartConfirmationTimer') === false,
    'Risk End attacks, End turn and Restart must confirm in persistent inline strips (Escape cancels), skipping them when no legal attack or fortify remains.'
);
public_ux_assert(
    strpos($riskScript, "elements.undoButton.addEventListener('click', undoPlacement);") !== false
        && (bool) preg_match('/const handleReinforceClick = \(territory\) => \{.*?recordPlacement\(territory, count, previousSourceId\);/s', $riskScript)
        && (bool) preg_match('/const handleSetupClick = \(territory\) => \{.*?recordPlacement\(territory, 1, state\.sourceId\);/s', $riskScript)
        && (bool) preg_match('/const cancelPending = \(\) => \{.*?runtime\.placementUndo = \[\];/s', $riskScript)
        && (bool) preg_match('/const enterAttackPhase = \(player\) => \{.*?runtime\.placementUndo = \[\];/s', $riskScript)
        && (bool) preg_match('/const beginTurn = \(player\) => \{\s*runtime\.placementUndo = \[\];/', $riskScript)
        && (bool) preg_match('/markOnlineAction\(\'trade\'\);.*?runtime\.placementUndo = \[\];/s', $riskScript)
        && strpos($riskScript, 'undoButton.disabled = undoPending || !(humanTurn && latestUndoablePlacement());') !== false,
    'Risk Undo placement must revert the latest local placement and clear its stack on phase changes, trades, bot turns and remote updates.'
);
public_ux_assert(
    (bool) preg_match('/const applyRemoteState = \(remote, version\) => \{.*?sourceId: state\.sourceId,\s*targetId: state\.targetId\s*\};.*?const selection = keepLegalSelection\(keep\.sourceId, keep\.targetId\);\s*state\.sourceId = selection\.sourceId;\s*state\.targetId = selection\.targetId;/s', $riskScript)
        && (bool) preg_match('/const keepLegalSelection = \(sourceId, targetId\) => \{.*?attackError\(viewer, source, target,.*?fortifyError\(viewer, source, target, 1\)/s', $riskScript)
        && strpos($riskScript, 'state.selectedCardIds = keep.selectedCardIds.filter((cardId) => hand.some((card) => card.id === cardId));') !== false,
    'Risk online updates must keep the viewer\'s source, target and card selections while they remain legal.'
);
public_ux_assert(
    strpos($riskScript, 'then click an adjacent enemy to attack it at once') !== false
        && strpos($riskScript, 'Click an adjacent enemy to attack from ${ownSource.name}.') !== false
        && strpos($riskScript, 'use Min, Half or All') !== false
        && strpos($riskScript, 'Undo placement takes back your latest placement') !== false,
    'Risk phase guidance must describe one-click attacks, the army mover and Undo placement.'
);
public_ux_assert(
    strpos($riskScript, "marker.group.setAttribute('aria-describedby', mapTooltip.id);") !== false
        && strpos($riskScript, "markers.get(mapTooltipId)?.group.removeAttribute('aria-describedby');") !== false
        && strpos($riskScript, "group.addEventListener('pointerenter'") !== false
        && strpos($riskScript, "group.addEventListener('pointerleave'") !== false
        && strpos($riskScript, "group.addEventListener('focus'") !== false
        && strpos($riskScript, "group.addEventListener('blur'") !== false
        && strpos($riskScript, "(event).key === 'Escape' && mapTooltipId") !== false
        && strpos($riskScript, "if (mapInput.type === 'touch') {\n                showMapTooltip(territoryId);") !== false
        && strpos($riskScript, 'return open(`Attack from ${source.name}`);') !== false
        && strpos($riskScript, "return open('Legal fortify target');") !== false
        && strpos($riskScript, "return open('Place armies here');") !== false,
    'Risk markers must share one tooltip with owner, armies and a contextual hint, linked by aria-describedby and hidden on pointerleave, blur and Escape.'
);
public_ux_assert(
    strpos($riskScript, 'const MAP_DRAG_THRESHOLD = 6;') !== false
        && strpos($riskScript, 'if (Math.hypot(dx, dy) < MAP_DRAG_THRESHOLD) {') !== false
        && strpos($riskScript, "elements.map.addEventListener('pointermove', (event) => {") !== false
        && strpos($riskScript, 'mapGesture.suppressClick') !== false
        && strpos($riskScript, "if (!event.ctrlKey && !event.metaKey) {\n            return;\n        }") !== false
        && strpos($riskScript, '}, { passive: false });') !== false
        && strpos($riskScript, "elements.map.addEventListener('touchmove', (event) => {") !== false
        && strpos($riskScript, "elements.map.addEventListener('dblclick', (event) => {") !== false
        && strpos($riskScript, 'MAP_ZOOM_DETAIL = 1.4') !== false
        && (bool) preg_match('/const zoomMapAt = \(level, clientX, clientY, options = \{\}\) => \{.*?applyMapZoom\(level, Boolean\(options\.persist\)\);/s', $riskScript)
        && strpos($riskScript, 'window.localStorage.setItem(MAP_ZOOM_STORAGE_KEY, String(runtime.mapZoom));') !== false
        && strpos($riskScript, 'const MAP_ZOOM_MIN = 0.6;') !== false
        && strpos($riskScript, 'const MAP_ZOOM_MAX = 2;') !== false,
    'Risk map must drag-pan past a 6px threshold, zoom with Ctrl/Cmd + wheel, pinch and double-click through applyMapZoom within 0.6-2, and keep plain wheel scrolling.'
);
public_ux_assert(
    (bool) preg_match('/const scrollTerritoryIntoView = \(territoryId\) => \{.*?elements\.map\.getBoundingClientRect\(\);.*?marker\.ring\.getBoundingClientRect\(\);.*?box\.left >= visibleLeft && box\.right <= visibleRight.*?reducedMotion\(\) \? \'auto\' : \'smooth\'/s', $riskScript)
        && strpos($riskScript, 'marker.group.scrollIntoView(') === false,
    'Risk must scroll the board to a selected territory only when its marker lies outside the visible map frame.'
);
public_ux_assert(
    (bool) preg_match('/const renderMap = \(\) => \{.*?const raiseLands = selectionKey !== runtime\.mapSelectionKey;.*?if \(raiseLands\) \{.*?path\.parentNode\.appendChild\(path\);.*?pulseElement\(count, \'is-count-bump\', 520\).*?refreshMapTooltip\(\);\n    \};/s', $riskScript)
        && substr_count($riskScript, 'path.parentNode.appendChild(path);') === 1
        && strpos($riskScript, "actionable.has(territory.id) ? 'is-actionable' : ''") !== false,
    'Risk renderMap must restack land paths only when the selection changes, bump changed army counts, and mark actionable territories.'
);
public_ux_assert(
    strpos($riskScript, 'const AI_WORKER_TIME_BUDGET_MS = 1500;') !== false
        && strpos($riskScript, 'normal: { budgetMs: AI_WORKER_TIME_BUDGET_MS, timeoutMs: AI_WORKER_TIMEOUT_MS }') !== false
        && strpos($riskScript, 'fast: { budgetMs: 600,') !== false
        && strpos($riskScript, 'instant: { budgetMs: 200,') !== false
        && (bool) preg_match('/const requestBotAction = \(seat\) => \{.*?const budget = botThinkBudget\(\);.*?\}, budget\.timeoutMs\);.*?options: \{ timeBudgetMs: budget\.budgetMs \}/s', $riskScript)
        && (bool) preg_match('/const pace = \(milliseconds\) => \{\s*const speed = effectiveSpeed\(\);\s*if \(speed === \'instant\'\) \{\s*return 0;/', $riskScript),
    'Risk bot think time and pacing must follow the Speed setting: 1500ms at Normal, at most 600ms at Fast, at most 200ms and no delay at Instant.'
);
public_ux_assert(
    strpos($riskScript, 'const effectiveSpeed = () => (runtime.skipToTurn ? \'instant\' : runtime.speed);') !== false
        && strpos($riskScript, "uxElements.skipButton?.addEventListener('click', toggleSkipToTurn);") !== false
        && (bool) preg_match('/const toggleSkipToTurn = \(\) => \{.*?runtime\.skipToTurn = true;.*?uxElements\.announcer\.textContent = /s', $riskScript)
        && (bool) preg_match('/const syncSkipToTurn = \(\) => \{\s*if \(runtime\.skipToTurn && !canSkipBotTurn\(\)\) \{\s*runtime\.skipToTurn = false;/', $riskScript)
        && (bool) preg_match('/const canSkipBotTurn = \(\) => state\.active.*?isBot\(state\.current_seat\).*?!state\.pendingDefense;/s', $riskScript),
    'Risk Skip to my turn must force instant bot turns, be announced once, and end at the next human decision.'
);
public_ux_assert(
    strpos($riskScript, 'const logBattle = (battle, summary) => {') !== false
        && strpos($riskScript, 'attacks ${battle.targetName} from ${battle.sourceName} ×${tally.count} — attacker lost ${tally.attackerLost}, defender lost ${tally.defenderLost}${battle.conquered ? \', conquered\' : \'\'}.') !== false
        && strpos($riskScript, "if (!isBot(battle.attacker) && !runtime.blitzing) {") !== false
        && strpos($riskScript, 'retained[0].node.textContent = text;') !== false
        && strpos($riskScript, 'elements.log.scrollTop = previousScrollTop + (scrollAnchor.offsetTop - previousAnchorOffset);') !== false,
    'Risk must collapse consecutive bot and Blitz battles over one border into one live-updating log entry while keeping the log scroll anchor.'
);
public_ux_assert(
    (bool) preg_match('/const syncOnlineState = \(\) => \{(?P<body>.*?)\n    \};/s', $riskScript, $riskSyncOnlineState)
        && strpos($riskSyncOnlineState['body'], 'if (runtime.stateRevision === online.syncedRevision) {') !== false
        && strpos($riskSyncOnlineState['body'], 'JSON.stringify') === false
        && strpos($riskScript, 'expected_version: online.version, state: job.state') !== false
        && (bool) preg_match('/const markStateChanged = \(\) => \{\s*runtime\.stateRevision \+= 1;/', $riskScript)
        && (bool) preg_match('/const addLog = \(message\) => \{\s*markStateChanged\(\);/', $riskScript)
        && (bool) preg_match('/const applyBotAction = \(seat, action\) => \{\s*let error = \'\';\s*markStateChanged\(\);/', $riskScript)
        && (bool) preg_match('/const undoPlacement = \(\) => \{.*?runtime\.placementUndo\.pop\(\);\s*markStateChanged\(\);/s', $riskScript)
        && (bool) preg_match('/const endAttacks = \(\) => \{\s*markOnlineAction\(\'end\'\);\s*markStateChanged\(\);/', $riskScript)
        && (bool) preg_match('/const applyRemoteState = \(remote, version\) => \{.*?markStateChanged\(\);\s*online\.syncedRevision = runtime\.stateRevision;/s', $riskScript)
        && (bool) preg_match('/const guidanceContextKey = \(\) => \[(?P<body>.*?)\]\.join\(\'\|\'\);/s', $riskScript, $riskGuidanceKey)
        && strpos($riskGuidanceKey['body'], 'JSON.stringify') === false,
    'Risk online sync must serialize only when runtime.stateRevision changed, keep its optimistic-version posts, and key guidance without serializing the state.'
);
public_ux_assert(
    strpos($riskScript, 'const POLL_MS = 2500;') !== false
        && (bool) preg_match('/const startPolling = \(\) => \{.*?if \(document\.hidden\) \{\s*return;\s*\}.*?\}, POLL_MS\);/s', $riskScript)
        && (bool) preg_match('/document\.addEventListener\(\'visibilitychange\', \(\) => \{.*?clearPollTimer\(\);.*?startPolling\(\);\s*pollOnlineGame\(\);/s', $riskScript)
        && (bool) preg_match('/const flushOnlinePost = async \(\) => \{.*?render\(\);\s*flushOnlinePost\(\);.*?pollOnlineGame\(\);.*?\} catch \(error\) \{/s', $riskScript),
    'Risk online play must poll right after an acknowledged post, pause polling while hidden and poll at once when visible again.'
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
