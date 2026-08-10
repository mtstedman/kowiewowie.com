<?php

declare(strict_types=1);

/**
 * Send a JSON API response and stop request processing.
 *
 * @param array<string, mixed>|list<mixed> $payload
 */
function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Load a JSON data source from the template data directory.
 *
 * @return list<array<string, mixed>>
 */
function loadDataSource(string $filename): array
{
    $path = __DIR__ . '/../htdocs/data/' . $filename;
    $contents = file_get_contents($path);

    if ($contents === false) {
        respond([
            'error' => 'data_unavailable',
            'message' => 'The requested data source could not be loaded.',
        ], 500);
    }

    try {
        $data = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        respond([
            'error' => 'data_invalid',
            'message' => 'The requested data source is not valid JSON.',
        ], 500);
    }

    if (!is_array($data)) {
        respond([
            'error' => 'data_invalid',
            'message' => 'The requested data source is not an array.',
        ], 500);
    }

    return $data;
}

/**
 * Return a single item by slug from a loaded data source.
 *
 * @param list<array<string, mixed>> $items
 * @return array<string, mixed>
 */
function findBySlug(array $items, string $slug): array
{
    foreach ($items as $item) {
        if (($item['slug'] ?? null) === $slug) {
            return $item;
        }
    }

    respond([
        'error' => 'not_found',
        'message' => 'The requested API resource does not exist.',
    ], 404);
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
$route = preg_replace('#^/api(?=/|$)#', '', $path) ?: '/';

$dataSources = [
    'decks' => 'decks.json',
    'recipes' => 'recipes.json',
    'games' => 'games.json',
    'guides' => 'deck-guides.json',
    'music' => 'music.json',
];

$segments = array_values(array_filter(explode('/', $route), static fn (string $segment): bool => $segment !== ''));
$resource = $segments[0] ?? '';
$slug = $segments[1] ?? null;

match (true) {
    $route === '/' => respond([
        'name' => 'wowiekowie API',
        'version' => 'v1',
        'status' => 'ready',
        'health' => '/health',
    ]),
    $route === '/health' => respond([
        'status' => 'ok',
        'service' => 'api.wowiekowie.com',
        'time' => gmdate(DATE_ATOM),
    ]),
    count($segments) === 1 && isset($dataSources[$resource]) => respond(loadDataSource($dataSources[$resource])),
    count($segments) === 2 && isset($dataSources[$resource]) && $resource !== 'music' => respond(findBySlug(loadDataSource($dataSources[$resource]), $slug ?? '')),
    default => respond([
        'error' => 'not_found',
        'message' => 'The requested API endpoint does not exist.',
    ], 404),
};
