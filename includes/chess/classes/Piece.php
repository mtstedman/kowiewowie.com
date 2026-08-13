<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

abstract class Piece
{
    final public function __construct(private readonly string $color)
    {
        if (!in_array($color, [Board::WHITE, Board::BLACK], true)) {
            throw new \InvalidArgumentException('Pieces must be white or black.');
        }
    }

    final public function color(): string
    {
        return $this->color;
    }

    final public function imageIdentifier(): string
    {
        return $this->color . '-' . $this->type();
    }

    final public function fenSymbol(): string
    {
        $letter = $this->fenLetter();

        return $this->color === Board::WHITE ? strtoupper($letter) : $letter;
    }

    final public function isOpponent(?Piece $piece): bool
    {
        return $piece !== null && $piece->color() !== $this->color;
    }

    abstract public function type(): string;

    abstract public function fenLetter(): string;

    abstract public function sanLetter(): string;

    /**
     * @return list<array<string, mixed>>
     */
    abstract public function generatePseudoLegalMoves(Board $board, string $from): array;

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    final protected function createMove(string $from, string $to, array $extra = []): array
    {
        return $extra + [
            'from' => $from,
            'to' => $to,
            'piece' => $this->type(),
            'color' => $this->color,
            'promotion' => null,
            'isCapture' => false,
            'isEnPassant' => false,
            'isCastle' => false,
            'castleSide' => null,
        ];
    }

    /**
     * @param list<array{0: int, 1: int}> $directions
     * @return list<array<string, mixed>>
     */
    final protected function generateSlidingMoves(Board $board, string $from, array $directions): array
    {
        [$file, $rank] = Board::squareToCoords($from);
        $moves = [];

        foreach ($directions as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;

            while (Board::isInsideBoard($targetFile, $targetRank)) {
                $to = Board::coordsToSquare($targetFile, $targetRank);
                $occupant = $board->pieceAt($to);
                if ($occupant === null) {
                    $moves[] = $this->createMove($from, $to);
                } else {
                    if ($this->isOpponent($occupant)) {
                        $moves[] = $this->createMove($from, $to, ['isCapture' => true]);
                    }
                    break;
                }

                $targetFile += $fileDelta;
                $targetRank += $rankDelta;
            }
        }

        return $moves;
    }
}
