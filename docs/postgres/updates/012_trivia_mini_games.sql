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
            'crypt_runes'
        )
    );
