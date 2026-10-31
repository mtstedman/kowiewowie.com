#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\Board;
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

function moveForcesMateInTwoWithQuietFinish(ChessEngine $engine, string $fen, string $uci): bool
{
    $first = applyMove($engine, $fen, $uci);
    if (($first['state']['status'] ?? null) !== 'ongoing') {
        return false;
    }

    $replies = legalMoves($engine, (string) $first['fen']);
    if ($replies === []) {
        return false;
    }

    foreach ($replies as $reply) {
        $afterReply = applyMove($engine, (string) $first['fen'], (string) $reply['uci']);
        $hasQuietMate = false;
        $hasTacticalMate = false;
        foreach (legalMoves($engine, (string) $afterReply['fen']) as $mate) {
            $san = (string) $mate['san'];
            if (substr($san, -1) !== '#') {
                continue;
            }

            $afterMate = applyMove($engine, (string) $afterReply['fen'], (string) $mate['uci']);
            if (($afterMate['state']['status'] ?? null) !== 'checkmate') {
                continue;
            }

            if ($mate['promotion'] === null && !str_contains($san, 'x')) {
                $hasQuietMate = true;
            } else {
                $hasTacticalMate = true;
            }
        }
        if (!$hasQuietMate || $hasTacticalMate) {
            return false;
        }
    }

    return true;
}

/** Asserts the fixture is a legal ongoing position (side to move not in check) containing $uci. */
function assertTacticalFixture(ChessEngine $engine, string $fen, string $uci): void
{
    $state = $engine->detectState($fen);
    assertTrue(
        ($state['ok'] ?? false) === true
            && ($state['status'] ?? null) === 'ongoing'
            && ($state['in_check'] ?? null) === false,
        'expected an ongoing, not-in-check fixture: ' . $fen,
    );
    assertTrue(
        in_array($uci, array_column(legalMoves($engine, $fen), 'uci'), true),
        "expected legal fixture move $uci in $fen",
    );
}

/** Material balance, White minus Black, read from a FEN piece-placement field. */
function materialBalance(string $fen): int
{
    $values = ['p' => 100, 'n' => 320, 'b' => 330, 'r' => 500, 'q' => 900, 'k' => 0];
    $balance = 0;
    foreach (str_split(explode(' ', $fen)[0]) as $symbol) {
        $letter = strtolower($symbol);
        if (!isset($values[$letter])) {
            continue;
        }
        $balance += $symbol === $letter ? -$values[$letter] : $values[$letter];
    }

    return $balance;
}

/**
 * Exhaustive AND/OR proof that, whatever Black plays, White can keep a material balance of
 * at least $threshold once $plies more plies have been played. Checkmating Black also
 * qualifies; draws and White being mated do not.
 */
function whiteSecuresMaterial(ChessEngine $engine, string $fen, string $status, int $plies, int $threshold): bool
{
    $whiteToMove = explode(' ', $fen)[1] === 'w';
    if ($status === 'checkmate') {
        return !$whiteToMove;
    }
    if ($status !== 'ongoing') {
        return false;
    }
    if ($plies === 0) {
        return materialBalance($fen) >= $threshold;
    }

    $moves = legalMoves($engine, $fen);
    if ($whiteToMove) {
        // Captures are the likeliest witnesses; trying them first keeps the proof short.
        usort(
            $moves,
            static fn (array $a, array $b): int => (int) str_contains((string) $b['san'], 'x')
                <=> (int) str_contains((string) $a['san'], 'x'),
        );
    }
    foreach ($moves as $move) {
        $after = applyMove($engine, $fen, (string) $move['uci']);
        $secured = whiteSecuresMaterial(
            $engine,
            (string) $after['fen'],
            (string) $after['state']['status'],
            $plies - 1,
            $threshold,
        );
        if ($whiteToMove && $secured) {
            return true;
        }
        if (!$whiteToMove && !$secured) {
            return false;
        }
    }

    return !$whiteToMove;
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

// At depth two the search reaches the nominal horizon after every legal reply. The
// mate is visible only when quiescence admits the ensuing non-capture, non-promotion
// check; a capture/promotion-only horizon evaluates each continuation too soon.
$quietCheckHorizon = (new ChessBot($engine, 0, 2))->chooseMove($mateInTwoFen);
assertTrue(
    $quietCheckHorizon !== null
        && moveForcesMateInTwoWithQuietFinish($engine, $mateInTwoFen, $quietCheckHorizon),
    'depth-two decision was not established by exhaustive replies and quiet mating checks: '
        . var_export($quietCheckHorizon, true),
);

$quiescence = new ReflectionMethod(ChessBot::class, 'quiescence');
$nodes = new ReflectionProperty(ChessBot::class, 'nodes');
$quietCheckFen = '7k/8/8/8/8/8/8/K2Q4 w - - 0 1';
$quietChecks = array_values(array_filter(
    legalMoves($engine, $quietCheckFen),
    static fn (array $move): bool => $move['promotion'] === null
        && !str_contains((string) $move['san'], 'x')
        && substr((string) $move['san'], -1) === '+',
));
assertTrue($quietChecks !== [], 'quiet-check allowance fixture has no legal quiet check');
$afterQuietCheck = applyMove($engine, $quietCheckFen, (string) $quietChecks[0]['uci']);
assertTrue(
    legalMoves($engine, (string) $afterQuietCheck['fen']) !== [],
    'quiet-check allowance fixture needs at least one legal evasion',
);

$exhaustedBot = new ChessBot($engine, 0, 1);
$quiescence->invoke($exhaustedBot, Board::fromFen($quietCheckFen), -1000000, 1000000, 0, 0, false);
assertTrue((int) $nodes->getValue($exhaustedBot) === 1, 'exhausted allowance searched another elective quiet check');

$evasionBot = new ChessBot($engine, 0, 1);
$quiescence->invoke(
    $evasionBot,
    Board::fromFen((string) $afterQuietCheck['fen']),
    -1000000,
    1000000,
    1,
    1,
    false,
);
assertTrue((int) $nodes->getValue($evasionBot) > 1, 'exhausted allowance incorrectly suppressed legal check evasions');

$hangingQueenFen = '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1';
$hangingQueen = (new ChessBot($engine, 0, 3))->chooseMove($hangingQueenFen);
assertTrue($hangingQueen === 'e4d5', 'bot failed to capture a hanging queen: ' . var_export($hangingQueen, true));

$poisonedPawnFen = '3rk3/8/8/3p4/8/8/8/3QK3 w - - 0 1';
$poisonedPawn = (new ChessBot($engine, 0, 3))->chooseMove($poisonedPawnFen);
assertTrue($poisonedPawn !== null, 'losing-recapture position returned null');
assertTrue($poisonedPawn !== 'd1d5', 'bot greedily captured a pawn and lost its queen to the rook');

// Static exchange evaluation: swap-off outcome of a capture/promotion from the mover's view.
$staticExchange = new ReflectionMethod(ChessBot::class, 'staticExchange');
$seeBot = new ChessBot($engine, 0, 1);
$xrayExchangeFen = '3r2k1/8/5n2/3p4/8/2N5/3R4/3R2K1 w - - 0 1';
$seeFixtures = [
    // Undefended knight: the whole victim value.
    ['4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5', 320],
    // Pawn defended by a pawn, taken by the queen.
    ['4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', -800],
    // NxP NxN RxN RxR and the doubled rook recaptures through the x-ray.
    [$xrayExchangeFen, 'c3d5', 100],
    // RxP NxR NxN, after which Black declines RxN because the x-ray rook recaptures.
    [$xrayExchangeFen, 'd2d5', -80],
    // The king may not recapture onto f7 while the bishop still covers it.
    ['6k1/5p2/8/7Q/2B5/8/8/6K1 w - - 0 1', 'h5f7', 100],
    // Without the bishop the king recaptures the queen.
    ['6k1/5p2/8/7Q/8/8/8/6K1 w - - 0 1', 'h5f7', -800],
    // En passant captures a pawn from an empty target square.
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6', 100],
    // Promotions gain the promoted value minus the pawn, and may be recaptured.
    ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q', 800],
    ['1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q', -100],
    ['1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7b8q', 1300],
];
foreach ($seeFixtures as [$seeFen, $seeUci, $expectedSee]) {
    assertTacticalFixture($engine, $seeFen, $seeUci);
    $seeValue = $staticExchange->invoke(
        $seeBot,
        Board::fromFen($seeFen),
        substr($seeUci, 0, 2),
        substr($seeUci, 2, 2),
        strlen($seeUci) > 4 ? substr($seeUci, 4, 1) : null,
    );
    assertTrue(
        $seeValue === $expectedSee,
        sprintf('SEE of %s in %s was %s, expected %d', $seeUci, $seeFen, var_export($seeValue, true), $expectedSee),
    );
}

// Ordering: a SEE-winning capture stays first; a SEE-losing capture sorts after every quiet move.
$orderMoves = new ReflectionMethod(ChessBot::class, 'orderMoves');
$xrayBoard = Board::fromFen($xrayExchangeFen);
$orderedXray = $orderMoves->invoke(new ChessBot($engine, 0, 1), $xrayBoard, $engine->searchMoves($xrayBoard), null, 0, false);
$orderedXrayUcis = array_column($orderedXray, 'uci');
$losingIndex = array_search('d2d5', $orderedXrayUcis, true);
$quietIndexes = array_keys(array_filter($orderedXray, static fn (array $move): bool => $move['quiet'] === true));
assertTrue($orderedXrayUcis[0] === 'c3d5' && $orderedXray[0]['see'] === 100, 'SEE-winning capture was not ordered first');
assertTrue($losingIndex !== false && $orderedXray[$losingIndex]['see'] === -80, 'SEE-losing capture missing its SEE value');
assertTrue($orderedXray[$losingIndex]['quiet'] === false, 'SEE-losing capture must not be treated as quiet');
assertTrue($quietIndexes !== [], 'ordering fixture needs quiet moves');
assertTrue($losingIndex > max($quietIndexes), 'SEE-losing capture was not sorted after the quiet moves');

// Quiescence: exf5 (SEE +320) is searched, Qxd6 (SEE -400, rook defended by c7) is skipped.
// After exf5 Black has no capture, so the searched child is a single stand-pat node.
$seeQuiescenceFen = '6k1/2p5/3r4/5n2/4P3/Q7/8/6K1 w - - 0 1';
assertTacticalFixture($engine, $seeQuiescenceFen, 'e4f5');
assertTacticalFixture($engine, $seeQuiescenceFen, 'a3d6');
$seeQuiescenceBoard = Board::fromFen($seeQuiescenceFen);
assertTrue($staticExchange->invoke($seeBot, $seeQuiescenceBoard, 'e4', 'f5', null) === 320, 'winning capture SEE mismatch');
assertTrue($staticExchange->invoke($seeBot, $seeQuiescenceBoard, 'a3', 'd6', null) === -400, 'losing capture SEE mismatch');
$afterWinningCapture = applyMove($engine, $seeQuiescenceFen, 'e4f5');
$replyCaptures = array_filter(
    legalMoves($engine, (string) $afterWinningCapture['fen']),
    static fn (array $move): bool => $move['promotion'] !== null || str_contains((string) $move['san'], 'x'),
);
assertTrue($replyCaptures === [], 'quiescence fixture child must have no capture or promotion');
$seeQuiescenceBot = new ChessBot($engine, 0, 1);
$quiescence->invoke($seeQuiescenceBot, $seeQuiescenceBoard, -1000000, 1000000, 0, 0, false);
assertTrue(
    (int) $nodes->getValue($seeQuiescenceBot) === 2,
    'quiescence did not search exactly the winning capture while skipping the losing one: nodes '
        . (int) $nodes->getValue($seeQuiescenceBot),
);

$stalemateTrapFen = 'k7/8/2K5/2Q5/8/8/8/8 w - - 0 1';
$stalemateAvoidance = (new ChessBot($engine, 0, 4))->chooseMove($stalemateTrapFen);
assertTrue($stalemateAvoidance !== null, 'K+Q versus K position returned null');
$stalemateResult = applyMove($engine, $stalemateTrapFen, $stalemateAvoidance);
assertTrue(
    ($stalemateResult['state']['status'] ?? null) !== 'stalemate',
    'bot threw away a trivially won K+Q versus K position by stalemate',
);

// Quiet pawn fork: e4-e5 attacks the d6 knight and f6 bishop and blocks the bishop's
// diagonal. No capture exists at the root, so the material is won only by a quiet move
// whose payoff arrives plies later; pruning of quiet moves must not hide it.
$quietForkFen = '7k/8/3n1b2/8/3PP3/8/8/6K1 w - - 0 1';
assertTrue(
    array_filter(
        legalMoves($engine, $quietForkFen),
        static fn (array $move): bool => str_contains((string) $move['san'], 'x') || $move['promotion'] !== null,
    ) === [],
    'quiet-fork fixture must not offer a root capture or promotion',
);
$quietForkThreshold = materialBalance($quietForkFen) + 200;
$quietForkWins = static function (string $uci) use ($engine, $quietForkFen, $quietForkThreshold): bool {
    $after = applyMove($engine, $quietForkFen, $uci);

    return whiteSecuresMaterial(
        $engine,
        (string) $after['fen'],
        (string) $after['state']['status'],
        3,
        $quietForkThreshold,
    );
};
assertTrue($quietForkWins('e4e5'), 'quiet-fork fixture: e4e5 does not provably win two pawns of material');
$quietFork = (new ChessBot($engine, 0, 4))->chooseMove($quietForkFen);
assertTrue(
    $quietFork !== null && $quietForkWins($quietFork),
    'bot missed the quiet move that wins material within four plies: ' . var_export($quietFork, true),
);

// In check with two legal evasions: Nxe1 removes the checking rook, while the
// interposition Ng1 allows Rxg1# because the c5 bishop guards g1.
$onlyEvasionFen = 'k7/8/8/2b5/8/3N3N/6PP/4r2K w - - 0 1';
$onlyEvasionBoard = Board::fromFen($onlyEvasionFen);
assertTrue(
    $onlyEvasionBoard->isInCheck($onlyEvasionBoard->sideToMove()),
    'only-evasion fixture must start with the side to move in check',
);
$onlyEvasionMoves = legalMoves($engine, $onlyEvasionFen);
assertTrue(count($onlyEvasionMoves) >= 2, 'only-evasion fixture needs more than one legal evasion');
$safeEvasions = [];
foreach ($onlyEvasionMoves as $evasion) {
    $afterEvasion = applyMove($engine, $onlyEvasionFen, (string) $evasion['uci']);
    $allowsMate = false;
    foreach (legalMoves($engine, (string) $afterEvasion['fen']) as $reply) {
        $afterReply = applyMove($engine, (string) $afterEvasion['fen'], (string) $reply['uci']);
        if (($afterReply['state']['status'] ?? null) === 'checkmate') {
            $allowsMate = true;
            break;
        }
    }
    if (!$allowsMate) {
        $safeEvasions[] = (string) $evasion['uci'];
    }
}
assertTrue(
    $safeEvasions === ['d3e1'],
    'only-evasion fixture must have exactly one evasion avoiding mate in one: ' . implode(',', $safeEvasions),
);
$onlyEvasion = (new ChessBot($engine, 0, 2))->chooseMove($onlyEvasionFen);
assertTrue($onlyEvasion === 'd3e1', 'bot did not find the only non-losing check evasion: ' . var_export($onlyEvasion, true));

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

$clock = new ReflectionProperty(ChessBot::class, 'clock');
$completedDepth = new ReflectionProperty(ChessBot::class, 'completedDepth');
$deadlineFixtureMoves = array_column(legalMoves($engine, $hangingQueenFen), 'uci');
sort($deadlineFixtureMoves, SORT_STRING);

$beforeIterationBot = new ChessBot($engine, 100, 1);
$clockCalls = 0;
$clock->setValue(
    $beforeIterationBot,
    static function () use (&$clockCalls): int {
        return $clockCalls++ === 0 ? 0 : 200000000;
    },
);
$beforeIterationMove = $beforeIterationBot->chooseMove($hangingQueenFen);
assertTrue(
    $beforeIterationMove === $deadlineFixtureMoves[0],
    'pre-iteration deadline did not preserve the sorted fallback',
);
assertTrue((int) $completedDepth->getValue($beforeIterationBot) === 0, 'expired first iteration was marked complete');

$depthOneMove = (new ChessBot($engine, 0, 1))->chooseMove($hangingQueenFen);
$afterIterationBot = new ChessBot($engine, 100, 1);
$clock->setValue(
    $afterIterationBot,
    static function () use ($afterIterationBot, $completedDepth): int {
        return (int) $completedDepth->getValue($afterIterationBot) >= 1 ? 200000000 : 0;
    },
);
$afterIterationMove = $afterIterationBot->chooseMove($hangingQueenFen);
assertTrue($afterIterationMove === $depthOneMove, 'interrupted later iteration replaced the completed result');
assertTrue(
    (int) $completedDepth->getValue($afterIterationBot) === 1,
    'later deadline did not retain exactly one completed iteration',
);

$clockFen = 'r2q1rk1/pp2bppp/2n1pn2/2bp4/8/1PN1PN2/PBQP1PPP/R3KB1R w KQ - 2 10';
$clockBot = new ChessBot($engine, 300, 12);
$clockStartedAt = hrtime(true);
$clockMove = $clockBot->chooseMove($clockFen);
$clockElapsedMs = (hrtime(true) - $clockStartedAt) / 1000000;
assertTrue($clockMove !== null, 'clocked search returned null while legal moves existed');
$clockLegalUcis = array_column(legalMoves($engine, $clockFen), 'uci');
assertTrue(in_array($clockMove, $clockLegalUcis, true), 'clocked search returned an illegal move');
assertTrue($clockElapsedMs <= 450, sprintf('clocked search exceeded tolerance: %.1f ms', $clockElapsedMs));

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

// The same fixed-depth search with reverse futility and late move pruning disabled through
// the private diagnostics flag must visit strictly more nodes.
$selectivePruning = new ReflectionProperty(ChessBot::class, 'selectivePruning');
$prunedBot = new ChessBot($engine, 0, 4);
$prunedMove = $prunedBot->chooseMove($clockFen);
$prunedNodes = (int) $nodes->getValue($prunedBot);
$fullWidthBot = new ChessBot($engine, 0, 4);
$selectivePruning->setValue($fullWidthBot, false);
$fullWidthMove = $fullWidthBot->chooseMove($clockFen);
$fullWidthNodes = (int) $nodes->getValue($fullWidthBot);
assertTrue(
    in_array($prunedMove, $clockLegalUcis, true) && in_array($fullWidthMove, $clockLegalUcis, true),
    'fixed-depth node-count searches returned an illegal move',
);
assertTrue(
    $prunedNodes < $fullWidthNodes,
    sprintf('pruning did not reduce depth-4 nodes: %d with pruning, %d without', $prunedNodes, $fullWidthNodes),
);
fwrite(STDOUT, sprintf("Depth-4 search visited %d nodes with pruning, %d without.\n", $prunedNodes, $fullWidthNodes));
// Game-history repetition. Fixture lines are replayed through the engine so every prior FEN
// (and its halfmove clock) is exactly what the repository would have stored.
/** @return array{0: list<string>, 1: string} Prior FENs (oldest first) and the current FEN. */
function replayLine(ChessEngine $engine, string $startFen, array $ucis): array
{
    $state = $engine->detectState($startFen);
    assertTrue(($state['ok'] ?? false) === true && ($state['status'] ?? null) === 'ongoing', 'expected an ongoing start: ' . $startFen);
    $fens = [$startFen];
    $fen = $startFen;
    foreach ($ucis as $uci) {
        $after = applyMove($engine, $fen, $uci);
        assertTrue(($after['state']['status'] ?? null) === 'ongoing', "replayed move $uci ended the game");
        $fen = (string) $after['fen'];
        $fens[] = $fen;
    }
    $current = array_pop($fens);

    return [$fens, $current];
}

/** Repetition identity of a FEN: placement, side to move, castling and en passant fields. */
function repetitionKey(string $fen): string
{
    return implode(' ', array_slice(explode(' ', $fen), 0, 4));
}

/** How many prior FENs share the repetition identity of $fen. */
function priorOccurrences(array $priorFens, string $fen): int
{
    $key = repetitionKey($fen);

    return count(array_filter($priorFens, static fn (string $prior): bool => repetitionKey($prior) === $key));
}

// (a) White is a rook up and has shuffled Rb7-b6 against Ke8-f8 twice: b6b7 would recreate a
// position already present twice in the history, i.e. claimable threefold repetition.
$shuffleStartFen = '4k3/1R6/8/8/8/8/5PPP/6K1 w - - 0 1';
[$shufflePrior, $shuffleFen] = replayLine(
    $engine,
    $shuffleStartFen,
    ['b7b6', 'e8f8', 'b6b7', 'f8e8', 'b7b6', 'e8f8', 'b6b7', 'f8e8', 'b7b6', 'e8f8'],
);
assertTrue(materialBalance($shuffleFen) >= 500, 'repetition-avoidance fixture must be materially winning for White');
assertTrue(explode(' ', $shuffleFen)[1] === 'w', 'repetition-avoidance fixture must have White to move');
$repeatAfter = applyMove($engine, $shuffleFen, 'b6b7');
assertTrue(
    priorOccurrences($shufflePrior, (string) $repeatAfter['fen']) === 2,
    'b6b7 must recreate a position that already occurred twice',
);
// Without history the shuffle move is the bot's choice, so avoiding it below is the history's doing.
$noHistoryShuffle = (new ChessBot($engine, 0, 3))->chooseMove($shuffleFen);
assertTrue($noHistoryShuffle === 'b6b7', 'repetition-avoidance control: expected b6b7 without history, got ' . var_export($noHistoryShuffle, true));
$historyShuffleBot = new ChessBot($engine, 0, 3);
$historyShuffle = $historyShuffleBot->chooseMove($shuffleFen, $shufflePrior);
assertTrue(
    $historyShuffle !== null && in_array($historyShuffle, array_column(legalMoves($engine, $shuffleFen), 'uci'), true),
    'repetition-avoidance search returned no legal move: ' . var_export($historyShuffle, true),
);
$historyShuffleAfter = applyMove($engine, $shuffleFen, $historyShuffle);
assertTrue(
    priorOccurrences($shufflePrior, (string) $historyShuffleAfter['fen']) < 2,
    'winning bot played into a third repetition: ' . $historyShuffle,
);
assertTrue(
    ($historyShuffleAfter['state']['status'] ?? null) === 'ongoing' && materialBalance((string) $historyShuffleAfter['fen']) >= 500,
    'repetition-avoiding move gave up the win: ' . $historyShuffle,
);
assertTrue(
    $historyShuffleBot->chooseMove($shuffleFen, $shufflePrior) === $historyShuffle,
    'fixed-depth search with game history is not deterministic',
);

// Root scores with an explicit game history, read through the private search entry points.
$searchRoot = new ReflectionMethod(ChessBot::class, 'searchRoot');
$buildGameHistory = new ReflectionMethod(ChessBot::class, 'buildGameHistory');
$gameHistory = new ReflectionProperty(ChessBot::class, 'gameHistory');
/** @return array{0: string, 1: int} Best move and score of one full-window root iteration. */
$rootSearch = static function (string $fen, array $priorFens, int $depth, ?string $excludedUci = null) use (
    $engine,
    $searchRoot,
    $buildGameHistory,
    $gameHistory,
): array {
    $bot = new ChessBot($engine, 0, $depth);
    $board = Board::fromFen($fen);
    $gameHistory->setValue($bot, $buildGameHistory->invoke($bot, $board, $priorFens));
    $moves = array_values(array_filter(
        $engine->searchMoves($board),
        static fn (array $move): bool => $move['uci'] !== $excludedUci,
    ));
    $result = $searchRoot->invoke($bot, $board, $moves, $depth, null, -1000000, 1000000);
    assertTrue(is_array($result), 'root search was interrupted');

    return $result;
};

// (b) Black is a queen up and threatens Rb1#, but White has the perpetual Qh5+ Kg8 Qe8+ Kh7.
$perpetualStartFen = '4Q3/6pk/8/8/1r6/r7/2q3PP/7K w - - 0 1';
[$perpetualPrior, $perpetualFen] = replayLine($engine, $perpetualStartFen, ['e8h5', 'h7g8', 'h5e8', 'g8h7']);
assertTrue(materialBalance($perpetualFen) <= -500, 'perpetual fixture must be materially losing for White');
assertTrue(explode(' ', $perpetualFen)[1] === 'w', 'perpetual fixture must have White to move');
$perpetualCheck = applyMove($engine, $perpetualFen, 'e8h5');
assertTrue(($perpetualCheck['state']['in_check'] ?? null) === true, 'perpetual fixture: e8h5 must give check');
assertTrue(
    array_column(legalMoves($engine, (string) $perpetualCheck['fen']), 'uci') === ['h7g8'],
    'perpetual fixture: Kg8 must be the only reply to Qh5+',
);
assertTrue(
    priorOccurrences($perpetualPrior, (string) $perpetualCheck['fen']) === 1,
    'perpetual fixture: Qh5+ must recreate a prior position',
);
$perpetualBot = new ChessBot($engine, 0, 3);
$perpetual = $perpetualBot->chooseMove($perpetualFen, $perpetualPrior);
assertTrue($perpetual !== null, 'losing perpetual search returned null');
$perpetualAfter = applyMove($engine, $perpetualFen, $perpetual);
assertTrue(
    priorOccurrences($perpetualPrior, (string) $perpetualAfter['fen']) >= 1,
    'losing bot did not repeat a prior position: ' . $perpetual,
);
[, $perpetualScore] = $rootSearch($perpetualFen, $perpetualPrior, 3);
[, $perpetualAlternative] = $rootSearch($perpetualFen, $perpetualPrior, 3, $perpetual);
assertTrue($perpetualScore === 0, 'repetition line did not score as a draw: ' . $perpetualScore);
assertTrue($perpetualAlternative < -500, 'perpetual fixture alternatives must be losing: ' . $perpetualAlternative);

// With a black rook able to block Qh5+ on h6 the perpetual is not forced, so only the game
// history (Black chose Kg8 there before) makes Qh5+ a repetition. Without it the bot loses.
[$blockablePrior, $blockableFen] = replayLine(
    $engine,
    '4Q3/6pk/1r6/8/8/r7/2q3PP/7K w - - 0 1',
    ['e8h5', 'h7g8', 'h5e8', 'g8h7'],
);
assertTrue(materialBalance($blockableFen) <= -500, 'blockable perpetual fixture must be materially losing for White');
$blockableCheck = applyMove($engine, $blockableFen, 'e8h5');
assertTrue(
    in_array('b6h6', array_column(legalMoves($engine, (string) $blockableCheck['fen']), 'uci'), true),
    'blockable perpetual fixture: Rh6 must block Qh5+',
);
assertTrue(
    priorOccurrences($blockablePrior, (string) $blockableCheck['fen']) === 1,
    'blockable perpetual fixture: Qh5+ must recreate a prior position',
);
[$blockableNoHistoryMove, $blockableNoHistoryScore] = $rootSearch($blockableFen, [], 2);
assertTrue(
    $blockableNoHistoryMove !== 'e8h5' && $blockableNoHistoryScore < -500,
    'blockable perpetual control: expected a losing non-repeating choice without history',
);
$blockable = (new ChessBot($engine, 0, 2))->chooseMove($blockableFen, $blockablePrior);
assertTrue($blockable === 'e8h5', 'losing bot missed the repetition draw: ' . var_export($blockable, true));
[, $blockableScore] = $rootSearch($blockableFen, $blockablePrior, 2);
assertTrue($blockableScore === 0, 'history repetition did not score as a draw: ' . $blockableScore);

// The rule applies from ply 1: the shuffle root already occurred twice, yet searched as the
// root (ply 0) it keeps its winning score, while the same node at ply 1 is a draw.
assertTrue(priorOccurrences($shufflePrior, $shuffleFen) === 2, 'shuffle root must repeat prior positions');
$negamax = new ReflectionMethod(ChessBot::class, 'negamax');
$repeatedRootBot = new ChessBot($engine, 0, 1);
$shuffleBoard = Board::fromFen($shuffleFen);
$gameHistory->setValue($repeatedRootBot, $buildGameHistory->invoke($repeatedRootBot, $shuffleBoard, $shufflePrior));
$rootPlyScore = $negamax->invoke($repeatedRootBot, $shuffleBoard, 1, -1000000, 1000000, 0);
$childPlyScore = $negamax->invoke($repeatedRootBot, $shuffleBoard, 1, -1000000, 1000000, 1);
assertTrue($rootPlyScore >= 400, 'a repeated root position was scored as a draw: ' . $rootPlyScore);
assertTrue($childPlyScore === 0, 'a repeated position below the root was not scored as a draw: ' . $childPlyScore);

// (c) An empty history leaves every existing fixed-depth decision unchanged.
$noHistoryFixtures = [
    [$mateInOneFen, 2, $mateInOne],
    [$mateInTwoFen, 4, $mateInTwo],
    [$mateInTwoFen, 2, $quietCheckHorizon],
    [$hangingQueenFen, 3, $hangingQueen],
    [$poisonedPawnFen, 3, $poisonedPawn],
    [$stalemateTrapFen, 4, $stalemateAvoidance],
    [$quietForkFen, 4, $quietFork],
    [$onlyEvasionFen, 2, $onlyEvasion],
    [$singleMoveFen, 8, $singleMove],
    [$clockFen, 4, $prunedMove],
    ['not a FEN', 3, null],
];
foreach ($noHistoryFixtures as [$fixtureFen, $fixtureDepth, $expectedMove]) {
    $withEmptyHistory = (new ChessBot($engine, 0, $fixtureDepth))->chooseMove($fixtureFen, []);
    assertTrue(
        $withEmptyHistory === $expectedMove,
        sprintf('empty history changed the depth-%d move in %s: %s', $fixtureDepth, $fixtureFen, var_export($withEmptyHistory, true)),
    );
}

fwrite(STDOUT, "Chess bot tactical regressions passed.\n");
