CREATE TABLE stratego_games (
    id bigserial PRIMARY KEY,
    public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'setup', 'active', 'finished', 'abandoned')),
    state jsonb NOT NULL,
    state_version integer NOT NULL DEFAULT 0,
    winner_color text CHECK (winner_color IN ('red', 'blue')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE stratego_game_players (
    id bigserial PRIMARY KEY,
    game_id bigint NOT NULL REFERENCES stratego_games(id) ON DELETE CASCADE,
    color text NOT NULL CHECK (color IN ('red', 'blue')),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    guest_profile_id uuid REFERENCES chess_guest_profiles(id) ON DELETE SET NULL,
    display_name text NOT NULL DEFAULT '',
    is_ready boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, color)
);

CREATE TABLE stratego_game_links (
    id bigserial PRIMARY KEY,
    game_id bigint NOT NULL REFERENCES stratego_games(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    link_type text NOT NULL DEFAULT 'play' CHECK (link_type IN ('play')),
    seat_color text CHECK (seat_color IN ('red', 'blue')),
    created_by_player_id bigint REFERENCES stratego_game_players(id) ON DELETE SET NULL,
    claimed_by_player_id bigint REFERENCES stratego_game_players(id) ON DELETE SET NULL,
    claimed_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stratego_game_players_game_idx
    ON stratego_game_players (game_id);
CREATE INDEX stratego_game_players_user_idx
    ON stratego_game_players (user_id);
CREATE INDEX stratego_game_players_guest_idx
    ON stratego_game_players (guest_profile_id);
CREATE INDEX stratego_game_links_game_idx
    ON stratego_game_links (game_id);
CREATE INDEX stratego_games_status_updated_idx
    ON stratego_games (status, updated_at);