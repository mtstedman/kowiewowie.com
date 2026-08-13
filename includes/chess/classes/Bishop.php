<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Bishop extends Piece
{
    public function type(): string
    {
        return 'bishop';
    }

    public function fenLetter(): string
    {
        return 'b';
    }

    public function sanLetter(): string
    {
        return 'B';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        return $this->generateSlidingMoves($board, $from, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    }
}
