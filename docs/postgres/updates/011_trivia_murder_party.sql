ALTER TABLE trivia_rooms
    ADD COLUMN phase text NOT NULL DEFAULT 'trivia'
        CHECK (phase IN ('trivia', 'killing_floor', 'ghost_race')),
    ADD COLUMN body_holder_player_id uuid,
    ADD COLUMN race_goal integer NOT NULL DEFAULT 12 CHECK (race_goal BETWEEN 6 AND 60),
    ADD COLUMN race_state jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(race_state) = 'object');

ALTER TABLE trivia_rooms
    ADD CONSTRAINT trivia_rooms_body_holder_player_fk
    FOREIGN KEY (id, body_holder_player_id)
    REFERENCES trivia_players(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE trivia_players
    ADD COLUMN is_ghost boolean NOT NULL DEFAULT false,
    ADD COLUMN ghosted_round_id uuid,
    ADD COLUMN race_position integer NOT NULL DEFAULT 0 CHECK (race_position >= 0);

ALTER TABLE trivia_players
    ADD CONSTRAINT trivia_players_ghosted_round_fk
    FOREIGN KEY (room_id, ghosted_round_id)
    REFERENCES trivia_rounds(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE trivia_prompts
    ADD COLUMN answer_shape jsonb NOT NULL DEFAULT '{"type":"single_choice"}'::jsonb
        CHECK (jsonb_typeof(answer_shape) = 'object'),
    ADD COLUMN image_url text
        CHECK (image_url IS NULL OR char_length(btrim(image_url)) BETWEEN 1 AND 300);

ALTER TABLE trivia_question_catalog
    ADD COLUMN answer_shape jsonb NOT NULL DEFAULT '{"type":"single_choice"}'::jsonb
        CHECK (jsonb_typeof(answer_shape) = 'object'),
    ADD COLUMN image_url text
        CHECK (image_url IS NULL OR char_length(btrim(image_url)) BETWEEN 1 AND 300);

ALTER TABLE trivia_rounds
    ADD COLUMN round_type text NOT NULL DEFAULT 'trivia'
        CHECK (round_type IN ('trivia', 'killing_floor', 'ghost_race')),
    ADD COLUMN phase text NOT NULL DEFAULT 'trivia'
        CHECK (phase IN ('trivia', 'killing_floor', 'ghost_race')),
    ADD COLUMN prompt_payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(prompt_payload) = 'object'),
    ADD COLUMN answer_shape jsonb NOT NULL DEFAULT '{"type":"single_choice"}'::jsonb
        CHECK (jsonb_typeof(answer_shape) = 'object'),
    ADD COLUMN image_url text
        CHECK (image_url IS NULL OR char_length(btrim(image_url)) BETWEEN 1 AND 300),
    ADD COLUMN minigame_type text
        CHECK (minigame_type IS NULL OR minigame_type IN ('key_lock', 'memory_match')),
    ADD COLUMN minigame_payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(minigame_payload) = 'object'),
    ADD COLUMN minigame_results jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(minigame_results) = 'object'),
    ADD COLUMN eligible_player_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    ADD COLUMN body_holder_player_id uuid,
    ADD COLUMN race_goal integer CHECK (race_goal IS NULL OR race_goal BETWEEN 6 AND 60),
    ADD COLUMN race_positions jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(race_positions) = 'object');

ALTER TABLE trivia_rounds
    ADD CONSTRAINT trivia_rounds_body_holder_player_fk
    FOREIGN KEY (room_id, body_holder_player_id)
    REFERENCES trivia_players(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE trivia_answers
    ADD COLUMN answer_payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(answer_payload) = 'object'),
    ADD COLUMN score integer NOT NULL DEFAULT 0 CHECK (score >= 0);

CREATE INDEX trivia_rooms_phase_idx
    ON trivia_rooms (phase, last_activity_at DESC)
    WHERE status = 'active';
CREATE INDEX trivia_players_ghost_idx
    ON trivia_players (room_id, is_ghost, race_position DESC);
CREATE INDEX trivia_rounds_phase_idx
    ON trivia_rounds (room_id, phase, round_type, status, round_number DESC);
