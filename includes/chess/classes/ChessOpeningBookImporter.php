<?php

declare(strict_types=1);

namespace Wowie\Api\Chess;

use PDO;
use RuntimeException;
use Throwable;

final class ChessOpeningBookImporter
{
    public function __construct(
        private PDO $pdo,
        private ChessEngine $engine = new ChessEngine(),
    ) {
    }

    /**
     * @return array{openings: int, positions: int, moves: int}
     */
    public function importTsv(string $path): array
    {
        $graph = $this->compileTsv($path);

        $this->pdo->beginTransaction();
        try {
            $openingIds = $this->storeOpenings($graph['openings']);
            $positionIds = $this->storePositions($graph['positions'], $openingIds);
            $this->storeMoves($graph['moves'], $positionIds);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        return [
            'openings' => count($graph['openings']),
            'positions' => count($graph['positions']),
            'moves' => count($graph['moves']),
        ];
    }

    /**
     * Compile and validate a TSV catalog without writing to PostgreSQL.
     *
     * @return array{
     *   openings: array<string, array{key: string, eco_code: string, name: string}>,
     *   positions: array<string, array{epd: string, opening_key: ?string, representative_pgn: ?string, representative_uci: ?string}>,
     *   moves: array<string, array{from_epd: string, uci: string, san: string, to_epd: string}>
     * }
     */
    public function compileTsv(string $path): array
    {
        $records = $this->loadTsv($path);
        $openings = [];
        $positions = [];
        $moves = [];

        $initialEpd = $this->canonicalEpd(Board::STARTING_FEN);
        $positions[$initialEpd] = $this->emptyPosition($initialEpd);

        foreach ($records as $recordIndex => $record) {
            $lineNumber = $recordIndex + 2;
            $ecoCode = trim($record['eco'] ?? '');
            $name = trim($record['name'] ?? '');
            $pgn = trim($record['pgn'] ?? '');

            if (!preg_match('/^[A-E][0-9]{2}(\/[0-9]{2})?$/', $ecoCode)) {
                throw new RuntimeException("Opening catalog line {$lineNumber} has an invalid ECO code.");
            }
            if ($name === '' || strlen($name) > 240) {
                throw new RuntimeException("Opening catalog line {$lineNumber} has an invalid name.");
            }

            $sanMoves = $this->parsePgnMoves($pgn, $lineNumber);
            $openingKey = $ecoCode . "\0" . $name;
            $openings[$openingKey] = [
                'key' => $openingKey,
                'eco_code' => $ecoCode,
                'name' => $name,
            ];

            $fen = Board::STARTING_FEN;
            $uciMoves = [];
            foreach ($sanMoves as $san) {
                $fromEpd = $this->canonicalEpd($fen);
                $positions[$fromEpd] ??= $this->emptyPosition($fromEpd);

                $legal = $this->engine->legalMoves($fen);
                if (($legal['ok'] ?? false) !== true || !is_array($legal['moves'] ?? null)) {
                    throw new RuntimeException("Could not generate legal moves for opening catalog line {$lineNumber}.");
                }

                $matches = array_values(array_filter(
                    $legal['moves'],
                    static fn (mixed $move): bool => is_array($move) && ($move['san'] ?? null) === $san,
                ));
                if (count($matches) !== 1) {
                    throw new RuntimeException(
                        "Opening catalog line {$lineNumber} has SAN move {$san} that is not uniquely legal after "
                        . ($uciMoves === [] ? 'the initial position' : implode(' ', $uciMoves))
                        . '.',
                    );
                }

                $uci = (string) $matches[0]['uci'];
                $applied = $this->engine->applyUciMove($fen, $uci);
                if (($applied['ok'] ?? false) !== true || !is_string($applied['fen'] ?? null)) {
                    throw new RuntimeException("Could not apply {$san} on opening catalog line {$lineNumber}.");
                }

                $toFen = $applied['fen'];
                $toEpd = $this->canonicalEpd($toFen);
                $positions[$toEpd] ??= $this->emptyPosition($toEpd);

                $moveKey = $fromEpd . "\0" . $uci;
                $edge = [
                    'from_epd' => $fromEpd,
                    'uci' => $uci,
                    'san' => $san,
                    'to_epd' => $toEpd,
                ];
                if (isset($moves[$moveKey]) && $moves[$moveKey] !== $edge) {
                    throw new RuntimeException("Opening catalog line {$lineNumber} conflicts with an existing {$uci} book edge.");
                }
                $moves[$moveKey] = $edge;

                $uciMoves[] = $uci;
                $fen = $toFen;
            }

            $terminalEpd = $this->canonicalEpd($fen);
            $existingOpeningKey = $positions[$terminalEpd]['opening_key'];
            if ($existingOpeningKey !== null && $existingOpeningKey !== $openingKey) {
                throw new RuntimeException(
                    "Opening catalog line {$lineNumber} classifies a position already assigned to a different opening.",
                );
            }

            $positions[$terminalEpd]['opening_key'] = $openingKey;
            $positions[$terminalEpd]['representative_pgn'] ??= $pgn;
            $positions[$terminalEpd]['representative_uci'] ??= implode(' ', $uciMoves);
        }

        return [
            'openings' => $openings,
            'positions' => $positions,
            'moves' => $moves,
        ];
    }

    public function canonicalEpd(string $fen): string
    {
        $board = Board::fromFen($fen);
        $parts = explode(' ', $board->toFen());
        if (count($parts) !== 6) {
            throw new RuntimeException('The chess engine returned an invalid FEN.');
        }

        $enPassant = $parts[3];
        if ($enPassant !== '-' && !$this->hasLegalEnPassantCapture($board, $enPassant)) {
            $enPassant = '-';
        }

        return implode(' ', [$parts[0], $parts[1], $parts[2], $enPassant]);
    }

    /**
     * @return list<array{eco: string, name: string, pgn: string}>
     */
    private function loadTsv(string $path): array
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException("Could not read opening catalog {$path}.");
        }

        try {
            $header = fgetcsv($handle, null, "\t", '"', '');
            if ($header !== ['eco', 'name', 'pgn']) {
                throw new RuntimeException('Opening catalog must have the TSV header: eco, name, pgn.');
            }

            $records = [];
            while (($columns = fgetcsv($handle, null, "\t", '"', '')) !== false) {
                if ($columns === [null] || $columns === []) {
                    continue;
                }
                if (count($columns) !== 3) {
                    throw new RuntimeException('Every opening catalog row must contain exactly three TSV columns.');
                }
                $records[] = [
                    'eco' => (string) $columns[0],
                    'name' => (string) $columns[1],
                    'pgn' => (string) $columns[2],
                ];
            }
        } finally {
            fclose($handle);
        }

        if ($records === []) {
            throw new RuntimeException('Opening catalog contains no records.');
        }

        return $records;
    }

    /** @return list<string> */
    private function parsePgnMoves(string $pgn, int $lineNumber): array
    {
        if ($pgn === '') {
            throw new RuntimeException("Opening catalog line {$lineNumber} has an empty PGN line.");
        }

        $moves = [];
        $tokens = preg_split('/\s+/', $pgn);
        if ($tokens === false) {
            throw new RuntimeException("Could not parse PGN on opening catalog line {$lineNumber}.");
        }

        foreach ($tokens as $token) {
            if (preg_match('/^[0-9]+\.(\.\.)?$/', $token)) {
                continue;
            }
            if (in_array($token, ['1-0', '0-1', '1/2-1/2', '*'], true)) {
                continue;
            }
            if (preg_match('/^[0-9]+\.(\.\.)?(.+)$/', $token, $match)) {
                $token = $match[2];
            }
            if ($token === '' || str_contains($token, '{') || str_contains($token, '(') || str_starts_with($token, '$')) {
                throw new RuntimeException("Opening catalog line {$lineNumber} must contain an unannotated main line.");
            }
            $moves[] = $token;
        }

        if ($moves === []) {
            throw new RuntimeException("Opening catalog line {$lineNumber} contains no moves.");
        }

        return $moves;
    }

    private function hasLegalEnPassantCapture(Board $board, string $target): bool
    {
        $legal = $this->engine->legalMoves($board);
        if (($legal['ok'] ?? false) !== true || !is_array($legal['moves'] ?? null)) {
            return false;
        }

        foreach ($legal['moves'] as $move) {
            if (!is_array($move) || ($move['to'] ?? null) !== $target) {
                continue;
            }
            $from = (string) ($move['from'] ?? '');
            $piece = $board->pieceAt($from);
            if ($piece instanceof Pawn && Board::fileOf($from) !== Board::fileOf($target)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{epd: string, opening_key: null, representative_pgn: null, representative_uci: null}
     */
    private function emptyPosition(string $epd): array
    {
        return [
            'epd' => $epd,
            'opening_key' => null,
            'representative_pgn' => null,
            'representative_uci' => null,
        ];
    }

    /**
     * @param array<string, array{key: string, eco_code: string, name: string}> $openings
     * @return array<string, int>
     */
    private function storeOpenings(array $openings): array
    {
        $insert = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_openings (eco_code, name)
            VALUES (:eco_code, :name)
            ON CONFLICT DO NOTHING
        SQL);
        $select = $this->pdo->prepare(<<<'SQL'
            SELECT id
            FROM chess_openings
            WHERE eco_code = :eco_code AND lower(name) = lower(:name)
        SQL);

        $ids = [];
        foreach ($openings as $opening) {
            $parameters = [
                'eco_code' => $opening['eco_code'],
                'name' => $opening['name'],
            ];
            $insert->execute($parameters);
            $select->execute($parameters);
            $id = $select->fetchColumn();
            if ($id === false) {
                throw new RuntimeException('Could not persist chess opening ' . $opening['name'] . '.');
            }
            $ids[$opening['key']] = (int) $id;
        }

        return $ids;
    }

    /**
     * @param array<string, array{epd: string, opening_key: ?string, representative_pgn: ?string, representative_uci: ?string}> $positions
     * @param array<string, int> $openingIds
     * @return array<string, int>
     */
    private function storePositions(array $positions, array $openingIds): array
    {
        $insert = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_opening_positions (epd, opening_id, representative_pgn, representative_uci)
            VALUES (:epd, :opening_id, :representative_pgn, :representative_uci)
            ON CONFLICT (epd) DO NOTHING
        SQL);
        $select = $this->pdo->prepare(<<<'SQL'
            SELECT id, opening_id
            FROM chess_opening_positions
            WHERE epd = :epd
        SQL);
        $classify = $this->pdo->prepare(<<<'SQL'
            UPDATE chess_opening_positions
            SET opening_id = :opening_id,
                representative_pgn = :representative_pgn,
                representative_uci = :representative_uci
            WHERE id = :id
        SQL);

        $ids = [];
        foreach ($positions as $position) {
            $openingId = $position['opening_key'] === null
                ? null
                : ($openingIds[$position['opening_key']] ?? throw new RuntimeException('Opening position references an unknown classification.'));
            $parameters = [
                'epd' => $position['epd'],
                'opening_id' => $openingId,
                'representative_pgn' => $position['representative_pgn'],
                'representative_uci' => $position['representative_uci'],
            ];
            $insert->execute($parameters);
            $select->execute(['epd' => $position['epd']]);
            $stored = $select->fetch(PDO::FETCH_ASSOC);
            if (!is_array($stored)) {
                throw new RuntimeException('Could not persist chess opening position.');
            }

            $storedOpeningId = $stored['opening_id'] === null ? null : (int) $stored['opening_id'];
            if ($openingId !== null && $storedOpeningId !== null && $storedOpeningId !== $openingId) {
                throw new RuntimeException('A chess opening position already has a different classification.');
            }
            if ($openingId !== null) {
                $classify->execute([
                    'id' => (int) $stored['id'],
                    'opening_id' => $openingId,
                    'representative_pgn' => $position['representative_pgn'],
                    'representative_uci' => $position['representative_uci'],
                ]);
            }
            $ids[$position['epd']] = (int) $stored['id'];
        }

        return $ids;
    }

    /**
     * @param array<string, array{from_epd: string, uci: string, san: string, to_epd: string}> $moves
     * @param array<string, int> $positionIds
     */
    private function storeMoves(array $moves, array $positionIds): void
    {
        $insert = $this->pdo->prepare(<<<'SQL'
            INSERT INTO chess_opening_moves (from_position_id, uci, san, to_position_id)
            VALUES (:from_position_id, :uci, :san, :to_position_id)
            ON CONFLICT (from_position_id, uci) DO NOTHING
        SQL);
        $select = $this->pdo->prepare(<<<'SQL'
            SELECT san, to_position_id
            FROM chess_opening_moves
            WHERE from_position_id = :from_position_id AND uci = :uci
        SQL);

        foreach ($moves as $move) {
            $parameters = [
                'from_position_id' => $positionIds[$move['from_epd']],
                'uci' => $move['uci'],
                'san' => $move['san'],
                'to_position_id' => $positionIds[$move['to_epd']],
            ];
            $insert->execute($parameters);
            $select->execute([
                'from_position_id' => $parameters['from_position_id'],
                'uci' => $parameters['uci'],
            ]);
            $stored = $select->fetch(PDO::FETCH_ASSOC);
            if (
                !is_array($stored)
                || $stored['san'] !== $move['san']
                || (int) $stored['to_position_id'] !== $parameters['to_position_id']
            ) {
                throw new RuntimeException('A chess opening move conflicts with an existing book edge.');
            }
        }
    }
}
