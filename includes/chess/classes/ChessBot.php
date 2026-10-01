<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

/**
 * Server-side chess opponent.
 *
 * Search: iterative-deepening negamax alpha-beta on Board objects with a transposition
 * table, MVV-LVA / killer / history move ordering and a quiescence search at the horizon.
 * Evaluation: Tomasz Michniewski's Simplified Evaluation Function (piece values plus
 * piece-square tables), https://www.chessprogramming.org/Simplified_Evaluation_Function
 */
final class ChessBot
{
    private const MATE = 100000;

    /** Scores beyond this magnitude are mate scores (MATE minus a ply distance). */
    private const MATE_BOUND = 99000;

    private const INFINITY = 1000000;

    /** Absolute recursion guard for the search. */
    private const MAX_PLY = 64;

    /** Quiet (not in check) quiescence nodes this far past the horizon stand pat. */
    private const QUIESCENCE_MAX_PLY = 8;

    private const TABLE_MAX_ENTRIES = 50000;

    private const BOUND_EXACT = 0;
    private const BOUND_LOWER = 1;
    private const BOUND_UPPER = 2;

    private const ORDER_FIRST = 1000000;
    private const ORDER_TACTICAL = 100000;
    private const ORDER_KILLER = 90000;
    private const ORDER_HISTORY_MAX = 80000;

    /**
     * The source lists K = 20000; both kings are always on the board, so the king's
     * material term cancels and is kept at 0 here.
     *
     * @var array<string, int>
     */
    private const PIECE_VALUES = [
        'p' => 100,
        'n' => 320,
        'b' => 330,
        'r' => 500,
        'q' => 900,
        'k' => 0,
    ];

    /** @var array<string, int> Least-valuable-attacker rank used by MVV-LVA ordering. */
    private const ATTACKER_RANK = [
        'p' => 1,
        'n' => 2,
        'b' => 3,
        'r' => 4,
        'q' => 5,
        'k' => 6,
    ];

    /**
     * Simplified Evaluation Function piece-square tables, laid out as published:
     * rank 8 first down to rank 1, files a to h, from White's point of view.
     * Black uses the same tables mirrored vertically. 'k' is the middlegame king table.
     *
     * @var array<string, list<int>>
     */
    private const PIECE_SQUARE_TABLES = [
        'p' => [
            0, 0, 0, 0, 0, 0, 0, 0,
            50, 50, 50, 50, 50, 50, 50, 50,
            10, 10, 20, 30, 30, 20, 10, 10,
            5, 5, 10, 25, 25, 10, 5, 5,
            0, 0, 0, 20, 20, 0, 0, 0,
            5, -5, -10, 0, 0, -10, -5, 5,
            5, 10, 10, -20, -20, 10, 10, 5,
            0, 0, 0, 0, 0, 0, 0, 0,
        ],
        'n' => [
            -50, -40, -30, -30, -30, -30, -40, -50,
            -40, -20, 0, 0, 0, 0, -20, -40,
            -30, 0, 10, 15, 15, 10, 0, -30,
            -30, 5, 15, 20, 20, 15, 5, -30,
            -30, 0, 15, 20, 20, 15, 0, -30,
            -30, 5, 10, 15, 15, 10, 5, -30,
            -40, -20, 0, 5, 5, 0, -20, -40,
            -50, -40, -30, -30, -30, -30, -40, -50,
        ],
        'b' => [
            -20, -10, -10, -10, -10, -10, -10, -20,
            -10, 0, 0, 0, 0, 0, 0, -10,
            -10, 0, 5, 10, 10, 5, 0, -10,
            -10, 5, 5, 10, 10, 5, 5, -10,
            -10, 0, 10, 10, 10, 10, 0, -10,
            -10, 10, 10, 10, 10, 10, 10, -10,
            -10, 5, 0, 0, 0, 0, 5, -10,
            -20, -10, -10, -10, -10, -10, -10, -20,
        ],
        'r' => [
            0, 0, 0, 0, 0, 0, 0, 0,
            5, 10, 10, 10, 10, 10, 10, 5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            0, 0, 0, 5, 5, 0, 0, 0,
        ],
        'q' => [
            -20, -10, -10, -5, -5, -10, -10, -20,
            -10, 0, 0, 0, 0, 0, 0, -10,
            -10, 0, 5, 5, 5, 5, 0, -10,
            -5, 0, 5, 5, 5, 5, 0, -5,
            0, 0, 5, 5, 5, 5, 0, -5,
            -10, 5, 5, 5, 5, 5, 0, -10,
            -10, 0, 5, 0, 0, 0, 0, -10,
            -20, -10, -10, -5, -5, -10, -10, -20,
        ],
        'k' => [
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -20, -30, -30, -40, -40, -30, -30, -20,
            -10, -20, -20, -20, -20, -20, -20, -10,
            20, 20, 0, 0, 0, 0, 20, 20,
            20, 30, 10, 0, 0, 10, 30, 20,
        ],
    ];

    /** @var list<int> Simplified Evaluation Function king end-game table (same layout). */
    private const KING_ENDGAME_TABLE = [
        -50, -40, -30, -20, -20, -30, -40, -50,
        -30, -20, -10, 0, 0, -10, -20, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -30, 0, 0, 0, 0, -30, -30,
        -50, -30, -30, -30, -30, -30, -30, -50,
    ];

    /**
     * FEN symbol => square => material plus piece-square score from White's point of view
     * (Black entries are negative). Kings use the middlegame table here.
     *
     * @var array<string, array<string, int>>
     */
    private static array $squareScores = [];

    /** @var array<string, array<string, int>> 'K' / 'k' => square => end-game king score. */
    private static array $kingEndgameScores = [];

    /** @var array<string, array{0: int, 1: int, 2: int, 3: ?string}> depth, score, bound, best move */
    private array $table = [];

    /** @var array<int, array{0: ?string, 1: ?string}> */
    private array $killers = [];

    /** @var array<string, int> */
    private array $history = [];

    /** @var array<string, true> Position keys on the path from the root to the current node. */
    private array $path = [];

    private int|float|null $deadline = null;

    private bool $deadlineActive = false;

    private bool $aborted = false;

    /**
     * @param int $timeBudgetMs Search clock in milliseconds; zero or less disables the clock
     *                          and searches exactly $maxDepth plies.
     * @param int $maxDepth     Deepest iteration of the iterative-deepening loop.
     */
    public function __construct(
        private readonly ChessEngine $engine,
        private readonly int $timeBudgetMs = 1000,
        private readonly int $maxDepth = 6,
    ) {
        self::initialiseSquareScores();
    }

    public function chooseMove(string $fen): ?string
    {
        $startedAt = hrtime(true);

        try {
            $board = Board::fromFen($fen);
            $moves = $this->engine->searchMoves($board);
        } catch (\Throwable) {
            return null;
        }
        if ($moves === []) {
            return null;
        }

        usort($moves, static fn (array $a, array $b): int => strcmp($a['uci'], $b['uci']));
        if (count($moves) === 1) {
            return $moves[0]['uci'];
        }

        $this->table = [];
        $this->killers = [];
        $this->history = [];
        $this->path = [];
        $this->aborted = false;
        $this->deadline = $this->timeBudgetMs > 0 ? $startedAt + $this->timeBudgetMs * 1000000 : null;

        $bestUci = null;
        $maxDepth = max(1, $this->maxDepth);

        try {
            for ($depth = 1; $depth <= $maxDepth; $depth++) {
                // Depth 1 always completes; deeper iterations are bound by the clock.
                $this->deadlineActive = $depth > 1 && $this->deadline !== null;

                $result = $this->searchRoot($board, $moves, $depth, $bestUci);
                if ($result === null) {
                    // Interrupted by the deadline: discard the partial iteration.
                    break;
                }

                [$bestUci, $bestScore] = $result;
                if ($bestScore > self::MATE_BOUND) {
                    // A forced mate is already proven; deeper iterations cannot improve on it.
                    break;
                }
            }
        } catch (\Throwable) {
            // Keep the move from the last completed iteration.
        }

        return $bestUci ?? $moves[0]['uci'];
    }

    /**
     * One full-width iteration from the root.
     *
     * @param list<array<string, mixed>> $moves
     * @return array{0: string, 1: int}|null Best move and score, or null when interrupted.
     */
    private function searchRoot(Board $board, array $moves, int $depth, ?string $pvUci): ?array
    {
        $key = $this->positionKey($board);
        $ordered = $this->orderMoves($board, $moves, $pvUci, 0, false);

        $bestUci = null;
        $bestScore = -self::INFINITY;

        $this->path[$key] = true;
        foreach ($ordered as $move) {
            // A window opened one point below the best score keeps equal-scoring moves exact,
            // so the lowest-UCI tie-break does not depend on the search order.
            $alpha = $bestUci === null ? -self::INFINITY : $bestScore - 1;
            $score = -$this->negamax($move['afterBoard'], $depth - 1, -self::INFINITY, -$alpha, 1);
            if ($this->aborted) {
                unset($this->path[$key]);

                return null;
            }

            if (
                $bestUci === null
                || $score > $bestScore
                || ($score === $bestScore && strcmp($move['uci'], $bestUci) < 0)
            ) {
                $bestScore = $score;
                $bestUci = $move['uci'];
            }
        }
        unset($this->path[$key]);

        return $bestUci === null ? null : [$bestUci, $bestScore];
    }

    /** Fail-soft negamax alpha-beta. The score is from the side to move's point of view. */
    private function negamax(Board $board, int $depth, int $alpha, int $beta, int $ply): int
    {
        if ($this->timeUp()) {
            return 0;
        }

        $key = $this->positionKey($board);
        if (isset($this->path[$key])) {
            // Position repeated inside the current search path.
            return 0;
        }
        if ($ply >= self::MAX_PLY) {
            return $this->evaluate($board);
        }
        if ($depth <= 0) {
            return $this->quiescence($board, $alpha, $beta, $ply, 0);
        }

        // The table key has no halfmove clock, so stay away from it near the fifty-move rule.
        $tableUsable = $board->halfmoveClock() + $depth < 100;
        $tableMove = null;
        $entry = $this->table[$key] ?? null;
        if ($entry !== null) {
            $tableMove = $entry[3];
            if ($tableUsable && $entry[0] >= $depth) {
                $tableScore = $entry[1];
                if ($tableScore > self::MATE_BOUND) {
                    $tableScore -= $ply;
                } elseif ($tableScore < -self::MATE_BOUND) {
                    $tableScore += $ply;
                }

                if (
                    $entry[2] === self::BOUND_EXACT
                    || ($entry[2] === self::BOUND_LOWER && $tableScore >= $beta)
                    || ($entry[2] === self::BOUND_UPPER && $tableScore <= $alpha)
                ) {
                    return $tableScore;
                }
            }
        }

        $moves = $this->engine->searchMoves($board);
        if ($moves === []) {
            // Checkmate is worse the sooner it happens; stalemate is a draw.
            return $board->isInCheck($board->sideToMove()) ? -(self::MATE - $ply) : 0;
        }
        if ($board->halfmoveClock() >= 100 || $this->isInsufficientMaterial($board)) {
            return 0;
        }

        $ordered = $this->orderMoves($board, $moves, $tableMove, $ply, false);
        $sideKey = $board->sideToMove() === Board::WHITE ? 'w' : 'b';
        $originalAlpha = $alpha;
        $bestScore = -self::INFINITY;
        $bestUci = null;

        $this->path[$key] = true;
        foreach ($ordered as $move) {
            $score = -$this->negamax($move['afterBoard'], $depth - 1, -$beta, -$alpha, $ply + 1);
            if ($this->aborted) {
                unset($this->path[$key]);

                return 0;
            }

            if ($score <= $bestScore) {
                continue;
            }

            $bestScore = $score;
            $bestUci = $move['uci'];
            if ($score <= $alpha) {
                continue;
            }

            $alpha = $score;
            if ($alpha >= $beta) {
                if ($move['quiet']) {
                    $this->recordQuietCutoff($move, $sideKey, $depth, $ply);
                }
                break;
            }
        }
        unset($this->path[$key]);

        if ($tableUsable) {
            $bound = self::BOUND_EXACT;
            if ($bestScore <= $originalAlpha) {
                $bound = self::BOUND_UPPER;
            } elseif ($bestScore >= $beta) {
                $bound = self::BOUND_LOWER;
            }
            $this->storeEntry($key, $depth, $bestScore, $bound, $bestUci, $ply);
        }

        return $bestScore;
    }

    /**
     * Quiescence search: stand pat, then captures and promotions only. In check there is no
     * stand-pat and every evasion is searched.
     */
    private function quiescence(Board $board, int $alpha, int $beta, int $ply, int $quiescencePly): int
    {
        if ($this->timeUp()) {
            return 0;
        }
        if ($ply >= self::MAX_PLY) {
            return $this->evaluate($board);
        }

        $inCheck = $board->isInCheck($board->sideToMove());
        $bestScore = -self::INFINITY;

        if (!$inCheck) {
            // Not in check, so these are draws whether or not a legal move exists.
            if ($board->halfmoveClock() >= 100 || $this->isInsufficientMaterial($board)) {
                return 0;
            }

            $standPat = $this->evaluate($board);
            if ($standPat >= $beta || $quiescencePly >= self::QUIESCENCE_MAX_PLY) {
                return $standPat;
            }
            if ($standPat > $alpha) {
                $alpha = $standPat;
            }
            $bestScore = $standPat;
        }

        $moves = $this->engine->searchMoves($board);
        if ($moves === []) {
            return $inCheck ? -(self::MATE - $ply) : 0;
        }
        if ($inCheck && ($board->halfmoveClock() >= 100 || $this->isInsufficientMaterial($board))) {
            return 0;
        }

        foreach ($this->orderMoves($board, $moves, null, $ply, !$inCheck) as $move) {
            $score = -$this->quiescence($move['afterBoard'], -$beta, -$alpha, $ply + 1, $quiescencePly + 1);
            if ($this->aborted) {
                return 0;
            }

            if ($score <= $bestScore) {
                continue;
            }

            $bestScore = $score;
            if ($score > $alpha) {
                $alpha = $score;
                if ($alpha >= $beta) {
                    break;
                }
            }
        }

        return $bestScore;
    }

    /**
     * Orders moves: the previous-iteration / transposition move, then captures by MVV-LVA
     * and promotions, then killer moves, then quiet moves by history score. Equal scores
     * fall back to UCI order so the search is deterministic.
     *
     * @param list<array<string, mixed>> $moves
     * @return list<array<string, mixed>> Moves with 'order' and 'quiet' added.
     */
    private function orderMoves(Board $board, array $moves, ?string $firstUci, int $ply, bool $tacticalOnly): array
    {
        $squares = $board->pieces();
        $sideKey = $board->sideToMove() === Board::WHITE ? 'w' : 'b';
        $killers = $this->killers[$ply] ?? [null, null];

        $ordered = [];
        foreach ($moves as $move) {
            $from = (string) $move['from'];
            $to = (string) $move['to'];
            $attacker = $squares[$from]->fenLetter();
            $victim = isset($squares[$to]) ? $squares[$to]->fenLetter() : null;
            if ($victim === null && $attacker === 'p' && $from[0] !== $to[0]) {
                // A pawn changing file onto an empty square is an en-passant capture.
                $victim = 'p';
            }
            $promotion = $move['promotion'];

            $tactical = $victim !== null || $promotion !== null;
            if ($tacticalOnly && !$tactical) {
                continue;
            }

            if ($move['uci'] === $firstUci) {
                $order = self::ORDER_FIRST;
            } elseif ($tactical) {
                $order = self::ORDER_TACTICAL
                    + 10 * ($victim !== null ? self::PIECE_VALUES[$victim] : 0)
                    + 10 * ($promotion !== null ? (self::PIECE_VALUES[$promotion] ?? 0) : 0)
                    - (self::ATTACKER_RANK[$attacker] ?? 0);
            } elseif ($move['uci'] === $killers[0]) {
                $order = self::ORDER_KILLER;
            } elseif ($move['uci'] === $killers[1]) {
                $order = self::ORDER_KILLER - 1;
            } else {
                $order = min($this->history[$sideKey . $from . $to] ?? 0, self::ORDER_HISTORY_MAX);
            }

            $move['order'] = $order;
            $move['quiet'] = !$tactical;
            $ordered[] = $move;
        }

        usort(
            $ordered,
            static fn (array $a, array $b): int => ($b['order'] <=> $a['order']) ?: strcmp($a['uci'], $b['uci']),
        );

        return $ordered;
    }

    /** @param array<string, mixed> $move */
    private function recordQuietCutoff(array $move, string $sideKey, int $depth, int $ply): void
    {
        $uci = (string) $move['uci'];
        $killers = $this->killers[$ply] ?? [null, null];
        if ($killers[0] !== $uci) {
            $this->killers[$ply] = [$uci, $killers[0]];
        }

        $historyKey = $sideKey . $move['from'] . $move['to'];
        $this->history[$historyKey] = ($this->history[$historyKey] ?? 0) + $depth * $depth;
    }

    private function storeEntry(string $key, int $depth, int $score, int $bound, ?string $bestUci, int $ply): void
    {
        $existing = $this->table[$key] ?? null;
        if ($existing === null) {
            if (count($this->table) >= self::TABLE_MAX_ENTRIES) {
                return;
            }
        } elseif ($existing[0] > $depth) {
            return;
        }

        // Store mate scores relative to this node rather than to the root.
        if ($score > self::MATE_BOUND) {
            $score += $ply;
        } elseif ($score < -self::MATE_BOUND) {
            $score -= $ply;
        }

        $this->table[$key] = [$depth, $score, $bound, $bestUci];
    }

    /** Checks the clock; called on entry to every searched node. */
    private function timeUp(): bool
    {
        if (!$this->aborted && $this->deadlineActive && hrtime(true) >= $this->deadline) {
            $this->aborted = true;
        }

        return $this->aborted;
    }

    /** Piece placement + side to move + castling rights + en-passant target. */
    private function positionKey(Board $board): string
    {
        $placement = str_repeat('.', 64);
        foreach ($board->pieces() as $square => $piece) {
            $square = (string) $square;
            $placement[(ord($square[0]) - 97) + 8 * ((int) $square[1] - 1)] = $piece->fenSymbol();
        }

        return $placement
            . ($board->sideToMove() === Board::WHITE ? 'w' : 'b')
            . $board->castlingRightsString()
            . ($board->enPassantTarget() ?? '-');
    }

    /**
     * Static evaluation from the side to move's point of view: material plus piece-square
     * tables, with the king table chosen by the Simplified Evaluation Function's end-game
     * definition.
     */
    private function evaluate(Board $board): int
    {
        $score = 0;
        $whiteKing = null;
        $blackKing = null;
        $whiteQueens = 0;
        $whiteRooks = 0;
        $whiteMinors = 0;
        $blackQueens = 0;
        $blackRooks = 0;
        $blackMinors = 0;

        foreach ($board->pieces() as $square => $piece) {
            $symbol = $piece->fenSymbol();
            switch ($symbol) {
                case 'K':
                    $whiteKing = $square;
                    continue 2;
                case 'k':
                    $blackKing = $square;
                    continue 2;
                case 'Q':
                    $whiteQueens++;
                    break;
                case 'R':
                    $whiteRooks++;
                    break;
                case 'B':
                case 'N':
                    $whiteMinors++;
                    break;
                case 'q':
                    $blackQueens++;
                    break;
                case 'r':
                    $blackRooks++;
                    break;
                case 'b':
                case 'n':
                    $blackMinors++;
                    break;
            }

            $score += self::$squareScores[$symbol][$square];
        }

        // "Both sides have no queens, or every side which has a queen has additionally no
        // other pieces or one minor piece maximum."
        $endgame = ($whiteQueens === 0 || ($whiteQueens === 1 && $whiteRooks === 0 && $whiteMinors <= 1))
            && ($blackQueens === 0 || ($blackQueens === 1 && $blackRooks === 0 && $blackMinors <= 1));
        $kingScores = $endgame ? self::$kingEndgameScores : self::$squareScores;
        if ($whiteKing !== null) {
            $score += $kingScores['K'][$whiteKing];
        }
        if ($blackKing !== null) {
            $score += $kingScores['k'][$blackKing];
        }

        return $board->sideToMove() === Board::WHITE ? $score : -$score;
    }

    /** Same rule as the engine's insufficient-material draw. */
    private function isInsufficientMaterial(Board $board): bool
    {
        $knights = 0;
        $bishops = 0;
        $bishopShades = 0;

        foreach ($board->pieces() as $square => $piece) {
            $letter = $piece->fenLetter();
            if ($letter === 'k') {
                continue;
            }
            if ($letter === 'n') {
                $knights++;
                continue;
            }
            if ($letter !== 'b') {
                return false;
            }

            $square = (string) $square;
            $bishops++;
            $bishopShades |= 1 << ((ord($square[0]) + ord($square[1])) & 1);
        }

        if ($bishops === 0) {
            return $knights <= 2;
        }
        if ($knights > 0) {
            return false;
        }

        return $bishops === 1 || $bishopShades !== 3;
    }

    private static function initialiseSquareScores(): void
    {
        if (self::$squareScores !== []) {
            return;
        }

        $scores = [];
        foreach (self::PIECE_SQUARE_TABLES as $letter => $table) {
            $scores[strtoupper($letter)] = self::signedSquareScores($table, self::PIECE_VALUES[$letter], true);
            $scores[$letter] = self::signedSquareScores($table, self::PIECE_VALUES[$letter], false);
        }

        self::$kingEndgameScores = [
            'K' => self::signedSquareScores(self::KING_ENDGAME_TABLE, self::PIECE_VALUES['k'], true),
            'k' => self::signedSquareScores(self::KING_ENDGAME_TABLE, self::PIECE_VALUES['k'], false),
        ];
        self::$squareScores = $scores;
    }

    /**
     * Expands a published table (rank 8 first) into square => score from White's point of
     * view. Black pieces read the table mirrored vertically and score negatively.
     *
     * @param list<int> $table
     * @return array<string, int>
     */
    private static function signedSquareScores(array $table, int $pieceValue, bool $white): array
    {
        $scores = [];
        foreach ($table as $index => $bonus) {
            $row = intdiv($index, 8);
            $file = chr(97 + $index % 8);
            $rank = $white ? 8 - $row : $row + 1;
            $scores[$file . $rank] = $white ? $pieceValue + $bonus : -($pieceValue + $bonus);
        }

        return $scores;
    }
}
