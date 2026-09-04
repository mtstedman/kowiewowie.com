#!/usr/bin/env php
<?php

declare(strict_types=1);

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
        JOIN trivia_prompts p ON p.id = r.prompt_id
        WHERE room.public_id = :public_id
        ORDER BY r.round_number DESC
        LIMIT 1
    SQL);
    $statement->execute(['public_id' => $publicId]);
    $round = $statement->fetch(\PDO::FETCH_ASSOC);
    if (!is_array($round)) {
        throw new RuntimeException('The test room has no current round.');
    }

    return $round;
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
    murderTriviaAssert($minted['from'] === 0 && $minted['to'] === 12, 'The isolated database did not migrate from version 0 to 12.');
    $seededQuestions = seedTriviaQuestions($pdo, $projectRoot . '/database/data/trivia-questions.json');
    murderTriviaAssert($seededQuestions === 160, 'The isolated catalog did not seed all 160 questions.');

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

    $joinToken = (string) $room['created_links'][0]['token'];
    $claimed = $repository->claimLink($joinToken, $guestIdentity);
    murderTriviaAssert(count($claimed['players'] ?? []) === 2, 'The guest did not claim the second seat.');

    $started = $repository->startRoom($publicId, $hostIdentity);
    murderTriviaAssert($started['phase'] === 'trivia' && $started['round']['status'] === 'answering', 'The first trivia round did not open.');
    murderTriviaAssert(!isset($started['round']['prompt']['correct_answer']), 'An open trivia round leaked its correct answer.');

    // Two correct rounds must not exhaust a two-player room's prompt supply.
    for ($questionNumber = 1; $questionNumber <= 2; $questionNumber++) {
        $triviaRound = murderTriviaCurrentRound($pdo, $publicId);
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

    $killingFloorTypes = [
        'key_lock' => 'single_choice',
        'memory_match' => 'multi_select',
        'poison_chalices' => 'single_choice',
        'sword_boxes' => 'single_choice',
        'crypt_runes' => 'multi_select',
    ];

    foreach ($killingFloorTypes as $expectedType => $expectedAnswerShape) {
        $triviaRound = murderTriviaCurrentRound($pdo, $publicId);
        $correctSelection = murderTriviaCorrectSelection($triviaRound);
        $triviaAnswerShape = json_decode((string) $triviaRound['answer_shape'], true, 512, JSON_THROW_ON_ERROR);
        $triviaIsMulti = ($triviaAnswerShape['type'] ?? null) === 'multi_select';
        $choices = json_decode((string) $triviaRound['choices'], true, 512, JSON_THROW_ON_ERROR);
        $wrongSelection = array_values(array_filter(array_map('strval', $choices), static fn (string $choice): bool => !in_array($choice, $correctSelection, true)));
        murderTriviaAssert($wrongSelection !== [], "The trivia prompt before {$expectedType} did not have a usable wrong answer.");

        $afterHostAnswer = $repository->submitAnswer($publicId, murderTriviaAnswerPayload([$wrongSelection[0]], $triviaIsMulti), $hostIdentity);
        murderTriviaAssert($afterHostAnswer['round']['status'] === 'answering', "The trivia prompt before {$expectedType} resolved before every eligible player answered.");
        $afterGuestAnswer = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($correctSelection, $triviaIsMulti), $guestIdentity);
        murderTriviaAssert($afterGuestAnswer['round']['status'] === 'resolved', "The trivia prompt before {$expectedType} did not resolve after every answer.");

        $killingFloor = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($killingFloor['phase'] === 'killing_floor', "A wrong living player was not sent to the {$expectedType} Killing Floor trial.");
        murderTriviaAssert($killingFloor['round']['minigame']['type'] === $expectedType, "The Killing Floor rotation did not open {$expectedType}.");
        murderTriviaAssert(($killingFloor['round']['answer_shape']['type'] ?? null) === $expectedAnswerShape, "The {$expectedType} answer shape was incorrect.");
        if ($expectedType === 'key_lock') {
            murderTriviaAssert(!isset($killingFloor['round']['minigame']['payload']['correct_key']), 'The open key lock leaked its correct key.');
        }
        if (in_array($expectedType, ['poison_chalices', 'sword_boxes'], true)) {
            murderTriviaAssert(($killingFloor['round']['answer_shape']['type'] ?? null) === 'single_choice', "The {$expectedType} trial did not require one choice.");
        }
        if ($expectedType === 'crypt_runes') {
            murderTriviaAssert(($killingFloor['round']['answer_shape']['type'] ?? null) === 'multi_select', 'The crypt runes trial did not require multiple selections.');
        }

        $killingRound = murderTriviaCurrentRound($pdo, $publicId);
        $minigamePayload = json_decode((string) $killingRound['minigame_payload'], true, 512, JSON_THROW_ON_ERROR);
        if ($expectedAnswerShape === 'multi_select') {
            $correctSelection = array_values(array_map('strval', $minigamePayload['correct_choices'] ?? []));
            murderTriviaAssert(count($correctSelection) > 1, "The {$expectedType} trial did not have a usable correct pattern.");
            $killingResult = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($correctSelection, true), $hostIdentity);
        } else {
            $correctAnswer = (string) ($minigamePayload['correct_key'] ?? '');
            murderTriviaAssert($correctAnswer !== '', "The {$expectedType} trial did not have a correct choice.");
            $killingResult = $repository->submitAnswer($publicId, murderTriviaAnswerPayload([$correctAnswer]), $hostIdentity);
        }
        murderTriviaAssert($killingResult['round']['status'] === 'resolved', "The {$expectedType} Killing Floor trial did not resolve after its only eligible player answered.");
        murderTriviaAssert(count(array_filter($killingResult['players'], static fn (array $player): bool => $player['is_ghost'] === true)) === 0, "A correct {$expectedType} answer incorrectly created a ghost.");

        $nextTrivia = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
        murderTriviaAssert($nextTrivia['phase'] === 'trivia', "Surviving the {$expectedType} Killing Floor trial did not return upstairs.");
    }

    $triviaRound = murderTriviaCurrentRound($pdo, $publicId);
    $correctSelection = murderTriviaCorrectSelection($triviaRound);
    $triviaAnswerShape = json_decode((string) $triviaRound['answer_shape'], true, 512, JSON_THROW_ON_ERROR);
    $triviaIsMulti = ($triviaAnswerShape['type'] ?? null) === 'multi_select';
    $choices = json_decode((string) $triviaRound['choices'], true, 512, JSON_THROW_ON_ERROR);
    $wrongSelection = array_values(array_filter(array_map('strval', $choices), static fn (string $choice): bool => !in_array($choice, $correctSelection, true)));
    murderTriviaAssert($wrongSelection !== [], 'The final trivia prompt did not have a usable wrong answer.');
    $repository->submitAnswer($publicId, murderTriviaAnswerPayload([$wrongSelection[0]], $triviaIsMulti), $hostIdentity);
    $repository->submitAnswer($publicId, murderTriviaAnswerPayload($correctSelection, $triviaIsMulti), $guestIdentity);

    $failureFloor = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($failureFloor['phase'] === 'killing_floor', 'The intentional later wrong answer skipped the Killing Floor.');
    murderTriviaAssert($failureFloor['round']['minigame']['type'] === 'key_lock', 'The Killing Floor rotation did not return to key lock after five trials.');

    $failureRound = murderTriviaCurrentRound($pdo, $publicId);
    $failurePayload = json_decode((string) $failureRound['minigame_payload'], true, 512, JSON_THROW_ON_ERROR);
    $correctKey = (string) ($failurePayload['correct_key'] ?? '');
    $wrongKey = array_values(array_filter(array_map('strval', $failurePayload['choices'] ?? []), static fn (string $choice): bool => $choice !== $correctKey));
    murderTriviaAssert($wrongKey !== [], 'The final key lock did not have a usable wrong key.');
    $killingResult = $repository->submitAnswer($publicId, murderTriviaAnswerPayload([$wrongKey[0]]), $hostIdentity);
    murderTriviaAssert($killingResult['round']['status'] === 'resolved', 'The intentionally failed key lock did not resolve after its only eligible player answered.');
    $hostPlayer = array_values(array_filter($killingResult['players'], static fn (array $player): bool => $player['viewer_controls_player'] === true))[0] ?? null;
    murderTriviaAssert(is_array($hostPlayer) && $hostPlayer['is_ghost'] === true, 'The intentionally failed key-lock player did not become a ghost.');

    $race = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
    murderTriviaAssert($race['phase'] === 'ghost_race', 'The last survivor did not enter the ghost race.');
    murderTriviaAssert($race['viewer']['can_answer_round'] === true, 'The ghost host was not allowed to answer the race.');
    foreach ($race['round']['prompt_payload']['items'] ?? [] as $item) {
        murderTriviaAssert(!array_key_exists('correct', $item), 'The open ghost race leaked a correct flag.');
    }

    $raceRounds = 0;
    while ($race['status'] !== 'finished' && $raceRounds < 5) {
        $raceRounds++;
        $rawRaceRound = murderTriviaCurrentRound($pdo, $publicId);
        $racePayload = json_decode((string) $rawRaceRound['prompt_payload'], true, 512, JSON_THROW_ON_ERROR);
        $raceCorrect = [];
        foreach ($racePayload['items'] ?? [] as $item) {
            if (is_array($item) && ($item['correct'] ?? false) === true) {
                $raceCorrect[] = (string) $item['label'];
            }
        }
        murderTriviaAssert($raceCorrect !== [], 'The ghost race prompt had no correct selections.');
        $repository->submitAnswer($publicId, murderTriviaAnswerPayload($raceCorrect, true), $hostIdentity);
        $race = $repository->submitAnswer($publicId, murderTriviaAnswerPayload($raceCorrect, true), $guestIdentity);
        murderTriviaAssert($race['round']['status'] === 'resolved', 'A ghost race round did not resolve after every answer.');
        if ($race['status'] !== 'finished') {
            $race = $repository->advanceRound($publicId, ['action' => 'advance'], $hostIdentity);
            murderTriviaAssert($race['phase'] === 'ghost_race', 'Advancing a ghost race left the finale early.');
        }
    }

    murderTriviaAssert($race['status'] === 'finished', 'The ghost race did not finish within five perfect rounds.');
    murderTriviaAssert($race['termination'] === 'escape_race', 'The game ended with the wrong termination reason.');
    murderTriviaAssert(is_string($race['winner_player_id']) && $race['winner_player_id'] !== '', 'The finished game did not select a winner.');
    murderTriviaAssert($race['winner_player_id'] === $race['body_holder_player_id'], 'The ghost-race winner did not hold the body.');

    $replay = $repository->replayRoom($publicId, [], $hostIdentity);
    murderTriviaAssert($replay['status'] === 'waiting' && $replay['id'] !== $publicId, 'Replay did not create a fresh waiting room.');
    murderTriviaAssert(count($replay['created_links'] ?? []) === 1, 'Replay did not create a new invitation.');

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
