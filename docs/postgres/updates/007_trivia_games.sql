CREATE TABLE trivia_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'active', 'finished', 'abandoned')),
    max_players integer NOT NULL DEFAULT 6 CHECK (max_players BETWEEN 2 AND 6),
    answer_window_seconds integer NOT NULL DEFAULT 30
        CHECK (answer_window_seconds BETWEEN 10 AND 120),
    host_player_id uuid,
    current_round_number integer NOT NULL DEFAULT 0 CHECK (current_round_number >= 0),
    winner_player_id uuid,
    termination text CHECK (char_length(btrim(termination)) BETWEEN 1 AND 80),
    started_at timestamptz,
    finished_at timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status IN ('finished', 'abandoned')) = (finished_at IS NOT NULL)),
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE trivia_players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES trivia_rooms(id) ON DELETE CASCADE,
    seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 6),
    role text NOT NULL DEFAULT 'player' CHECK (role IN ('host', 'player')),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    guest_profile_id uuid REFERENCES chess_guest_profiles(id) ON DELETE SET NULL,
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'eliminated', 'left')),
    eliminated_round_id uuid,
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, guest_profile_id) <= 1),
    UNIQUE (room_id, seat_number),
    UNIQUE (room_id, id),
    UNIQUE (room_id, user_id),
    UNIQUE (room_id, guest_profile_id)
);

ALTER TABLE trivia_rooms
    ADD CONSTRAINT trivia_rooms_host_player_fk
    FOREIGN KEY (id, host_player_id)
    REFERENCES trivia_players(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE trivia_rooms
    ADD CONSTRAINT trivia_rooms_winner_player_fk
    FOREIGN KEY (id, winner_player_id)
    REFERENCES trivia_players(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE trivia_room_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES trivia_rooms(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE
        CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    link_type text NOT NULL DEFAULT 'join' CHECK (link_type = 'join'),
    created_by_player_id uuid,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    UNIQUE (room_id, id),
    FOREIGN KEY (room_id, created_by_player_id)
        REFERENCES trivia_players(room_id, id)
);

CREATE TABLE trivia_link_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id uuid NOT NULL REFERENCES trivia_room_links(id) ON DELETE CASCADE,
    room_id uuid NOT NULL,
    player_id uuid NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (link_id, player_id),
    FOREIGN KEY (room_id, link_id)
        REFERENCES trivia_room_links(room_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (room_id, player_id)
        REFERENCES trivia_players(room_id, id)
        ON DELETE CASCADE
);

CREATE TABLE trivia_prompts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES trivia_rooms(id) ON DELETE CASCADE,
    prompt_order integer NOT NULL CHECK (prompt_order > 0),
    question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 300),
    correct_answer text NOT NULL
        CHECK (char_length(btrim(correct_answer)) BETWEEN 1 AND 200),
    choices jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(choices) = 'array'),
    explanation text CHECK (char_length(btrim(explanation)) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (room_id, prompt_order),
    UNIQUE (room_id, id)
);

CREATE TABLE trivia_rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES trivia_rooms(id) ON DELETE CASCADE,
    round_number integer NOT NULL CHECK (round_number > 0),
    prompt_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'answering'
        CHECK (status IN ('answering', 'resolved')),
    answer_window_seconds integer NOT NULL CHECK (answer_window_seconds BETWEEN 10 AND 120),
    opened_at timestamptz NOT NULL DEFAULT now(),
    closes_at timestamptz NOT NULL,
    resolved_at timestamptz,
    CHECK (closes_at > opened_at),
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
    UNIQUE (room_id, round_number),
    UNIQUE (room_id, id),
    FOREIGN KEY (room_id, prompt_id)
        REFERENCES trivia_prompts(room_id, id)
);

ALTER TABLE trivia_players
    ADD CONSTRAINT trivia_players_eliminated_round_fk
    FOREIGN KEY (room_id, eliminated_round_id)
    REFERENCES trivia_rounds(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE trivia_answers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL,
    round_id uuid NOT NULL,
    player_id uuid NOT NULL,
    client_answer_id uuid NOT NULL DEFAULT gen_random_uuid(),
    answer_text text NOT NULL CHECK (char_length(btrim(answer_text)) BETWEEN 1 AND 200),
    is_correct boolean NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (round_id, player_id),
    UNIQUE (room_id, client_answer_id),
    FOREIGN KEY (room_id, round_id)
        REFERENCES trivia_rounds(room_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (room_id, player_id)
        REFERENCES trivia_players(room_id, id)
        ON DELETE CASCADE
);

CREATE INDEX trivia_rooms_activity_idx
    ON trivia_rooms (last_activity_at DESC);
CREATE INDEX trivia_rooms_open_idx
    ON trivia_rooms (last_activity_at DESC)
    WHERE status IN ('waiting', 'active');
CREATE INDEX trivia_players_guest_idx
    ON trivia_players (guest_profile_id)
    WHERE guest_profile_id IS NOT NULL;
CREATE INDEX trivia_players_user_idx
    ON trivia_players (user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX trivia_room_links_room_idx
    ON trivia_room_links (room_id, created_at DESC);
CREATE INDEX trivia_room_links_expiry_idx
    ON trivia_room_links (expires_at)
    WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX trivia_link_claims_player_idx
    ON trivia_link_claims (player_id, claimed_at DESC);
CREATE INDEX trivia_rounds_room_status_idx
    ON trivia_rounds (room_id, status, round_number DESC);
CREATE INDEX trivia_answers_round_idx
    ON trivia_answers (round_id, submitted_at ASC);

CREATE TRIGGER trivia_rooms_set_updated_at
BEFORE UPDATE ON trivia_rooms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
