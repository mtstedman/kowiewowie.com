#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\ChessOpeningBookImporter;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;

require __DIR__ . '/../api/bootstrap.php';

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$importer = new ChessOpeningBookImporter(Database::connect($config));
$result = $importer->importTsv(__DIR__ . '/data/chess-openings.tsv');

fwrite(STDOUT, sprintf(
    "Seeded %d opening classification(s), %d book position(s), and %d book move(s).\n",
    $result['openings'],
    $result['positions'],
    $result['moves'],
));
