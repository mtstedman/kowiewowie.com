#!/usr/bin/env php
<?php

declare(strict_types=1);

use Wowie\Api\Chess\Board;
use Wowie\Api\Chess\ChessEngine;
use Wowie\Api\Chess\ChessRepository;

require __DIR__ . '/../api/bootstrap.php';

final class CountingPdo extends PDO
{
    private int $statementCount = 0;

    public function __construct(string $dsn, ?string $username = null, ?string $password = null, ?array $options = null)
    {
        parent::__construct($dsn, $username, $password, $options ?? []);
        $this->setAttribute(PDO::ATTR_STATEMENT_CLASS, [CountingPdoStatement::class, [$this]]);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->recordStatement();

        return parent::prepare($query, $options);
    }

    public function recordStatement(): void
    {
        ++$this->statementCount;
    }

    public function resetStatementCount(): void
    {
        $this->statementCount = 0;
    }

    public function statementCount(): int
    {
        return $this->statementCount;
    }
}

final class CountingPdoStatement extends PDOStatement
{
    protected function __construct(private readonly CountingPdo $pdo)
    {
    }

    public function execute(?array $params = null): bool
    {
        $this->pdo->recordStatement();

        return parent::execute($params);
    }
}

function assertRepositoryQueryCountSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException("{$message}: expected " . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function assertRepositoryQueryCountTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @param list<list<string>> $moveHistories */
function createRepositoryQueryCountFixture(array $moveHistories): CountingPdo
{
    $pdo = new CountingPdo('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    createRepositoryQueryCountSchema($pdo);
    seedRepositoryOpeningBook($pdo);

    foreach ($moveHistories as $index => $moves) {
        seedRepositoryGame(
            $pdo,
            'game-' . ($index + 1),
            'public-game-' . ($index + 1),
            'guest-owner',
            $moves,
            sprintf('2026-01-01T00:%02d:00+00:00', $index),
        );
    }

    return $pdo;
}

function createRepositoryQueryCountSchema(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_games (
            id TEXT PRIMARY KEY,
            public_id TEXT NOT NULL,
            variant TEXT NOT NULL,
            status TEXT NOT NULL,
            current_ply INTEGER NOT NULL,
            result TEXT NOT NULL,
            termination TEXT NULL,
            started_at TEXT NULL,
            finished_at TEXT NULL,
            last_activity_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            pending_takeback_by_player_id TEXT NULL,
            pending_takeback_requested_at TEXT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_game_positions (
            game_id TEXT NOT NULL,
            ply INTEGER NOT NULL,
            fen TEXT NOT NULL,
            side_to_move TEXT NOT NULL,
            PRIMARY KEY (game_id, ply)
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_game_players (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            color TEXT NOT NULL,
            user_id TEXT NULL,
            guest_profile_id TEXT NULL,
            display_name TEXT NOT NULL,
            joined_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_game_moves (
            game_id TEXT NOT NULL,
            ply INTEGER NOT NULL,
            uci TEXT NOT NULL,
            PRIMARY KEY (game_id, ply)
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_openings (
            id TEXT PRIMARY KEY,
            eco_code TEXT NOT NULL,
            name TEXT NOT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_opening_positions (
            id TEXT PRIMARY KEY,
            epd TEXT NOT NULL UNIQUE,
            opening_id TEXT NULL,
            representative_pgn TEXT NULL,
            representative_uci TEXT NULL
        )
    SQL);
    $pdo->exec(<<<'SQL'
        CREATE TABLE chess_opening_moves (
            id TEXT PRIMARY KEY,
            from_position_id TEXT NOT NULL,
            to_position_id TEXT NOT NULL,
            uci TEXT NOT NULL,
            san TEXT NULL
        )
    SQL);
}

function seedRepositoryOpeningBook(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        INSERT INTO chess_openings (id, eco_code, name) VALUES
            ('open-kp', 'B00', 'King''s Pawn Game')
    SQL);
    $pdo->exec(<<<'SQL'
        INSERT INTO chess_opening_positions (id, epd, opening_id, representative_pgn, representative_uci) VALUES
            ('start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', NULL, NULL, NULL),
            ('after-e4', 'fixture after e2e4', NULL, '1. e4', 'e2e4'),
            ('after-e4-e5', 'fixture after e2e4 e7e5', 'open-kp', '1. e4 e5', 'e7e5'),
            ('after-e4-e5-nf3', 'fixture after e2e4 e7e5 g1f3', NULL, '1. e4 e5 2. Nf3', 'g1f3')
    SQL);
    $pdo->exec(<<<'SQL'
        INSERT INTO chess_opening_moves (id, from_position_id, to_position_id, uci, san) VALUES
            ('move-e4', 'start', 'after-e4', 'e2e4', 'e4'),
            ('move-e5', 'after-e4', 'after-e4-e5', 'e7e5', 'e5'),
            ('move-nf3', 'after-e4-e5', 'after-e4-e5-nf3', 'g1f3', 'Nf3')
    SQL);
}

/** @param list<string> $moves */
function seedRepositoryGame(PDO $pdo, string $gameId, string $publicId, string $guestProfileId, array $moves, string $lastActivityAt): void
{
    $currentPly = count($moves);
    $createdAt = '2026-01-01T00:00:00+00:00';

    $game = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_games (
            id, public_id, variant, status, current_ply, result, termination, started_at, finished_at,
            last_activity_at, created_at, updated_at, pending_takeback_by_player_id, pending_takeback_requested_at
        ) VALUES (
            :id, :public_id, 'standard', 'active', :current_ply, '*', NULL, :created_at, NULL,
            :last_activity_at, :created_at, :last_activity_at, NULL, NULL
        )
    SQL);
    $game->execute([
        'id' => $gameId,
        'public_id' => $publicId,
        'current_ply' => $currentPly,
        'created_at' => $createdAt,
        'last_activity_at' => $lastActivityAt,
    ]);

    $position = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_game_positions (game_id, ply, fen, side_to_move)
        VALUES (:game_id, :ply, :fen, 'w')
    SQL);
    $position->execute([
        'game_id' => $gameId,
        'ply' => $currentPly,
        'fen' => Board::STARTING_FEN,
    ]);

    $player = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_game_players (id, game_id, color, user_id, guest_profile_id, display_name, joined_at, last_seen_at)
        VALUES (:id, :game_id, :color, :user_id, :guest_profile_id, :display_name, :joined_at, :last_seen_at)
    SQL);
    $player->execute([
        'id' => $gameId . '-white',
        'game_id' => $gameId,
        'color' => 'white',
        'user_id' => null,
        'guest_profile_id' => $guestProfileId,
        'display_name' => 'Query Counter',
        'joined_at' => $createdAt,
        'last_seen_at' => $lastActivityAt,
    ]);
    $player->execute([
        'id' => $gameId . '-black',
        'game_id' => $gameId,
        'color' => 'black',
        'user_id' => null,
        'guest_profile_id' => null,
        'display_name' => 'Open Seat',
        'joined_at' => $createdAt,
        'last_seen_at' => $lastActivityAt,
    ]);

    $move = $pdo->prepare(<<<'SQL'
        INSERT INTO chess_game_moves (game_id, ply, uci)
        VALUES (:game_id, :ply, :uci)
    SQL);
    foreach ($moves as $index => $uci) {
        $move->execute([
            'game_id' => $gameId,
            'ply' => $index + 1,
            'uci' => $uci,
        ]);
    }
}

/**
 * @param array<string, mixed> $identity
 * @return array{games: list<array<string, mixed>>, statement_count: int}
 */
function listRepositoryGamesAndCountStatements(CountingPdo $pdo, array $identity): array
{
    $repository = new ChessRepository($pdo, new ChessEngine());

    $pdo->resetStatementCount();
    $games = $repository->listGamesForIdentity($identity);

    return [
        'games' => $games,
        'statement_count' => $pdo->statementCount(),
    ];
}

$identity = [
    'guest_profile' => [
        'id' => 'guest-owner',
        'display_name' => 'Query Counter',
    ],
];

$single = listRepositoryGamesAndCountStatements(
    createRepositoryQueryCountFixture([
        ['e2e4'],
    ]),
    $identity,
);
$multiple = listRepositoryGamesAndCountStatements(
    createRepositoryQueryCountFixture([
        [],
        ['e2e4', 'e7e5'],
        ['e2e4', 'e7e5', 'g1f3'],
    ]),
    $identity,
);

assertRepositoryQueryCountSame(1, count($single['games']), 'Single fixture should return exactly one game');
assertRepositoryQueryCountSame(3, count($multiple['games']), 'Multiple fixture should return every owned game');
assertRepositoryQueryCountSame(
    $single['statement_count'],
    $multiple['statement_count'],
    'listGamesForIdentity statement count should be constant across game and move counts',
);
assertRepositoryQueryCountTrue(
    $multiple['statement_count'] > 0 && $multiple['statement_count'] <= 10,
    'listGamesForIdentity should stay within the deterministic ten-event batch bound',
);

fwrite(STDOUT, "Chess repository query-count regressions passed.\n");
