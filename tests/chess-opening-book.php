#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\Board;
use Wowie\Api\Chess\ChessEngine;
use Wowie\Api\Chess\ChessOpeningBookImporter;

require __DIR__ . '/../api/bootstrap.php';

function assertOpeningBook(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/**
 * @param array{
 *   positions: array<string, array{epd: string, opening_key: ?string, representative_pgn: ?string, representative_uci: ?string}>,
 *   moves: array<string, array{from_epd: string, uci: string, san: string, to_epd: string}>
 * } $graph
 * @param list<string> $moves
 */
function followBookLine(array $graph, string $position, array $moves): string
{
    foreach ($moves as $uci) {
        $edge = $graph['moves'][$position . "\0" . $uci] ?? null;
        assertOpeningBook(is_array($edge), "Missing expected {$uci} opening-book edge.");
        $position = $edge['to_epd'];
    }

    return $position;
}

$engine = new ChessEngine();
$importer = new ChessOpeningBookImporter(new PDO('sqlite::memory:'), $engine);
$graph = $importer->compileTsv(__DIR__ . '/../database/data/chess-openings.tsv');

$distinctOpeningNames = array_unique(array_map(
    static fn (array $opening): string => strtolower($opening['name']),
    $graph['openings'],
));
assertOpeningBook(count($graph['openings']) >= 670, 'Common opening catalog should contain at least 670 classifications.');
assertOpeningBook(count($distinctOpeningNames) >= 668, 'Common opening catalog should contain at least 668 distinct named systems.');
assertOpeningBook(count($graph['positions']) >= 1090, 'Common opening catalog should contain at least 1090 positions.');
assertOpeningBook(count($graph['moves']) >= 1110, 'Common opening catalog should contain at least 1110 directed moves.');
assertOpeningBook(count($graph['moves']) > count($graph['positions']), 'Opening graph should contain converging transposition edges.');

$initial = $importer->canonicalEpd(Board::STARTING_FEN);
assertOpeningBook(isset($graph['positions'][$initial]), 'Opening graph is missing the standard initial position.');
assertOpeningBook(!isset($graph['moves'][$initial . "\0a2a3"]), 'Uncatalogued first move should not be considered on book.');

$qgdMain = followBookLine($graph, $initial, ['d2d4', 'd7d5', 'c2c4', 'e7e6']);
$qgdTransposition = followBookLine($graph, $initial, ['d2d4', 'e7e6', 'c2c4', 'd7d5']);
assertOpeningBook($qgdMain === $qgdTransposition, 'Queen\'s Gambit move orders should transpose to one EPD position.');
$qgdOpeningKey = $graph['positions'][$qgdMain]['opening_key'];
assertOpeningBook(
    $qgdOpeningKey !== null && $graph['openings'][$qgdOpeningKey]['name'] === "Queen's Gambit Declined",
    'Transposed Queen\'s Gambit position has the wrong classification.',
);

$kidMain = followBookLine($graph, $initial, ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6']);
$kidTransposition = followBookLine($graph, $initial, ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d6', 'e2e4', 'f8g7']);
assertOpeningBook($kidMain === $kidTransposition, 'King\'s Indian move orders should transpose to one EPD position.');

$marshall = followBookLine(
    $graph,
    $initial,
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'e8g8', 'c2c3', 'd7d5'],
);
$marshallOpeningKey = $graph['positions'][$marshall]['opening_key'];
assertOpeningBook(
    $marshallOpeningKey !== null && $graph['openings'][$marshallOpeningKey]['name'] === 'Ruy Lopez: Marshall Attack',
    'Expanded catalog is missing the Ruy Lopez: Marshall Attack classification.',
);

$meran = followBookLine(
    $graph,
    $initial,
    ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'b1c3', 'g8f6', 'e2e3', 'e7e6', 'g1f3', 'b8d7', 'f1d3', 'd5c4', 'd3c4', 'b7b5'],
);
$meranOpeningKey = $graph['positions'][$meran]['opening_key'];
assertOpeningBook(
    $meranOpeningKey !== null && $graph['openings'][$meranOpeningKey]['name'] === 'Semi-Slav Defense: Meran Variation',
    'Expanded catalog is missing the Semi-Slav Defense: Meran Variation classification.',
);

$jobava = followBookLine($graph, $initial, ['d2d4', 'd7d5', 'b1c3', 'g8f6', 'c1f4']);
$jobavaOpeningKey = $graph['positions'][$jobava]['opening_key'];
assertOpeningBook(
    $jobavaOpeningKey !== null && $graph['openings'][$jobavaOpeningKey]['name'] === 'Rapport-Jobava System',
    'Expanded catalog is missing the Rapport-Jobava System classification.',
);

$kidBayonet = followBookLine(
    $graph,
    $initial,
    ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8', 'f1e2', 'e7e5', 'e1g1', 'b8c6', 'd4d5', 'c6e7', 'b2b4'],
);
$kidBayonetOpeningKey = $graph['positions'][$kidBayonet]['opening_key'];
assertOpeningBook(
    $kidBayonetOpeningKey !== null
        && $graph['openings'][$kidBayonetOpeningKey]['name'] === "King's Indian Defense: Orthodox Variation, Bayonet Attack",
    'Expanded catalog is missing the King\'s Indian Bayonet Attack classification.',
);

$berlinWall = followBookLine(
    $graph,
    $initial,
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1', 'f6e4', 'd2d4', 'e4d6', 'b5c6', 'd7c6', 'd4e5', 'd6f5', 'd1d8', 'e8d8', 'b1c3', 'c8d7'],
);
$berlinWallOpeningKey = $graph['positions'][$berlinWall]['opening_key'];
assertOpeningBook(
    $berlinWallOpeningKey !== null && $graph['openings'][$berlinWallOpeningKey]['name'] === 'Ruy Lopez: Berlin Defense, Berlin Wall',
    'Final catalog is missing the Ruy Lopez: Berlin Defense, Berlin Wall classification.',
);

$blumenfeld = followBookLine(
    $graph,
    $initial,
    ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'c7c5', 'd4d5', 'b7b5'],
);
$blumenfeldOpeningKey = $graph['positions'][$blumenfeld]['opening_key'];
assertOpeningBook(
    $blumenfeldOpeningKey !== null && $graph['openings'][$blumenfeldOpeningKey]['name'] === 'Blumenfeld Countergambit',
    'Final catalog is missing the Blumenfeld Countergambit classification.',
);

$spasskyQid = followBookLine(
    $graph,
    $initial,
    ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'b7b6', 'e2e3'],
);
$spasskyQidOpeningKey = $graph['positions'][$spasskyQid]['opening_key'];
assertOpeningBook(
    $spasskyQidOpeningKey !== null && $graph['openings'][$spasskyQidOpeningKey]['name'] === "Queen's Indian Defense: Spassky System",
    'Doubled catalog is missing the Queen\'s Indian Defense: Spassky System classification.',
);

$afterE4 = $engine->applyUciMove(Board::STARTING_FEN, 'e2e4');
assertOpeningBook(($afterE4['ok'] ?? false) === true, 'Could not generate position after e4.');
assertOpeningBook(
    str_ends_with($importer->canonicalEpd((string) $afterE4['fen']), ' b KQkq -'),
    'Canonical EPD should omit a non-capturable en-passant target.',
);

$fen = Board::STARTING_FEN;
foreach (['e2e4', 'c7c5', 'e4e5', 'd7d5'] as $uci) {
    $applied = $engine->applyUciMove($fen, $uci);
    assertOpeningBook(($applied['ok'] ?? false) === true, "Could not apply {$uci} in en-passant regression line.");
    $fen = (string) $applied['fen'];
}
assertOpeningBook(
    str_ends_with($importer->canonicalEpd($fen), ' w KQkq d6'),
    'Canonical EPD should preserve a legally capturable en-passant target.',
);

fwrite(STDOUT, "Chess opening-book regressions passed.\n");
