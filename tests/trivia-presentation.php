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

$sequenceRound = $baseRound;
$sequenceRound['phase'] = 'killing_floor';
$sequenceRound['round_type'] = 'killing_floor';
$sequenceRound['minigame_type'] = 'sequence_recall';
$sequenceRound['answer_shape'] = '{"type":"ordered_select","count":4}';
$sequenceRound['prompt_payload'] = '{"title":"Sequence Recall","instructions":"Repeat the sequence."}';
$sequenceRound['minigame_payload'] = '{"type":"sequence_recall","choices":["Skull","Candle","Key","Moon","Dagger","Bat"],"correct_order":["Moon","Skull","Bat","Key"],"result_description":"The sequence was Moon, Skull, Bat, Key."}';
$sequenceRound['opened_at'] = gmdate(DATE_ATOM);
$sequence = $presentRound->invoke($repository, $sequenceRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert($sequence['answer_shape'] === ['type' => 'ordered_select', 'count' => 4], 'Sequence recall did not present its ordered answer shape.');
trivia_presentation_assert($sequence['minigame']['preview'] === ['sequence' => ['Moon', 'Skull', 'Bat', 'Key']], 'Sequence recall preview did not expose the sequence during its first six seconds.');
trivia_presentation_assert(!isset($sequence['minigame']['payload']['correct_order']), 'Open sequence recall leaked its correct order in the payload.');
trivia_presentation_assert(!isset($sequence['minigame']['payload']['result_description']), 'Open sequence recall leaked its result description.');
trivia_presentation_assert(count($sequence['minigame']['payload']['choices'] ?? []) === 6, 'Open sequence recall did not offer six choices.');

$sequenceRound['opened_at'] = gmdate(DATE_ATOM, time() - 3);
$sequenceStillVisible = $presentRound->invoke($repository, $sequenceRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert(($sequenceStillVisible['minigame']['preview']['sequence'] ?? null) === ['Moon', 'Skull', 'Bat', 'Key'], 'Sequence recall preview expired before six seconds.');

$sequenceRound['opened_at'] = gmdate(DATE_ATOM, time() - 10);
$sequenceAfterPreview = $presentRound->invoke($repository, $sequenceRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
trivia_presentation_assert($sequenceAfterPreview['minigame']['preview'] === [], 'Sequence recall preview remained visible after six seconds.');
trivia_presentation_assert(!isset($sequenceAfterPreview['minigame']['payload']['correct_order']), 'Sequence recall leaked its correct order after the preview expired.');

$resolvedSequenceRound = $sequenceRound;
$resolvedSequenceRound['status'] = 'resolved';
$resolvedSequenceRound['resolved_at'] = gmdate(DATE_ATOM);
$resolvedSequence = $presentRound->invoke($repository, $resolvedSequenceRound, 'active', ['submitted' => 1, 'correct' => 1], null, true);
trivia_presentation_assert($resolvedSequence['minigame']['payload']['correct_order'] === ['Moon', 'Skull', 'Bat', 'Key'], 'Resolved sequence recall did not expose its correct order.');
trivia_presentation_assert($resolvedSequence['minigame']['preview'] === [], 'Resolved sequence recall kept a preview.');

foreach (['grim_arithmetic' => '{"type":"grim_arithmetic","expression":"7 × 6 − 3","choices":["39","40","29","45"],"correct_key":"39","result_description":"7 × 6 − 3 = 39."}', 'odd_one_out' => '{"type":"odd_one_out","choices":["Mars","Rook","Venus","Saturn"],"correct_key":"Rook","result_description":"Three were planets; Rook did not belong."}'] as $singleType => $singlePayload) {
    $singleRound = $baseRound;
    $singleRound['phase'] = 'killing_floor';
    $singleRound['round_type'] = 'killing_floor';
    $singleRound['minigame_type'] = $singleType;
    $singleRound['answer_shape'] = '{"type":"single_choice"}';
    $singleRound['prompt_payload'] = '{"title":"Trial","instructions":"Choose."}';
    $singleRound['minigame_payload'] = $singlePayload;
    $open = $presentRound->invoke($repository, $singleRound, 'active', ['submitted' => 0, 'correct' => 0], null, true);
    trivia_presentation_assert(!isset($open['minigame']['payload']['correct_key']), "Open {$singleType} leaked its correct key.");
    trivia_presentation_assert($open['minigame']['preview'] === [], "Open {$singleType} exposed a preview.");
    $singleRound['status'] = 'resolved';
    $closed = $presentRound->invoke($repository, $singleRound, 'active', ['submitted' => 1, 'correct' => 0], null, true);
    trivia_presentation_assert(is_string($closed['minigame']['payload']['correct_key'] ?? null), "Resolved {$singleType} did not expose its correct key.");
}
trivia_presentation_assert(($open['minigame']['payload']['choices'] ?? null) === ['Mars', 'Rook', 'Venus', 'Saturn'], 'Open odd one out did not keep its four choices.');

$sequenceAnswerRound = [
    'round_type' => 'killing_floor',
    'minigame_type' => 'sequence_recall',
    'minigame_payload' => '{"type":"sequence_recall","choices":["Skull","Candle","Key","Moon","Dagger","Bat"],"correct_order":["Moon","Skull","Bat","Key"]}',
];
$orderedCorrect = $normalizeAnswer->invoke($repository, $sequenceAnswerRound, ['answer_payload' => ['selected' => [' moon', 'SKULL ', 'Bat', 'key']]]);
trivia_presentation_assert($orderedCorrect['is_correct'] === true && $orderedCorrect['score'] === 1, 'A correctly ordered sequence (after trim/case normalization) was not accepted.');
trivia_presentation_assert($orderedCorrect['answer_payload'] === ['selected' => ['moon', 'SKULL', 'Bat', 'key']], 'Ordered answers were not stored in click order.');
$orderedWrong = $normalizeAnswer->invoke($repository, $sequenceAnswerRound, ['selected' => ['Skull', 'Moon', 'Bat', 'Key']]);
trivia_presentation_assert($orderedWrong['is_correct'] === false && $orderedWrong['score'] === 0, 'A sequence with the right symbols in the wrong order was accepted.');
$orderedShort = $normalizeAnswer->invoke($repository, $sequenceAnswerRound, ['selected' => ['Moon', 'Skull', 'Bat']]);
trivia_presentation_assert($orderedShort['is_correct'] === false, 'An incomplete sequence was accepted.');

$grimAnswer = $normalizeAnswer->invoke($repository, [
    'round_type' => 'killing_floor',
    'minigame_type' => 'grim_arithmetic',
    'minigame_payload' => '{"type":"grim_arithmetic","expression":"7 × 6 − 3","choices":["39","40","29","45"],"correct_key":"39"}',
], ['answer_payload' => ['answer' => ' 39 ']]);
trivia_presentation_assert($grimAnswer['is_correct'] === true, 'A correct grim arithmetic answer was rejected.');

// Generated trial payloads are deterministic and well formed.
$method = static fn (string $name): ReflectionMethod => new ReflectionMethod(TriviaRepository::class, $name);
$grimPayload = $method('grimArithmeticPayload');
$oddPayload = $method('oddOneOutPayload');
$sequencePayload = $method('sequenceRecallPayload');
$rotation = $method('killingFloorRotation');
$categories = (new ReflectionClassConstant(TriviaRepository::class, 'ODD_ONE_OUT_CATEGORIES'))->getValue();
trivia_presentation_assert(count($categories) >= 12, 'Odd one out needs at least twelve category sets.');
foreach ($categories as $members) {
    trivia_presentation_assert(count($members) >= 4, 'An odd one out category has fewer than four members.');
}
$allTypes = ['crypt_runes', 'grim_arithmetic', 'key_lock', 'memory_match', 'odd_one_out', 'poison_chalices', 'sequence_recall', 'sword_boxes'];
$rotationOrders = [];
for ($sample = 0; $sample < 200; $sample++) {
    $id = sprintf('%08x-%04x-4%03x-a%03x-%012x', $sample * 7919, $sample, $sample, $sample, $sample * 104729);

    $grim = $grimPayload->invoke($repository, $id);
    trivia_presentation_assert($grim === $grimPayload->invoke($repository, $id), 'Grim arithmetic was not deterministic for its round.');
    trivia_presentation_assert(preg_match('/^(\d+) ([+−×]) (\d+) ([+−×]) (\d+)$/u', $grim['expression'], $parts) === 1, 'Grim arithmetic produced a malformed expression.');
    foreach ([$parts[1], $parts[3], $parts[5]] as $operand) {
        trivia_presentation_assert((int) $operand >= 2 && (int) $operand <= 12, 'Grim arithmetic used an operand outside 2..12.');
    }
    trivia_presentation_assert(count($grim['choices']) === 4 && count(array_unique($grim['choices'])) === 4, 'Grim arithmetic did not offer four distinct choices.');
    trivia_presentation_assert(in_array($grim['correct_key'], $grim['choices'], true), 'Grim arithmetic choices omitted the answer.');
    $nearMisses = 0;
    foreach ($grim['choices'] as $choice) {
        trivia_presentation_assert(preg_match('/^-?\d+$/', $choice) === 1, 'Grim arithmetic offered a non-numeric choice.');
        if (in_array(abs((int) $choice - (int) $grim['correct_key']), [1, 10], true)) {
            $nearMisses++;
        }
    }
    trivia_presentation_assert($nearMisses === 1, 'Grim arithmetic did not include exactly one near-miss choice.');
    $values = [(int) $parts[1], (int) $parts[3], (int) $parts[5]];
    $apply = static fn (string $operator, int $left, int $right): int => match ($operator) { '+' => $left + $right, '−' => $left - $right, default => $left * $right };
    $expected = $parts[4] === '×' && $parts[2] !== '×'
        ? $apply($parts[2], $values[0], $values[1] * $values[2])
        : $apply($parts[4], $apply($parts[2], $values[0], $values[1]), $values[2]);
    trivia_presentation_assert($grim['correct_key'] === (string) $expected, 'Grim arithmetic computed the wrong answer.');

    $odd = $oddPayload->invoke($repository, $id);
    trivia_presentation_assert(count($odd['choices']) === 4 && count(array_unique($odd['choices'])) === 4, 'Odd one out did not offer four distinct choices.');
    trivia_presentation_assert(in_array($odd['correct_key'], $odd['choices'], true), 'Odd one out choices omitted the odd item.');
    $matchedCategory = null;
    foreach ($categories as $category => $members) {
        $inCategory = array_values(array_filter($odd['choices'], static fn (string $choice): bool => in_array($choice, $members, true)));
        if (count($inCategory) === 3 && !in_array($odd['correct_key'], $members, true)) {
            $matchedCategory = $category;
        }
    }
    trivia_presentation_assert($matchedCategory !== null, 'Odd one out did not pair three members of one category with one outsider.');
    trivia_presentation_assert($odd['result_description'] === "Three were {$matchedCategory}; {$odd['correct_key']} did not belong.", 'Odd one out produced the wrong result description.');

    $recall = $sequencePayload->invoke($repository, $id);
    trivia_presentation_assert(count($recall['choices']) === 6, 'Sequence recall did not offer six choices.');
    trivia_presentation_assert(count($recall['correct_order']) === 4 && count(array_unique($recall['correct_order'])) === 4, 'Sequence recall did not use four distinct symbols.');
    trivia_presentation_assert(array_diff($recall['correct_order'], $recall['choices']) === [], 'Sequence recall ordered a symbol that was not offered.');

    $order = $rotation->invoke($repository, $id);
    $sortedOrder = $order;
    sort($sortedOrder);
    trivia_presentation_assert($sortedOrder === $allTypes, 'The Killing Floor rotation was not a permutation of all eight trials.');
    trivia_presentation_assert($order === $rotation->invoke($repository, $id), 'The Killing Floor rotation was not deterministic for its room.');
    $rotationOrders[implode(',', $order)] = true;
}
trivia_presentation_assert(count($rotationOrders) > 1, 'Different rooms did not receive different Killing Floor orders.');

fwrite(STDOUT, "Trivia presentation regressions passed.\n");
