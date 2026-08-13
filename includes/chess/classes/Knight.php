<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Knight extends Piece
{
    public function type(): string
    {
        return 'knight';
    }

    public function fenLetter(): string
    {
        return 'n';
    }

    public function sanLetter(): string
    {
        return 'N';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        [$file, $rank] = Board::squareToCoords($from);
        $moves = [];

        foreach ([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            if (!Board::isInsideBoard($targetFile, $targetRank)) {
                continue;
            }

            $to = Board::coordsToSquare($targetFile, $targetRank);
            $occupant = $board->pieceAt($to);
            if ($occupant === null) {
                $moves[] = $this->createMove($from, $to);
                continue;
            }

            if ($this->isOpponent($occupant)) {
                $moves[] = $this->createMove($from, $to, ['isCapture' => true]);
            }
        }

        return $moves;
    }
}
