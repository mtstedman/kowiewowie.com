#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Config;
use Wowie\Api\Content\ContentRepository;
use Wowie\Api\Database\Database;
use Wowie\Api\Trivia\TriviaQuestionCatalog;

use function Wowie\Api\Content\slugify;

require_once __DIR__ . '/../api/bootstrap.php';

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
    $catalog = new TriviaQuestionCatalog();
    $preparedItems = [];
    $activeCount = 0;

    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            throw new RuntimeException("Trivia question seed {$index} must be an object.");
        }
        $isActive = array_key_exists('is_active', $item) ? (bool) $item['is_active'] : true;
        $normalizedPrompt = $catalog->resolve([$item])[0];
        if ($isActive) {
            $activeCount++;
        }
        $preparedItems[] = [
            'source' => $item,
            'prompt' => $normalizedPrompt,
            'is_active' => $isActive,
        ];
    }

    if ($activeCount < TriviaQuestionCatalog::MAX_ROOM_PROMPTS) {
        throw new RuntimeException(sprintf(
            'Trivia question seed catalog must contain at least %d active questions.',
            TriviaQuestionCatalog::MAX_ROOM_PROMPTS,
        ));
    }

    $statement = $pdo->prepare(<<<'SQL'
        INSERT INTO trivia_question_catalog (slug, display_order, question, correct_answer, choices, explanation, answer_shape, image_url, is_active)
        VALUES (:slug, :display_order, :question, :correct_answer, CAST(:choices AS jsonb), :explanation, CAST(:answer_shape AS jsonb), :image_url, :is_active)
        ON CONFLICT (slug) DO UPDATE
        SET display_order = EXCLUDED.display_order,
            question = EXCLUDED.question,
            correct_answer = EXCLUDED.correct_answer,
            choices = EXCLUDED.choices,
            explanation = EXCLUDED.explanation,
            answer_shape = EXCLUDED.answer_shape,
            image_url = EXCLUDED.image_url,
            is_active = EXCLUDED.is_active,
            updated_at = now()
    SQL);

    $count = 0;
    foreach ($preparedItems as $index => $preparedItem) {
        $source = $preparedItem['source'];
        $prompt = $preparedItem['prompt'];
        $statement->execute([
            'slug' => (string) ($source['slug'] ?? ''),
            'display_order' => (int) ($source['display_order'] ?? ($index + 1)),
            'question' => $prompt['question'],
            'correct_answer' => $prompt['correct_answer'],
            'choices' => json_encode($prompt['choices'], JSON_THROW_ON_ERROR),
            'explanation' => $prompt['explanation'],
            'answer_shape' => json_encode($prompt['answer_shape'], JSON_THROW_ON_ERROR),
            'image_url' => $prompt['image_url'],
            'is_active' => $preparedItem['is_active'] ? 'true' : 'false',
        ]);
        $count++;
    }

    return $count;
}

if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) !== __FILE__) {
    return;
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
