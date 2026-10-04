<?php

declare(strict_types=1);

$publicNavItems = [
    'recipes' => ['href' => '/recipes/', 'label' => 'Recipes'],
    'games' => ['href' => '/games/', 'label' => 'Games'],
    'music' => ['href' => '/music/', 'label' => 'Music'],
    'videos' => ['href' => '/videos/', 'label' => 'Videos'],
    'dongs' => ['href' => '/dongs/', 'label' => 'Dongs'],
    'collectibles' => ['href' => '/collectibles/', 'label' => 'Collectibles'],
];

$publicSectionAliases = [
    'risk' => 'games',
    'chess' => 'games',
    'trivia' => 'games',
    'palworld' => 'games',
    'decks' => 'games',
];

$gameSubNavItems = [
    'games' => ['href' => '/games/', 'label' => 'Overview'],
    'chess' => ['href' => '/chess/', 'label' => 'Chess'],
    'trivia' => ['href' => '/trivia/', 'label' => 'Murder Trivia Party'],
    'risk' => ['href' => '/risk/', 'label' => 'Risk'],
    'palworld' => ['href' => '/palworld/', 'label' => 'Palworld'],
    'decks' => ['href' => '/decks/', 'label' => 'Magic Decks'],
];

$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$currentPublicSection = null;
$currentGameSubsection = null;

if (is_string($requestPath) && $requestPath !== '' && $requestPath !== '/') {
    $firstPathSegment = explode('/', trim($requestPath, '/'))[0] ?? '';
    $matchedPublicSection = $publicSectionAliases[$firstPathSegment] ?? $firstPathSegment;

    if (array_key_exists($matchedPublicSection, $publicNavItems)) {
        $currentPublicSection = $matchedPublicSection;
    }

    if (array_key_exists($firstPathSegment, $gameSubNavItems)) {
        $currentGameSubsection = $firstPathSegment;
    }
}

$isLoginPage = is_string($requestPath) && explode('/', trim($requestPath, '/'))[0] === 'login';
$accountReturnTo = '/';
if (
    is_string($requestPath)
    && str_starts_with($requestPath, '/')
    && !str_starts_with($requestPath, '//')
    && !str_contains($requestPath, '\\')
) {
    $accountReturnTo = $requestPath;
}
$accountLoginHref = $isLoginPage ? '/login/' : '/login/?return_to=' . rawurlencode($accountReturnTo);
?>
<a class="skip-link" href="#main-content">Skip to main content</a>
<header class="site-header" aria-label="Site header">
    <div class="site-header-main">
        <a class="wordmark" href="/" aria-label="wowiekowie.com home">
            <span class="wordmark-mark" aria-hidden="true">w</span>
            <span class="wordmark-text">wowiekowie.com</span>
        </a>
        <nav class="site-nav" aria-label="Primary navigation">
            <?php foreach ($publicNavItems as $sectionKey => $navItem): ?>
                <a href="<?= htmlspecialchars($navItem['href'], ENT_QUOTES, 'UTF-8') ?>"<?= $currentPublicSection === $sectionKey ? ' aria-current="page"' : '' ?>><?= htmlspecialchars($navItem['label'], ENT_QUOTES, 'UTF-8') ?></a>
            <?php endforeach; ?>
        </nav>
        <div class="site-account" role="group" aria-label="Account" data-site-account data-account-state="signed-out">
            <span class="site-account-view" data-account-view="loading" hidden>
                <span class="site-account-note">Checking account&hellip;</span>
            </span>
            <span class="site-account-view" data-account-view="signed-out">
                <a class="button site-account-link" href="<?= htmlspecialchars($accountLoginHref, ENT_QUOTES, 'UTF-8') ?>" data-account-login-link<?= $isLoginPage ? ' aria-current="page"' : '' ?>>Log in</a>
            </span>
            <span class="site-account-view" data-account-view="authenticated" hidden>
                <a class="button site-account-link" href="/login/" data-account-profile-link><span class="public-visually-hidden">Signed in as </span><span data-account-name></span></a>
                <button class="button site-account-logout" type="button" data-account-logout>Log out</button>
            </span>
            <span class="site-account-view" data-account-view="error" hidden>
                <span class="site-account-note">Could not check your account.</span>
                <button class="button site-account-retry" type="button" data-account-retry>Retry</button>
            </span>
            <span class="site-account-message" role="status" data-account-message></span>
        </div>
    </div>
    <?php if ($currentPublicSection === 'games'): ?>
        <nav class="games-subnav" aria-label="Games navigation">
            <?php foreach ($gameSubNavItems as $sectionKey => $navItem): ?>
                <a href="<?= htmlspecialchars($navItem['href'], ENT_QUOTES, 'UTF-8') ?>"<?= $currentGameSubsection === $sectionKey ? ' aria-current="page"' : '' ?>><?= htmlspecialchars($navItem['label'], ENT_QUOTES, 'UTF-8') ?></a>
            <?php endforeach; ?>
        </nav>
    <?php endif; ?>
</header>
<span id="main-content" class="skip-target" tabindex="-1"></span>
