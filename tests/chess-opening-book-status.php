#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\ChessOpeningBookQuery;

require __DIR__ . '/../api/bootstrap.php';

function assertOpeningBookStatusSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException("{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

/** @return PDO */
function createOpeningBookStatusFixture(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_openings (
            id TEXT PRIMARY KEY,
            eco_code TEXT NOT NULL,
            name TEXT NOT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_opening_positions (
            id TEXT PRIMARY KEY,
            epd TEXT NOT NULL UNIQUE,
            opening_id TEXT NULL,
            representative_pgn TEXT NULL,
            representative_uci TEXT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_opening_moves (
            id TEXT PRIMARY KEY,
            from_position_id TEXT NOT NULL,
            to_position_id TEXT NOT NULL,
            uci TEXT NOT NULL,
            san TEXT NULL
        )
    SQL);

    $pdo->exec(<<<'SQL'
        INSERT INTO chess_openings (id, eco_code, name) VALUES
            ('open-kp', 'B00', 'King''s Pawn Game')
    SQL);
    $pdo->exec(<<<'SQL'
        INSERT INTO chess_opening_positions (id, epd, opening_id, representative_pgn, representative_uci) VALUES
            ('start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', NULL, NULL, NULL),
            ('after-e4', 'fixture after e2e4', NULL, '1. e4', 'e2e4'),
            ('after-e4-e5', 'fixture after e2e4 e7e5', 'open-kp', '1. e4 e5', 'e7e5'),
            ('after-e4-e5-nf3', 'fixture after e2e4 e7e5 g1f3', NULL, '1. e4 e5 2. Nf3', 'g1f3')
    SQL);
    $pdo->exec(<<<'SQL'
        INSERT INTO chess_opening_moves (id, from_position_id, to_position_id, uci, san) VALUES
            ('move-e4', 'start', 'after-e4', 'e2e4', 'e4'),
            ('move-e5', 'after-e4', 'after-e4-e5', 'e7e5', 'e5'),
            ('move-nf3', 'after-e4-e5', 'after-e4-e5-nf3', 'g1f3', 'Nf3')
    SQL);

    return $pdo;
}

$query = new ChessOpeningBookQuery(createOpeningBookStatusFixture());

assertOpeningBookStatusSame(
    ['on_book' => true, 'eco_code' => null, 'name' => null],
    $query->query([]),
    'Initial position should be on book without a named opening',
);
assertOpeningBookStatusSame(
    ['on_book' => true, 'eco_code' => null, 'name' => null],
    $query->query(['e2e4']),
    'Unnamed on-book position before any named opening should remain unnamed',
);
assertOpeningBookStatusSame(
    ['on_book' => true, 'eco_code' => 'B00', 'name' => "King's Pawn Game"],
    $query->query(['e2e4', 'e7e5']),
    'Named on-book position should expose its opening classification',
);
assertOpeningBookStatusSame(
    ['on_book' => true, 'eco_code' => 'B00', 'name' => "King's Pawn Game"],
    $query->query(['e2e4', 'e7e5', 'g1f3']),
    'Later unnamed on-book position should preserve the latest named opening',
);
assertOpeningBookStatusSame(
    ['on_book' => false, 'eco_code' => null, 'name' => null],
    $query->query(['a2a3']),
    'First absent edge should be reported off book without opening metadata',
);

fwrite(STDOUT, "Chess opening-book status regressions passed.\n");
