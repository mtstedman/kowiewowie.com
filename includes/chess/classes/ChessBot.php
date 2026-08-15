<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class ChessBot
{
    private const SEARCH_DEPTH = 2;

    /** @var array<string, int> */
    private const PIECE_VALUES = [
        'p' => 100,
        'n' => 320,
        'b' => 330,
        'r' => 500,
        'q' => 900,
        'k' => 0,
    ];

    public function __construct(private readonly ChessEngine $engine)
    {
    }

    public function chooseMove(string $fen): ?string
    {
        $side = $this->sideToMove($fen);
        $moves = $this->legalMoves($fen);
        if ($moves === []) {
            return null;
        }

        $bestMove = null;
        $bestScore = PHP_INT_MIN;
        foreach ($moves as $move) {
            $applied = $this->engine->applyUciMove($fen, (string) $move['uci']);
            if (($applied['ok'] ?? false) !== true) {
                continue;
            }

            $score = $this->minimax((string) $applied['fen'], self::SEARCH_DEPTH - 1, $side);
            if ($score > $bestScore || ($score === $bestScore && ($bestMove === null || (string) $move['uci'] < $bestMove))) {
                $bestScore = $score;
                $bestMove = (string) $move['uci'];
            }
        }

        return $bestMove;
    }

    private function minimax(string $fen, int $depth, string $botSide): int
    {
        $state = $this->engine->detectState($fen);
        if (($state['ok'] ?? false) !== true) {
            return $this->evaluateMaterial($fen, $botSide);
        }
        if (($state['status'] ?? 'ongoing') !== 'ongoing' || $depth <= 0) {
            return $this->evaluateState($fen, $state, $botSide);
        }

        $moves = $this->legalMoves($fen);
        if ($moves === []) {
            return $this->evaluateState($fen, $state, $botSide);
        }

        $maximizing = $this->sideToMove($fen) === $botSide;
        $best = $maximizing ? PHP_INT_MIN : PHP_INT_MAX;
        foreach ($moves as $move) {
            $applied = $this->engine->applyUciMove($fen, (string) $move['uci']);
            if (($applied['ok'] ?? false) !== true) {
                continue;
            }

            $score = $this->minimax((string) $applied['fen'], $depth - 1, $botSide);
            $best = $maximizing ? max($best, $score) : min($best, $score);
        }

        return $best;
    }

    /** @param array<string, mixed> $state */
    private function evaluateState(string $fen, array $state, string $botSide): int
    {
        $status = (string) ($state['status'] ?? 'ongoing');
        if ($status === 'checkmate') {
            return $this->sideToMove($fen) === $botSide ? -100000 : 100000;
        }
        if ($status === 'stalemate' || $status === 'draw') {
            return 0;
        }

        $score = $this->evaluateMaterial($fen, $botSide);
        if (($state['in_check'] ?? false) === true) {
            $score += $this->sideToMove($fen) === $botSide ? -25 : 25;
        }

        return $score;
    }

    private function evaluateMaterial(string $fen, string $botSide): int
    {
        $placement = explode(' ', trim($fen))[0] ?? '';
        $score = 0;
        foreach (str_split($placement) as $symbol) {
            $piece = strtolower($symbol);
            if (!isset(self::PIECE_VALUES[$piece])) {
                continue;
            }

            $value = self::PIECE_VALUES[$piece];
            $isWhite = strtoupper($symbol) === $symbol;
            $score += ($botSide === 'white') === $isWhite ? $value : -$value;
        }

        return $score;
    }

    /** @return list<array<string, mixed>> */
    private function legalMoves(string $fen): array
    {
        $result = $this->engine->legalMoves($fen);
        if (($result['ok'] ?? false) !== true || !is_array($result['moves'] ?? null)) {
            return [];
        }

        $moves = array_values($result['moves']);
        usort($moves, static fn (array $a, array $b): int => strcmp((string) $a['uci'], (string) $b['uci']));

        return $moves;
    }

    private function sideToMove(string $fen): string
    {
        $parts = preg_split('/\s+/', trim($fen));

        return ($parts[1] ?? 'w') === 'b' ? 'black' : 'white';
    }
}
