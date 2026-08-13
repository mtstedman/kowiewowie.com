<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

final class ChessEngine
{
    /** @return array<string, mixed> */
    public function legalMoves(string|Board $position): array
    {
        try {
            $board = $this->coerceBoard($position);
            $moves = $this->decorateMovesWithSan($board);

            return [
                'ok' => true,
                'moves' => array_map(
                    static fn (array $move): array => [
                        'uci' => $move['uci'],
                        'san' => $move['san'],
                        'from' => $move['from'],
                        'to' => $move['to'],
                        'promotion' => $move['promotion'],
                    ],
                    $moves,
                ),
            ];
        } catch (\Throwable $error) {
            return ['ok' => false, 'error' => $error->getMessage()];
        }
    }

    /** @return array<string, mixed> */
    public function validateUciMove(string|Board $position, string $uci): array
    {
        try {
            $board = $this->coerceBoard($position);
            $parsedMove = $this->parseUci($uci);
            if ($parsedMove === null) {
                return ['ok' => false, 'error' => 'Moves must use UCI notation such as e2e4 or e7e8q.'];
            }

            $piece = $board->pieceAt($parsedMove['from']);
            if ($piece === null) {
                return ['ok' => false, 'error' => 'There is no piece on ' . $parsedMove['from'] . '.'];
            }

            if ($piece->color() !== $board->sideToMove()) {
                return ['ok' => false, 'error' => 'It is ' . $board->sideToMove() . ' to move.'];
            }

            $promotionError = $this->promotionError($piece, $parsedMove);
            if ($promotionError !== null) {
                return ['ok' => false, 'error' => $promotionError];
            }

            $moves = $this->decorateMovesWithSan($board);
            foreach ($moves as $move) {
                if ($move['uci'] === $parsedMove['uci']) {
                    return [
                        'ok' => true,
                        'move' => $move,
                    ];
                }
            }

            return ['ok' => false, 'error' => 'That move is not legal in the current position.'];
        } catch (\Throwable $error) {
            return ['ok' => false, 'error' => $error->getMessage()];
        }
    }

    /** @return array<string, mixed> */
    public function applyUciMove(string|Board $position, string $uci): array
    {
        $validation = $this->validateUciMove($position, $uci);
        if (($validation['ok'] ?? false) !== true) {
            return $validation;
        }

        /** @var array<string, mixed> $move */
        $move = $validation['move'];
        /** @var Board $afterBoard */
        $afterBoard = $move['afterBoard'];
        $state = $this->describeBoardState($afterBoard);

        return [
            'ok' => true,
            'uci' => $move['uci'],
            'san' => $move['san'],
            'fen' => $afterBoard->toFen(),
            'state' => $state,
        ];
    }

    /** @return array<string, mixed> */
    public function detectState(string|Board $position): array
    {
        try {
            $board = $this->coerceBoard($position);
            return ['ok' => true] + $this->describeBoardState($board);
        } catch (\Throwable $error) {
            return ['ok' => false, 'error' => $error->getMessage()];
        }
    }

    private function coerceBoard(string|Board $position): Board
    {
        return $position instanceof Board ? $position->copy() : Board::fromFen($position);
    }

    /** @return list<array<string, mixed>> */
    private function decorateMovesWithSan(Board $board): array
    {
        $moves = $this->collectLegalMoves($board);
        foreach ($moves as $index => $move) {
            $moves[$index]['san'] = $this->buildSan($board, $move, $moves);
        }

        return $moves;
    }

    /** @return list<array<string, mixed>> */
    private function collectLegalMoves(Board $board): array
    {
        $moves = [];
        $movingColor = $board->sideToMove();

        foreach ($board->pieces($movingColor) as $from => $piece) {
            foreach ($piece->generatePseudoLegalMoves($board, $from) as $candidate) {
                $afterBoard = $this->applyMove($board, $candidate);
                if ($afterBoard->isInCheck($movingColor)) {
                    continue;
                }

                $candidate['uci'] = $this->moveToUci($candidate);
                $candidate['afterBoard'] = $afterBoard;
                $moves[] = $candidate;
            }
        }

        return $moves;
    }

    private function hasAnyLegalMove(Board $board): bool
    {
        $movingColor = $board->sideToMove();
        foreach ($board->pieces($movingColor) as $from => $piece) {
            foreach ($piece->generatePseudoLegalMoves($board, $from) as $candidate) {
                $afterBoard = $this->applyMove($board, $candidate);
                if (!$afterBoard->isInCheck($movingColor)) {
                    return true;
                }
            }
        }

        return false;
    }

    /** @param array<string, mixed> $move @return array<string, mixed> */
    private function describeBoardState(Board $board): array
    {
        $legalMoves = $this->collectLegalMoves($board);
        $inCheck = $board->isInCheck($board->sideToMove());
        $status = 'ongoing';
        $result = '*';
        $drawReason = null;

        if ($legalMoves === []) {
            if ($inCheck) {
                $status = 'checkmate';
                $result = $board->sideToMove() === Board::WHITE ? '0-1' : '1-0';
            } else {
                $status = 'stalemate';
                $result = '1/2-1/2';
            }
        } elseif ($board->halfmoveClock() >= 100) {
            $status = 'draw';
            $result = '1/2-1/2';
            $drawReason = 'fifty-move-rule';
        } elseif ($this->isInsufficientMaterial($board)) {
            $status = 'draw';
            $result = '1/2-1/2';
            $drawReason = 'insufficient-material';
        }

        return [
            'status' => $status,
            'result' => $result,
            'in_check' => $inCheck,
            'legal_move_count' => count($legalMoves),
            'draw_reason' => $drawReason,
        ];
    }

    /**
     * @param array<string, mixed> $move
     * @param list<array<string, mixed>> $legalMoves
     */
    private function buildSan(Board $beforeBoard, array $move, array $legalMoves): string
    {
        /** @var Piece $piece */
        $piece = $beforeBoard->pieceAt($move['from']);
        /** @var Board $afterBoard */
        $afterBoard = $move['afterBoard'];

        if ($move['isCastle']) {
            $san = $move['castleSide'] === 'queen' ? 'O-O-O' : 'O-O';
        } else {
            $captureMarker = $move['isCapture'] ? 'x' : '';
            if ($piece instanceof Pawn) {
                $san = ($move['isCapture'] ? Board::fileOf($move['from']) : '') . $captureMarker . $move['to'];
            } else {
                $san = $piece->sanLetter()
                    . $this->buildDisambiguation($move, $legalMoves)
                    . $captureMarker
                    . $move['to'];
            }

            if ($move['promotion'] !== null) {
                $san .= '=' . strtoupper((string) $move['promotion']);
            }
        }

        $opponentInCheck = $afterBoard->isInCheck($afterBoard->sideToMove());
        if ($opponentInCheck) {
            $san .= $this->hasAnyLegalMove($afterBoard) ? '+' : '#';
        }

        return $san;
    }

    /**
     * @param array<string, mixed> $move
     * @param list<array<string, mixed>> $legalMoves
     */
    private function buildDisambiguation(array $move, array $legalMoves): string
    {
        $alternatives = [];
        foreach ($legalMoves as $candidate) {
            if ($candidate['to'] !== $move['to']) {
                continue;
            }
            if ($candidate['piece'] !== $move['piece'] || $candidate['from'] === $move['from']) {
                continue;
            }
            $alternatives[] = $candidate;
        }

        if ($alternatives === []) {
            return '';
        }

        $sameFile = false;
        $sameRank = false;
        foreach ($alternatives as $candidate) {
            if (Board::fileOf($candidate['from']) === Board::fileOf($move['from'])) {
                $sameFile = true;
            }
            if (Board::rankOf($candidate['from']) === Board::rankOf($move['from'])) {
                $sameRank = true;
            }
        }

        if (!$sameFile) {
            return Board::fileOf($move['from']);
        }
        if (!$sameRank) {
            return Board::rankOf($move['from']);
        }

        return $move['from'];
    }

    /** @param array<string, mixed> $move */
    private function applyMove(Board $board, array $move): Board
    {
        $piece = $board->pieceAt($move['from']);
        if (!$piece instanceof Piece) {
            throw new \LogicException('Cannot apply a move from an empty square.');
        }

        $nextBoard = $board->copy();
        $nextBoard->setEnPassantTarget(null);

        $capturedSquare = $move['to'];
        if ($move['isEnPassant']) {
            $capturedSquare = Board::fileOf($move['to']) . Board::rankOf($move['from']);
        }

        $capturedPiece = $board->pieceAt($capturedSquare);
        if ($move['isEnPassant'] && (!$capturedPiece instanceof Pawn || !$piece->isOpponent($capturedPiece))) {
            throw new \LogicException('Cannot apply an en-passant move without an opposing pawn to capture.');
        }
        if ($capturedPiece instanceof Rook) {
            $nextBoard->clearCastlingRightForRookSquare($capturedSquare);
        }

        $nextBoard->removePiece($move['from']);
        if ($capturedPiece !== null) {
            $nextBoard->removePiece($capturedSquare);
        }

        if ($piece instanceof King) {
            $nextBoard->disableCastlingRightsForColor($piece->color());
        }
        if ($piece instanceof Rook) {
            $nextBoard->clearCastlingRightForRookSquare($move['from']);
        }

        if ($move['isCastle']) {
            $this->moveCastlingRook($nextBoard, $piece->color(), (string) $move['castleSide']);
        }

        $placedPiece = $piece;
        if ($move['promotion'] !== null) {
            $placedPiece = $this->createPromotionPiece((string) $move['promotion'], $piece->color());
        }
        $nextBoard->setPiece($move['to'], $placedPiece);
        $nextBoard->setSideToMove(Board::otherColor($piece->color()));

        if ($piece instanceof Pawn) {
            [$fromFile, $fromRank] = Board::squareToCoords($move['from']);
            [, $toRank] = Board::squareToCoords($move['to']);
            if (abs($toRank - $fromRank) === 2) {
                $nextBoard->setEnPassantTarget(Board::coordsToSquare($fromFile, (int) (($fromRank + $toRank) / 2)));
            }
            $nextBoard->setHalfmoveClock(0);
        } elseif ($capturedPiece !== null) {
            $nextBoard->setHalfmoveClock(0);
        } else {
            $nextBoard->setHalfmoveClock($board->halfmoveClock() + 1);
        }

        if ($piece->color() === Board::BLACK) {
            $nextBoard->setFullmoveNumber($board->fullmoveNumber() + 1);
        }

        return $nextBoard;
    }

    private function moveCastlingRook(Board $board, string $color, string $castleSide): void
    {
        if ($color === Board::WHITE) {
            $from = $castleSide === 'queen' ? 'a1' : 'h1';
            $to = $castleSide === 'queen' ? 'd1' : 'f1';
        } else {
            $from = $castleSide === 'queen' ? 'a8' : 'h8';
            $to = $castleSide === 'queen' ? 'd8' : 'f8';
        }

        $rook = $board->pieceAt($from);
        if (!$rook instanceof Rook) {
            throw new \LogicException('Castling requires the corresponding rook.');
        }

        $board->removePiece($from);
        $board->setPiece($to, $rook);
    }

    /** @return array{from: string, to: string, promotion: ?string, uci: string}|null */
    private function parseUci(string $uci): ?array
    {
        if (!preg_match('/^([a-h][1-8])([a-h][1-8])([qrbn])?$/', strtolower(trim($uci)), $matches)) {
            return null;
        }

        $promotion = ($matches[3] ?? '') !== '' ? $matches[3] : null;

        return [
            'from' => $matches[1],
            'to' => $matches[2],
            'promotion' => $promotion,
            'uci' => $matches[1] . $matches[2] . ($promotion ?? ''),
        ];
    }

    private function promotionError(Piece $piece, array $parsedMove): ?string
    {
        $targetRank = Board::rankOf($parsedMove['to']);
        $reachesPromotionRank = $piece instanceof Pawn && (
            ($piece->color() === Board::WHITE && $targetRank === '8')
            || ($piece->color() === Board::BLACK && $targetRank === '1')
        );

        if ($piece instanceof Pawn && $reachesPromotionRank && $parsedMove['promotion'] === null) {
            return 'Pawn promotions must specify q, r, b, or n in the UCI move.';
        }
        if ($piece instanceof Pawn && !$reachesPromotionRank && $parsedMove['promotion'] !== null) {
            return 'Promotion pieces are only allowed when a pawn reaches the last rank.';
        }
        if (!($piece instanceof Pawn) && $parsedMove['promotion'] !== null) {
            return 'Only pawns can promote.';
        }

        return null;
    }

    private function createPromotionPiece(string $promotion, string $color): Piece
    {
        return match ($promotion) {
            'q' => new Queen($color),
            'r' => new Rook($color),
            'b' => new Bishop($color),
            'n' => new Knight($color),
            default => throw new \InvalidArgumentException('Promotion piece must be one of q, r, b, or n.'),
        };
    }

    /** @param array<string, mixed> $move */
    private function moveToUci(array $move): string
    {
        return $move['from'] . $move['to'] . ($move['promotion'] ?? '');
    }

    private function isInsufficientMaterial(Board $board): bool
    {
        $bishops = [];
        $knights = 0;

        foreach ($board->pieces() as $square => $piece) {
            if ($piece instanceof King) {
                continue;
            }
            if ($piece instanceof Pawn || $piece instanceof Rook || $piece instanceof Queen) {
                return false;
            }
            if ($piece instanceof Knight) {
                $knights++;
                continue;
            }
            if ($piece instanceof Bishop) {
                $bishops[] = $square;
            }
        }

        if ($bishops === [] && $knights === 0) {
            return true;
        }
        if ($bishops === [] && $knights <= 2) {
            return true;
        }
        if (count($bishops) === 1 && $knights === 0) {
            return true;
        }
        if ($knights > 0) {
            return false;
        }

        $colors = [];
        foreach ($bishops as $square) {
            [$file, $rank] = Board::squareToCoords($square);
            $colors[] = ($file + $rank) % 2;
        }

        return count(array_unique($colors)) === 1;
    }
}
