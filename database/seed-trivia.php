#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Database\Database;

require_once __DIR__ . '/seed.php';

$projectRoot = dirname(__DIR__);
$pdo = Database::connect(Config::load($projectRoot));
$count = seedTriviaQuestions($pdo, $projectRoot . '/database/data/trivia-questions.json');

fwrite(STDOUT, "Seeded {$count} trivia question(s).\n");
