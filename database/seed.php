#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Database\Database;

use function Wowie\Api\Content\slugify;

require __DIR__ . '/../api/bootstrap.php';

/** @return list<array<string, mixed>> */
function loadSeedFile(string $path): array
{
    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException("Could not read {$path}.");
    }
    $data = json_decode($contents, true, 128, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !array_is_list($data)) {
        throw new RuntimeException("Seed file {$path} must contain a JSON array.");
    }

    return $data;
}

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$repository = new ContentRepository(Database::connect($config));
$sourceRoot = $projectRoot . '/htdocs/data';
$sources = [
    'recipes' => 'recipes.json',
    'decks' => 'decks.json',
    'games' => 'games.json',
    'guides' => 'deck-guides.json',
    'music' => 'music.json',
];

foreach ($sources as $resource => $filename) {
    $count = 0;
    foreach (loadSeedFile($sourceRoot . '/' . $filename) as $item) {
        if ($resource === 'music' && !isset($item['slug'])) {
            $item['slug'] = slugify((string) ($item['artist'] ?? '') . '-' . (string) ($item['title'] ?? ''));
        }
        $item['status'] = 'published';
        $repository->save($resource, $item);
        $count++;
    }
    fwrite(STDOUT, "Seeded {$count} {$resource} item(s).\n");
}
