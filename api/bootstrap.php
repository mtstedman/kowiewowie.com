<?php

declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $roots = [
        'Wowie\\Api\\Auth\\' => __DIR__ . '/../includes/auth/classes/',
        'Wowie\\Api\\Content\\' => __DIR__ . '/../includes/content/classes/',
        'Wowie\\Api\\Http\\' => __DIR__ . '/../includes/http/classes/',
        'Wowie\\Api\\Database\\' => __DIR__ . '/../includes/database/classes/',
        'Wowie\\Api\\Chess\\' => __DIR__ . '/../includes/chess/classes/',
        'Wowie\\Api\\' => __DIR__ . '/../includes/api/classes/',
    ];

    foreach ($roots as $prefix => $root) {
        if (!str_starts_with($class, $prefix)) {
            continue;
        }

        $relative = substr($class, strlen($prefix));
        $path = $root . str_replace('\\', '/', $relative) . '.php';
        if (is_file($path)) {
            require $path;
        }
        return;
    }
});

require_once __DIR__ . '/../includes/content/functions/validation.php';
require_once __DIR__ . '/../includes/content/functions/slug.php';
