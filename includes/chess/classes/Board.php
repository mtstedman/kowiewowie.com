<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class Board
{
    public const WHITE = 'white';
    public const BLACK = 'black';
    public const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    public const STANDARD_STARTING_FEN = self::STARTING_FEN;

    /** @var array<string, Piece> */
    private array $squares;

    /** @var array<string, bool> */
    private array $castlingRights;

    /**
     * @param array<string, Piece> $squares
     * @param array<string, bool> $castlingRights
     */
    public function __construct(
        array $squares = [],
        private string $sideToMove = self::WHITE,
        array $castlingRights = ['K' => false, 'Q' => false, 'k' => false, 'q' => false],
        private ?string $enPassantTarget = null,
        private int $halfmoveClock = 0,
        private int $fullmoveNumber = 1,
    ) {
        self::assertColor($this->sideToMove);
        if ($this->enPassantTarget !== null) {
            self::assertEnPassantSquare($this->enPassantTarget);
        }
        if ($this->halfmoveClock < 0) {
            throw new \InvalidArgumentException('Halfmove clock must be zero or greater.');
        }
        if ($this->fullmoveNumber < 1) {
            throw new \InvalidArgumentException('Fullmove number must be one or greater.');
        }

        $this->castlingRights = ['K' => false, 'Q' => false, 'k' => false, 'q' => false];
        foreach ($castlingRights as $right => $allowed) {
            $this->setCastleRight($right, (bool) $allowed);
        }

        $this->squares = [];
        foreach ($squares as $square => $piece) {
            self::assertSquare($square);
            if (!$piece instanceof Piece) {
                throw new \InvalidArgumentException('Board squares must contain Piece instances.');
            }
            $this->squares[$square] = $piece;
        }
    }

    public static function fromFen(string $fen): self
    {
        $parts = preg_split('/\s+/', trim($fen));
        if ($parts === false || count($parts) !== 6) {
            throw new \InvalidArgumentException('FEN must contain six space-delimited fields.');
        }

        [$placement, $activeColor, $castling, $enPassant, $halfmove, $fullmove] = $parts;
        $ranks = explode('/', $placement);
        if (count($ranks) !== 8) {
            throw new \InvalidArgumentException('FEN placement must contain eight ranks.');
        }

        $squares = [];
        $whiteKings = 0;
        $blackKings = 0;

        foreach ($ranks as $rankOffset => $rankDefinition) {
            $file = 0;
            $rank = 7 - $rankOffset;
            $characters = str_split($rankDefinition);
            foreach ($characters as $character) {
                if (ctype_digit($character)) {
                    $file += (int) $character;
                    continue;
                }

                if (!self::isInsideBoard($file, $rank)) {
                    throw new \InvalidArgumentException('FEN placement extends beyond the board.');
                }

                $piece = self::createPieceFromFenSymbol($character);
                if ($piece instanceof Pawn && ($rank === 0 || $rank === 7)) {
                    throw new \InvalidArgumentException('Pawns cannot be placed on the first or eighth rank.');
                }

                if ($piece instanceof King) {
                    if ($piece->color() === self::WHITE) {
                        $whiteKings++;
                    } else {
                        $blackKings++;
                    }
                }

                $squares[self::coordsToSquare($file, $rank)] = $piece;
                $file++;
            }

            if ($file !== 8) {
                throw new \InvalidArgumentException('Each FEN rank must describe exactly eight files.');
            }
        }

        if ($whiteKings !== 1 || $blackKings !== 1) {
            throw new \InvalidArgumentException('FEN must contain exactly one white king and one black king.');
        }

        $sideToMove = match ($activeColor) {
            'w' => self::WHITE,
            'b' => self::BLACK,
            default => throw new \InvalidArgumentException('FEN active color must be w or b.'),
        };

        $castlingRights = ['K' => false, 'Q' => false, 'k' => false, 'q' => false];
        if ($castling !== '-') {
            $seen = [];
            foreach (str_split($castling) as $right) {
                if (!array_key_exists($right, $castlingRights) || isset($seen[$right])) {
                    throw new \InvalidArgumentException('FEN castling rights must be a unique subset of KQkq.');
                }
                $castlingRights[$right] = true;
                $seen[$right] = true;
            }
        }

        $enPassantTarget = null;
        if ($enPassant !== '-') {
            self::assertEnPassantSquare($enPassant);
            $enPassantTarget = $enPassant;
        }

        if (!ctype_digit($halfmove)) {
            throw new \InvalidArgumentException('FEN halfmove clock must be numeric.');
        }
        if (!ctype_digit($fullmove) || $fullmove === '0') {
            throw new \InvalidArgumentException('FEN fullmove number must be a positive integer.');
        }

        return new self(
            $squares,
            $sideToMove,
            $castlingRights,
            $enPassantTarget,
            (int) $halfmove,
            (int) $fullmove,
        );
    }

    public function copy(): self
    {
        return new self(
            $this->squares,
            $this->sideToMove,
            $this->castlingRights,
            $this->enPassantTarget,
            $this->halfmoveClock,
            $this->fullmoveNumber,
        );
    }

    public function toFen(): string
    {
        $ranks = [];
        for ($rank = 7; $rank >= 0; $rank--) {
            $empty = 0;
            $buffer = '';
            for ($file = 0; $file < 8; $file++) {
                $piece = $this->pieceAt(self::coordsToSquare($file, $rank));
                if ($piece === null) {
                    $empty++;
                    continue;
                }

                if ($empty > 0) {
                    $buffer .= (string) $empty;
                    $empty = 0;
                }

                $buffer .= $piece->fenSymbol();
            }

            if ($empty > 0) {
                $buffer .= (string) $empty;
            }

            $ranks[] = $buffer;
        }

        return implode('/', $ranks)
            . ' '
            . ($this->sideToMove === self::WHITE ? 'w' : 'b')
            . ' '
            . $this->castlingRightsString()
            . ' '
            . ($this->enPassantTarget ?? '-')
            . ' '
            . $this->halfmoveClock
            . ' '
            . $this->fullmoveNumber;
    }

    public function sideToMove(): string
    {
        return $this->sideToMove;
    }

    public function setSideToMove(string $color): void
    {
        self::assertColor($color);
        $this->sideToMove = $color;
    }

    public function enPassantTarget(): ?string
    {
        return $this->enPassantTarget;
    }

    public function setEnPassantTarget(?string $square): void
    {
        if ($square !== null) {
            self::assertEnPassantSquare($square);
        }
        $this->enPassantTarget = $square;
    }

    public function halfmoveClock(): int
    {
        return $this->halfmoveClock;
    }

    public function setHalfmoveClock(int $halfmoveClock): void
    {
        if ($halfmoveClock < 0) {
            throw new \InvalidArgumentException('Halfmove clock must be zero or greater.');
        }
        $this->halfmoveClock = $halfmoveClock;
    }

    public function fullmoveNumber(): int
    {
        return $this->fullmoveNumber;
    }

    public function setFullmoveNumber(int $fullmoveNumber): void
    {
        if ($fullmoveNumber < 1) {
            throw new \InvalidArgumentException('Fullmove number must be one or greater.');
        }
        $this->fullmoveNumber = $fullmoveNumber;
    }

    public function pieceAt(string $square): ?Piece
    {
        self::assertSquare($square);

        return $this->squares[$square] ?? null;
    }

    public function setPiece(string $square, ?Piece $piece): void
    {
        self::assertSquare($square);
        if ($piece === null) {
            unset($this->squares[$square]);
            return;
        }

        $this->squares[$square] = $piece;
    }

    public function removePiece(string $square): void
    {
        self::assertSquare($square);
        unset($this->squares[$square]);
    }

    /** @return array<string, Piece> */
    public function pieces(?string $color = null): array
    {
        if ($color === null) {
            return $this->squares;
        }

        self::assertColor($color);
        return array_filter(
            $this->squares,
            static fn (Piece $piece): bool => $piece->color() === $color,
        );
    }

    public function canCastle(string $right): bool
    {
        if (!array_key_exists($right, $this->castlingRights)) {
            throw new \InvalidArgumentException('Unknown castling right: ' . $right);
        }

        return $this->castlingRights[$right];
    }

    public function setCastleRight(string $right, bool $allowed): void
    {
        if (!array_key_exists($right, $this->castlingRights)) {
            throw new \InvalidArgumentException('Unknown castling right: ' . $right);
        }

        $this->castlingRights[$right] = $allowed;
    }

    public function disableCastlingRightsForColor(string $color): void
    {
        self::assertColor($color);
        if ($color === self::WHITE) {
            $this->castlingRights['K'] = false;
            $this->castlingRights['Q'] = false;
            return;
        }

        $this->castlingRights['k'] = false;
        $this->castlingRights['q'] = false;
    }

    public function clearCastlingRightForRookSquare(string $square): void
    {
        match ($square) {
            'a1' => $this->castlingRights['Q'] = false,
            'h1' => $this->castlingRights['K'] = false,
            'a8' => $this->castlingRights['q'] = false,
            'h8' => $this->castlingRights['k'] = false,
            default => null,
        };
    }

    public function castlingRightsString(): string
    {
        $rights = '';
        foreach (['K', 'Q', 'k', 'q'] as $right) {
            if ($this->castlingRights[$right]) {
                $rights .= $right;
            }
        }

        return $rights === '' ? '-' : $rights;
    }

    public function findKing(string $color): ?string
    {
        self::assertColor($color);
        foreach ($this->squares as $square => $piece) {
            if ($piece instanceof King && $piece->color() === $color) {
                return $square;
            }
        }

        return null;
    }

    public function isInCheck(string $color): bool
    {
        $kingSquare = $this->findKing($color);
        if ($kingSquare === null) {
            throw new \LogicException('Cannot evaluate check without a king on the board.');
        }

        return $this->isSquareAttacked($kingSquare, self::otherColor($color));
    }

    public function isSquareAttacked(string $square, string $byColor): bool
    {
        self::assertSquare($square);
        self::assertColor($byColor);
        [$file, $rank] = self::squareToCoords($square);

        $pawnRank = $rank + ($byColor === self::WHITE ? -1 : 1);
        foreach ([-1, 1] as $fileDelta) {
            $pawnFile = $file + $fileDelta;
            if (!self::isInsideBoard($pawnFile, $pawnRank)) {
                continue;
            }

            $piece = $this->pieceAt(self::coordsToSquare($pawnFile, $pawnRank));
            if ($piece instanceof Pawn && $piece->color() === $byColor) {
                return true;
            }
        }

        foreach ([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            if (!self::isInsideBoard($targetFile, $targetRank)) {
                continue;
            }

            $piece = $this->pieceAt(self::coordsToSquare($targetFile, $targetRank));
            if ($piece instanceof Knight && $piece->color() === $byColor) {
                return true;
            }
        }

        foreach ([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as [$fileDelta, $rankDelta]) {
            $targetFile = $file + $fileDelta;
            $targetRank = $rank + $rankDelta;
            if (!self::isInsideBoard($targetFile, $targetRank)) {
                continue;
            }

            $piece = $this->pieceAt(self::coordsToSquare($targetFile, $targetRank));
            if ($piece instanceof King && $piece->color() === $byColor) {
                return true;
            }
        }

        foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$fileDelta, $rankDelta]) {
            if ($this->rayAttacks($file, $rank, $fileDelta, $rankDelta, $byColor, [Rook::class, Queen::class])) {
                return true;
            }
        }

        foreach ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as [$fileDelta, $rankDelta]) {
            if ($this->rayAttacks($file, $rank, $fileDelta, $rankDelta, $byColor, [Bishop::class, Queen::class])) {
                return true;
            }
        }

        return false;
    }

    public static function otherColor(string $color): string
    {
        self::assertColor($color);

        return $color === self::WHITE ? self::BLACK : self::WHITE;
    }

    public static function isInsideBoard(int $file, int $rank): bool
    {
        return $file >= 0 && $file < 8 && $rank >= 0 && $rank < 8;
    }

    /** @return array{0: int, 1: int} */
    public static function squareToCoords(string $square): array
    {
        self::assertSquare($square);

        return [ord($square[0]) - ord('a'), ((int) $square[1]) - 1];
    }

    public static function coordsToSquare(int $file, int $rank): string
    {
        if (!self::isInsideBoard($file, $rank)) {
            throw new \InvalidArgumentException('Board coordinates must be within 0-7.');
        }

        return chr(ord('a') + $file) . (string) ($rank + 1);
    }

    public static function fileOf(string $square): string
    {
        self::assertSquare($square);

        return $square[0];
    }

    public static function rankOf(string $square): string
    {
        self::assertSquare($square);

        return $square[1];
    }

    private static function createPieceFromFenSymbol(string $symbol): Piece
    {
        $color = ctype_upper($symbol) ? self::WHITE : self::BLACK;

        return match (strtolower($symbol)) {
            'p' => new Pawn($color),
            'n' => new Knight($color),
            'b' => new Bishop($color),
            'r' => new Rook($color),
            'q' => new Queen($color),
            'k' => new King($color),
            default => throw new \InvalidArgumentException('Unknown FEN piece symbol: ' . $symbol),
        };
    }

    /** @param list<class-string<Piece>> $attackers */
    private function rayAttacks(int $file, int $rank, int $fileDelta, int $rankDelta, string $byColor, array $attackers): bool
    {
        $targetFile = $file + $fileDelta;
        $targetRank = $rank + $rankDelta;
        while (self::isInsideBoard($targetFile, $targetRank)) {
            $piece = $this->pieceAt(self::coordsToSquare($targetFile, $targetRank));
            if ($piece === null) {
                $targetFile += $fileDelta;
                $targetRank += $rankDelta;
                continue;
            }

            if ($piece->color() !== $byColor) {
                return false;
            }

            foreach ($attackers as $attacker) {
                if ($piece instanceof $attacker) {
                    return true;
                }
            }

            return false;
        }

        return false;
    }

    private static function assertColor(string $color): void
    {
        if (!in_array($color, [self::WHITE, self::BLACK], true)) {
            throw new \InvalidArgumentException('Color must be white or black.');
        }
    }

    private static function assertSquare(string $square): void
    {
        if (!preg_match('/^[a-h][1-8]$/', $square)) {
            throw new \InvalidArgumentException('Invalid square: ' . $square);
        }
    }

    private static function assertEnPassantSquare(string $square): void
    {
        if (!preg_match('/^[a-h][36]$/', $square)) {
            throw new \InvalidArgumentException('En-passant target must be on rank 3 or 6.');
        }
    }
}
