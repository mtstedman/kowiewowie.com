#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;

require __DIR__ . '/../api/bootstrap.php';

function deploymentRevisionAssert(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

$root = sys_get_temp_dir() . '/wowie-deployment-revision-' . bin2hex(random_bytes(8));
$htdocs = $root . '/htdocs';
if (!mkdir($htdocs, 0700, true) && !is_dir($htdocs)) {
    throw new RuntimeException('Unable to create deployment revision fixture.');
}

try {
    $config = Config::load($root);
    deploymentRevisionAssert(null, $config->deploymentRevision(), 'Missing revisions must remain unverified');

    $revision = str_repeat('A', 40);
    file_put_contents($htdocs . '/.deployment-revision', $revision . PHP_EOL);
    deploymentRevisionAssert(strtolower($revision), $config->deploymentRevision(), 'Valid revisions must be normalized');

    file_put_contents($htdocs . '/.deployment-revision', 'not-a-commit' . PHP_EOL);
    deploymentRevisionAssert(null, $config->deploymentRevision(), 'Malformed revisions must remain unverified');
} finally {
    @unlink($htdocs . '/.deployment-revision');
    @rmdir($htdocs);
    @rmdir($root);
}

fwrite(STDOUT, 'Deployment revision regressions passed.' . PHP_EOL);
