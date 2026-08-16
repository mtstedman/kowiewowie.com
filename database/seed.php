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

function seedTriviaQuestions(\PDO $pdo, string $path): int
{
    $items = loadSeedFile($path);
    $statement = $pdo->prepare(<<<'SQL'
        INSERT INTO trivia_question_catalog (slug, display_order, question, correct_answer, choices, explanation, is_active)
        VALUES (:slug, :display_order, :question, :correct_answer, CAST(:choices AS jsonb), :explanation, :is_active)
        ON CONFLICT (slug) DO UPDATE
        SET display_order = EXCLUDED.display_order,
            question = EXCLUDED.question,
            correct_answer = EXCLUDED.correct_answer,
            choices = EXCLUDED.choices,
            explanation = EXCLUDED.explanation,
            is_active = EXCLUDED.is_active,
            updated_at = now()
    SQL);

    $count = 0;
    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            throw new RuntimeException("Trivia question seed {$index} must be an object.");
        }
        $choices = $item['choices'] ?? null;
        if (!is_array($choices) || !array_is_list($choices)) {
            throw new RuntimeException("Trivia question seed {$index} must include a choices array.");
        }
        $statement->execute([
            'slug' => (string) ($item['slug'] ?? ''),
            'display_order' => (int) ($item['display_order'] ?? ($index + 1)),
            'question' => (string) ($item['question'] ?? ''),
            'correct_answer' => (string) ($item['correct_answer'] ?? $item['answer'] ?? ''),
            'choices' => json_encode(array_values($choices), JSON_THROW_ON_ERROR),
            'explanation' => isset($item['explanation']) ? (string) $item['explanation'] : null,
            'is_active' => array_key_exists('is_active', $item) ? (bool) $item['is_active'] : true,
        ]);
        $count++;
    }

    return $count;
}

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$pdo = Database::connect($config);
$repository = new ContentRepository($pdo);
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

$triviaCount = seedTriviaQuestions($pdo, $projectRoot . '/database/data/trivia-questions.json');
fwrite(STDOUT, "Seeded {$triviaCount} trivia question(s).\n");
