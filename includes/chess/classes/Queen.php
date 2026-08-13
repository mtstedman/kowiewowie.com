<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Queen extends Piece
{
    public function type(): string
    {
        return 'queen';
    }

    public function fenLetter(): string
    {
        return 'q';
    }

    public function sanLetter(): string
    {
        return 'Q';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        return $this->generateSlidingMoves($board, $from, [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ]);
    }
}
