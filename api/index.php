<?php

declare(strict_types=1);

use Wowie\Api\ApiException;
use Wowie\Api\Application;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Http\Request;
use Wowie\Api\Http\Response;

require __DIR__ . '/bootstrap.php';

try {
    $config = Config::load(dirname(__DIR__));
    $application = new Application($config, Database::connect($config));
    $response = $application->handle(Request::fromGlobals());
} catch (ApiException $error) {
    $response = Response::json([
        'error' => $error->errorCode,
        'message' => $error->getMessage(),
    ], $error->status);
} catch (Throwable $error) {
    error_log('wowiekowie API bootstrap failed: ' . $error);
    $response = Response::json([
        'error' => 'service_unavailable',
        'message' => 'The API is not configured or the database is unavailable.',
    ], 503);
}

$response->send();
