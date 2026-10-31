ALTER TABLE trivia_rooms
    ADD COLUMN starting_lives integer NOT NULL DEFAULT 2
        CHECK (starting_lives BETWEEN 1 AND 3);

ALTER TABLE trivia_players
    ADD COLUMN lives_remaining integer NOT NULL DEFAULT 2
        CHECK (lives_remaining BETWEEN 0 AND 3);

UPDATE trivia_players
SET lives_remaining = 0
WHERE is_ghost;

ALTER TABLE trivia_rounds
    DROP CONSTRAINT IF EXISTS trivia_rounds_minigame_type_check;

ALTER TABLE trivia_rounds
    ADD CONSTRAINT trivia_rounds_minigame_type_check
    CHECK (
        minigame_type IS NULL
        OR minigame_type IN (
            'key_lock',
            'memory_match',
            'poison_chalices',
            'sword_boxes',
            'crypt_runes',
            'grim_arithmetic',
            'odd_one_out',
            'sequence_recall'
        )
    );
