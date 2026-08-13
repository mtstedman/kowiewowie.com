<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class King extends Piece
{
    public function type(): string
    {
        return 'king';
    }

    public function fenLetter(): string
    {
        return 'k';
    }

    public function sanLetter(): string
    {
        return 'K';
    }

    public function generatePseudoLegalMoves(Board $board, string $from): array
    {
        [$file, $rank] = Board::squareToCoords($from);
        $moves = [];

        foreach ([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as [$fileDelta, $rankDelta]) {
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

            if ($this->isCapturable($occupant)) {
                $moves[] = $this->createMove($from, $to, ['isCapture' => true]);
            }
        }

        $moves = array_merge($moves, $this->generateCastlingMoves($board, $from));

        return $moves;
    }

    /** @return list<array<string, mixed>> */
    private function generateCastlingMoves(Board $board, string $from): array
    {
        if (($this->color() === Board::WHITE && $from !== 'e1') || ($this->color() === Board::BLACK && $from !== 'e8')) {
            return [];
        }

        if ($board->isInCheck($this->color())) {
            return [];
        }

        $moves = [];
        $enemyColor = Board::otherColor($this->color());

        if ($this->color() === Board::WHITE) {
            if ($board->canCastle('K')
                && $board->pieceAt('h1') instanceof Rook
                && $board->pieceAt('h1')?->color() === Board::WHITE
                && $board->pieceAt('f1') === null
                && $board->pieceAt('g1') === null
                && !$board->isSquareAttacked('f1', $enemyColor)
                && !$board->isSquareAttacked('g1', $enemyColor)
            ) {
                $moves[] = $this->createMove('e1', 'g1', ['isCastle' => true, 'castleSide' => 'king']);
            }

            if ($board->canCastle('Q')
                && $board->pieceAt('a1') instanceof Rook
                && $board->pieceAt('a1')?->color() === Board::WHITE
                && $board->pieceAt('b1') === null
                && $board->pieceAt('c1') === null
                && $board->pieceAt('d1') === null
                && !$board->isSquareAttacked('d1', $enemyColor)
                && !$board->isSquareAttacked('c1', $enemyColor)
            ) {
                $moves[] = $this->createMove('e1', 'c1', ['isCastle' => true, 'castleSide' => 'queen']);
            }

            return $moves;
        }

        if ($board->canCastle('k')
            && $board->pieceAt('h8') instanceof Rook
            && $board->pieceAt('h8')?->color() === Board::BLACK
            && $board->pieceAt('f8') === null
            && $board->pieceAt('g8') === null
            && !$board->isSquareAttacked('f8', $enemyColor)
            && !$board->isSquareAttacked('g8', $enemyColor)
        ) {
            $moves[] = $this->createMove('e8', 'g8', ['isCastle' => true, 'castleSide' => 'king']);
        }

        if ($board->canCastle('q')
            && $board->pieceAt('a8') instanceof Rook
            && $board->pieceAt('a8')?->color() === Board::BLACK
            && $board->pieceAt('b8') === null
            && $board->pieceAt('c8') === null
            && $board->pieceAt('d8') === null
            && !$board->isSquareAttacked('d8', $enemyColor)
            && !$board->isSquareAttacked('c8', $enemyColor)
        ) {
            $moves[] = $this->createMove('e8', 'c8', ['isCastle' => true, 'castleSide' => 'queen']);
        }

        return $moves;
    }
}
