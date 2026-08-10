#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Database\MigrationRunner;

require __DIR__ . '/../api/bootstrap.php';

$config = Config::load(dirname(__DIR__));
$runner = new MigrationRunner(Database::connect($config), __DIR__ . '/migrations');

if (in_array('--status', $argv, true)) {
    foreach ($runner->status() as $migration) {
        printf("[%s] %s\n", $migration['applied'] ? 'applied' : 'pending', $migration['version']);
    }
    exit;
}

$applied = $runner->migrate();
if ($applied === []) {
    fwrite(STDOUT, "Database is already current.\n");
    exit;
}
foreach ($applied as $version) {
    fwrite(STDOUT, "Applied {$version}.\n");
}
