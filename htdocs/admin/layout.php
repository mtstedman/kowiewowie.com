<?php

declare(strict_types=1);

/**
 * Shared admin layout and session-based access checks.
 * Login code should populate $_SESSION['admin_user'] with id, email/display_name, and roles.
 */
function admin_start_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

/** @return array<string, mixed>|null */
function admin_current_user(): ?array
{
    admin_start_session();

    $user = $_SESSION['admin_user'] ?? $_SESSION['user'] ?? null;
    return is_array($user) ? $user : null;
}

function admin_login_url(): string
{
    $requestUri = $_SERVER['REQUEST_URI'] ?? '/admin/';
    return '/admin/login.php?return_to=' . rawurlencode($requestUri);
}

/** @return array<string, mixed> */
function admin_require_user(): array
{
    $user = admin_current_user();
    if ($user !== null) {
        return $user;
    }

    header('Location: ' . admin_login_url(), true, 302);
    exit;
}

/** @param array<string, mixed> $user */
function admin_user_is_admin(array $user): bool
{
    $roles = $user['roles'] ?? [];
    if (is_string($roles)) {
        $decoded = json_decode($roles, true);
        $roles = is_array($decoded) ? $decoded : [$roles];
    }

    return is_array($roles) && in_array('admin', $roles, true);
}

/** @param array<string, mixed> $user */
function admin_display_name(array $user): string
{
    $name = $user['display_name'] ?? $user['email'] ?? 'Admin user';
    return is_scalar($name) ? (string) $name : 'Admin user';
}

/** @param array<string, mixed> $user */
function admin_require_admin(array $user): void
{
    if (admin_user_is_admin($user)) {
        return;
    }

    http_response_code(403);
    admin_render_page(
        'Permission denied',
        static function () use ($user): void {
            ?>
            <section class="admin-panel admin-denied" aria-labelledby="denied-title">
                <p class="admin-eyebrow">403</p>
                <h1 id="denied-title">Permission denied</h1>
                <p><?= htmlspecialchars(admin_display_name($user), ENT_QUOTES, 'UTF-8') ?> does not have administrator access.</p>
            </section>
            <?php
        },
        $user,
    );
    exit;
}

/**
 * @param callable(): void $content
 * @param array<string, mixed>|null $user
 */
function admin_render_page(string $title, callable $content, ?array $user = null): void
{
    $user ??= admin_current_user();
    $pageTitle = $title === '' ? 'Admin' : $title . ' | Admin';
    $navItems = [
        ['href' => '/admin/', 'label' => 'Dashboard'],
        ['href' => '/admin/recipes.php', 'label' => 'Recipes'],
        ['href' => '/admin/decks.php', 'label' => 'Decks'],
        ['href' => '/admin/guides.php', 'label' => 'Guides'],
        ['href' => '/admin/games.php', 'label' => 'Games'],
        ['href' => '/admin/music.php', 'label' => 'Music'],
    ];
    $currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '/admin/', PHP_URL_PATH) ?: '/admin/';
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
        <link rel="stylesheet" href="/admin/style.css">
    </head>
    <body>
        <div class="admin-shell">
            <header class="admin-header">
                <a class="admin-brand" href="/admin/">wowiekowie admin</a>
                <?php if ($user !== null && admin_user_is_admin($user)): ?>
                    <nav class="admin-nav" aria-label="Admin sections">
                        <?php foreach ($navItems as $item): ?>
                            <?php $isActive = $currentPath === $item['href']; ?>
                            <a class="admin-nav-link<?= $isActive ? ' is-active' : '' ?>" href="<?= htmlspecialchars($item['href'], ENT_QUOTES, 'UTF-8') ?>"<?= $isActive ? ' aria-current="page"' : '' ?>>
                                <?= htmlspecialchars($item['label'], ENT_QUOTES, 'UTF-8') ?>
                            </a>
                        <?php endforeach; ?>
                    </nav>
                <?php endif; ?>
                <?php if ($user !== null): ?>
                    <div class="admin-account">
                        <span><?= htmlspecialchars(admin_display_name($user), ENT_QUOTES, 'UTF-8') ?></span>
                    </div>
                <?php endif; ?>
            </header>
            <main class="admin-main">
                <?php $content(); ?>
            </main>
        </div>
    </body>
    </html>
    <?php
}
