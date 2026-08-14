<?php

declare(strict_types=1);

$publicNavItems = [
    'recipes' => ['href' => '/recipes/', 'label' => 'Recipes'],
    'decks' => ['href' => '/decks/', 'label' => 'Decks'],
    'games' => ['href' => '/games/', 'label' => 'Games'],
    'chess' => ['href' => '/chess/', 'label' => 'Chess'],
    'music' => ['href' => '/music/', 'label' => 'Music'],
    'videos' => ['href' => '/videos/', 'label' => 'Videos'],
    'dongs' => ['href' => '/dongs/', 'label' => 'Dongs'],
];

$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$currentPublicSection = null;

if (is_string($requestPath) && $requestPath !== '' && $requestPath !== '/') {
    $firstPathSegment = explode('/', trim($requestPath, '/'))[0] ?? '';

    if (array_key_exists($firstPathSegment, $publicNavItems)) {
        $currentPublicSection = $firstPathSegment;
    }
}
?>
<a class="skip-link" href="#main-content">Skip to main content</a>
<header class="site-header" aria-label="Site header">
    <a class="wordmark" href="/" aria-label="wowiekowie.com home">
        <span class="wordmark-mark" aria-hidden="true">w</span>
        <span class="wordmark-text">wowiekowie.com</span>
    </a>
    <nav class="site-nav" aria-label="Primary navigation">
        <?php foreach ($publicNavItems as $sectionKey => $navItem): ?>
            <a href="<?= htmlspecialchars($navItem['href'], ENT_QUOTES, 'UTF-8') ?>"<?= $currentPublicSection === $sectionKey ? ' aria-current="page"' : '' ?>><?= htmlspecialchars($navItem['label'], ENT_QUOTES, 'UTF-8') ?></a>
        <?php endforeach; ?>
    </nav>
    <span class="status"><span class="status-dot" aria-hidden="true"></span>site awake</span>
</header>
<span id="main-content" class="skip-target" tabindex="-1"></span>
