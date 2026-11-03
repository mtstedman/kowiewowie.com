#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Stratego\StrategoEngine;
use Wowie\Api\Stratego\StrategoRuleException;

require_once __DIR__ . '/../includes/stratego/classes/StrategoRuleException.php';
require_once __DIR__ . '/../includes/stratego/classes/StrategoEngine.php';

function assertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assertFalse(bool $condition, string $message): void
{
    assertTrue(!$condition, $message);
}

function assertSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(
            $message . ' (expected ' . var_export($expected, true) . ', got ' . var_export($actual, true) . ')',
        );
    }
}

/** @param callable(): mixed $callback */
function assertRuleCode(callable $callback, string $expectedCode, string $message): void
{
    try {
        $callback();
    } catch (StrategoRuleException $error) {
        assertSame($expectedCode, $error->ruleCode(), $message . ' [wrong rule code]');
        assertTrue($error instanceof InvalidArgumentException, 'StrategoRuleException must extend InvalidArgumentException');

        return;
    }

    throw new RuntimeException($message . ' [no StrategoRuleException thrown]');
}

/** @return list<array{square: string, rank: string}> */
function armyPlacements(string $color, bool $reversed = false): array
{
    $ranksOfRows = $color === 'red' ? [1, 2, 3, 4] : [10, 9, 8, 7];
    $squares = [];
    foreach ($ranksOfRows as $boardRank) {
        foreach (str_split('abcdefghij') as $file) {
            $squares[] = $file . $boardRank;
        }
    }

    $ranks = [];
    foreach (StrategoEngine::standardArmy() as $rank => $count) {
        for ($i = 0; $i < $count; $i++) {
            $ranks[] = (string) $rank;
        }
    }
    if ($reversed) {
        $ranks = array_reverse($ranks);
    }

    $placements = [];
    foreach ($ranks as $index => $rank) {
        $placements[] = ['square' => $squares[$index], 'rank' => $rank];
    }

    return $placements;
}

/**
 * @param array<string, array{string, string}> $pieces square => [color, rank]
 * @return array<string, mixed>
 */
function activeState(StrategoEngine $engine, array $pieces, string $turn = 'red'): array
{
    $state = $engine->initialState();
    $state['phase'] = 'active';
    $state['turn'] = $turn;
    $state['ready'] = ['red' => true, 'blue' => true];
    foreach ($pieces as $square => [$color, $rank]) {
        $coords = StrategoEngine::squareToCoords($square);
        assertTrue($coords !== null, 'test fixture square ' . $square . ' must be valid');
        $state['board'][$coords[0]][$coords[1]] = [
            'id' => $color . '-' . $square,
            'color' => $color,
            'rank' => $rank,
            'revealed' => false,
        ];
    }

    return $state;
}

/** @param array<string, mixed> $state */
function pieceAt(array $state, string $square): ?array
{
    $coords = StrategoEngine::squareToCoords($square);

    return $coords === null ? null : $state['board'][$coords[0]][$coords[1]];
}

/**
 * @param array<string, mixed> $state
 * @return list<string>
 */
function destinationsFrom(StrategoEngine $engine, array $state, string $color, string $from): array
{
    $targets = [];
    foreach ($engine->legalMoves($state, $color) as $move) {
        if ($move['from'] === $from) {
            $targets[] = $move['to'];
        }
    }
    sort($targets);

    return $targets;
}

/** @param array<string, mixed> $state */
function countColor(array $state, string $color): int
{
    $count = 0;
    foreach ($state['board'] as $row) {
        foreach ($row as $cell) {
            if (is_array($cell) && $cell['color'] === $color) {
                $count++;
            }
        }
    }

    return $count;
}

$engine = new StrategoEngine();

// --- Square notation and lakes ---------------------------------------------
assertSame([0, 0], StrategoEngine::squareToCoords('a1'), 'a1 should map to row 0 col 0');
assertSame([9, 9], StrategoEngine::squareToCoords('j10'), 'j10 should map to row 9 col 9');
assertSame('e7', StrategoEngine::coordsToSquare(6, 4), 'row 6 col 4 should be e7');
assertSame(null, StrategoEngine::squareToCoords('k1'), 'k1 is off the board');
assertSame(null, StrategoEngine::squareToCoords('a11'), 'a11 is off the board');
foreach (['c5', 'd5', 'c6', 'd6', 'g5', 'h5', 'g6', 'h6'] as $lakeSquare) {
    assertTrue(StrategoEngine::isLakeSquare($lakeSquare), $lakeSquare . ' should be a lake');
}
foreach (['a5', 'b6', 'e5', 'f6', 'i5', 'j6', 'c4', 'c7'] as $openSquare) {
    assertFalse(StrategoEngine::isLakeSquare($openSquare), $openSquare . ' should not be a lake');
}

// --- Army counts --------------------------------------------------------------
$army = StrategoEngine::standardArmy();
assertSame(40, array_sum($army), 'standard army should have 40 pieces');
$expectedArmy = ['10' => 1, '9' => 1, '8' => 2, '7' => 3, '6' => 4, '5' => 4, '4' => 4, '3' => 5, '2' => 8, '1' => 1, 'B' => 6, 'F' => 1];
foreach ($expectedArmy as $rank => $count) {
    assertSame($count, $army[$rank] ?? null, 'army count for rank ' . (string) $rank);
}
assertSame(count($expectedArmy), count($army), 'standard army should have exactly 12 rank codes');

// --- Initial state and setup validation ---------------------------------------
$state = $engine->initialState();
assertSame('setup', $state['phase'], 'initial phase should be setup');
assertSame('red', $state['turn'], 'red moves first');
assertSame(['red' => false, 'blue' => false], $state['ready'], 'nobody is ready initially');
assertSame(['red' => [], 'blue' => []], $state['captured'], 'nothing is captured initially');
assertSame(['red' => [], 'blue' => []], $state['recent_moves'], 'no recent moves initially');
assertSame(0, $state['move_count'], 'move count starts at 0');
assertSame(null, $state['last_move'], 'no last move initially');
assertSame(null, $state['winner'], 'no winner initially');
assertSame(null, $state['end_reason'], 'no end reason initially');
assertSame(10, count($state['board']), 'board has 10 rows');
assertSame(10, count($state['board'][0]), 'board has 10 columns');

$redPlacements = armyPlacements('red');
$bluePlacements = armyPlacements('blue');

$tooFew = array_slice($redPlacements, 0, 39);
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $tooFew), 'invalid_setup', '39 placements must be rejected');

$tooMany = $redPlacements;
$tooMany[] = ['square' => 'a5', 'rank' => '2'];
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $tooMany), 'invalid_setup', '41 placements must be rejected');

$wrongCounts = $redPlacements;
$wrongCounts[39]['rank'] = 'B'; // replaces the flag with a 7th bomb
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $wrongCounts), 'invalid_setup', 'wrong army counts must be rejected');

$outsideRows = $redPlacements;
$outsideRows[0]['square'] = 'a5';
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $outsideRows), 'invalid_setup', 'red placement outside ranks 1-4 must be rejected');
assertRuleCode(static fn () => $engine->applySetup($state, 'blue', $redPlacements), 'invalid_setup', 'blue cannot use red setup rows');

$lakePlacement = $redPlacements;
$lakePlacement[0]['square'] = 'c5';
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $lakePlacement), 'invalid_setup', 'lake placement must be rejected');

$duplicate = $redPlacements;
$duplicate[1]['square'] = $duplicate[0]['square'];
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $duplicate), 'invalid_setup', 'duplicate squares must be rejected');

$unknownRank = $redPlacements;
$unknownRank[0]['rank'] = '11';
assertRuleCode(static fn () => $engine->applySetup($state, 'red', $unknownRank), 'invalid_setup', 'unknown rank must be rejected');

assertRuleCode(static fn () => $engine->applySetup($state, 'green', $redPlacements), 'invalid_color', 'unknown color must be rejected');
assertRuleCode(static fn () => $engine->setReady($state, 'red'), 'invalid_setup', 'setReady requires a complete placement');
assertRuleCode(static fn () => $engine->applyMove($state, 'red', 'a4', 'a5'), 'wrong_phase', 'moves are rejected during setup');

$setupState = $engine->applySetup($state, 'red', $redPlacements);
assertSame(40, countColor($setupState, 'red'), 'red should have 40 pieces after setup');
assertSame(0, countColor($state, 'red'), 'applySetup must not mutate the input state');
assertSame('10', pieceAt($setupState, 'a1')['rank'] ?? null, 'first placement should put the marshal on a1');
assertSame(false, pieceAt($setupState, 'a1')['revealed'] ?? null, 'placed pieces start unrevealed');

$resubmitted = $engine->applySetup($setupState, 'red', armyPlacements('red', true));
assertSame(40, countColor($resubmitted, 'red'), 're-submission replaces instead of adding pieces');
assertSame('F', pieceAt($resubmitted, 'a1')['rank'] ?? null, 're-submission should replace the earlier placement');

$setupState = $engine->applySetup($setupState, 'blue', $bluePlacements);
assertSame(40, countColor($setupState, 'blue'), 'blue should have 40 pieces after setup');
assertSame(40, countColor($setupState, 'red'), 'blue setup must not touch red pieces');

$setupView = $engine->presentForViewer($setupState, 'red');
assertSame(40, countColor($setupView, 'red'), 'red viewer sees own setup');
assertSame(0, countColor($setupView, 'blue'), 'red viewer must not see blue placements during setup');
assertSame(['red' => 40, 'blue' => 40], $setupView['placed'], 'setup view shows placement counts');
assertSame(0, countColor($engine->presentForViewer($setupState, null), 'red'), 'spectator sees no placements during setup');

$redReady = $engine->setReady($setupState, 'red');
assertSame('setup', $redReady['phase'], 'one ready player keeps setup phase');
assertSame(true, $redReady['ready']['red'], 'red should be ready');
assertRuleCode(static fn () => $engine->applySetup($redReady, 'red', $redPlacements), 'already_ready', 'ready player cannot change setup');

$bothReady = $engine->setReady($redReady, 'blue');
assertSame('active', $bothReady['phase'], 'both ready should start the game');
assertSame('red', $bothReady['turn'], 'red moves first after setup');
assertTrue($engine->legalMoves($bothReady, 'red') !== [], 'red should have legal moves at the start');
assertRuleCode(static fn () => $engine->applySetup($bothReady, 'red', $redPlacements), 'wrong_phase', 'setup is rejected once active');

// --- Turn order and basic move validation -------------------------------------
assertRuleCode(static fn () => $engine->applyMove($bothReady, 'blue', 'a7', 'a6'), 'not_your_turn', 'blue cannot move on red turn');
assertRuleCode(static fn () => $engine->applyMove($bothReady, 'red', 'a5', 'a6'), 'illegal_move', 'moving from an empty square is illegal');
assertRuleCode(static fn () => $engine->applyMove($bothReady, 'red', 'a7', 'a6'), 'illegal_move', 'moving an enemy piece is illegal');

// --- One-step movement, lakes, own pieces --------------------------------------
$moveState = activeState($engine, [
    'a1' => ['red', '5'],
    'd4' => ['red', '6'],
    'e2' => ['red', '7'],
    'e3' => ['red', '8'],
    'j1' => ['red', 'F'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]);
assertSame(['a2', 'b1'], destinationsFrom($engine, $moveState, 'red', 'a1'), 'corner piece moves one square orthogonally');
assertSame(['c4', 'd3', 'e4'], destinationsFrom($engine, $moveState, 'red', 'd4'), 'piece next to a lake cannot enter it');
assertSame(['d2', 'e1', 'f2'], destinationsFrom($engine, $moveState, 'red', 'e2'), 'piece cannot move onto own piece');
assertRuleCode(static fn () => $engine->applyMove($moveState, 'red', 'd4', 'd5'), 'illegal_move', 'entering a lake is illegal');
assertRuleCode(static fn () => $engine->applyMove($moveState, 'red', 'e2', 'e3'), 'illegal_move', 'moving onto own piece is illegal');
assertRuleCode(static fn () => $engine->applyMove($moveState, 'red', 'a1', 'a3'), 'illegal_move', 'non-scout cannot move two squares');
assertRuleCode(static fn () => $engine->applyMove($moveState, 'red', 'a1', 'b2'), 'illegal_move', 'diagonal moves are illegal');

$afterStep = $engine->applyMove($moveState, 'red', 'a1', 'a2');
assertSame(null, pieceAt($afterStep, 'a1'), 'from-square is emptied');
assertSame('5', pieceAt($afterStep, 'a2')['rank'] ?? null, 'piece arrives on the to-square');
assertSame('blue', $afterStep['turn'], 'turn passes to blue');
assertSame(1, $afterStep['move_count'], 'move count increments');
assertSame('move', $afterStep['last_move']['outcome'], 'plain move outcome');
assertSame(null, $afterStep['last_move']['defender'], 'plain move has no defender');
assertSame(false, pieceAt($afterStep, 'a2')['revealed'], 'plain move does not reveal the piece');
assertSame([['piece_id' => 'red-a1', 'from' => 'a1', 'to' => 'a2']], $afterStep['recent_moves']['red'], 'recent moves are tracked');
assertSame('active', $afterStep['phase'], 'game continues');
assertRuleCode(static fn () => $engine->applyMove($afterStep, 'red', 'a2', 'a3'), 'not_your_turn', 'red cannot move twice in a row');

// --- Bombs and flags never move ------------------------------------------------
$immobileState = activeState($engine, [
    'a1' => ['red', 'B'],
    'b1' => ['red', 'F'],
    'j1' => ['red', '4'],
    'j10' => ['blue', 'F'],
    'a10' => ['blue', '4'],
]);
assertSame([], destinationsFrom($engine, $immobileState, 'red', 'a1'), 'bombs have no legal moves');
assertSame([], destinationsFrom($engine, $immobileState, 'red', 'b1'), 'flags have no legal moves');
assertRuleCode(static fn () => $engine->applyMove($immobileState, 'red', 'a1', 'a2'), 'illegal_move', 'bombs cannot move');
assertRuleCode(static fn () => $engine->applyMove($immobileState, 'red', 'b1', 'b2'), 'illegal_move', 'flags cannot move');

// --- Scouts --------------------------------------------------------------------
$scoutState = activeState($engine, [
    'a2' => ['red', '2'],
    'e1' => ['red', '2'],
    'e4' => ['red', '5'],
    'a5' => ['red', '2'],
    'j1' => ['red', 'F'],
    'a8' => ['blue', '1'],
    'j10' => ['blue', 'F'],
    'i10' => ['blue', '4'],
]);
assertSame(
    ['a1', 'a3', 'a4', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'i2', 'j2'],
    destinationsFrom($engine, $scoutState, 'red', 'a2'),
    'scout reaches every empty square along open lines',
);
assertSame(12, count(destinationsFrom($engine, $scoutState, 'red', 'a2')), 'scout on a2 has exactly 12 moves (blocked at a5)');
assertFalse(in_array('a6', destinationsFrom($engine, $scoutState, 'red', 'a2'), true), 'scout cannot jump over own piece');
assertSame(
    ['e2', 'e3'],
    array_values(array_filter(destinationsFrom($engine, $scoutState, 'red', 'e1'), static fn (string $sq): bool => $sq[0] === 'e')),
    'scout path north is blocked by own piece on e4',
);
assertRuleCode(static fn () => $engine->applyMove($scoutState, 'red', 'e1', 'e5'), 'illegal_move', 'scout cannot jump over pieces');
assertTrue(in_array('b5', destinationsFrom($engine, $scoutState, 'red', 'a5'), true), 'scout can move next to a lake');
assertFalse(in_array('e5', destinationsFrom($engine, $scoutState, 'red', 'a5'), true), 'scout cannot cross a lake');
assertRuleCode(static fn () => $engine->applyMove($scoutState, 'red', 'a5', 'e5'), 'illegal_move', 'scout cannot jump over a lake');
assertTrue(in_array('a8', destinationsFrom($engine, $scoutState, 'red', 'a5'), true), 'scout can attack the first enemy in line');
assertFalse(in_array('a9', destinationsFrom($engine, $scoutState, 'red', 'a5'), true), 'scout cannot pass an enemy piece');

$scoutAttack = $engine->applyMove($scoutState, 'red', 'a5', 'a8');
assertSame('attacker_wins', $scoutAttack['last_move']['outcome'], 'scout beats spy when attacking from distance');
assertSame('2', pieceAt($scoutAttack, 'a8')['rank'] ?? null, 'scout moves into the square after winning');
assertSame(null, pieceAt($scoutAttack, 'a5'), 'scout left its square');
assertSame(['1'], $scoutAttack['captured']['blue'], 'blue lost the spy');

$scoutLong = $engine->applyMove($scoutState, 'red', 'a2', 'j2');
assertSame('2', pieceAt($scoutLong, 'j2')['rank'] ?? null, 'scout can travel the whole rank in one move');

// --- Spy versus Marshal ---------------------------------------------------------
$spyAttack = activeState($engine, [
    'e4' => ['red', '1'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '10'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]);
$spyWins = $engine->applyMove($spyAttack, 'red', 'e4', 'e5');
assertSame('attacker_wins', $spyWins['last_move']['outcome'], 'spy attacking marshal wins');
assertSame('1', pieceAt($spyWins, 'e5')['rank'] ?? null, 'spy moves into the marshal square');
assertSame(true, pieceAt($spyWins, 'e5')['revealed'] ?? null, 'combat reveals the winner');
assertSame(['10'], $spyWins['captured']['blue'], 'blue lost the marshal');
assertSame(['color' => 'blue', 'rank' => '10'], $spyWins['last_move']['defender'], 'last move records the defender');
assertSame(['color' => 'red', 'rank' => '1'], $spyWins['last_move']['attacker'], 'last move records the attacker');

$marshalAttack = activeState($engine, [
    'e4' => ['red', '1'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '10'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
], 'blue');
$marshalWins = $engine->applyMove($marshalAttack, 'blue', 'e5', 'e4');
assertSame('attacker_wins', $marshalWins['last_move']['outcome'], 'spy loses when attacked by the marshal');
assertSame('10', pieceAt($marshalWins, 'e4')['rank'] ?? null, 'marshal moves into the spy square');
assertSame(['1'], $marshalWins['captured']['red'], 'red lost the spy');

$spyAttacked = activeState($engine, [
    'e4' => ['red', '1'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '2'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
], 'blue');
$spyLosesToScout = $engine->applyMove($spyAttacked, 'blue', 'e5', 'e4');
assertSame('attacker_wins', $spyLosesToScout['last_move']['outcome'], 'spy loses when attacked by anything');

$spyVsGeneral = activeState($engine, [
    'e4' => ['red', '1'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '9'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]);
$spyLosesAttacking = $engine->applyMove($spyVsGeneral, 'red', 'e4', 'e5');
assertSame('defender_wins', $spyLosesAttacking['last_move']['outcome'], 'spy only beats the marshal');

// --- Bombs ------------------------------------------------------------------------
$bombBoard = [
    'e4' => ['red', '3'],
    'f4' => ['red', '9'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', 'B'],
    'f5' => ['blue', 'B'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
];
$minerAttack = $engine->applyMove(activeState($engine, $bombBoard), 'red', 'e4', 'e5');
assertSame('attacker_wins', $minerAttack['last_move']['outcome'], 'miner defuses the bomb');
assertSame('3', pieceAt($minerAttack, 'e5')['rank'] ?? null, 'miner moves into the bomb square');
assertSame(null, pieceAt($minerAttack, 'e4'), 'miner left its square');
assertSame(['B'], $minerAttack['captured']['blue'], 'blue lost a bomb');

$generalOnBomb = $engine->applyMove(activeState($engine, $bombBoard), 'red', 'f4', 'f5');
assertSame('defender_wins', $generalOnBomb['last_move']['outcome'], 'non-miner loses against a bomb');
assertSame(null, pieceAt($generalOnBomb, 'f4'), 'losing attacker is removed');
assertSame('B', pieceAt($generalOnBomb, 'f5')['rank'] ?? null, 'bomb stays in place');
assertSame(true, pieceAt($generalOnBomb, 'f5')['revealed'] ?? null, 'bomb is revealed after combat');
assertSame(['9'], $generalOnBomb['captured']['red'], 'red lost the general');
assertSame([], $generalOnBomb['captured']['blue'], 'blue lost nothing');

// --- Rank comparisons ---------------------------------------------------------------
$equalBattle = $engine->applyMove(activeState($engine, [
    'e4' => ['red', '7'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '7'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]), 'red', 'e4', 'e5');
assertSame('both_lost', $equalBattle['last_move']['outcome'], 'equal ranks remove both');
assertSame(null, pieceAt($equalBattle, 'e4'), 'equal-rank attacker removed');
assertSame(null, pieceAt($equalBattle, 'e5'), 'equal-rank defender removed');
assertSame(['7'], $equalBattle['captured']['red'], 'red lost the major');
assertSame(['7'], $equalBattle['captured']['blue'], 'blue lost the major');

$higherAttacker = $engine->applyMove(activeState($engine, [
    'e4' => ['red', '6'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '4'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]), 'red', 'e4', 'e5');
assertSame('attacker_wins', $higherAttacker['last_move']['outcome'], 'higher attacker wins');
assertSame('6', pieceAt($higherAttacker, 'e5')['rank'] ?? null, 'winning attacker advances');
assertSame(null, pieceAt($higherAttacker, 'e4'), 'winning attacker leaves its square');

$lowerAttacker = $engine->applyMove(activeState($engine, [
    'e4' => ['red', '4'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '6'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]), 'red', 'e4', 'e5');
assertSame('defender_wins', $lowerAttacker['last_move']['outcome'], 'higher defender wins');
assertSame('6', pieceAt($lowerAttacker, 'e5')['rank'] ?? null, 'winning defender stays');
assertSame('blue', pieceAt($lowerAttacker, 'e5')['color'] ?? null, 'defender square keeps the defender');
assertSame(null, pieceAt($lowerAttacker, 'e4'), 'losing attacker removed');
assertSame(true, pieceAt($lowerAttacker, 'e5')['revealed'] ?? null, 'defender revealed by combat');

// --- Flag capture -------------------------------------------------------------------
$flagCapture = $engine->applyMove(activeState($engine, [
    'e4' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', 'F'],
    'a10' => ['blue', '4'],
]), 'red', 'e4', 'e5');
assertSame('flag_captured', $flagCapture['last_move']['outcome'], 'striking the flag captures it');
assertSame('finished', $flagCapture['phase'], 'flag capture finishes the game');
assertSame('red', $flagCapture['winner'], 'attacker wins on flag capture');
assertSame('flag_captured', $flagCapture['end_reason'], 'end reason is flag_captured');
assertSame(['F'], $flagCapture['captured']['blue'], 'blue lost the flag');
assertRuleCode(static fn () => $engine->applyMove($flagCapture, 'blue', 'a10', 'a9'), 'wrong_phase', 'no moves after the game ends');
assertSame([], $engine->legalMoves($flagCapture, 'blue'), 'finished games have no legal moves');

// --- Two-square rule ---------------------------------------------------------------
$twoSquare = activeState($engine, [
    'a1' => ['red', '5'],
    'f1' => ['red', 'F'],
    'j10' => ['blue', '5'],
    'f10' => ['blue', 'F'],
]);
$twoSquare = $engine->applyMove($twoSquare, 'red', 'a1', 'a2');
$twoSquare = $engine->applyMove($twoSquare, 'blue', 'j10', 'j9');
$twoSquare = $engine->applyMove($twoSquare, 'red', 'a2', 'a1');
$twoSquare = $engine->applyMove($twoSquare, 'blue', 'j9', 'j10');
$twoSquare = $engine->applyMove($twoSquare, 'red', 'a1', 'a2');
$twoSquare = $engine->applyMove($twoSquare, 'blue', 'j10', 'j9');
assertSame(3, count($twoSquare['recent_moves']['red']), 'recent moves keep the last three');
assertRuleCode(static fn () => $engine->applyMove($twoSquare, 'red', 'a2', 'a1'), 'two_square_rule', '4th oscillation must be rejected');
assertFalse(in_array('a1', destinationsFrom($engine, $twoSquare, 'red', 'a2'), true), 'legalMoves excludes the 4th oscillation');
assertTrue(in_array('a3', destinationsFrom($engine, $twoSquare, 'red', 'a2'), true), 'other moves remain legal');
$brokenCycle = $engine->applyMove($twoSquare, 'red', 'a2', 'a3');
assertSame('active', $brokenCycle['phase'], 'leaving the pair is allowed');
assertRuleCode(static fn () => $engine->applyMove($twoSquare, 'blue', 'j9', 'j10'), 'not_your_turn', 'turn still enforced');

// --- No legal moves loses -------------------------------------------------------------
$noMoves = activeState($engine, [
    'a1' => ['red', '5'],
    'j1' => ['red', 'F'],
    'a10' => ['blue', 'B'],
    'j10' => ['blue', 'F'],
]);
$noMovesAfter = $engine->applyMove($noMoves, 'red', 'a1', 'a2');
assertSame('finished', $noMovesAfter['phase'], 'player without legal moves loses');
assertSame('red', $noMovesAfter['winner'], 'opponent of the stuck player wins');
assertSame('no_moves', $noMovesAfter['end_reason'], 'end reason is no_moves');

// --- Resign ---------------------------------------------------------------------------
$resignState = activeState($engine, [
    'a1' => ['red', '5'],
    'j1' => ['red', 'F'],
    'a10' => ['blue', '5'],
    'j10' => ['blue', 'F'],
]);
$resigned = $engine->resign($resignState, 'red');
assertSame('finished', $resigned['phase'], 'resign finishes the game');
assertSame('blue', $resigned['winner'], 'opponent wins on resignation');
assertSame('resigned', $resigned['end_reason'], 'end reason is resigned');
assertRuleCode(static fn () => $engine->resign($resigned, 'blue'), 'wrong_phase', 'cannot resign a finished game');

// --- presentForViewer -------------------------------------------------------------------
$viewState = activeState($engine, [
    'e4' => ['red', '5'],
    'a1' => ['red', '4'],
    'j1' => ['red', 'F'],
    'e5' => ['blue', '6'],
    'a10' => ['blue', '4'],
    'j10' => ['blue', 'F'],
]);
$redView = $engine->presentForViewer($viewState, 'red');
assertSame(null, pieceAt($redView, 'e5')['rank'], 'red viewer must not see unrevealed blue rank');
assertSame(true, pieceAt($redView, 'e5')['hidden'], 'unrevealed blue piece is marked hidden');
assertSame('blue', pieceAt($redView, 'e5')['color'], 'hidden piece still shows its color');
assertSame('5', pieceAt($redView, 'e4')['rank'], 'red viewer sees own rank');
assertSame(false, pieceAt($redView, 'e4')['hidden'], 'own piece is not hidden');
assertFalse(str_contains((string) json_encode($redView), '"rank":"6"'), 'red view must not leak the blue captain anywhere');
assertSame(null, pieceAt($redView, 'j10')['rank'], 'red view must not leak the blue flag');
assertSame(null, pieceAt($redView, 'a10')['rank'], 'red view must not leak the blue sergeant');

$blueView = $engine->presentForViewer($viewState, 'blue');
assertSame('6', pieceAt($blueView, 'e5')['rank'], 'blue viewer sees own rank');
assertSame(null, pieceAt($blueView, 'e4')['rank'], 'blue viewer must not see unrevealed red rank');

$spectatorView = $engine->presentForViewer($viewState, null);
assertSame(null, pieceAt($spectatorView, 'e4')['rank'], 'spectator must not see unrevealed red rank');
assertSame(null, pieceAt($spectatorView, 'e5')['rank'], 'spectator must not see unrevealed blue rank');
assertSame('5', pieceAt($viewState, 'e4')['rank'], 'presentForViewer must not mutate the state');

$afterCombat = $engine->applyMove($viewState, 'red', 'e4', 'e5');
$redCombatView = $engine->presentForViewer($afterCombat, 'red');
assertSame('6', pieceAt($redCombatView, 'e5')['rank'], 'combat reveals the surviving blue piece');
assertSame(false, pieceAt($redCombatView, 'e5')['hidden'], 'revealed piece is no longer hidden');
assertSame('6', pieceAt($engine->presentForViewer($afterCombat, null), 'e5')['rank'], 'spectator sees revealed ranks');
assertSame(null, pieceAt($redCombatView, 'a10')['rank'], 'other blue pieces stay hidden');

$bluePlainMove = $engine->applyMove($afterCombat, 'blue', 'a10', 'a9');
$redAfterBlueMove = $engine->presentForViewer($bluePlainMove, 'red');
assertSame(null, $redAfterBlueMove['last_move']['attacker']['rank'], 'last move must not leak the rank of an unrevealed mover');
assertSame('4', $engine->presentForViewer($bluePlainMove, 'blue')['last_move']['attacker']['rank'], 'mover sees own rank in last move');

$finishedView = $engine->presentForViewer($engine->resign($viewState, 'blue'), 'red');
assertSame('6', pieceAt($finishedView, 'e5')['rank'], 'finished game reveals all ranks');
assertSame('F', pieceAt($finishedView, 'j10')['rank'], 'finished game reveals the flag');
assertSame(false, pieceAt($finishedView, 'j10')['hidden'], 'nothing is hidden after the game');

fwrite(STDOUT, "Stratego rules regressions passed.\n");
