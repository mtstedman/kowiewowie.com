<?php

declare(strict_types=1);

use Wowie\Api\Trivia\TriviaRepository;

require dirname(__DIR__) . '/api/bootstrap.php';

function trivia_presentation_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$repository = (new ReflectionClass(TriviaRepository::class))->newInstanceWithoutConstructor();
$presentRound = new ReflectionMethod(TriviaRepository::class, 'presentRound');
$baseRound = [
    'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'round_number' => 7,
    'status' => 'answering',
    'answer_window_seconds' => 30,
    'opened_at' => gmdate(DATE_ATOM),
    'closes_at' => gmdate(DATE_ATOM, time() + 30),
    'resolved_at' => null,
    'phase' => 'ghost_race',
    'round_type' => 'ghost_race',
    'choices' => '["2","4","5","9"]',
    'answer_shape' => '{"type":"multi_select","correct_answers":["2","5"]}',
    'image_url' => null,
    'eligible_player_ids' => '{}',
    'body_holder_player_id' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'race_goal' => 12,
    'race_positions' => '{}',
    'prompt_payload' => '{"category":"Pick the primes","items":[{"label":"2","correct":true},{"label":"4","correct":false},{"label":"5","correct":true},{"label":"9","correct":false}]}',
    'minigame_type' => null,
    'minigame_payload' => '{}',
    'minigame_results' => '{}',
    'question' => 'Pick the primes',
    'correct_answer' => '2',
    'explanation' => '2 and 5 are prime.',
];

$unresolved = $presentRound->invoke($repository, $baseRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert(!isset($unresolved['answer_shape']['correct_answers']), 'Unresolved answer shape leaked correct answers.');
foreach ($unresolved['prompt_payload']['items'] as $item) {
    trivia_presentation_assert(!array_key_exists('correct', $item), 'Unresolved ghost race leaked a correct flag.');
}

$resolvedRound = $baseRound;
$resolvedRound['status'] = 'resolved';
$resolvedRound['resolved_at'] = gmdate(DATE_ATOM);
$resolved = $presentRound->invoke($repository, $resolvedRound, 'active', ['submitted' => 2, 'correct' => 1], null, true);
trivia_presentation_assert($resolved['answer_shape']['correct_answers'] === ['2', '5'], 'Resolved answer shape omitted correct answers.');
trivia_presentation_assert($resolved['prompt_payload']['items'][0]['correct'] === true, 'Resolved ghost race omitted correct flags.');
trivia_presentation_assert($resolved['race_results'] === [], 'Resolved ghost race results changed unexpectedly.');

$memoryRound = $baseRound;
$memoryRound['phase'] = 'killing_floor';
$memoryRound['round_type'] = 'killing_floor';
$memoryRound['minigame_type'] = 'memory_match';
$memoryRound['prompt_payload'] = '{"title":"Memory Grid","instructions":"Remember the flash."}';
$memoryRound['minigame_payload'] = '{"type":"memory_match","choices":["Bell","Mask","Coin"],"correct_choices":["Bell","Coin"]}';
$memoryRound['opened_at'] = gmdate(DATE_ATOM);
$memory = $presentRound->invoke($repository, $memoryRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert($memory['minigame']['preview'] === ['Bell', 'Coin'], 'Memory preview did not expose its timed flash.');
trivia_presentation_assert(!isset($memory['minigame']['payload']['correct_choices']), 'Unresolved memory round leaked correct choices in its answer payload.');

$memoryRound['opened_at'] = gmdate(DATE_ATOM, time() - 10);
$memoryAfterFlash = $presentRound->invoke($repository, $memoryRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert($memoryAfterFlash['minigame']['preview'] === [], 'Memory preview remained visible after five seconds.');

$normalizeAnswer = new ReflectionMethod(TriviaRepository::class, 'normalizeRoundAnswerInput');
$normalized = $normalizeAnswer->invoke($repository, [
    'round_type' => 'trivia',
    'answer_shape' => '{"type":"multi_select","correct_answers":["Mars","Saturn"]}',
    'correct_answer' => 'Mars',
], ['selected' => ['Saturn', 'Mars']]);
trivia_presentation_assert($normalized['is_correct'] === true, 'Multi-select trivia did not compare answers as a set.');
trivia_presentation_assert($normalized['score'] === 1, 'Correct multi-select trivia did not award a point.');

fwrite(STDOUT, "Trivia presentation regressions passed.\n");
