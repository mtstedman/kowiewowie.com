<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Rook extends Piece
{
    public function type(): string
    {
        return 'rook';
    }

    public function fenLetter(): string
    {
        return 'r';
    }

    public function sanLetter(): string
    {
        return 'R';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        return $this->generateSlidingMoves($board, $from, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
    }
}
