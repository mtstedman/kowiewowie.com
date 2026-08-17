ALTER TABLE chess_game_players
    ADD COLUMN recovery_token_hash text,
    ADD COLUMN recovery_token_created_at timestamptz,
    ADD COLUMN recovery_token_last_used_at timestamptz,
    ADD CONSTRAINT chess_game_players_recovery_token_hash_format
        CHECK (recovery_token_hash IS NULL OR recovery_token_hash ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT chess_game_players_recovery_token_presence
        CHECK ((recovery_token_hash IS NULL) = (recovery_token_created_at IS NULL)),
    ADD CONSTRAINT chess_game_players_recovery_token_hash_unique
        UNIQUE (recovery_token_hash);

ALTER TABLE trivia_players
    ADD COLUMN recovery_token_hash text,
    ADD COLUMN recovery_token_created_at timestamptz,
    ADD COLUMN recovery_token_last_used_at timestamptz,
    ADD CONSTRAINT trivia_players_recovery_token_hash_format
        CHECK (recovery_token_hash IS NULL OR recovery_token_hash ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT trivia_players_recovery_token_presence
        CHECK ((recovery_token_hash IS NULL) = (recovery_token_created_at IS NULL)),
    ADD CONSTRAINT trivia_players_recovery_token_hash_unique
        UNIQUE (recovery_token_hash);
