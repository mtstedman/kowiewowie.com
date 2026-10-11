#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\ChessBot;
use Wowie\Api\Chess\ChessEngine;

require __DIR__ . '/../api/bootstrap.php';

function assertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @return list<array<string, mixed>> */
function legalMoves(ChessEngine $engine, string $fen): array
{
    $result = $engine->legalMoves($fen);
    assertTrue(($result['ok'] ?? false) === true, 'expected a valid test FEN: ' . $fen);

    return $result['moves'];
}

/** @return array<string, mixed> */
function applyMove(ChessEngine $engine, string $fen, string $uci): array
{
    $result = $engine->applyUciMove($fen, $uci);
    assertTrue(($result['ok'] ?? false) === true, "expected legal move $uci in $fen");

    return $result;
}

function moveForcesMateInTwo(ChessEngine $engine, string $fen, string $uci): bool
{
    $first = $engine->applyUciMove($fen, $uci);
    if (($first['ok'] ?? false) !== true || ($first['state']['status'] ?? null) !== 'ongoing') {
        return false;
    }

    $replies = legalMoves($engine, (string) $first['fen']);
    if ($replies === []) {
        return false;
    }

    foreach ($replies as $reply) {
        $afterReply = applyMove($engine, (string) $first['fen'], (string) $reply['uci']);
        $hasMate = false;
        foreach (legalMoves($engine, (string) $afterReply['fen']) as $mate) {
            $afterMate = applyMove($engine, (string) $afterReply['fen'], (string) $mate['uci']);
            if (($afterMate['state']['status'] ?? null) === 'checkmate') {
                $hasMate = true;
                break;
            }
        }
        if (!$hasMate) {
            return false;
        }
    }

    return true;
}

$engine = new ChessEngine();

$mateInOneFen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
$mateInOne = (new ChessBot($engine, 0, 2))->chooseMove($mateInOneFen);
assertTrue($mateInOne !== null, 'mate-in-one search returned null');
$mateInOneResult = applyMove($engine, $mateInOneFen, $mateInOne);
assertTrue(($mateInOneResult['state']['status'] ?? null) === 'checkmate', 'bot did not play mate in one');

$mateInTwoFen = '7k/7p/6K1/6Q1/8/8/8/8 w - - 0 1';
$mateInTwo = (new ChessBot($engine, 0, 4))->chooseMove($mateInTwoFen);
assertTrue($mateInTwo !== null, 'mate-in-two search returned null');
assertTrue(
    moveForcesMateInTwo($engine, $mateInTwoFen, $mateInTwo),
    'bot did not choose a move forcing mate in two: ' . $mateInTwo,
);

$hangingQueenFen = '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1';
$hangingQueen = (new ChessBot($engine, 0, 3))->chooseMove($hangingQueenFen);
assertTrue($hangingQueen === 'e4d5', 'bot failed to capture a hanging queen: ' . var_export($hangingQueen, true));

$poisonedPawnFen = '3rk3/8/8/3p4/8/8/8/3QK3 w - - 0 1';
$poisonedPawn = (new ChessBot($engine, 0, 3))->chooseMove($poisonedPawnFen);
assertTrue($poisonedPawn !== null, 'losing-recapture position returned null');
assertTrue($poisonedPawn !== 'd1d5', 'bot greedily captured a pawn and lost its queen to the rook');

$stalemateTrapFen = 'k7/8/2K5/2Q5/8/8/8/8 w - - 0 1';
$stalemateAvoidance = (new ChessBot($engine, 0, 4))->chooseMove($stalemateTrapFen);
assertTrue($stalemateAvoidance !== null, 'K+Q versus K position returned null');
$stalemateResult = applyMove($engine, $stalemateTrapFen, $stalemateAvoidance);
assertTrue(
    ($stalemateResult['state']['status'] ?? null) !== 'stalemate',
    'bot threw away a trivially won K+Q versus K position by stalemate',
);

$deterministicBot = new ChessBot($engine, 0, 4);
$deterministicFirst = $deterministicBot->chooseMove($hangingQueenFen);
$deterministicSecond = $deterministicBot->chooseMove($hangingQueenFen);
assertTrue($deterministicFirst === $deterministicSecond, 'fixed-depth search is not deterministic');

assertTrue((new ChessBot($engine, 0, 3))->chooseMove('not a FEN') === null, 'invalid FEN should return null');

$singleMoveFen = '7k/8/8/8/8/1b6/r7/K7 w - - 0 1';
$singleMoves = legalMoves($engine, $singleMoveFen);
assertTrue(count($singleMoves) === 1, 'single-move fixture does not have exactly one legal move');
$singleMove = (new ChessBot($engine, 0, 8))->chooseMove($singleMoveFen);
assertTrue($singleMove === $singleMoves[0]['uci'], 'bot did not return the only legal move');

$clockFen = 'r2q1rk1/pp2bppp/2n1pn2/2bp4/8/1PN1PN2/PBQP1PPP/R3KB1R w KQ - 2 10';
$clockBot = new ChessBot($engine, 300, 12);
$clockStartedAt = hrtime(true);
$clockMove = $clockBot->chooseMove($clockFen);
$clockElapsedMs = (hrtime(true) - $clockStartedAt) / 1000000;
assertTrue($clockMove !== null, 'clocked search returned null while legal moves existed');
$clockLegalUcis = array_column(legalMoves($engine, $clockFen), 'uci');
assertTrue(in_array($clockMove, $clockLegalUcis, true), 'clocked search returned an illegal move');
assertTrue($clockElapsedMs <= 450, sprintf('clocked search exceeded tolerance: %.1f ms', $clockElapsedMs));

$completedDepth = new ReflectionProperty(ChessBot::class, 'completedDepth');
$clockDepth = (int) $completedDepth->getValue($clockBot);
fwrite(STDOUT, sprintf("Clocked tactical search completed depth %d in %.1f ms.\n", $clockDepth, $clockElapsedMs));

// Normal-clock opening/middlegame position with the tactical Qxf7 mate available. Later
// iterations reuse that principal variation and prove the same result at greater depth.
$depthFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
assertTrue(count(legalMoves($engine, $depthFen)) > 1, 'default-depth fixture needs multiple legal moves');
$defaultBot = new ChessBot($engine);
$depthMove = $defaultBot->chooseMove($depthFen);
assertTrue($depthMove !== null, 'default middlegame search returned null');
$depthResult = applyMove($engine, $depthFen, $depthMove);
assertTrue(($depthResult['state']['status'] ?? null) === 'checkmate', 'default depth fixture was not solved');
$defaultDepth = (int) $completedDepth->getValue($defaultBot);
assertTrue(
    $defaultDepth > 6,
    sprintf('default search completed only depth %d; expected deeper than baseline depth 6', $defaultDepth),
);
fwrite(STDOUT, sprintf("Default middlegame search completed depth %d.\n", $defaultDepth));
fwrite(STDOUT, "Chess bot tactical regressions passed.\n");
