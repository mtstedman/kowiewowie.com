<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

/**
 * Server-side chess opponent.
 *
 * Search: iterative-deepening negamax alpha-beta on Board objects with a transposition
 * table, MVV-LVA / killer / history move ordering refined by static exchange evaluation (SEE),
 * and a quiescence search at the horizon that skips captures losing material by SEE.
 * Selectivity: principal-variation (PV) nodes are searched in full, with internal iterative
 * deepening when no transposition move is known; null-window (non-PV) nodes outside check
 * and mate windows use reverse futility and late move pruning; late moves are reduced by a
 * depth/move-index table and re-searched at full depth whenever they beat alpha.
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

    /** Captures/promotions losing material by SEE: below killers and every history quiet. */
    private const ORDER_LOSING_TACTICAL = -100000;

    private const ASPIRATION_WINDOW = 40;
    private const TIME_CHECK_NODES = 256;
    private const FUTILITY_MARGIN = [1 => 120, 2 => 300];
    private const DELTA_MARGIN = 120;

    /**
     * Reverse futility (static null-move) margins by remaining depth: a non-PV node whose
     * static evaluation exceeds beta by this much returns that evaluation unsearched.
     */
    private const REVERSE_FUTILITY_MARGIN = [1 => 120, 2 => 240, 3 => 360];

    /** Late move pruning: searched-move count after which a non-PV node skips plain quiets. */
    private const LATE_MOVE_PRUNING_COUNT = [1 => 5, 2 => 8, 3 => 12];

    /** Internal iterative deepening: minimum PV-node depth and the shallower search's reduction. */
    private const IID_MIN_DEPTH = 5;
    private const IID_REDUCTION = 2;

    /**
     * Late move reductions: floor(LMR_BASE + ln(depth) * ln(moveIndex) / LMR_DIVISOR), capped at
     * LMR_MAX_REDUCTION, one ply less in PV nodes, and never below one remaining ply.
     */
    private const LMR_MIN_DEPTH = 3;
    private const LMR_MIN_MOVE_INDEX = 3;
    private const LMR_BASE = 0.75;
    private const LMR_DIVISOR = 2.25;
    private const LMR_MAX_REDUCTION = 4;
    private const LMR_TABLE_SIZE = 64;

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

    /** @var array<int, array<int, int>> depth => move index => late move reduction in plies. */
    private static array $lateMoveReductions = [];

    /** @var array<string, array{0: int, 1: int, 2: int, 3: ?string, 4: string}> */
    private array $table = [];

    /** @var array<int, array{0: ?string, 1: ?string}> */
    private array $killers = [];

    /** @var array<string, int> */
    private array $history = [];

    /** @var array<string, true> Collision-safe position identities on the current line. */
    private array $path = [];

    /**
     * Collision-safe identities of positions that occurred earlier in the real game, with
     * occurrence counts. Rebuilt per chooseMove() call from the supplied prior FENs.
     *
     * @var array<string, int>
     */
    private array $gameHistory = [];

    /** @var array<string, array<string, array{0: int, 1: int}>> */
    private static array $zobrist = [];

    private int|float|null $deadline = null;

    /** @var null|\Closure(): int Monotonic clock override used by deterministic search controls. */
    private ?\Closure $clock = null;

    private bool $deadlineActive = false;

    private bool $aborted = false;

    private int $nodes = 0;

    /** Last fully completed iterative-deepening depth; useful for diagnostics. */
    private int $completedDepth = 0;

    /** Reverse futility and late move pruning switch; diagnostics may disable it to compare node counts. */
    private bool $selectivePruning = true;

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
        self::initialiseZobrist();
        self::initialiseLateMoveReductions();
    }

    /**
     * @param list<string> $priorFens Positions that occurred earlier in the game, oldest to
     *                                newest, excluding $fen itself. A search node (never the
     *                                root) that recreates one of them scores as a draw.
     */
    public function chooseMove(string $fen, array $priorFens = []): ?string
    {
        $startedAt = $this->now();

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
        $this->gameHistory = $this->buildGameHistory($board, $priorFens);
        $this->aborted = false;
        $this->nodes = 0;
        $this->completedDepth = 0;
        $this->deadline = $this->timeBudgetMs > 0 ? $startedAt + $this->timeBudgetMs * 1000000 : null;

        $bestUci = null;
        $previousScore = null;
        $previousIterationNs = null;
        // A clocked default search is pruning-limited rather than artificially capped at depth six.
        $maxDepth = $this->timeBudgetMs > 0 ? max(12, $this->maxDepth) : max(1, $this->maxDepth);

        try {
            for ($depth = 1; $depth <= $maxDepth; $depth++) {
                if ($this->deadline !== null && $previousIterationNs !== null && $depth > 2) {
                    $remaining = $this->deadline - $this->now();
                    if ($remaining <= (int) ($previousIterationNs * 1.35)) {
                        break;
                    }
                }

                $this->deadlineActive = $this->deadline !== null;
                $iterationStartedAt = $this->now();
                $window = self::ASPIRATION_WINDOW;
                $alpha = $previousScore === null || abs($previousScore) > self::MATE_BOUND
                    ? -self::INFINITY
                    : max(-self::INFINITY, $previousScore - $window);
                $beta = $previousScore === null || abs($previousScore) > self::MATE_BOUND
                    ? self::INFINITY
                    : min(self::INFINITY, $previousScore + $window);

                while (true) {
                    $result = $this->searchRoot($board, $moves, $depth, $bestUci, $alpha, $beta);
                    if ($result === null) {
                        break 2;
                    }

                    [$candidateUci, $candidateScore] = $result;
                    if ($candidateScore <= $alpha && $alpha > -self::INFINITY) {
                        $window *= 2;
                        $alpha = $window >= 2048 ? -self::INFINITY : max(-self::INFINITY, $candidateScore - $window);
                        continue;
                    }
                    if ($candidateScore >= $beta && $beta < self::INFINITY) {
                        $window *= 2;
                        $beta = $window >= 2048 ? self::INFINITY : min(self::INFINITY, $candidateScore + $window);
                        continue;
                    }

                    $bestUci = $candidateUci;
                    $previousScore = $candidateScore;
                    $this->completedDepth = $depth;
                    $previousIterationNs = max(1, $this->now() - $iterationStartedAt);
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
    private function searchRoot(
        Board $board,
        array $moves,
        int $depth,
        ?string $pvUci,
        int $alpha,
        int $beta,
    ): ?array {
        [$key, $lock] = $this->positionIdentity($board);
        $pathKey = $key . ':' . $lock;
        $ordered = $this->orderMoves($board, $moves, $pvUci, 0, false);
        $bestUci = null;
        $bestScore = -self::INFINITY;
        $moveIndex = 0;

        $this->path[$pathKey] = true;
        foreach ($ordered as $move) {
            if ($this->timeUp(true)) {
                unset($this->path[$pathKey]);

                return null;
            }

            $scoreExact = true;
            if ($moveIndex === 0) {
                $score = -$this->negamax($move['afterBoard'], $depth - 1, -$beta, -$alpha, 1);
            } else {
                $scoreExact = false;
                $score = -$this->negamax($move['afterBoard'], $depth - 1, -$alpha - 1, -$alpha, 1);
                if (!$this->aborted && $score < $beta && $score >= $alpha) {
                    if ($score === $alpha && $alpha === self::MATE - 1) {
                        // Mate-distance pruning may return alpha as a bound. At the maximum
                        // root score, prove an equal mate directly before using the UCI tie-break.
                        $child = $move['afterBoard'];
                        $scoreExact = $child->isInCheck($child->sideToMove())
                            && $this->engine->searchMoves($child) === [];
                    } else {
                        $score = -$this->negamax($move['afterBoard'], $depth - 1, -$beta, -$alpha, 1);
                        $scoreExact = true;
                    }
                }
            }
            if ($this->aborted) {
                unset($this->path[$pathKey]);

                return null;
            }
            $moveIndex++;

            if (
                $bestUci === null
                || $score > $bestScore
                || ($scoreExact && $score === $bestScore && strcmp($move['uci'], $bestUci) < 0)
            ) {
                $bestScore = $score;
                $bestUci = $move['uci'];
            }
            if ($score > $alpha) {
                $alpha = $score;
                if ($alpha >= $beta) {
                    break;
                }
            }
        }
        unset($this->path[$pathKey]);

        return $bestUci === null ? null : [$bestUci, $bestScore];
    }

    /**
     * Fail-soft negamax alpha-beta. The score is from the side to move's point of view.
     *
     * A node searched with a wider-than-null window is a PV node. Reverse futility and late
     * move pruning apply only to non-PV nodes that are not in check and whose window holds no
     * mate score; PV nodes without a transposition move first run internal iterative deepening.
     */
    private function negamax(
        Board $board,
        int $depth,
        int $alpha,
        int $beta,
        int $ply,
        bool $allowNull = true,
    ): int {
        $this->nodes++;
        if ($this->timeUp()) {
            return 0;
        }
        if ($ply >= self::MAX_PLY) {
            return $this->evaluate($board);
        }

        $isPv = $beta - $alpha > 1;
        $inCheck = $board->isInCheck($board->sideToMove());
        if ($inCheck) {
            // The checking move and this evasion do not consume search depth.
            $depth++;
        }
        if ($depth <= 0) {
            return $this->quiescence($board, $alpha, $beta, $ply, 0);
        }

        // Mate-distance pruning prevents searching scores that cannot improve the line.
        $alpha = max($alpha, -self::MATE + $ply);
        $beta = min($beta, self::MATE - $ply - 1);
        if ($alpha >= $beta) {
            return $alpha;
        }

        [$key, $lock] = $this->positionIdentity($board);
        $pathKey = $key . ':' . $lock;
        if ($ply >= 1 && (isset($this->path[$pathKey]) || isset($this->gameHistory[$pathKey]))) {
            // A repetition of the search line or of the real game is scored as a draw.
            return 0;
        }

        $moves = $this->engine->searchMoves($board);
        if ($moves === []) {
            return $inCheck ? -(self::MATE - $ply) : 0;
        }
        if ($board->halfmoveClock() >= 100 || $this->isInsufficientMaterial($board)) {
            return 0;
        }

        $legalUcis = [];
        foreach ($moves as $move) {
            $legalUcis[(string) $move['uci']] = true;
        }

        // The key omits the halfmove clock; avoid table cutoffs near the fifty-move boundary.
        $tableUsable = $board->halfmoveClock() + $depth < 100;
        $tableMove = null;
        $entry = $this->table[$key] ?? null;
        if (
            $entry !== null
            && $entry[4] === $lock
            && ($entry[3] === null || isset($legalUcis[$entry[3]]))
        ) {
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

        $selective = $this->selectivePruning
            && !$isPv
            && !$inCheck
            && abs($alpha) < self::MATE_BOUND
            && abs($beta) < self::MATE_BOUND;
        $staticScore = null;

        // Reverse futility pruning: a static score this far above beta is assumed to hold.
        // A static evaluation is never a mate score.
        if ($selective && isset(self::REVERSE_FUTILITY_MARGIN[$depth])) {
            $staticScore = $this->evaluate($board);
            if ($staticScore - self::REVERSE_FUTILITY_MARGIN[$depth] >= $beta) {
                return $staticScore;
            }
        }

        // Internal iterative deepening: a shallower search on the same window fills the table
        // with a best move for ordering. It runs before this position joins the path, so the
        // inner search does not see itself as a repetition; in check the inner node extends
        // again, so one ply is removed here to keep the inner search exactly IID_REDUCTION shallower.
        if ($isPv && $tableMove === null && $depth >= self::IID_MIN_DEPTH) {
            $this->negamax(
                $board,
                $depth - self::IID_REDUCTION - ($inCheck ? 1 : 0),
                $alpha,
                $beta,
                $ply,
                $allowNull,
            );
            if ($this->aborted) {
                return 0;
            }
            $entry = $this->table[$key] ?? null;
            if ($entry !== null && $entry[4] === $lock && $entry[3] !== null && isset($legalUcis[$entry[3]])) {
                $tableMove = $entry[3];
            }
        }

        $originalAlpha = $alpha;
        $this->path[$pathKey] = true;

        if (
            $allowNull
            && !$inCheck
            && $depth >= 3
            && abs($beta) < self::MATE_BOUND
            && $this->canUseNullMove($board)
        ) {
            $nullBoard = $this->makeNullMove($board);
            $reduction = $depth >= 6 ? 3 : 2;
            $nullScore = -$this->negamax(
                $nullBoard,
                $depth - $reduction - 1,
                -$beta,
                -$beta + 1,
                $ply + 1,
                false,
            );
            if ($this->aborted) {
                unset($this->path[$pathKey]);

                return 0;
            }
            if ($nullScore >= $beta) {
                unset($this->path[$pathKey]);

                return $nullScore;
            }
        }

        $ordered = $this->orderMoves($board, $moves, $tableMove, $ply, false);
        $sideKey = $board->sideToMove() === Board::WHITE ? 'w' : 'b';
        $killers = $this->killers[$ply] ?? [null, null];
        $futilityMargin = !$inCheck && isset(self::FUTILITY_MARGIN[$depth]) && abs($alpha) < self::MATE_BOUND
            ? self::FUTILITY_MARGIN[$depth]
            : null;
        $lateMoveLimit = $selective ? (self::LATE_MOVE_PRUNING_COUNT[$depth] ?? null) : null;
        $bestScore = -self::INFINITY;
        $bestUci = null;
        $searchedMoves = 0;
        $prunedMoves = false;

        foreach ($ordered as $moveIndex => $move) {
            $uci = (string) $move['uci'];
            $givesCheck = $move['afterBoard']->isInCheck($move['afterBoard']->sideToMove());
            $isKiller = $uci === $killers[0] || $uci === $killers[1];
            // Plain quiet moves: never the first searched move, a check, a killer or the TT move.
            $prunable = $searchedMoves > 0
                && $move['quiet']
                && !$givesCheck
                && !$isKiller
                && $uci !== $tableMove;
            if ($prunable && $lateMoveLimit !== null && $searchedMoves >= $lateMoveLimit) {
                $prunedMoves = true;
                continue;
            }
            if ($prunable && $futilityMargin !== null) {
                $staticScore ??= $this->evaluate($board);
                if ($staticScore + $futilityMargin <= $alpha) {
                    $prunedMoves = true;
                    continue;
                }
            }

            $childDepth = $depth - 1;
            $reduction = 0;
            if (
                $depth >= self::LMR_MIN_DEPTH
                && $moveIndex >= self::LMR_MIN_MOVE_INDEX
                && $searchedMoves > 0
                && !$inCheck
                && !$givesCheck
                && !$isKiller
                && $uci !== $tableMove
                && ($move['quiet'] || $move['see'] < 0)
            ) {
                // Late quiets and SEE-losing captures; SEE >= 0 tactical moves are never reduced.
                $reduction = $this->lateMoveReduction($depth, $moveIndex, $isPv);
            }

            if ($reduction > 0) {
                $score = -$this->negamax(
                    $move['afterBoard'],
                    max(0, $childDepth - $reduction),
                    -$alpha - 1,
                    -$alpha,
                    $ply + 1,
                );
                if (!$this->aborted && $score > $alpha) {
                    $score = -$this->negamax(
                        $move['afterBoard'],
                        $childDepth,
                        -$alpha - 1,
                        -$alpha,
                        $ply + 1,
                    );
                    if (!$this->aborted && $score > $alpha && $score < $beta) {
                        $score = -$this->negamax(
                            $move['afterBoard'],
                            $childDepth,
                            -$beta,
                            -$alpha,
                            $ply + 1,
                        );
                    }
                }
            } elseif ($searchedMoves === 0) {
                $score = -$this->negamax($move['afterBoard'], $childDepth, -$beta, -$alpha, $ply + 1);
            } else {
                $score = -$this->negamax($move['afterBoard'], $childDepth, -$alpha - 1, -$alpha, $ply + 1);
                if (!$this->aborted && $score > $alpha && $score < $beta) {
                    $score = -$this->negamax($move['afterBoard'], $childDepth, -$beta, -$alpha, $ply + 1);
                }
            }
            if ($this->aborted) {
                unset($this->path[$pathKey]);

                return 0;
            }
            $searchedMoves++;

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestUci = $uci;
            }
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
        unset($this->path[$pathKey]);

        if ($prunedMoves && $bestScore < -self::MATE_BOUND) {
            // Every searched move was mated, but a pruned quiet move may escape: pruning only
            // assumed those moves fail low, so report the (non-mate) alpha bound instead.
            $bestScore = $originalAlpha;
        }

        if ($tableUsable) {
            $bound = self::BOUND_EXACT;
            if ($bestScore <= $originalAlpha) {
                $bound = self::BOUND_UPPER;
            } elseif ($bestScore >= $beta) {
                $bound = self::BOUND_LOWER;
            }
            $this->storeEntry($key, $lock, $depth, $bestScore, $bound, $bestUci, $ply);
        }

        return $bestScore;
    }

    /**
     * Quiescence search: stand pat, then tactical moves and at most one elective quiet check
     * per path. In check there is no stand-pat and every evasion is searched.
     */
    private function quiescence(
        Board $board,
        int $alpha,
        int $beta,
        int $ply,
        int $quiescencePly,
        bool $quietCheckAvailable = true,
    ): int
    {
        $this->nodes++;
        if ($this->timeUp()) {
            return 0;
        }
        if ($ply >= self::MAX_PLY) {
            return $this->evaluate($board);
        }

        $alpha = max($alpha, -self::MATE + $ply);
        $beta = min($beta, self::MATE - $ply - 1);
        if ($alpha >= $beta) {
            return $alpha;
        }

        // After a capture or pawn move (halfmove clock 0) no earlier position can recur.
        if ($ply >= 1 && $board->halfmoveClock() > 0) {
            [$key, $lock] = $this->positionIdentity($board);
            $pathKey = $key . ':' . $lock;
            if (isset($this->path[$pathKey]) || isset($this->gameHistory[$pathKey])) {
                return 0;
            }
        }

        $inCheck = $board->isInCheck($board->sideToMove());
        $bestScore = -self::INFINITY;
        $standPat = null;

        if (!$inCheck) {
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

        foreach ($this->orderMoves($board, $moves, null, $ply, false) as $move) {
            $givesCheck = $move['afterBoard']->isInCheck($move['afterBoard']->sideToMove());
            $electiveQuietCheck = !$inCheck && $move['quiet'] && $givesCheck;
            if (!$inCheck && $move['quiet'] && (!$givesCheck || !$quietCheckAvailable)) {
                continue;
            }
            if (!$inCheck && !$move['quiet'] && $move['promotion'] === null && $move['see'] < 0) {
                // A capture that loses material in the swap-off cannot raise the stand-pat
                // bound; check evasions and promotions are never skipped here.
                continue;
            }
            if (
                !$inCheck
                && !$givesCheck
                && $standPat !== null
                && $standPat + $move['tacticalGain'] + self::DELTA_MARGIN < $alpha
            ) {
                continue;
            }

            $score = -$this->quiescence(
                $move['afterBoard'],
                -$beta,
                -$alpha,
                $ply + 1,
                $quiescencePly + 1,
                $quietCheckAvailable && !$electiveQuietCheck,
            );
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
     * Orders moves: the previous-iteration / transposition move, then captures and
     * promotions that do not lose material by SEE (MVV-LVA inside that band), then killer
     * moves, then quiet moves by history score, then SEE-losing captures/promotions (least
     * loss first). Equal scores fall back to UCI order so the search is deterministic.
     *
     * @param list<array<string, mixed>> $moves
     * @return list<array<string, mixed>> Moves with 'order', 'quiet', 'tacticalGain' and
     *                                    'see' (int for tactical moves, null for quiet) added.
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

            $see = $tactical ? $this->staticExchange($board, $from, $to, $promotion) : null;

            if ($move['uci'] === $firstUci) {
                $order = self::ORDER_FIRST;
            } elseif ($tactical && $see < 0) {
                $order = self::ORDER_LOSING_TACTICAL + $see;
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
            $move['see'] = $see;
            $move['tacticalGain'] = ($victim !== null ? self::PIECE_VALUES[$victim] : 0)
                + ($promotion !== null ? max(0, (self::PIECE_VALUES[$promotion] ?? 0) - self::PIECE_VALUES['p']) : 0);
            $ordered[] = $move;
        }

        usort(
            $ordered,
            static fn (array $a, array $b): int => ($b['order'] <=> $a['order']) ?: strcmp($a['uci'], $b['uci']),
        );

        return $ordered;
    }

    /**
     * Static exchange evaluation: the centipawn material outcome, from the mover's point
     * of view, of playing the capture/promotion $from-$to and then letting both sides
     * recapture on $to with their least valuable attacker, each side free to stop when
     * continuing would lose material. Uses PIECE_VALUES; an en-passant victim is a pawn,
     * a promotion gains the promoted piece's value minus a pawn (also for pawn recaptures
     * onto the last rank, which promote to a queen), and a king recaptures only as a last
     * resort and never onto a square the opponent still attacks. Sliding attackers revealed
     * behind a piece that has captured (x-rays) join the exchange. Pins and checks against
     * the recapturing side are ignored, as is usual for SEE.
     */
    private function staticExchange(Board $board, string $from, string $to, ?string $promotion): int
    {
        $occupied = $board->pieces();
        $mover = $occupied[$from];
        $moverLetter = $mover->fenLetter();
        $side = $mover->color();
        [$toFile, $toRank] = Board::squareToCoords($to);

        $victimValue = 0;
        if (isset($occupied[$to])) {
            $victimValue = self::PIECE_VALUES[$occupied[$to]->fenLetter()];
            unset($occupied[$to]);
        } elseif ($moverLetter === 'p' && $from[0] !== $to[0]) {
            // En passant: the captured pawn sits beside the mover, on the mover's rank.
            $victimValue = self::PIECE_VALUES['p'];
            unset($occupied[$to[0] . $from[1]]);
        }
        unset($occupied[$from]);

        $gains = [$victimValue];
        $onSquare = self::PIECE_VALUES[$moverLetter];
        if ($promotion !== null) {
            $promotedValue = self::PIECE_VALUES[strtolower($promotion)] ?? 0;
            $gains[0] += $promotedValue - self::PIECE_VALUES['p'];
            $onSquare = $promotedValue;
        }

        $side = Board::otherColor($side);
        $promotionRank = [Board::WHITE => 7, Board::BLACK => 0];
        while (true) {
            $attacker = self::leastValuableAttacker($occupied, $toFile, $toRank, $side);
            if ($attacker === null) {
                break;
            }
            [$attackerSquare, $attackerLetter] = $attacker;
            unset($occupied[$attackerSquare]);
            if (
                $attackerLetter === 'k'
                && self::leastValuableAttacker($occupied, $toFile, $toRank, Board::otherColor($side)) !== null
            ) {
                break;
            }

            $captured = $onSquare;
            $onSquare = self::PIECE_VALUES[$attackerLetter];
            if ($attackerLetter === 'p' && $toRank === $promotionRank[$side]) {
                $captured += self::PIECE_VALUES['q'] - self::PIECE_VALUES['p'];
                $onSquare = self::PIECE_VALUES['q'];
            }
            $gains[] = $captured - $gains[count($gains) - 1];
            $side = Board::otherColor($side);
        }

        // Each recapture is optional: the side to recapture keeps the better of stopping
        // (the negated previous gain) and capturing (its own resolved gain).
        for ($index = count($gains) - 1; $index > 0; $index--) {
            $gains[$index - 1] = -max(-$gains[$index - 1], $gains[$index]);
        }

        return $gains[0];
    }

    /**
     * The least valuable $color piece attacking the square at ($file, $rank) on the given
     * occupancy (pawn, knight, bishop, rook, queen, then king), scanning in a fixed order.
     *
     * @param array<string, Piece> $occupied
     * @return array{0: string, 1: string}|null Attacker square and lowercase piece letter.
     */
    private static function leastValuableAttacker(array $occupied, int $file, int $rank, string $color): ?array
    {
        $pawnRank = $rank + ($color === Board::WHITE ? -1 : 1);
        if ($pawnRank >= 0 && $pawnRank < 8) {
            foreach ([-1, 1] as $fileDelta) {
                $pawnFile = $file + $fileDelta;
                if ($pawnFile < 0 || $pawnFile > 7) {
                    continue;
                }
                $square = chr(97 + $pawnFile) . ($pawnRank + 1);
                $piece = $occupied[$square] ?? null;
                if ($piece !== null && $piece->color() === $color && $piece->fenLetter() === 'p') {
                    return [$square, 'p'];
                }
            }
        }

        foreach ([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            if ($targetFile < 0 || $targetFile > 7 || $targetRank < 0 || $targetRank > 7) {
                continue;
            }
            $square = chr(97 + $targetFile) . ($targetRank + 1);
            $piece = $occupied[$square] ?? null;
            if ($piece !== null && $piece->color() === $color && $piece->fenLetter() === 'n') {
                return [$square, 'n'];
            }
        }

        $best = null;
        $bestRank = PHP_INT_MAX;
        $rays = [
            [1, 1, 'b'], [1, -1, 'b'], [-1, 1, 'b'], [-1, -1, 'b'],
            [1, 0, 'r'], [-1, 0, 'r'], [0, 1, 'r'], [0, -1, 'r'],
        ];
        foreach ($rays as [$fileDelta, $rankDelta, $slider]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            while ($targetFile >= 0 && $targetFile < 8 && $targetRank >= 0 && $targetRank < 8) {
                $square = chr(97 + $targetFile) . ($targetRank + 1);
                $piece = $occupied[$square] ?? null;
                if ($piece === null) {
                    $targetFile += $fileDelta;
                    $targetRank += $rankDelta;
                    continue;
                }

                $letter = $piece->fenLetter();
                if (
                    $piece->color() === $color
                    && ($letter === $slider || $letter === 'q')
                    && self::ATTACKER_RANK[$letter] < $bestRank
                ) {
                    $best = [$square, $letter];
                    $bestRank = self::ATTACKER_RANK[$letter];
                }
                break;
            }
        }
        if ($best !== null) {
            return $best;
        }

        foreach ([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            if ($targetFile < 0 || $targetFile > 7 || $targetRank < 0 || $targetRank > 7) {
                continue;
            }
            $square = chr(97 + $targetFile) . ($targetRank + 1);
            $piece = $occupied[$square] ?? null;
            if ($piece !== null && $piece->color() === $color && $piece->fenLetter() === 'k') {
                return [$square, 'k'];
            }
        }

        return null;
    }

    /**
     * Plies to reduce a late move by: the depth/move-index table, one ply less in PV nodes,
     * and bounded so the reduced child keeps at least one ply before quiescence.
     */
    private function lateMoveReduction(int $depth, int $moveIndex, bool $isPv): int
    {
        $reduction = self::$lateMoveReductions[min($depth, self::LMR_TABLE_SIZE - 1)][min($moveIndex, self::LMR_TABLE_SIZE - 1)];
        if ($isPv) {
            $reduction--;
        }

        return max(0, min($reduction, $depth - 2));
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

    private function storeEntry(
        string $key,
        string $lock,
        int $depth,
        int $score,
        int $bound,
        ?string $bestUci,
        int $ply,
    ): void {
        $existing = $this->table[$key] ?? null;
        if ($existing === null) {
            if (count($this->table) >= self::TABLE_MAX_ENTRIES) {
                return;
            }
        } elseif ($existing[4] === $lock && $existing[0] > $depth) {
            return;
        }

        // Store mate scores relative to this node rather than to the root.
        if ($score > self::MATE_BOUND) {
            $score += $ply;
        } elseif ($score < -self::MATE_BOUND) {
            $score -= $ply;
        }

        $this->table[$key] = [$depth, $score, $bound, $bestUci, $lock];
    }

    private function now(): int
    {
        return $this->clock === null ? hrtime(true) : ($this->clock)();
    }

    /** Check the monotonic clock only once per node batch, plus explicit root boundaries. */
    private function timeUp(bool $force = false): bool
    {
        if (
            !$this->aborted
            && $this->deadlineActive
            && ($force || $this->nodes % self::TIME_CHECK_NODES === 0)
            && $this->now() >= $this->deadline
        ) {
            $this->aborted = true;
        }

        return $this->aborted;
    }

    /**
     * Occurrence counts of the prior game positions that the root can still repeat: only the
     * last halfmoveClock() positions, since a capture or pawn move makes earlier ones unreachable.
     *
     * @param array<int|string, mixed> $priorFens
     * @return array<string, int>
     */
    private function buildGameHistory(Board $root, array $priorFens): array
    {
        $reachable = $root->halfmoveClock();
        if ($reachable <= 0 || $priorFens === []) {
            return [];
        }

        $history = [];
        foreach (array_slice(array_values($priorFens), -$reachable) as $priorFen) {
            if (!is_string($priorFen)) {
                continue;
            }
            try {
                [$key, $lock] = $this->positionIdentity(Board::fromFen($priorFen));
            } catch (\Throwable) {
                continue;
            }
            $pathKey = $key . ':' . $lock;
            $history[$pathKey] = ($history[$pathKey] ?? 0) + 1;
        }

        return $history;
    }

    /**
     * @return array{0: string, 1: string} 64-bit Zobrist key and exact collision lock.
     */
    private function positionIdentity(Board $board): array
    {
        $hashA = 0;
        $hashB = 0;
        $pieces = $board->pieces();
        ksort($pieces, SORT_STRING);
        $lock = '';

        foreach ($pieces as $square => $piece) {
            $symbol = $piece->fenSymbol();
            [$pieceA, $pieceB] = self::$zobrist[$symbol][(string) $square];
            $hashA ^= $pieceA;
            $hashB ^= $pieceB;
            $lock .= $square . $symbol;
        }

        $state = ($board->sideToMove() === Board::WHITE ? 'w' : 'b')
            . $board->castlingRightsString()
            . ($board->enPassantTarget() ?? '-');
        [$stateA, $stateB] = self::zobristPair('state:' . $state);
        $hashA ^= $stateA;
        $hashB ^= $stateB;

        return [
            sprintf('%08x%08x', $hashA & 0xffffffff, $hashB & 0xffffffff),
            $lock . '|' . $state,
        ];
    }

    private function canUseNullMove(Board $board): bool
    {
        $ownHasNonPawn = false;
        $nonPawnPieces = 0;
        $hasHeavyPiece = false;
        $side = $board->sideToMove();

        foreach ($board->pieces() as $piece) {
            $letter = $piece->fenLetter();
            if ($letter === 'k' || $letter === 'p') {
                continue;
            }
            $nonPawnPieces++;
            $hasHeavyPiece = $hasHeavyPiece || $letter === 'r' || $letter === 'q';
            if ($piece->color() === $side) {
                $ownHasNonPawn = true;
            }
        }

        // Pawn-only sides and sparse minor-piece endings are common zugzwang territory.
        return $ownHasNonPawn && ($hasHeavyPiece || $nonPawnPieces >= 4);
    }

    private function makeNullMove(Board $board): Board
    {
        $nullBoard = $board->copy();
        $side = $board->sideToMove();
        $nullBoard->setSideToMove(Board::otherColor($side));
        $nullBoard->setEnPassantTarget(null);
        $nullBoard->setHalfmoveClock($board->halfmoveClock() + 1);
        if ($side === Board::BLACK) {
            $nullBoard->setFullmoveNumber($board->fullmoveNumber() + 1);
        }

        return $nullBoard;
    }

    private static function initialiseLateMoveReductions(): void
    {
        if (self::$lateMoveReductions !== []) {
            return;
        }

        $reductions = [];
        for ($depth = 0; $depth < self::LMR_TABLE_SIZE; $depth++) {
            for ($index = 0; $index < self::LMR_TABLE_SIZE; $index++) {
                $reduction = 0;
                if ($depth > 0 && $index > 0) {
                    $reduction = (int) floor(self::LMR_BASE + log($depth) * log($index) / self::LMR_DIVISOR);
                }
                $reductions[$depth][$index] = max(0, min(self::LMR_MAX_REDUCTION, $reduction));
            }
        }
        self::$lateMoveReductions = $reductions;
    }

    private static function initialiseZobrist(): void
    {
        if (self::$zobrist !== []) {
            return;
        }

        foreach (['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'] as $symbol) {
            for ($rank = 1; $rank <= 8; $rank++) {
                for ($file = 0; $file < 8; $file++) {
                    $square = chr(97 + $file) . $rank;
                    self::$zobrist[$symbol][$square] = self::zobristPair($symbol . $square);
                }
            }
        }
    }

    /** @return array{0: int, 1: int} */
    private static function zobristPair(string $token): array
    {
        return [crc32("chess-a:$token"), crc32("chess-b:$token")];
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
