#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\ApiException;
use Wowie\Api\Config;
use Wowie\Api\Database\Database;
use Wowie\Api\Database\SchemaVersionMinter;
use Wowie\Api\Trivia\TriviaRepository;

require dirname(__DIR__) . '/api/bootstrap.php';
require_once dirname(__DIR__) . '/database/seed.php';

function murderTriviaAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function murderTriviaUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);

    return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
}

/** @return array<string, mixed> */
function murderTriviaCurrentRound(\PDO $pdo, string $publicId): array
{
    $statement = $pdo->prepare(<<<'SQL'
        SELECT r.*, p.question, p.correct_answer, p.choices, p.answer_shape AS prompt_answer_shape
        FROM trivia_rooms room
        JOIN trivia_rounds r ON r.room_id = room.id
                            AND r.round_number = room.current_round_number
        JOIN trivia_prompts p ON p.id = r.prompt_id
        WHERE room.public_id = :public_id
        LIMIT 1
    SQL);
    $statement->execute(['public_id' => $publicId]);
    $round = $statement->fetch(\PDO::FETCH_ASSOC);
    if (!is_array($round)) {
        throw new RuntimeException('The test room has no current round.');
    }

    return $round;
}

function murderTriviaRoundHistoryCount(\PDO $pdo, string $publicId): int
{
    $statement = $pdo->prepare(<<<'SQL'
        SELECT count(*)
        FROM trivia_rooms room
        JOIN trivia_rounds r ON r.room_id = room.id
        WHERE room.public_id = :public_id
    SQL);
    $statement->execute(['public_id' => $publicId]);

    return (int) $statement->fetchColumn();
}

/** @return list<string> */
function murderTriviaCorrectSelection(array $round): array
{
    $shape = json_decode((string) ($round['answer_shape'] ?? $round['prompt_answer_shape'] ?? '{}'), true);
    if (is_array($shape) && ($shape['type'] ?? null) === 'multi_select') {
        return array_values(array_map('strval', is_array($shape['correct_answers'] ?? null) ? $shape['correct_answers'] : []));
    }

    return [(string) $round['correct_answer']];
}

/** @return array<string, mixed> */
function murderTriviaAnswerPayload(array $selection, bool $multiple = false): array
{
    return $multiple
        ? ['selected' => $selection, 'client_answer_id' => murderTriviaUuid()]
        : ['answer' => $selection[0] ?? '', 'client_answer_id' => murderTriviaUuid()];
}

/** @return array<string, mixed> */
function murderTriviaMinigamePayload(\PDO $pdo, string $publicId): array
{
    $round = murderTriviaCurrentRound($pdo, $publicId);

    return json_decode((string) $round['minigame_payload'], true, 512, JSON_THROW_ON_ERROR);
}

/**
 * Build a correct or deliberately wrong Killing Floor submission from the stored payload.
 *
 * @param array<string, mixed> $payload
 * @return array<string, mixed>
 */
function murderTriviaKillingFloorAnswer(array $payload, string $type, bool $correct): array
{
    if ($type === 'sequence_recall') {
        $order = array_values(array_map('strval', $payload['correct_order'] ?? []));
        murderTriviaAssert(count($order) === 4, 'The sequence recall trial did not store a four-symbol order.');
        $selected = $correct ? $order : array_reverse($order);

        return ['selected' => $selected, 'answer_payload' => ['selected' => $selected], 'client_answer_id' => murderTriviaUuid()];
    }
    if (in_array($type, ['memory_match', 'crypt_runes'], true)) {
        $pattern = array_values(array_map('strval', $payload['correct_choices'] ?? []));
        murderTriviaAssert(count($pattern) > 1, "The {$type} trial did not have a usable correct pattern.");

        return murderTriviaAnswerPayload($correct ? $pattern : [], true);
    }

    $correctKey = (string) ($payload['correct_key'] ?? '');
    murderTriviaAssert($correctKey !== '', "The {$type} trial did not have a correct choice.");
    if ($correct) {
        return murderTriviaAnswerPayload([$correctKey]);
    }
    $wrong = array_values(array_filter(array_map('strval', $payload['choices'] ?? []), static fn (string $choice): bool => $choice !== $correctKey));
    murderTriviaAssert($wrong !== [], "The {$type} trial did not have a usable wrong choice.");

    return murderTriviaAnswerPayload([$wrong[0]]);
}

/**
 * Answer the current trivia round for each identity, correctly or not, in the given order.
 *
 * @param list<array{0: array<string, mixed>, 1: bool}> $answers
 * @return array<string, mixed>
 */
function murderTriviaAnswerTrivia(TriviaRepository $repository, \PDO $pdo, string $publicId, array $answers): array
{
    $round = murderTriviaCurrentRound($pdo, $publicId);
    murderTriviaAssert((string) $round['round_type'] === 'trivia', 'Expected an open trivia round.');
    $correctSelection = murderTriviaCorrectSelection($round);
    $shape = json_decode((string) $round['answer_shape'], true, 512, JSON_THROW_ON_ERROR);
    $isMulti = ($shape['type'] ?? null) === 'multi_select';
    $choices = json_decode((string) $round['choices'], true, 512, JSON_THROW_ON_ERROR);
    $wrongSelection = array_values(array_filter(array_map('strval', $choices), static fn (string $choice): bool => !in_array($choice, $correctSelection, true)));
    if ($wrongSelection !== []) {
        $wrongAnswer = [$wrongSelection[0]];
    } else {
        // An all-correct multi-select prompt (the catalog allows them) is answered wrongly by selecting nothing.
        murderTriviaAssert($isMulti && $correctSelection !== [], 'A trivia prompt did not have a usable wrong answer.');
        $wrongAnswer = [];
    }

    $result = [];
    foreach ($answers as [$identity, $isCorrect]) {
        $result = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($isCorrect ? $correctSelection : $wrongAnswer, $isMulti), $identity);
    }

    return $result;
}

/**
 * @param array<string, mixed> $room
 * @return array<string, mixed>
 */
function murderTriviaPlayer(array $room, string $playerId): array
{
    foreach ($room['players'] ?? [] as $player) {
        if ($player['id'] === $playerId) {
            return $player;
        }
    }

    throw new RuntimeException('The expected trivia player is missing from the room.');
}

/**
 * @param array<string, mixed> $results
 * @return array<string, array<string, mixed>>
 */
function murderTriviaOutcomes(array $results): array
{
    $outcomes = [];
    foreach ($results['player_outcomes'] ?? [] as $outcome) {
        $outcomes[(string) $outcome['player_id']] = $outcome;
    }

    return $outcomes;
}

function murderTriviaGuest(\PDO $pdo, string $displayName): array
{
    $statement = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_guest_profiles (cookie_token_hash, display_name)
        VALUES (:cookie_token_hash, :display_name)
        RETURNING id
    SQL);
    $statement->execute(['cookie_token_hash' => hash('sha256', random_bytes(32)), 'display_name' => $displayName]);

    return ['user' => null, 'guest_profile' => ['id' => (string) $statement->fetchColumn(), 'display_name' => $displayName]];
}

$projectRoot = dirname(__DIR__);
$config = Config::load($projectRoot);
$pdo = Database::connect($config);
$schema = 'murder_trivia_test_' . bin2hex(random_bytes(8));
$quotedSchema = '"' . $schema . '"';
$schemaCreated = false;

try {
    $pdo->exec("CREATE SCHEMA {$quotedSchema}");
    $schemaCreated = true;
    $pdo->exec("SET search_path TO {$quotedSchema}, public");

    $minted = (new SchemaVersionMinter($pdo, $projectRoot . '/docs/postgres'))->mint();
    $targetVersion = SchemaVersionMinter::validateDefinition($projectRoot . '/docs/postgres')['targetVersion'];
    murderTriviaAssert($minted['from'] === 0 && $minted['to'] === $targetVersion, "The isolated database did not migrate from version 0 to {$targetVersion}.");
    $catalogPath = $projectRoot . '/database/data/trivia-questions.json';
    $catalog = json_decode((string) file_get_contents($catalogPath), true, 512, JSON_THROW_ON_ERROR);
    $seededQuestions = seedTriviaQuestions($pdo, $catalogPath);
    murderTriviaAssert($seededQuestions >= 160 && $seededQuestions === count($catalog), 'The isolated catalog did not seed every source question.');

    $guestStatement = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_guest_profiles (cookie_token_hash, display_name)
        VALUES (:cookie_token_hash, :display_name)
        RETURNING id
    SQL);
    $guestStatement->execute(['cookie_token_hash' => hash('sha256', random_bytes(32)), 'display_name' => 'Host Phantom']);
    $hostGuestId = (string) $guestStatement->fetchColumn();
    $guestStatement->execute(['cookie_token_hash' => hash('sha256', random_bytes(32)), 'display_name' => 'Guest Ghoul']);
    $guestGuestId = (string) $guestStatement->fetchColumn();

    $hostIdentity = ['user' => null, 'guest_profile' => ['id' => $hostGuestId, 'display_name' => 'Host Phantom']];
    $guestIdentity = ['user' => null, 'guest_profile' => ['id' => $guestGuestId, 'display_name' => 'Guest Ghoul']];
    $repository = new TriviaRepository($pdo);
    $room = $repository->createRoom([
        'max_players' => 2,
        'answer_window_seconds' => 30,
    ], $hostIdentity);
    $publicId = (string) $room['id'];
    murderTriviaAssert($room['status'] === 'waiting', 'A new room did not start in the lobby.');
    murderTriviaAssert(count($room['created_links'] ?? []) === 1, 'A two-seat room did not mint one invitation.');
    murderTriviaAssert(($room['starting_lives'] ?? null) === 2, 'A room created without starting_lives did not default to two lives.');

    $joinToken = (string) $room['created_links'][0]['token'];
    $claimed = $repository->claimLink($joinToken, $guestIdentity);
    murderTriviaAssert(count($claimed['players'] ?? []) === 2, 'The guest did not claim the second seat.');
    $hostPlayerId = '';
    $guestPlayerId = '';
    foreach ($claimed['players'] as $player) {
        murderTriviaAssert(($player['lives_remaining'] ?? null) === 2, 'A seated player did not start with the room starting lives.');
        if ((int) $player['seat_number'] === 1) {
            $hostPlayerId = (string) $player['id'];
        } else {
            $guestPlayerId = (string) $player['id'];
        }
    }

    $started = $repository->startRoom($publicId, $hostIdentity);
    murderTriviaAssert($started['phase'] === 'trivia' && $started['round']['status'] === 'answering', 'The first trivia round did not open.');
    murderTriviaAssert(!isset($started['round']['prompt']['correct_answer']), 'An open trivia round leaked its correct answer.');

    // Move the active round above synthetic history, then mark every available prompt as previously used.
    $pdo->prepare('UPDATE trivia_rounds SET round_number = 10000 WHERE id = :id')
        ->execute(['id' => $started['round']['id']]);
    $pdo->prepare('UPDATE trivia_rooms SET current_round_number = 10000 WHERE public_id = :public_id')
        ->execute(['public_id' => $publicId]);
    $exhaustStatement = $pdo->prepare(<<<'SQL'
        INSERT INTO trivia_rounds (room_id, round_number, prompt_id, status, answer_window_seconds,
                                   opened_at, closes_at, resolved_at,
                                   round_type, phase, answer_shape, image_url)
        SELECT room.id, p.prompt_order, p.id, 'resolved', room.answer_window_seconds,
               now() - make_interval(secs => room.answer_window_seconds), now(), now(),
               'trivia', 'trivia', p.answer_shape, p.image_url
        FROM trivia_rooms room
        JOIN trivia_prompts p ON p.room_id = room.id
        WHERE room.public_id = :public_id
    SQL);
    $exhaustStatement->execute(['public_id' => $publicId]);
    $historyBeforeContinuation = murderTriviaRoundHistoryCount($pdo, $publicId);

    // Correct play must continue with fresh rounds after two questions, past fifteen, and after prompt exhaustion.
    $seenTriviaRoundIds = [];
    $cycledPromptIds = [];
    for ($questionNumber = 1; $questionNumber <= 16; $questionNumber++) {
        $triviaRound = murderTriviaCurrentRound($pdo, $publicId);
        $triviaRoundId = (string) $triviaRound['id'];
        murderTriviaAssert(!in_array($triviaRoundId, $seenTriviaRoundIds, true), "Trivia question {$questionNumber} reused a prior round and its answer state.");
        $seenTriviaRoundIds[] = $triviaRoundId;
        $cycledPromptIds[] = (string) $triviaRound['prompt_id'];
        $correctSelection = murderTriviaCorrectSelection($triviaRound);
        $triviaAnswerShape = json_decode((string) $triviaRound['answer_shape'], true, 512, JSON_THROW_ON_ERROR);
        $triviaIsMulti = ($triviaAnswerShape['type'] ?? null) === 'multi_select';
        $repository->submitAnswer($publicId, murderTriviaAnswerPayload($correctSelection, $triviaIsMulti), $hostIdentity);
        $correctResult = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($correctSelection, $triviaIsMulti), $guestIdentity);
        murderTriviaAssert($correctResult['round']['status'] === 'resolved', "Trivia question {$questionNumber} did not resolve.");
        $nextQuestion = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($nextQuestion['status'] === 'active', "The game ended after trivia question {$questionNumber}.");
        murderTriviaAssert($nextQuestion['phase'] === 'trivia', "A fully correct question {$questionNumber} opened the wrong phase.");
    }
    murderTriviaAssert(
        murderTriviaRoundHistoryCount($pdo, $publicId) === $historyBeforeContinuation + 16,
        'Continuing through exhausted prompts did not preserve every historical round while opening fresh rounds.',
    );
    murderTriviaAssert(
        count(array_unique($cycledPromptIds)) > 1,
        'Exhausted prompt selection did not cycle through the available prompts.',
    );

    $allMiniGameTypes = ['crypt_runes', 'grim_arithmetic', 'key_lock', 'memory_match', 'odd_one_out', 'poison_chalices', 'sequence_recall', 'sword_boxes'];
    $expectedAnswerShapes = [
        'key_lock' => 'single_choice',
        'memory_match' => 'multi_select',
        'poison_chalices' => 'single_choice',
        'sword_boxes' => 'single_choice',
        'crypt_runes' => 'multi_select',
        'grim_arithmetic' => 'single_choice',
        'odd_one_out' => 'single_choice',
        'sequence_recall' => 'ordered_select',
    ];
    $roomIdStatement = $pdo->prepare('SELECT id FROM trivia_rooms WHERE public_id = :public_id');
    $roomIdStatement->execute(['public_id' => $publicId]);
    $roomInternalId = (string) $roomIdStatement->fetchColumn();
    $rotation = (new ReflectionMethod(TriviaRepository::class, 'killingFloorRotation'))->invoke($repository, $roomInternalId);
    $sortedRotation = $rotation;
    sort($sortedRotation);
    murderTriviaAssert($sortedRotation === $allMiniGameTypes, 'The room rotation is not a permutation of all eight Killing Floor trials.');

    // Nine Killing Floors: the first eight cover every trial once, the ninth repeats the first.
    $observedTypes = [];
    $sequenceLossChecked = false;
    for ($floor = 0; $floor < 9; $floor++) {
        $expectedType = $rotation[$floor % 8];
        $bothDescend = $expectedType === 'sequence_recall' && !$sequenceLossChecked;
        $afterTrivia = murderTriviaAnswerTrivia($repository, $pdo, $publicId, [[$hostIdentity, false], [$guestIdentity, !$bothDescend]]);
        murderTriviaAssert($afterTrivia['round']['status'] === 'resolved', "The trivia prompt before {$expectedType} did not resolve after every answer.");

        $killingFloor = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($killingFloor['phase'] === 'killing_floor', "A wrong living player was not sent to the {$expectedType} Killing Floor trial.");
        $openedType = (string) $killingFloor['round']['minigame']['type'];
        murderTriviaAssert($openedType === $expectedType, "Killing Floor {$floor} opened {$openedType} instead of the seeded {$expectedType}.");
        $observedTypes[] = $openedType;
        murderTriviaAssert(($killingFloor['round']['answer_shape']['type'] ?? null) === $expectedAnswerShapes[$expectedType], "The {$expectedType} answer shape was incorrect.");
        $expectedEligible = $bothDescend ? [$hostPlayerId, $guestPlayerId] : [$hostPlayerId];
        murderTriviaAssert($killingFloor['round']['eligible_player_ids'] === $expectedEligible, "The {$expectedType} trial did not hold exactly the wrong living players.");

        $openPayload = $killingFloor['round']['minigame']['payload'];
        foreach (['correct_key', 'correct_choices', 'correct_order', 'result_description'] as $secretKey) {
            murderTriviaAssert(!array_key_exists($secretKey, $openPayload), "The open {$expectedType} trial leaked {$secretKey}.");
        }
        if ($expectedType === 'grim_arithmetic') {
            murderTriviaAssert(is_string($openPayload['expression'] ?? null) && $openPayload['expression'] !== '', 'The open grim arithmetic trial had no expression.');
            murderTriviaAssert(count($openPayload['choices'] ?? []) === 4, 'The open grim arithmetic trial did not offer four choices.');
        }
        if ($expectedType === 'odd_one_out') {
            murderTriviaAssert(count($openPayload['choices'] ?? []) === 4, 'The open odd one out trial did not offer four choices.');
        }
        if ($expectedType === 'sequence_recall') {
            murderTriviaAssert(($killingFloor['round']['answer_shape']['count'] ?? null) === 4, 'The sequence recall answer shape did not require four selections.');
            murderTriviaAssert(count($openPayload['choices'] ?? []) === 6, 'The open sequence recall trial did not offer six choices.');
            murderTriviaAssert(count($killingFloor['round']['minigame']['preview']['sequence'] ?? []) === 4, 'The fresh sequence recall trial did not preview its sequence.');
        }
        if (in_array($expectedType, ['key_lock', 'poison_chalices', 'sword_boxes', 'grim_arithmetic', 'odd_one_out'], true)) {
            murderTriviaAssert($killingFloor['round']['minigame']['preview'] === [], "The open {$expectedType} trial exposed a preview.");
        }

        $killingRound = murderTriviaCurrentRound($pdo, $publicId);
        $minigamePayload = murderTriviaMinigamePayload($pdo, $publicId);
        murderTriviaAssert(($minigamePayload['type'] ?? null) === $expectedType, "The stored {$expectedType} payload has the wrong type.");
        if ($expectedType === 'sequence_recall') {
            $pdo->prepare("UPDATE trivia_rounds SET opened_at = opened_at - interval '10 seconds' WHERE id = :id")
                ->execute(['id' => $killingRound['id']]);
            $afterPreview = $repository->findRoom($publicId, $hostIdentity);
            murderTriviaAssert($afterPreview['round']['minigame']['preview'] === [], 'The sequence recall preview stayed visible after six seconds.');
            murderTriviaAssert(!array_key_exists('correct_order', $afterPreview['round']['minigame']['payload']), 'The sequence recall trial leaked its order after the preview.');
        }

        if ($bothDescend) {
            $afterHost = $repository->submitAnswer($publicId, murderTriviaKillingFloorAnswer($minigamePayload, $expectedType, false), $hostIdentity);
            murderTriviaAssert($afterHost['round']['status'] === 'answering', 'The two-player sequence recall resolved before both answered.');
            $killingResult = $repository->submitAnswer($publicId, murderTriviaKillingFloorAnswer($minigamePayload, $expectedType, true), $guestIdentity);
            murderTriviaAssert($killingResult['round']['status'] === 'resolved', 'The two-player sequence recall did not resolve.');
            murderTriviaAssert($killingResult['round']['viewer_answer']['is_correct'] === true, 'A correctly ordered sequence was not marked correct.');
            $hostView = $repository->findRoom($publicId, $hostIdentity);
            murderTriviaAssert($hostView['round']['viewer_answer']['is_correct'] === false, 'A wrongly ordered sequence was marked correct.');

            $results = $killingResult['round']['minigame']['results'];
            murderTriviaAssert($results['survivor_player_ids'] === [$guestPlayerId], 'The correct sequence player was not recorded as the survivor.');
            murderTriviaAssert($results['lives_lost_player_ids'] === [$hostPlayerId], 'The first Killing Floor loss did not cost exactly one life.');
            murderTriviaAssert($results['ghosted_player_ids'] === [] && $results['spared_player_id'] === null, 'A first loss with lives left created a ghost or a spare.');
            $outcomes = murderTriviaOutcomes($results);
            murderTriviaAssert(array_keys($outcomes) === [$hostPlayerId, $guestPlayerId], 'Player outcomes were not listed by seat.');
            murderTriviaAssert(
                $outcomes[$hostPlayerId]['answered'] === true && $outcomes[$hostPlayerId]['survived'] === false
                && $outcomes[$hostPlayerId]['lost_life'] === true && $outcomes[$hostPlayerId]['ghosted'] === false
                && $outcomes[$hostPlayerId]['spared'] === false && $outcomes[$hostPlayerId]['lives_remaining'] === 1
                && $outcomes[$hostPlayerId]['display_name'] === 'Host Phantom',
                'The life-losing player outcome was wrong.',
            );
            murderTriviaAssert(
                $outcomes[$guestPlayerId]['survived'] === true && $outcomes[$guestPlayerId]['lost_life'] === false
                && $outcomes[$guestPlayerId]['lives_remaining'] === 2,
                'The surviving player outcome was wrong.',
            );
            $host = murderTriviaPlayer($killingResult, $hostPlayerId);
            murderTriviaAssert($host['lives_remaining'] === 1 && $host['is_ghost'] === false && $host['status'] === 'active', 'The first loss did not leave the host alive with one life.');
            $sequenceLossChecked = true;
        } else {
            $killingResult = $repository->submitAnswer($publicId, murderTriviaKillingFloorAnswer($minigamePayload, $expectedType, true), $hostIdentity);
            murderTriviaAssert($killingResult['round']['status'] === 'resolved', "The {$expectedType} Killing Floor trial did not resolve after its only eligible player answered.");
            murderTriviaAssert(count(array_filter($killingResult['players'], static fn (array $player): bool => $player['is_ghost'] === true)) === 0, "A correct {$expectedType} answer incorrectly created a ghost.");
            $results = $killingResult['round']['minigame']['results'];
            murderTriviaAssert($results['survivor_player_ids'] === [$hostPlayerId] && $results['lives_lost_player_ids'] === [], "A correct {$expectedType} answer cost a life.");
            murderTriviaAssert(count($results['player_outcomes']) === 1 && $results['player_outcomes'][0]['survived'] === true, "The {$expectedType} outcome did not record the survivor.");
        }

        $resolvedPayload = $killingResult['round']['minigame']['payload'];
        if ($expectedType === 'sequence_recall') {
            murderTriviaAssert($resolvedPayload['correct_order'] === $minigamePayload['correct_order'], 'The resolved sequence recall did not expose its order.');
            murderTriviaAssert($killingResult['round']['minigame']['preview'] === [], 'The resolved sequence recall kept its preview.');
        } elseif (in_array($expectedType, ['memory_match', 'crypt_runes'], true)) {
            murderTriviaAssert($resolvedPayload['correct_choices'] === $minigamePayload['correct_choices'], "The resolved {$expectedType} did not expose its pattern.");
        } else {
            murderTriviaAssert(
                is_string($resolvedPayload['correct_key'] ?? null) && in_array($resolvedPayload['correct_key'], $resolvedPayload['choices'], true),
                "The resolved {$expectedType} did not expose its correct key.",
            );
        }
        if ($expectedType === 'odd_one_out') {
            murderTriviaAssert(
                str_starts_with((string) ($killingResult['round']['minigame']['results']['result_description'] ?? ''), 'Three were '),
                'The resolved odd one out did not explain the category.',
            );
        }

        $nextTrivia = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($nextTrivia['phase'] === 'trivia', "Surviving the {$expectedType} Killing Floor trial did not return upstairs.");
    }
    $firstCycle = array_slice($observedTypes, 0, 8);
    $sortedCycle = $firstCycle;
    sort($sortedCycle);
    murderTriviaAssert($sortedCycle === $allMiniGameTypes, 'The first eight Killing Floors did not use each trial exactly once.');
    murderTriviaAssert($firstCycle === $rotation, 'The first eight Killing Floors did not follow the room-seeded order.');
    murderTriviaAssert($observedTypes[8] === $observedTypes[0], 'The ninth Killing Floor did not repeat the first trial.');
    murderTriviaAssert($sequenceLossChecked, 'The sequence recall loss was never exercised.');

    // The second loss spends the host's last life and ghosts them.
    murderTriviaAnswerTrivia($repository, $pdo, $publicId, [[$hostIdentity, false], [$guestIdentity, true]]);
    $failureFloor = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($failureFloor['phase'] === 'killing_floor', 'The intentional later wrong answer skipped the Killing Floor.');
    $failureType = (string) $failureFloor['round']['minigame']['type'];
    murderTriviaAssert($failureType === $rotation[1], 'The tenth Killing Floor did not continue the repeating rotation.');
    $failurePayload = murderTriviaMinigamePayload($pdo, $publicId);
    $killingResult = $repository->submitAnswer($publicId, murderTriviaKillingFloorAnswer($failurePayload, $failureType, false), $hostIdentity);
    murderTriviaAssert($killingResult['round']['status'] === 'resolved', 'The final failed trial did not resolve.');
    $failureResults = $killingResult['round']['minigame']['results'] ?? [];
    murderTriviaAssert($failureResults['ghosted_player_ids'] === [$hostPlayerId] && $failureResults['lives_lost_player_ids'] === [], 'The second loss did not ghost the host.');
    murderTriviaAssert($failureResults['spared_player_id'] === null, 'A loss with another player alive spared someone.');
    $failureOutcome = murderTriviaOutcomes($failureResults)[$hostPlayerId] ?? [];
    murderTriviaAssert(($failureOutcome['ghosted'] ?? null) === true && ($failureOutcome['lives_remaining'] ?? null) === 0, 'The ghosted outcome did not report zero lives.');
    $ghostHost = murderTriviaPlayer($killingResult, $hostPlayerId);
    murderTriviaAssert($ghostHost['is_ghost'] === true && $ghostHost['status'] === 'eliminated' && $ghostHost['lives_remaining'] === 0, 'The host was not ghosted at zero lives.');
    murderTriviaAssert(murderTriviaPlayer($killingResult, $guestPlayerId)['lives_remaining'] === 2, 'The surviving guest lost a life.');

    $race = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($race['status'] === 'active' && $race['phase'] === 'ghost_race', 'The last survivor did not enter the ghost race after prompt exhaustion.');
    murderTriviaAssert($race['race_goal'] === 20 && $race['round']['race_goal'] === 20, 'A newly started ghost race did not persist the longer goal of 20.');
    $raceBodyHolderId = (string) $race['body_holder_player_id'];
    murderTriviaAssert(
        (int) ($race['round']['race_positions'][$raceBodyHolderId] ?? 0) === 4,
        'The ghost-race body holder did not start at position 4.',
    );
    murderTriviaAssert($raceBodyHolderId === $guestPlayerId, 'The surviving guest did not hold the body.');
    murderTriviaAssert((int) ($race['round']['race_positions'][$hostPlayerId] ?? -1) === 0, 'A ghost without correct trivia answers started the race with a head start.');
    murderTriviaAssert($race['viewer']['can_answer_round'] === true, 'The host was not allowed to answer the race.');
    foreach ($race['round']['prompt_payload']['items'] ?? [] as $item) {
        murderTriviaAssert(!array_key_exists('correct', $item), 'The open ghost race leaked a correct flag.');
    }

    // Simulate a race persisted before this request and verify its stored goal survives round advancement.
    $persistedRaceGoal = 60;
    $pdo->prepare('UPDATE trivia_rounds SET race_goal = :race_goal WHERE id = :id')->execute([
        'race_goal' => $persistedRaceGoal,
        'id' => $race['round']['id'],
    ]);
    $pdo->prepare('UPDATE trivia_rooms SET race_goal = :race_goal WHERE public_id = :public_id')->execute([
        'race_goal' => $persistedRaceGoal,
        'public_id' => $publicId,
    ]);
    $expectedRaceGoal = $persistedRaceGoal;
    $persistedRaceGoalVerified = false;

    $raceRounds = 0;
    $raceRoundLimit = 20;
    while ($race['status'] !== 'finished' && $raceRounds < $raceRoundLimit) {
        $raceRounds++;
        $rawRaceRound = murderTriviaCurrentRound($pdo, $publicId);
        $racePayload = json_decode((string) $rawRaceRound['prompt_payload'], true, 512, JSON_THROW_ON_ERROR);
        $raceCorrect = [];
        foreach ($racePayload['items'] ?? [] as $item) {
            if (is_array($item) && ($item['correct'] ?? false) === true) {
                $raceCorrect[] = (string) $item['label'];
            }
        }
        // Catalog multi-select prompts may have no correct items; a perfect answer then selects nothing.
        murderTriviaAssert(($racePayload['items'] ?? []) !== [], 'The ghost race prompt had no items to classify.');
        $repository->submitAnswer($publicId, murderTriviaAnswerPayload($raceCorrect, true), $hostIdentity);
        $race = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($raceCorrect, true), $guestIdentity);
        murderTriviaAssert($race['round']['status'] === 'resolved', 'A ghost race round did not resolve after every answer.');
        if ($race['status'] !== 'finished') {
            $race = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
            murderTriviaAssert($race['phase'] === 'ghost_race', 'Advancing a ghost race left the finale early.');
            murderTriviaAssert($race['round']['race_goal'] === $expectedRaceGoal, 'A later ghost-race round did not retain the persisted goal.');
            if (!$persistedRaceGoalVerified) {
                $persistedRaceGoalVerified = true;
                $expectedRaceGoal = 20;
                $pdo->prepare('UPDATE trivia_rounds SET race_goal = :race_goal WHERE id = :id')->execute([
                    'race_goal' => $expectedRaceGoal,
                    'id' => $race['round']['id'],
                ]);
                $pdo->prepare('UPDATE trivia_rooms SET race_goal = :race_goal WHERE public_id = :public_id')->execute([
                    'race_goal' => $expectedRaceGoal,
                    'public_id' => $publicId,
                ]);
            }
        }
    }

    murderTriviaAssert($persistedRaceGoalVerified, 'The ghost race finished before a persisted goal could be carried into its next round.');
    murderTriviaAssert($race['status'] === 'finished', "The ghost race did not finish within {$raceRoundLimit} perfect rounds.");
    murderTriviaAssert($race['termination'] === 'escape_race', 'The game ended with the wrong termination reason.');
    murderTriviaAssert(is_string($race['winner_player_id']) && $race['winner_player_id'] !== '', 'The finished game did not select a winner.');
    murderTriviaAssert($race['winner_player_id'] === $race['body_holder_player_id'], 'The ghost-race winner did not hold the body.');

    $replay = $repository->replayRoom($publicId, [], $hostIdentity);
    murderTriviaAssert($replay['status'] === 'waiting' && $replay['id'] !== $publicId, 'Replay did not create a fresh waiting room.');
    murderTriviaAssert(count($replay['created_links'] ?? []) === 1, 'Replay did not create a new invitation.');
    murderTriviaAssert($replay['starting_lives'] === 2 && $replay['players'][0]['lives_remaining'] === 2, 'Replay did not keep two starting lives.');

    // starting_lives accepts 1..3 only.
    foreach ([4, 'x', 0] as $invalidLives) {
        $rejected = false;
        try {
            $repository->createRoom(['max_players' => 2, 'answer_window_seconds' => 30, 'starting_lives' => $invalidLives], $hostIdentity);
        } catch (ApiException $error) {
            $rejected = $error->status === 422 && $error->errorCode === 'validation_error';
        }
        murderTriviaAssert($rejected, 'starting_lives ' . var_export($invalidLives, true) . ' was not rejected with a 422 validation error.');
    }

    $soloRoom = $repository->createRoom([
        'max_players' => 2,
        'answer_window_seconds' => 30,
        'starting_lives' => 3,
    ], $hostIdentity);
    murderTriviaAssert($soloRoom['starting_lives'] === 3 && $soloRoom['players'][0]['lives_remaining'] === 3, 'A three-life room did not seat its host with three lives.');
    $soloPublicId = (string) $soloRoom['id'];
    $soloClaimed = $repository->claimLink((string) $soloRoom['created_links'][0]['token'], $guestIdentity);
    murderTriviaAssert($soloClaimed['players'][1]['lives_remaining'] === 3, 'A joining player did not receive the room starting lives.');
    $repository->startRoom($soloPublicId, $hostIdentity);
    $pdo->prepare(<<<'SQL'
        UPDATE trivia_players player
        SET status = 'left'
        FROM trivia_rooms room
        WHERE player.room_id = room.id
          AND room.public_id = :public_id
          AND player.guest_profile_id = :guest_profile_id
    SQL)->execute([
        'public_id' => $soloPublicId,
        'guest_profile_id' => $guestGuestId,
    ]);
    $soloRound = murderTriviaCurrentRound($pdo, $soloPublicId);
    $soloSelection = murderTriviaCorrectSelection($soloRound);
    $soloShape = json_decode((string) $soloRound['answer_shape'], true, 512, JSON_THROW_ON_ERROR);
    $soloResult = $repository->submitAnswer(
        $soloPublicId,
        murderTriviaAnswerPayload($soloSelection, ($soloShape['type'] ?? null) === 'multi_select'),
        $hostIdentity,
    );
    murderTriviaAssert($soloResult['round']['status'] === 'resolved', 'The remaining solo player did not resolve the final trivia round.');
    $soloFinish = $repository->advanceRound($soloPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert(
        $soloFinish['status'] === 'finished' && $soloFinish['termination'] === 'last_player_standing',
        'One survivor without ghosts did not win directly.',
    );
    $soloReplay = $repository->replayRoom($soloPublicId, [], $hostIdentity);
    murderTriviaAssert($soloReplay['starting_lives'] === 3 && $soloReplay['players'][0]['lives_remaining'] === 3, 'Replay did not copy three starting lives.');

    // One-life room: instant ghosting, ghost haunting, and the all-fail spare rule.
    $thirdIdentity = murderTriviaGuest($pdo, 'Third Wraith');
    $hauntRoom = $repository->createRoom([
        'max_players' => 3,
        'answer_window_seconds' => 30,
        'starting_lives' => 1,
    ], $hostIdentity);
    $hauntPublicId = (string) $hauntRoom['id'];
    murderTriviaAssert($hauntRoom['starting_lives'] === 1 && count($hauntRoom['created_links'] ?? []) === 2, 'The one-life room was not created with two invitations.');
    $repository->claimLink((string) $hauntRoom['created_links'][0]['token'], $guestIdentity);
    $hauntClaimed = $repository->claimLink((string) $hauntRoom['created_links'][1]['token'], $thirdIdentity);
    $hauntSeats = [];
    foreach ($hauntClaimed['players'] as $player) {
        murderTriviaAssert($player['lives_remaining'] === 1, 'A one-life room seated a player with the wrong lives.');
        $hauntSeats[(int) $player['seat_number']] = (string) $player['id'];
    }
    [$hauntHostId, $hauntGuestId, $hauntThirdId] = [$hauntSeats[1], $hauntSeats[2], $hauntSeats[3]];
    $repository->startRoom($hauntPublicId, $hostIdentity);

    murderTriviaAnswerTrivia($repository, $pdo, $hauntPublicId, [[$hostIdentity, false], [$guestIdentity, true], [$thirdIdentity, true]]);
    $instantFloor = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($instantFloor['phase'] === 'killing_floor' && $instantFloor['round']['eligible_player_ids'] === [$hauntHostId], 'The one-life host was not sent alone to the Killing Floor.');
    $instantType = (string) $instantFloor['round']['minigame']['type'];
    $instantResult = $repository->submitAnswer($hauntPublicId, murderTriviaKillingFloorAnswer(murderTriviaMinigamePayload($pdo, $hauntPublicId), $instantType, false), $hostIdentity);
    $instantResults = $instantResult['round']['minigame']['results'];
    murderTriviaAssert($instantResults['ghosted_player_ids'] === [$hauntHostId] && $instantResults['lives_lost_player_ids'] === [], 'A one-life loss did not ghost instantly.');
    murderTriviaAssert(murderTriviaPlayer($instantResult, $hauntHostId)['is_ghost'] === true, 'The one-life host did not become a ghost.');
    $hauntState = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($hauntState['phase'] === 'trivia', 'Two living players did not return to trivia.');

    for ($haunt = 1; $haunt <= 4; $haunt++) {
        $hauntResult = murderTriviaAnswerTrivia($repository, $pdo, $hauntPublicId, [[$hostIdentity, true], [$guestIdentity, true], [$thirdIdentity, true]]);
        murderTriviaAssert($hauntResult['round']['status'] === 'resolved', 'A trivia round with a ghost did not resolve after every answer.');
        murderTriviaAssert(
            murderTriviaPlayer($hauntResult, $hauntHostId)['race_position'] === min($haunt, 3),
            "The ghost haunt position after {$haunt} correct answers was not capped at 3.",
        );
        foreach ([$hauntGuestId, $hauntThirdId] as $livingId) {
            murderTriviaAssert(murderTriviaPlayer($hauntResult, $livingId)['race_position'] === 0, 'A living player moved along the track during trivia.');
        }
        $hauntState = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($hauntState['phase'] === 'trivia', 'All-correct trivia with a ghost left the trivia phase.');
    }

    // A wrong ghost answer neither haunts nor sends anyone to the Killing Floor.
    $ghostWrong = murderTriviaAnswerTrivia($repository, $pdo, $hauntPublicId, [[$hostIdentity, false], [$guestIdentity, true], [$thirdIdentity, true]]);
    murderTriviaAssert(murderTriviaPlayer($ghostWrong, $hauntHostId)['race_position'] === 3, 'A wrong ghost answer changed the haunt position.');
    $hauntState = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($hauntState['phase'] === 'trivia', 'A wrong ghost answer sent someone to the Killing Floor.');

    // The guest survives a trial but falls one correct trivia answer behind the third player.
    murderTriviaAnswerTrivia($repository, $pdo, $hauntPublicId, [[$hostIdentity, true], [$guestIdentity, false], [$thirdIdentity, true]]);
    $guestFloor = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($guestFloor['phase'] === 'killing_floor' && $guestFloor['round']['eligible_player_ids'] === [$hauntGuestId], 'The wrong guest was not sent alone to the Killing Floor.');
    $guestFloorType = (string) $guestFloor['round']['minigame']['type'];
    $guestSurvived = $repository->submitAnswer($hauntPublicId, murderTriviaKillingFloorAnswer(murderTriviaMinigamePayload($pdo, $hauntPublicId), $guestFloorType, true), $guestIdentity);
    murderTriviaAssert(murderTriviaPlayer($guestSurvived, $hauntGuestId)['lives_remaining'] === 1, 'Passing a trial cost the guest a life.');
    $hauntState = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($hauntState['phase'] === 'trivia', 'Passing a trial did not return upstairs.');

    // Both living players fail; the guest answers first and holds the lower seat, but the third player has more correct trivia.
    murderTriviaAnswerTrivia($repository, $pdo, $hauntPublicId, [[$hostIdentity, true], [$guestIdentity, false], [$thirdIdentity, false]]);
    $spareFloor = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($spareFloor['phase'] === 'killing_floor' && $spareFloor['round']['eligible_player_ids'] === [$hauntGuestId, $hauntThirdId], 'Both wrong living players were not sent to the Killing Floor.');
    $spareType = (string) $spareFloor['round']['minigame']['type'];
    $sparePayload = murderTriviaMinigamePayload($pdo, $hauntPublicId);
    $repository->submitAnswer($hauntPublicId, murderTriviaKillingFloorAnswer($sparePayload, $spareType, false), $guestIdentity);
    $spareResult = $repository->submitAnswer($hauntPublicId, murderTriviaKillingFloorAnswer($sparePayload, $spareType, false), $thirdIdentity);
    murderTriviaAssert($spareResult['round']['status'] === 'resolved', 'The all-fail trial did not resolve.');
    $spareResults = $spareResult['round']['minigame']['results'];
    murderTriviaAssert($spareResults['spared_player_id'] === $hauntThirdId, 'The all-fail spare did not choose the player with the most correct trivia answers.');
    murderTriviaAssert($spareResults['ghosted_player_ids'] === [$hauntGuestId] && $spareResults['lives_lost_player_ids'] === [] && $spareResults['survivor_player_ids'] === [], 'The all-fail trial did not ghost exactly the unspared player.');
    $spareOutcomes = murderTriviaOutcomes($spareResults);
    murderTriviaAssert(
        $spareOutcomes[$hauntThirdId]['spared'] === true && $spareOutcomes[$hauntThirdId]['lives_remaining'] >= 1
        && $spareOutcomes[$hauntThirdId]['ghosted'] === false && $spareOutcomes[$hauntThirdId]['lost_life'] === false,
        'The spared outcome was wrong.',
    );
    murderTriviaAssert($spareOutcomes[$hauntGuestId]['ghosted'] === true && $spareOutcomes[$hauntGuestId]['lives_remaining'] === 0, 'The unspared outcome was wrong.');
    $sparedPlayer = murderTriviaPlayer($spareResult, $hauntThirdId);
    murderTriviaAssert($sparedPlayer['status'] === 'active' && $sparedPlayer['is_ghost'] === false && $sparedPlayer['lives_remaining'] === 1, 'The spared player was not kept alive with one life.');

    // Ghosts carry their haunt head start into the race; the living body still starts at 4.
    $hauntRace = $repository->advanceRound($hauntPublicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($hauntRace['phase'] === 'ghost_race' && $hauntRace['body_holder_player_id'] === $hauntThirdId, 'The spared survivor did not carry the body into the race.');
    $hauntPositions = $hauntRace['round']['race_positions'];
    murderTriviaAssert((int) ($hauntPositions[$hauntThirdId] ?? -1) === 4, 'The living body holder did not start the race at 4.');
    murderTriviaAssert((int) ($hauntPositions[$hauntHostId] ?? -1) === 3, 'The haunting ghost did not carry its capped head start of 3.');
    murderTriviaAssert((int) ($hauntPositions[$hauntGuestId] ?? -1) === 0, 'A freshly ghosted player started the race with a head start.');

    fwrite(STDOUT, "Murder Trivia database playthrough passed ({$raceRounds} race rounds).\n");
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $pdo->exec('SET search_path TO public');
    if ($schemaCreated) {
        $pdo->exec("DROP SCHEMA {$quotedSchema} CASCADE");
    }
}
