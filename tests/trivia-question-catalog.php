<?php

declare(strict_types=1);

use Wowie\Api\Trivia\TriviaQuestionCatalog;

require dirname(__DIR__) . '/api/bootstrap.php';

function trivia_catalog_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$path = dirname(__DIR__) . '/database/data/trivia-questions.json';
$source = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
trivia_catalog_assert(is_array($source) && array_is_list($source), 'Trivia source must be a JSON list.');
trivia_catalog_assert(count($source) >= 160, 'Trivia source must contain at least 160 questions.');

$slugs = [];
$multiSelectCount = 0;
foreach ($source as $index => $item) {
    trivia_catalog_assert(is_array($item), "Question {$index} must be an object.");
    $slug = (string) ($item['slug'] ?? '');
    trivia_catalog_assert($slug !== '', "Question {$index} needs a slug.");
    trivia_catalog_assert(!isset($slugs[$slug]), "Duplicate trivia slug: {$slug}");
    $slugs[$slug] = true;
    if (($item['answer_shape']['type'] ?? null) === 'multi_select') {
        $multiSelectCount++;
    }
}

$prompts = (new TriviaQuestionCatalog())->resolve($source, 160);
trivia_catalog_assert(count($prompts) === count($source), 'Every source question must normalize.');
trivia_catalog_assert($multiSelectCount >= 10, 'The catalog must retain at least ten multi-select questions.');
foreach ($prompts as $index => $prompt) {
    trivia_catalog_assert(count($prompt['choices']) >= 4, "Question {$index} needs at least four choices.");
    trivia_catalog_assert(($prompt['explanation'] ?? '') !== '', "Question {$index} needs an explanation.");
}

fwrite(STDOUT, sprintf("Trivia catalog regressions passed (%d questions, %d multi-select).\n", count($prompts), $multiSelectCount));
