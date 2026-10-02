#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Poe2\Poe2TreeImporter;

require_once __DIR__ . '/../api/bootstrap.php';

$projectRoot = dirname(__DIR__);
$pdo = Database::connect(Config::load($projectRoot));
$result = (new Poe2TreeImporter($pdo))->importFromManifest($projectRoot . '/database/data/poe2-passive-tree/source.json');

fwrite(STDOUT, $result['status'] === 'unchanged'
    ? "PoE 2 passive tree {$result['version']} is already imported.\n"
    : "Imported PoE 2 passive tree {$result['version']}: {$result['nodes']} node(s), {$result['edges']} edge(s).\n");
