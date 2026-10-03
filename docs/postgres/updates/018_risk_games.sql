CREATE TABLE risk_games (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'active', 'finished', 'abandoned')),
    seat_count integer NOT NULL CHECK (seat_count BETWEEN 2 AND 6),
    state jsonb,
    state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    winner_seat integer CHECK (winner_seat BETWEEN 1 AND 6),
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_game_players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES risk_games(id) ON DELETE CASCADE,
    seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 6),
    kind text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'bot')),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    guest_profile_id uuid REFERENCES chess_guest_profiles(id) ON DELETE SET NULL,
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, seat_number),
    UNIQUE (game_id, user_id),
    UNIQUE (game_id, guest_profile_id)
);

CREATE TABLE risk_game_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES risk_games(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE
        CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_game_players_guest_idx
    ON risk_game_players (guest_profile_id)
    WHERE guest_profile_id IS NOT NULL;
CREATE INDEX risk_game_players_user_idx
    ON risk_game_players (user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX risk_game_links_game_idx
    ON risk_game_links (game_id, created_at DESC);