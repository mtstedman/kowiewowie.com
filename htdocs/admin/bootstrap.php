<?php

declare(strict_types=1);

use Wowie\Api\Auth\AuthService;
use Wowie\Api\Auth\JwtService;
use Wowie\Api\Config;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Database\Database;

require_once __DIR__ . '/../../api/bootstrap.php';

function admin_bootstrap_start_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

function admin_config(): Config
{
    static $config = null;

    if (!$config instanceof Config) {
        $config = Config::load(dirname(__DIR__, 2));
    }

    return $config;
}

function admin_pdo(): PDO
{
    static $pdo = null;

    if (!$pdo instanceof PDO) {
        $pdo = Database::connect(admin_config());
    }

    return $pdo;
}

function admin_content_repository(): ContentRepository
{
    static $repository = null;

    if (!$repository instanceof ContentRepository) {
        $repository = new ContentRepository(admin_pdo());
    }

    return $repository;
}

function admin_auth_service(): AuthService
{
    static $auth = null;

    if (!$auth instanceof AuthService) {
        $config = admin_config();
        $auth = new AuthService(admin_pdo(), new JwtService($config), $config);
    }

    return $auth;
}

function admin_csrf_token(): string
{
    admin_bootstrap_start_session();

    if (!isset($_SESSION['admin_csrf_token']) || !is_string($_SESSION['admin_csrf_token'])) {
        $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['admin_csrf_token'];
}

function admin_csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="'
        . htmlspecialchars(admin_csrf_token(), ENT_QUOTES, 'UTF-8')
        . '">';
}

function admin_verify_csrf_token(mixed $token): bool
{
    admin_bootstrap_start_session();

    return is_string($token)
        && isset($_SESSION['admin_csrf_token'])
        && is_string($_SESSION['admin_csrf_token'])
        && hash_equals($_SESSION['admin_csrf_token'], $token);
}
