<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Pawn extends Piece
{
    public function type(): string
    {
        return 'pawn';
    }

    public function fenLetter(): string
    {
        return 'p';
    }

    public function sanLetter(): string
    {
        return '';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        [$file, $rank] = Board::squareToCoords($from);
        $direction = $this->color() === Board::WHITE ? 1 : -1;
        $startRank = $this->color() === Board::WHITE ? 1 : 6;
        $promotionRank = $this->color() === Board::WHITE ? 7 : 0;
        $moves = [];

        $forwardRank = $rank + $direction;
        if (Board::isInsideBoard($file, $forwardRank)) {
            $forwardSquare = Board::coordsToSquare($file, $forwardRank);
            if ($board->pieceAt($forwardSquare) === null) {
                $moves = array_merge($moves, $this->createPawnMoves($from, $forwardSquare, $forwardRank === $promotionRank));

                $doubleRank = $rank + ($direction * 2);
                if ($rank === $startRank && Board::isInsideBoard($file, $doubleRank)) {
                    $doubleSquare = Board::coordsToSquare($file, $doubleRank);
                    if ($board->pieceAt($doubleSquare) === null) {
                        $moves[] = $this->createMove($from, $doubleSquare);
                    }
                }
            }
        }

        foreach ([-1, 1] as $fileDelta) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $direction;
            if (!Board::isInsideBoard($targetFile, $targetRank)) {
                continue;
            }

            $to = Board::coordsToSquare($targetFile, $targetRank);
            $occupant = $board->pieceAt($to);
            if ($this->isOpponent($occupant)) {
                $moves = array_merge($moves, $this->createPawnMoves($from, $to, $targetRank === $promotionRank, ['isCapture' => true]));
                continue;
            }

            if ($board->enPassantTarget() === $to) {
                $moves[] = $this->createMove($from, $to, [
                    'isCapture' => true,
                    'isEnPassant' => true,
                ]);
            }
        }

        return $moves;
    }

    /**
     * @param array<string, mixed> $extra
     * @return list<array<string, mixed>>
     */
    private function createPawnMoves(string $from, string $to, bool $promotion, array $extra = []): array
    {
        if (!$promotion) {
            return [$this->createMove($from, $to, $extra)];
        }

        $moves = [];
        foreach (['q', 'r', 'b', 'n'] as $piece) {
            $moves[] = $this->createMove($from, $to, $extra + ['promotion' => $piece]);
        }

        return $moves;
    }
}
