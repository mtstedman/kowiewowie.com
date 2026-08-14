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
     * @return array{eco_code: string, name: string}|null
     */
    public function query(array $uciMoves): ?array
    {
        $position = $this->initialPosition();
        if ($position === null) {
            return null;
        }

        $currentPositionId = (string) $position['id'];
        $opening = $this->openingFromPosition($position);
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
                return null;
            }

            $currentPositionId = (string) $nextPosition['id'];
            $nextOpening = $this->openingFromPosition($nextPosition);
            if ($nextOpening !== null) {
                $opening = $nextOpening;
            }
        }

        return $opening;
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
     * @return array{eco_code: string, name: string}|null
     */
    private function openingFromPosition(array $position): ?array
    {
        if ($position['eco_code'] === null || $position['name'] === null) {
            return null;
        }

        return [
            'eco_code' => (string) $position['eco_code'],
            'name' => (string) $position['name'],
        ];
    }
}
