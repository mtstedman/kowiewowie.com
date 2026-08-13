#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\Board;
use Wowie\Api\Chess\ChessEngine;
use Wowie\Api\Chess\King;
use Wowie\Api\Chess\Rook;

require __DIR__ . '/../api/bootstrap.php';

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

/** @param callable(): mixed $callback */
function assertThrows(callable $callback, string $message): void
{
    try {
        $callback();
    } catch (Throwable) {
        return;
    }

    throw new RuntimeException($message);
}

$engine = new ChessEngine();
$kingCaptureBoard = new Board([
    'a1' => new King(Board::WHITE),
    'e1' => new Rook(Board::WHITE),
    'e8' => new King(Board::BLACK),
], Board::WHITE);
$kingCaptureUci = 'e1e8';

$kingCaptureMoves = $engine->legalMoves($kingCaptureBoard);
assertTrue(($kingCaptureMoves['ok'] ?? false) === true, 'king-capture position should produce legal moves');
assertTrue(is_array($kingCaptureMoves['moves'] ?? null), 'legalMoves should return a move list');
foreach ($kingCaptureMoves['moves'] as $move) {
    assertFalse(
        $kingCaptureBoard->pieceAt((string) ($move['to'] ?? '')) instanceof King,
        'legalMoves returned a move capturing a king: ' . var_export($move, true),
    );
    assertFalse(($move['uci'] ?? null) === $kingCaptureUci, 'legalMoves returned explicit king-capture UCI');
}

$kingCaptureValidation = $engine->validateUciMove($kingCaptureBoard, $kingCaptureUci);
assertFalse(($kingCaptureValidation['ok'] ?? false) === true, 'validateUciMove accepted attempted king capture');

$kingCaptureApplication = $engine->applyUciMove($kingCaptureBoard, $kingCaptureUci);
assertFalse(($kingCaptureApplication['ok'] ?? false) === true, 'applyUciMove accepted attempted king capture');

assertThrows(
    static fn (): Board => Board::fromFen('4k3/8/8/8/8/8/4r3/4K3 b - - 0 1'),
    "Board::fromFen accepted a FEN where the just-moved side's king is in check",
);
assertThrows(
    static fn (): Board => Board::fromFen('8/8/8/8/8/8/8/4K3 w - - 0 1'),
    'Board::fromFen accepted a kingless FEN',
);
assertThrows(
    static fn (): Board => Board::fromFen('4k3/8/8/8/8/8/8/K3K3 w - - 0 1'),
    'Board::fromFen accepted a multi-king FEN',
);

$startingBoard = Board::fromFen(Board::STARTING_FEN);
$startingMoves = $engine->legalMoves($startingBoard);
assertTrue(($startingMoves['ok'] ?? false) === true, 'starting FEN should produce legal moves');
assertTrue(($startingMoves['moves'] ?? []) !== [], 'starting FEN should have a non-empty legal move list');

fwrite(STDOUT, "Chess rules regressions passed.\n");
