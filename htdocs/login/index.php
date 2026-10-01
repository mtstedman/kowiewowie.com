<?php

declare(strict_types=1);

$year = gmdate('Y');
$pageTitle = 'Log in - wowiekowie.com';
$metaDescription = 'Sign in to your wowiekowie.com account, or create one when sign-ups are open.';
$pageStyles = ['/assets/css/login.css'];
$loginScriptPath = dirname(__DIR__) . '/assets/js/login.js';
$loginScriptVersion = is_file($loginScriptPath) ? (string) filemtime($loginScriptPath) : '1';

if (PHP_SAPI !== 'cli') {
    header('Cache-Control: no-store');
}

require dirname(__DIR__) . '/partials/head.php';
?>
<body>
    <div class="page-shell">
        <?php require dirname(__DIR__) . '/partials/header.php'; ?>

        <main>
            <section class="hero hero-compact" aria-labelledby="login-title">
                <p class="eyebrow">Account</p>
                <h1 id="login-title">Sign in and the site remembers you.</h1>
                <p class="lede">
                    One account keeps your identity steady across visits. Your session lives in a secure cookie,
                    and this browser never stores your password.
                </p>
            </section>

            <section class="foundation login-panel" aria-labelledby="login-panel-title" data-login-root data-login-state="loading">
                <h2 id="login-panel-title" class="public-visually-hidden">Account access</h2>

                <div class="login-status-row">
                    <p class="login-status" role="status" data-login-status>Checking whether you are already signed in&hellip;</p>
                    <button class="button login-retry" type="button" data-login-retry hidden>Try again</button>
                </div>

                <noscript>
                    <p class="login-status">Signing in needs JavaScript. Please enable it and reload this page.</p>
                </noscript>

                <div class="login-account" data-login-account hidden>
                    <h2 id="login-account-title" tabindex="-1" data-login-account-title>You are signed in</h2>
                    <dl class="login-account-details">
                        <div>
                            <dt>Name</dt>
                            <dd data-login-account-name></dd>
                        </div>
                        <div>
                            <dt>Email</dt>
                            <dd data-login-account-email></dd>
                        </div>
                    </dl>
                    <div class="login-actions">
                        <a class="button" href="/" data-login-continue>Continue <span aria-hidden="true">-&gt;</span></a>
                        <button class="button" type="button" data-login-logout>Log out</button>
                    </div>
                    <p class="login-error" id="login-account-error" role="alert" tabindex="-1" data-login-account-error hidden></p>
                </div>

                <div class="login-forms" data-login-forms hidden>
                    <form class="login-form" method="post" action="/login/" aria-labelledby="login-form-title" data-login-form="login">
                        <h2 id="login-form-title" tabindex="-1" data-login-form-title>Sign in</h2>
                        <div class="login-field">
                            <label for="login-email">Email</label>
                            <input id="login-email" name="email" type="email" autocomplete="username" maxlength="320" required aria-describedby="login-form-error">
                        </div>
                        <div class="login-field">
                            <label for="login-password">Password</label>
                            <input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required aria-describedby="login-form-error">
                        </div>
                        <p class="login-error" id="login-form-error" role="alert" tabindex="-1" data-login-form-error hidden></p>
                        <button class="button login-submit" type="submit" data-login-submit data-busy-label="Signing in&hellip;">Sign in</button>
                    </form>

                    <form class="login-form" method="post" action="/login/" aria-labelledby="register-form-title" aria-describedby="register-form-note" data-login-form="register">
                        <h2 id="register-form-title">Create an account</h2>
                        <p class="login-note" id="register-form-note">New accounts open only while sign-ups are enabled. If they are closed, we will say so here.</p>
                        <div class="login-field">
                            <label for="register-name">Display name</label>
                            <input id="register-name" name="display_name" type="text" autocomplete="nickname" maxlength="120" required aria-describedby="register-form-error">
                        </div>
                        <div class="login-field">
                            <label for="register-email">Email</label>
                            <input id="register-email" name="email" type="email" autocomplete="email" maxlength="320" required aria-describedby="register-form-error">
                        </div>
                        <div class="login-field">
                            <label for="register-password">Password</label>
                            <input id="register-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required aria-describedby="register-password-hint register-form-error">
                            <p class="login-hint" id="register-password-hint">At least 12 characters.</p>
                        </div>
                        <p class="login-error" id="register-form-error" role="alert" tabindex="-1" data-login-form-error hidden></p>
                        <button class="button login-submit" type="submit" data-login-submit data-busy-label="Creating account&hellip;">Create account</button>
                    </form>
                </div>
            </section>
        </main>

        <?php require dirname(__DIR__) . '/partials/footer.php'; ?>
    </div>
    <script type="module" src="/assets/js/login.js?v=<?= rawurlencode($loginScriptVersion) ?>"></script>
</body>
</html>
