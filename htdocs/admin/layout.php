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
                <p><?= htmlspecialchars(admin_display_name($user), ENT_QUOTES, 'UTF-8') ?> can peek at the hallway, but this control room needs an administrator role.</p>
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
        [
            'label' => 'Magic',
            'children' => [
                ['href' => '/admin/decks.php', 'label' => 'Decks'],
                ['href' => '/admin/guides.php', 'label' => 'Guides'],
            ],
        ],
        ['href' => '/admin/games.php', 'label' => 'Games'],
        ['href' => '/admin/music.php', 'label' => 'Music'],
        ['href' => '/admin/videos.php', 'label' => 'Videos'],
    ];
    $currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '/admin/', PHP_URL_PATH) ?: '/admin/';
    $adminStylesheetPath = __DIR__ . '/style.css';
    $adminStylesheetVersion = is_file($adminStylesheetPath) ? (string) filemtime($adminStylesheetPath) : '1';
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
        <link rel="stylesheet" href="/admin/style.css?v=<?= rawurlencode($adminStylesheetVersion) ?>">
    </head>
    <body>
        <div class="admin-shell">
            <header class="admin-header">
                <a class="admin-brand" href="/admin/">wowiekowie control room</a>
                <?php if ($user !== null && admin_user_is_admin($user)): ?>
                    <nav class="admin-nav" aria-label="Admin sections">
                        <?php foreach ($navItems as $item): ?>
                            <?php $children = $item['children'] ?? null; ?>
                            <?php if (is_array($children)): ?>
                                <?php
                                $isGroupActive = false;
                                foreach ($children as $child) {
                                    if (is_array($child) && ($child['href'] ?? '') === $currentPath) {
                                        $isGroupActive = true;
                                        break;
                                    }
                                }
                                ?>
                                <span class="admin-nav-group<?= $isGroupActive ? ' is-active' : '' ?>" aria-label="<?= htmlspecialchars((string) ($item['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?> admin sections">
                                    <span class="admin-nav-label<?= $isGroupActive ? ' is-active' : '' ?>">
                                        <?= htmlspecialchars((string) ($item['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?>
                                    </span>
                                    <span class="admin-nav-children">
                                        <?php foreach ($children as $child): ?>
                                            <?php if (!is_array($child)) { continue; } ?>
                                            <?php $isActive = $currentPath === ($child['href'] ?? ''); ?>
                                            <a class="admin-nav-link admin-nav-child<?= $isActive ? ' is-active' : '' ?>" href="<?= htmlspecialchars((string) ($child['href'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"<?= $isActive ? ' aria-current="page"' : '' ?>>
                                                <?= htmlspecialchars((string) ($child['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?>
                                            </a>
                                        <?php endforeach; ?>
                                    </span>
                                </span>
                            <?php else: ?>
                                <?php $isActive = $currentPath === ($item['href'] ?? ''); ?>
                                <a class="admin-nav-link<?= $isActive ? ' is-active' : '' ?>" href="<?= htmlspecialchars((string) ($item['href'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"<?= $isActive ? ' aria-current="page"' : '' ?>>
                                    <?= htmlspecialchars((string) ($item['label'] ?? ''), ENT_QUOTES, 'UTF-8') ?>
                                </a>
                            <?php endif; ?>
                        <?php endforeach; ?>
                    </nav>
                <?php endif; ?>
                <?php if ($user !== null): ?>
                    <div class="admin-account">
                        <span>Signed in as <?= htmlspecialchars(admin_display_name($user), ENT_QUOTES, 'UTF-8') ?></span>
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

                const clampPercentage = (value) => Math.min(100, Math.max(0, value));
                const easingFactor = 0.18;
                const settleThreshold = 0.12;
                const restingPosition = 50;

                for (const panel of panels) {
                    const state = {
                        currentX: restingPosition,
                        currentY: restingPosition,
                        targetX: restingPosition,
                        targetY: restingPosition,
                        frameId: null,
                    };

                    const applyHighlightPosition = () => {
                        panel.style.setProperty('--mx', `${state.currentX}%`);
                        panel.style.setProperty('--my', `${state.currentY}%`);
                    };

                    const animateHighlight = () => {
                        state.frameId = null;
                        state.currentX += (state.targetX - state.currentX) * easingFactor;
                        state.currentY += (state.targetY - state.currentY) * easingFactor;

                        const deltaX = Math.abs(state.targetX - state.currentX);
                        const deltaY = Math.abs(state.targetY - state.currentY);

                        if (deltaX <= settleThreshold && deltaY <= settleThreshold) {
                            state.currentX = state.targetX;
                            state.currentY = state.targetY;
                            applyHighlightPosition();
                            return;
                        }

                        applyHighlightPosition();
                        state.frameId = window.requestAnimationFrame(animateHighlight);
                    };

                    const ensureAnimation = () => {
                        if (state.frameId !== null) {
                            return;
                        }

                        state.frameId = window.requestAnimationFrame(animateHighlight);
                    };

                    const setHighlightTarget = (x, y) => {
                        state.targetX = clampPercentage(x);
                        state.targetY = clampPercentage(y);
                        ensureAnimation();
                    };

                    const updatePanelHighlight = (event) => {
                        const rect = panel.getBoundingClientRect();
                        if (rect.width <= 0 || rect.height <= 0) {
                            return;
                        }

                        const x = ((event.clientX - rect.left) / rect.width) * 100;
                        const y = ((event.clientY - rect.top) / rect.height) * 100;
                        setHighlightTarget(x, y);
                    };

                    panel.addEventListener('pointermove', updatePanelHighlight);
                    panel.addEventListener('pointerleave', () => {
                        setHighlightTarget(restingPosition, restingPosition);
                    });
                }
            })();
        </script>
    </body>
    </html>
    <?php
}
