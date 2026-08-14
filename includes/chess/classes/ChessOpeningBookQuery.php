<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

use PDO;

final class ChessOpeningBookQuery
{
    private const INITIAL_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

    public function __construct(
        private readonly PDO $pdo,
    ) {
    }

    /**
     * @param list<string> $uciMoves
     * @return array{on_book: bool, eco_code: string|null, name: string|null}
     */
    public function query(array $uciMoves): array
    {
        $position = $this->initialPosition();
        if ($position === null) {
            return $this->offBookResponse();
        }

        $currentPositionId = (string) $position['id'];
        $currentOpening = $this->openingFromPosition($position);
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT
                next_position.id,
                opening.eco_code,
                opening.name
            FROM chess_opening_moves book_move
            JOIN chess_opening_positions next_position
              ON next_position.id = book_move.to_position_id
            LEFT JOIN chess_openings opening
              ON opening.id = next_position.opening_id
            WHERE book_move.from_position_id = :from_position_id
              AND book_move.uci = :uci
            LIMIT 1
        SQL);

        foreach ($uciMoves as $uci) {
            $statement->execute([
                'from_position_id' => $currentPositionId,
                'uci' => strtolower(trim($uci)),
            ]);
            $nextPosition = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($nextPosition)) {
                return $this->offBookResponse();
            }

            $currentPositionId = (string) $nextPosition['id'];
            $nextOpening = $this->openingFromPosition($nextPosition);
            if ($nextOpening['eco_code'] !== null || $nextOpening['name'] !== null) {
                $currentOpening = $nextOpening;
            }
        }

        return [
            'on_book' => true,
            'eco_code' => $currentOpening['eco_code'],
            'name' => $currentOpening['name'],
        ];
    }

    /** @return array{id: mixed, eco_code: mixed, name: mixed}|null */
    private function initialPosition(): ?array
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT
                initial_position.id,
                opening.eco_code,
                opening.name
            FROM chess_opening_positions initial_position
            LEFT JOIN chess_openings opening
              ON opening.id = initial_position.opening_id
            WHERE initial_position.epd = :epd
            LIMIT 1
        SQL);
        $statement->execute(['epd' => self::INITIAL_EPD]);
        $position = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($position) ? $position : null;
    }

    /**
     * @param array{id: mixed, eco_code: mixed, name: mixed} $position
     * @return array{eco_code: string|null, name: string|null}
     */
    private function openingFromPosition(array $position): array
    {
        return [
            'eco_code' => $position['eco_code'] === null ? null : (string) $position['eco_code'],
            'name' => $position['name'] === null ? null : (string) $position['name'],
        ];
    }

    /** @return array{on_book: false, eco_code: null, name: null} */
    private function offBookResponse(): array
    {
        return [
            'on_book' => false,
            'eco_code' => null,
            'name' => null,
        ];
    }
}
