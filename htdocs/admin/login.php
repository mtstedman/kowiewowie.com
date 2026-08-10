<?php

declare(strict_types=1);

use Wowie\Api\ApiException;

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/layout.php';

admin_bootstrap_start_session();

function admin_login_return_to(mixed $value): string
{
    if (!is_string($value) || $value === '') {
        return '/admin/index.php';
    }

    $path = parse_url($value, PHP_URL_PATH);
    if (!is_string($path) || !str_starts_with($path, '/admin/') || $path === '/admin/login.php') {
        return '/admin/index.php';
    }

    $query = parse_url($value, PHP_URL_QUERY);
    return $query !== null && $query !== '' ? $path . '?' . $query : $path;
}

function admin_login_session_user(array $user): array
{
    return [
        'id' => (string) ($user['id'] ?? ''),
        'email' => (string) ($user['email'] ?? ''),
        'display_name' => (string) ($user['display_name'] ?? ''),
        'roles' => is_array($user['roles'] ?? null) ? array_values($user['roles']) : [],
    ];
}

$returnTo = admin_login_return_to($_POST['return_to'] ?? $_GET['return_to'] ?? null);
$error = null;
$email = '';

$currentUser = admin_current_user();
if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $currentUser !== null && admin_user_is_admin($currentUser)) {
    header('Location: ' . $returnTo, true, 302);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string) ($_POST['email'] ?? ''));
    unset($_SESSION['admin_user']);

    if (!admin_verify_csrf_token($_POST['csrf_token'] ?? null)) {
        $error = 'The sign-in form expired. Please try again.';
    } else {
        try {
            $payload = admin_auth_service()->login(
                [
                    'email' => $email,
                    'password' => (string) ($_POST['password'] ?? ''),
                ],
                $_SERVER['REMOTE_ADDR'] ?? null,
                $_SERVER['HTTP_USER_AGENT'] ?? null,
            );
            $user = is_array($payload['user'] ?? null) ? $payload['user'] : [];
            admin_auth_service()->requireAnyRole($user, ['admin']);

            session_regenerate_id(true);
            $_SESSION['admin_user'] = admin_login_session_user($user);
            unset($_SESSION['admin_csrf_token']);

            header('Location: ' . $returnTo, true, 302);
            exit;
        } catch (ApiException) {
            unset($_SESSION['admin_user']);
            $error = 'The email or password is incorrect, or the account is not an administrator.';
        }
    }
}

admin_render_page(
    'Sign in',
    static function () use ($email, $error, $returnTo): void {
        ?>
        <section class="admin-panel" aria-labelledby="login-title">
            <p class="admin-eyebrow">Admin access</p>
            <h1 id="login-title">Sign in</h1>
            <?php if ($error !== null): ?>
                <p class="admin-login-error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>
            <form class="admin-login-form" method="post" action="/admin/login.php" novalidate>
                <?= admin_csrf_field() ?>
                <input type="hidden" name="return_to" value="<?= htmlspecialchars($returnTo, ENT_QUOTES, 'UTF-8') ?>">
                <label class="admin-field">
                    <span>Email</span>
                    <input type="email" name="email" value="<?= htmlspecialchars($email, ENT_QUOTES, 'UTF-8') ?>" autocomplete="email" required>
                </label>
                <label class="admin-field">
                    <span>Password</span>
                    <input type="password" name="password" autocomplete="current-password" required>
                </label>
                <button class="admin-button" type="submit">Sign in</button>
            </form>
        </section>
        <?php
    },
    null,
);
