<?php

declare(strict_types=1);

/**
 * Send a JSON API response and stop request processing.
 *
 * @param array<string, mixed> $payload
 */
function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

$requestId = $_SERVER['HTTP_X_REQUEST_ID'] ?? bin2hex(random_bytes(8));
header('X-Request-ID: ' . preg_replace('/[^a-zA-Z0-9._-]/', '', $requestId));

$allowedOrigins = [
    'https://wowiekowie.com',
    'https://www.wowiekowie.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-ID');
    header('Access-Control-Max-Age: 600');
    header('Vary: Origin');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) ? rtrim($path, '/') ?: '/' : '/';

match ($path) {
    '/' => respond([
        'name' => 'wowiekowie API',
        'version' => 'v1',
        'status' => 'ready',
        'health' => '/health',
    ]),
    '/health' => respond([
        'status' => 'ok',
        'service' => 'api.wowiekowie.com',
        'time' => gmdate(DATE_ATOM),
    ]),
    default => respond([
        'error' => 'not_found',
        'message' => 'The requested API endpoint does not exist.',
    ], 404),
};
