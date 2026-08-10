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
        ['href' => '/admin/videos.php', 'label' => 'Videos'],
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
        <style>
            .admin-panel {
                --mx: 50%;
                --my: 50%;
                --admin-glass-tint: rgba(12, 18, 34, 0.68);
                --admin-glass-tint-strong: rgba(10, 14, 28, 0.82);
                --admin-glass-border-hi: rgba(255, 255, 255, 0.28);
                --admin-glass-border-mid: rgba(194, 214, 255, 0.16);
                --admin-glass-border-low: rgba(18, 24, 42, 0.56);
                --admin-glass-border-bottom: rgba(132, 164, 236, 0.24);
                --admin-glass-shimmer: rgba(255, 255, 255, 0.34);
                position: relative;
                isolation: isolate;
                overflow: hidden;
                border: 1px solid transparent;
                background:
                    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 24%) padding-box,
                    linear-gradient(180deg, var(--admin-glass-tint-strong), var(--admin-glass-tint)) padding-box,
                    linear-gradient(
                        145deg,
                        var(--admin-glass-border-hi) 0%,
                        var(--admin-glass-border-mid) 42%,
                        var(--admin-glass-border-low) 68%,
                        var(--admin-glass-border-bottom) 100%
                    ) border-box;
                -webkit-backdrop-filter: blur(22px) saturate(180%);
                backdrop-filter: blur(22px) saturate(180%);
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.08),
                    inset 0 -1px 0 rgba(6, 10, 20, 0.24),
                    0 18px 42px rgba(2, 4, 12, 0.28);
            }

            .admin-panel.admin-denied {
                --admin-glass-border-hi: rgba(255, 234, 231, 0.44);
                --admin-glass-border-mid: rgba(241, 184, 179, 0.28);
                --admin-glass-border-low: rgba(90, 24, 20, 0.54);
                --admin-glass-border-bottom: rgba(241, 184, 179, 0.34);
            }

            .admin-panel::before {
                content: "";
                position: absolute;
                inset: 0;
                z-index: -1;
                border-radius: inherit;
                pointer-events: none;
                opacity: 0;
                background: radial-gradient(
                    circle at var(--mx) var(--my),
                    var(--admin-glass-shimmer) 0,
                    rgba(255, 255, 255, 0.12) 30%,
                    transparent 60%
                );
                transition: opacity 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            .admin-panel:hover::before,
            .admin-panel:focus-within::before {
                opacity: 0.55;
            }

            .admin-panel {
                color: rgba(244, 248, 255, 0.92);
            }

            .admin-panel h1,
            .admin-panel h2,
            .admin-panel h3,
            .admin-panel h4,
            .admin-panel h5,
            .admin-panel h6 {
                color: rgba(255, 255, 255, 0.98);
            }

            .admin-panel p,
            .admin-panel label,
            .admin-panel li,
            .admin-panel dt,
            .admin-panel dd,
            .admin-panel small {
                color: rgba(230, 238, 255, 0.84);
            }

            .admin-panel .admin-eyebrow {
                color: rgba(192, 222, 255, 0.82);
            }
        </style>
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
        <script>
            (() => {
                const panels = document.querySelectorAll('.admin-panel');

                if (panels.length === 0) {
                    return;
                }

                const updatePanelHighlight = (panel, event) => {
                    const rect = panel.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) {
                        return;
                    }

                    const x = ((event.clientX - rect.left) / rect.width) * 100;
                    const y = ((event.clientY - rect.top) / rect.height) * 100;
                    panel.style.setProperty('--mx', `${x}%`);
                    panel.style.setProperty('--my', `${y}%`);
                };

                for (const panel of panels) {
                    panel.addEventListener('pointermove', (event) => {
                        updatePanelHighlight(panel, event);
                    });

                    panel.addEventListener('pointerleave', () => {
                        panel.style.setProperty('--mx', '50%');
                        panel.style.setProperty('--my', '50%');
                    });
                }
            })();
        </script>
    </body>
    </html>
    <?php
}
