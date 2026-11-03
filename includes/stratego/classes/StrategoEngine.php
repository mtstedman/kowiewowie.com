<?php

declare(strict_types=1);

namespace Wowie\Api\Stratego;

/**
 * Server-authoritative Stratego rules engine.
 *
 * Pure functions over an array state (no database, session or HTTP access).
 * Board cells are addressed as board[row][col] where row 0 is rank 1 and
 * col 0 is file 'a'; squares are algebraic strings such as 'a1' or 'j10'.
 */
final class StrategoEngine
{
    public const RED = 'red';
    public const BLUE = 'blue';
    public const SIZE = 10;

    public const PHASE_SETUP = 'setup';
    public const PHASE_ACTIVE = 'active';
    public const PHASE_FINISHED = 'finished';

    private const FILES = 'abcdefghij';
    private const ARMY_SIZE = 40;
    private const TWO_SQUARE_LIMIT = 3;

    private const RANK_SPY = '1';
    private const RANK_SCOUT = '2';
    private const RANK_MINER = '3';
    private const RANK_MARSHAL = '10';
    private const RANK_BOMB = 'B';
    private const RANK_FLAG = 'F';

    /** @var list<array{int, int}> */
    private const LAKES = [
        [4, 2], [4, 3], [5, 2], [5, 3],
        [4, 6], [4, 7], [5, 6], [5, 7],
    ];

    private const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /**
     * Rank code => number of pieces per color. Numeric rank codes become
     * integer array keys in PHP; cast keys to string when reading them.
     *
     * @return array<string|int, int>
     */
    public static function standardArmy(): array
    {
        return [
            '10' => 1,
            '9' => 1,
            '8' => 2,
            '7' => 3,
            '6' => 4,
            '5' => 4,
            '4' => 4,
            '3' => 5,
            '2' => 8,
            '1' => 1,
            'B' => 6,
            'F' => 1,
        ];
    }

    /** @return array{int, int}|null [row, col] */
    public static function squareToCoords(string $square): ?array
    {
        $normalized = strtolower(trim($square));
        if (preg_match('/^([a-j])(10|[1-9])$/', $normalized, $matches) !== 1) {
            return null;
        }

        return [(int) $matches[2] - 1, strpos(self::FILES, $matches[1])];
    }

    public static function coordsToSquare(int $row, int $col): string
    {
        if (!self::inBounds($row, $col)) {
            throw new StrategoRuleException('invalid_square', 'Coordinates are outside the board.');
        }

        return self::FILES[$col] . (string) ($row + 1);
    }

    public static function isLake(int $row, int $col): bool
    {
        return in_array([$row, $col], self::LAKES, true);
    }

    public static function isLakeSquare(string $square): bool
    {
        $coords = self::squareToCoords($square);

        return $coords !== null && self::isLake($coords[0], $coords[1]);
    }

    /** @return list<int> */
    public static function setupRows(string $color): array
    {
        return match ($color) {
            self::RED => [0, 1, 2, 3],
            self::BLUE => [6, 7, 8, 9],
            default => throw new StrategoRuleException('invalid_color', 'Color must be red or blue.'),
        };
    }

    public static function opponent(string $color): string
    {
        return match ($color) {
            self::RED => self::BLUE,
            self::BLUE => self::RED,
            default => throw new StrategoRuleException('invalid_color', 'Color must be red or blue.'),
        };
    }

    /** @return array<string, mixed> */
    public function initialState(): array
    {
        return [
            'phase' => self::PHASE_SETUP,
            'turn' => self::RED,
            'board' => self::emptyBoard(),
            'ready' => [self::RED => false, self::BLUE => false],
            'captured' => [self::RED => [], self::BLUE => []],
            'move_count' => 0,
            'recent_moves' => [self::RED => [], self::BLUE => []],
            'last_move' => null,
            'winner' => null,
            'end_reason' => null,
        ];
    }

    /**
     * @param array<string, mixed> $state
     * @param array<int, mixed> $placements list of {square, rank}
     * @return array<string, mixed>
     */
    public function applySetup(array $state, string $color, array $placements): array
    {
        $this->assertColor($color);
        $this->assertPhase($state, self::PHASE_SETUP);
        if (($state['ready'][$color] ?? false) === true) {
            throw new StrategoRuleException('already_ready', 'The setup cannot change after the player is ready.');
        }

        $validated = $this->validatePlacements($color, $placements);

        $board = $this->boardOf($state);
        for ($row = 0; $row < self::SIZE; $row++) {
            for ($col = 0; $col < self::SIZE; $col++) {
                $cell = $board[$row][$col];
                if (is_array($cell) && ($cell['color'] ?? null) === $color) {
                    $board[$row][$col] = null;
                }
            }
        }

        foreach ($validated as [$row, $col, $rank, $square]) {
            $board[$row][$col] = [
                'id' => $color . '-' . $square,
                'color' => $color,
                'rank' => $rank,
                'revealed' => false,
            ];
        }

        $state['board'] = $board;

        return $state;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    public function setReady(array $state, string $color): array
    {
        $this->assertColor($color);
        $this->assertPhase($state, self::PHASE_SETUP);

        if ($this->countPieces($this->boardOf($state), $color) !== self::ARMY_SIZE) {
            throw new StrategoRuleException('invalid_setup', 'All 40 pieces must be placed before getting ready.');
        }

        $state['ready'][$color] = true;
        if (($state['ready'][self::RED] ?? false) === true && ($state['ready'][self::BLUE] ?? false) === true) {
            $state['phase'] = self::PHASE_ACTIVE;
            $state['turn'] = self::RED;
            $state = $this->finishIfNoMoves($state);
        }

        return $state;
    }

    /**
     * @param array<string, mixed> $state
     * @return list<array{from: string, to: string}>
     */
    public function legalMoves(array $state, string $color): array
    {
        $this->assertColor($color);
        if (($state['phase'] ?? null) !== self::PHASE_ACTIVE) {
            return [];
        }

        $moves = [];
        foreach ($this->candidateMoves($this->boardOf($state), $color) as $move) {
            if ($this->violatesTwoSquareRule($state, $color, $move['piece_id'], $move['from'], $move['to'])) {
                continue;
            }
            $moves[] = ['from' => $move['from'], 'to' => $move['to']];
        }

        return $moves;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    public function applyMove(array $state, string $color, string $from, string $to): array
    {
        $this->assertColor($color);
        $this->assertPhase($state, self::PHASE_ACTIVE);
        if (($state['turn'] ?? null) !== $color) {
            throw new StrategoRuleException('not_your_turn', 'It is ' . (string) ($state['turn'] ?? '') . ' to move.');
        }

        $fromCoords = self::squareToCoords($from);
        $toCoords = self::squareToCoords($to);
        if ($fromCoords === null || $toCoords === null) {
            throw new StrategoRuleException('illegal_move', 'Squares must use notation such as a1 or j10.');
        }

        $board = $this->boardOf($state);
        [$fromRow, $fromCol] = $fromCoords;
        [$toRow, $toCol] = $toCoords;
        $fromSquare = self::coordsToSquare($fromRow, $fromCol);
        $toSquare = self::coordsToSquare($toRow, $toCol);

        $attacker = $board[$fromRow][$fromCol];
        if (!is_array($attacker) || ($attacker['color'] ?? null) !== $color) {
            throw new StrategoRuleException('illegal_move', 'There is no ' . $color . ' piece on ' . $fromSquare . '.');
        }

        $candidate = null;
        foreach ($this->candidateMoves($board, $color) as $move) {
            if ($move['from'] === $fromSquare && $move['to'] === $toSquare) {
                $candidate = $move;
                break;
            }
        }

        if ($candidate === null) {
            throw new StrategoRuleException('illegal_move', 'That move is not legal in the current position.');
        }

        if ($this->violatesTwoSquareRule($state, $color, $candidate['piece_id'], $fromSquare, $toSquare)) {
            throw new StrategoRuleException(
                'two_square_rule',
                'A piece may not move back and forth between the same two squares more than three times in a row.',
            );
        }

        $opponent = self::opponent($color);
        $attackerRank = (string) $attacker['rank'];
        $defender = $board[$toRow][$toCol];
        $defenderInfo = null;
        $board[$fromRow][$fromCol] = null;

        if (!is_array($defender)) {
            $outcome = 'move';
            $board[$toRow][$toCol] = $attacker;
        } else {
            $defenderRank = (string) $defender['rank'];
            $defenderInfo = ['color' => (string) $defender['color'], 'rank' => $defenderRank];
            $outcome = $this->combatOutcome($attackerRank, $defenderRank);
            $attacker['revealed'] = true;
            $defender['revealed'] = true;

            switch ($outcome) {
                case 'attacker_wins':
                case 'flag_captured':
                    $board[$toRow][$toCol] = $attacker;
                    $state['captured'][$opponent][] = $defenderRank;
                    break;
                case 'defender_wins':
                    $board[$toRow][$toCol] = $defender;
                    $state['captured'][$color][] = $attackerRank;
                    break;
                default:
                    $board[$toRow][$toCol] = null;
                    $state['captured'][$color][] = $attackerRank;
                    $state['captured'][$opponent][] = $defenderRank;
                    break;
            }
        }

        $recent = is_array($state['recent_moves'][$color] ?? null) ? array_values($state['recent_moves'][$color]) : [];
        $recent[] = ['piece_id' => (string) $attacker['id'], 'from' => $fromSquare, 'to' => $toSquare];
        $state['recent_moves'][$color] = array_slice($recent, -self::TWO_SQUARE_LIMIT);

        $state['board'] = $board;
        $state['move_count'] = (int) ($state['move_count'] ?? 0) + 1;
        $state['last_move'] = [
            'color' => $color,
            'from' => $fromSquare,
            'to' => $toSquare,
            'outcome' => $outcome,
            'attacker' => ['color' => $color, 'rank' => $attackerRank],
            'defender' => $defenderInfo,
        ];
        $state['turn'] = $opponent;

        if ($outcome === 'flag_captured') {
            $state['phase'] = self::PHASE_FINISHED;
            $state['winner'] = $color;
            $state['end_reason'] = 'flag_captured';

            return $state;
        }

        return $this->finishIfNoMoves($state);
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    public function resign(array $state, string $color): array
    {
        $this->assertColor($color);
        $phase = $state['phase'] ?? null;
        if ($phase !== self::PHASE_SETUP && $phase !== self::PHASE_ACTIVE) {
            throw new StrategoRuleException('wrong_phase', 'The game is already finished.');
        }

        $state['phase'] = self::PHASE_FINISHED;
        $state['winner'] = self::opponent($color);
        $state['end_reason'] = 'resigned';

        return $state;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    public function presentForViewer(array $state, ?string $viewerColor): array
    {
        if ($viewerColor !== null) {
            $this->assertColor($viewerColor);
        }

        $phase = $state['phase'] ?? null;
        $board = $this->boardOf($state);
        $presentedBoard = self::emptyBoard();
        $placed = [self::RED => 0, self::BLUE => 0];

        for ($row = 0; $row < self::SIZE; $row++) {
            for ($col = 0; $col < self::SIZE; $col++) {
                $piece = $board[$row][$col];
                if (!is_array($piece)) {
                    continue;
                }

                $pieceColor = (string) ($piece['color'] ?? '');
                if (isset($placed[$pieceColor])) {
                    $placed[$pieceColor]++;
                }

                $isOwn = $viewerColor !== null && $pieceColor === $viewerColor;
                if ($phase === self::PHASE_SETUP && !$isOwn) {
                    continue;
                }

                $hidden = $phase !== self::PHASE_FINISHED && !$isOwn && ($piece['revealed'] ?? false) !== true;
                $presented = $piece;
                if ($hidden) {
                    $presented['rank'] = null;
                }
                $presented['hidden'] = $hidden;
                $presentedBoard[$row][$col] = $presented;
            }
        }

        $state['board'] = $presentedBoard;
        $state['placed'] = $placed;

        $lastMove = $state['last_move'] ?? null;
        if (is_array($lastMove) && ($lastMove['outcome'] ?? null) === 'move' && $phase !== self::PHASE_FINISHED) {
            $moverColor = (string) ($lastMove['attacker']['color'] ?? ($lastMove['color'] ?? ''));
            if ($viewerColor === null || $moverColor !== $viewerColor) {
                $toCoords = self::squareToCoords((string) ($lastMove['to'] ?? ''));
                $moved = $toCoords !== null ? $presentedBoard[$toCoords[0]][$toCoords[1]] : null;
                $lastMove['attacker']['rank'] = is_array($moved) && ($moved['hidden'] ?? true) === false
                    ? $moved['rank']
                    : null;
                $state['last_move'] = $lastMove;
            }
        }

        return $state;
    }

    /** @return list<list<null>> */
    private static function emptyBoard(): array
    {
        return array_fill(0, self::SIZE, array_fill(0, self::SIZE, null));
    }

    private static function inBounds(int $row, int $col): bool
    {
        return $row >= 0 && $row < self::SIZE && $col >= 0 && $col < self::SIZE;
    }

    private function assertColor(string $color): void
    {
        if ($color !== self::RED && $color !== self::BLUE) {
            throw new StrategoRuleException('invalid_color', 'Color must be red or blue.');
        }
    }

    /** @param array<string, mixed> $state */
    private function assertPhase(array $state, string $phase): void
    {
        if (($state['phase'] ?? null) !== $phase) {
            throw new StrategoRuleException(
                'wrong_phase',
                'That action is only allowed during the ' . $phase . ' phase.',
            );
        }
    }

    /**
     * @param array<string, mixed> $state
     * @return array<int, array<int, array<string, mixed>|null>>
     */
    private function boardOf(array $state): array
    {
        $board = $state['board'] ?? null;
        if (!is_array($board) || count($board) !== self::SIZE) {
            return self::emptyBoard();
        }

        return $board;
    }

    /** @param array<int, array<int, array<string, mixed>|null>> $board */
    private function countPieces(array $board, string $color): int
    {
        $count = 0;
        foreach ($board as $row) {
            foreach ($row as $cell) {
                if (is_array($cell) && ($cell['color'] ?? null) === $color) {
                    $count++;
                }
            }
        }

        return $count;
    }

    /**
     * @param array<int, mixed> $placements
     * @return list<array{int, int, string, string}> [row, col, rank, square]
     */
    private function validatePlacements(string $color, array $placements): array
    {
        if (!array_is_list($placements) || count($placements) !== self::ARMY_SIZE) {
            throw new StrategoRuleException('invalid_setup', 'Exactly 40 placements are required.');
        }

        $army = self::standardArmy();
        $setupRows = self::setupRows($color);
        $counts = [];
        $seen = [];
        $validated = [];

        foreach ($placements as $placement) {
            $square = is_array($placement) ? ($placement['square'] ?? null) : null;
            $rank = is_array($placement) ? ($placement['rank'] ?? null) : null;
            if (is_int($rank)) {
                $rank = (string) $rank;
            }
            if (!is_string($square) || !is_string($rank)) {
                throw new StrategoRuleException('invalid_setup', 'Each placement needs a square and a rank.');
            }

            $coords = self::squareToCoords($square);
            if ($coords === null) {
                throw new StrategoRuleException('invalid_setup', 'Unknown square ' . $square . '.');
            }
            [$row, $col] = $coords;
            $normalized = self::coordsToSquare($row, $col);

            if (self::isLake($row, $col)) {
                throw new StrategoRuleException('invalid_setup', 'Pieces cannot be placed in a lake (' . $normalized . ').');
            }
            if (!in_array($row, $setupRows, true)) {
                throw new StrategoRuleException('invalid_setup', $normalized . ' is outside the ' . $color . ' setup rows.');
            }
            if (isset($seen[$normalized])) {
                throw new StrategoRuleException('invalid_setup', 'Square ' . $normalized . ' is used more than once.');
            }
            if (!array_key_exists($rank, $army)) {
                throw new StrategoRuleException('invalid_setup', 'Unknown rank ' . $rank . '.');
            }

            $seen[$normalized] = true;
            $counts[$rank] = ($counts[$rank] ?? 0) + 1;
            $validated[] = [$row, $col, $rank, $normalized];
        }

        foreach ($army as $rank => $expected) {
            if (($counts[$rank] ?? 0) !== $expected) {
                throw new StrategoRuleException(
                    'invalid_setup',
                    'The army needs exactly ' . $expected . ' piece(s) of rank ' . (string) $rank . '.',
                );
            }
        }

        return $validated;
    }

    /**
     * Geometric moves for a color, before the two-square rule is applied.
     *
     * @param array<int, array<int, array<string, mixed>|null>> $board
     * @return list<array{from: string, to: string, piece_id: string}>
     */
    private function candidateMoves(array $board, string $color): array
    {
        $moves = [];
        for ($row = 0; $row < self::SIZE; $row++) {
            for ($col = 0; $col < self::SIZE; $col++) {
                $piece = $board[$row][$col] ?? null;
                if (!is_array($piece) || ($piece['color'] ?? null) !== $color) {
                    continue;
                }

                $rank = (string) ($piece['rank'] ?? '');
                if ($rank === self::RANK_BOMB || $rank === self::RANK_FLAG) {
                    continue;
                }

                $from = self::coordsToSquare($row, $col);
                $pieceId = (string) ($piece['id'] ?? $from);
                $maxSteps = $rank === self::RANK_SCOUT ? self::SIZE - 1 : 1;

                foreach (self::DIRECTIONS as [$dRow, $dCol]) {
                    for ($step = 1; $step <= $maxSteps; $step++) {
                        $toRow = $row + $dRow * $step;
                        $toCol = $col + $dCol * $step;
                        if (!self::inBounds($toRow, $toCol) || self::isLake($toRow, $toCol)) {
                            break;
                        }

                        $target = $board[$toRow][$toCol] ?? null;
                        if (is_array($target) && ($target['color'] ?? null) === $color) {
                            break;
                        }

                        $moves[] = ['from' => $from, 'to' => self::coordsToSquare($toRow, $toCol), 'piece_id' => $pieceId];
                        if (is_array($target)) {
                            break;
                        }
                    }
                }
            }
        }

        return $moves;
    }

    /**
     * True when this move would be the 4th consecutive move of the same piece
     * between the same two squares.
     *
     * @param array<string, mixed> $state
     */
    private function violatesTwoSquareRule(array $state, string $color, string $pieceId, string $from, string $to): bool
    {
        $recent = $state['recent_moves'][$color] ?? [];
        if (!is_array($recent) || count($recent) < self::TWO_SQUARE_LIMIT) {
            return false;
        }

        $lastMoves = array_slice(array_values($recent), -self::TWO_SQUARE_LIMIT);
        $pair = [$from, $to];
        sort($pair);
        foreach ($lastMoves as $move) {
            if (!is_array($move) || ($move['piece_id'] ?? null) !== $pieceId) {
                return false;
            }
            $movePair = [(string) ($move['from'] ?? ''), (string) ($move['to'] ?? '')];
            sort($movePair);
            if ($movePair !== $pair) {
                return false;
            }
        }

        $latest = $lastMoves[count($lastMoves) - 1];

        return ($latest['to'] ?? null) === $from;
    }

    private function combatOutcome(string $attackerRank, string $defenderRank): string
    {
        if ($defenderRank === self::RANK_FLAG) {
            return 'flag_captured';
        }
        if ($defenderRank === self::RANK_BOMB) {
            return $attackerRank === self::RANK_MINER ? 'attacker_wins' : 'defender_wins';
        }
        if ($attackerRank === self::RANK_SPY && $defenderRank === self::RANK_MARSHAL) {
            return 'attacker_wins';
        }

        $comparison = (int) $attackerRank <=> (int) $defenderRank;

        return match ($comparison) {
            1 => 'attacker_wins',
            -1 => 'defender_wins',
            default => 'both_lost',
        };
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private function finishIfNoMoves(array $state): array
    {
        if (($state['phase'] ?? null) !== self::PHASE_ACTIVE) {
            return $state;
        }

        $toMove = (string) $state['turn'];
        if ($this->legalMoves($state, $toMove) === []) {
            $state['phase'] = self::PHASE_FINISHED;
            $state['winner'] = self::opponent($toMove);
            $state['end_reason'] = 'no_moves';
        }

        return $state;
    }
}
