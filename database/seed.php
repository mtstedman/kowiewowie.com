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
$inlineSources = [
    'videos' => [
        [
            'slug' => 'weekday-dinner-prep',
            'title' => 'Weekday Dinner Prep in 20 Minutes',
            'description' => 'A quick kitchen workflow for getting dinner moving without turning the whole night into meal prep.',
            'youtube_id' => 'dQw4w9WgXcQ',
            'channel_title' => 'Kowie Kitchen',
            'thumbnail_url' => 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            'duration_seconds' => 1240,
            'view_count' => 18420,
            'tags' => ['cooking', 'meal-prep', 'weeknight'],
        ],
        [
            'slug' => 'commander-budget-upgrades',
            'title' => 'Commander Budget Upgrades That Actually Matter',
            'description' => 'Three swap packages that raise consistency first instead of chasing flashy one-offs.',
            'youtube_id' => '9bZkp7q19f0',
            'channel_title' => 'Kowie Cards',
            'thumbnail_url' => 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg',
            'duration_seconds' => 987,
            'view_count' => 7621,
            'tags' => ['magic', 'commander', 'budget'],
        ],
        [
            'slug' => 'arcade-speedrun-routing',
            'title' => 'Arcade Speedrun Routing Notes',
            'description' => 'Route planning around safer checkpoint recovery, score pressure, and when to skip coin-heavy detours.',
            'youtube_id' => '3JZ_D3ELwOQ',
            'channel_title' => 'Kowie Plays',
            'thumbnail_url' => 'https://i.ytimg.com/vi/3JZ_D3ELwOQ/hqdefault.jpg',
            'duration_seconds' => 1535,
            'view_count' => 4312,
            'tags' => ['games', 'speedrun', 'arcade'],
        ],
    ],
];

foreach (array_keys($sources + $inlineSources) as $resource) {
    $count = 0;
    $items = array_key_exists($resource, $sources)
        ? loadSeedFile($sourceRoot . '/' . $sources[$resource])
        : $inlineSources[$resource];
    foreach ($items as $item) {
        if ($resource === 'music' && !isset($item['slug'])) {
            $item['slug'] = slugify((string) ($item['artist'] ?? '') . '-' . (string) ($item['title'] ?? ''));
        }
        $item['status'] = 'published';
        $repository->save($resource, $item);
        $count++;
    }
    fwrite(STDOUT, "Seeded {$count} {$resource} item(s).\n");
}
