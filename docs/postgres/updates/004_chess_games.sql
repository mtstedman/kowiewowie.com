CREATE TABLE chess_guest_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cookie_token_hash text NOT NULL UNIQUE
        CHECK (cookie_token_hash ~ '^[a-f0-9]{64}$'),
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE TABLE chess_games (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    variant text NOT NULL DEFAULT 'standard'
        CHECK (variant IN ('standard', 'chess960')),
    status text NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'active', 'completed', 'abandoned')),
    current_ply integer NOT NULL DEFAULT 0 CHECK (current_ply >= 0),
    result text NOT NULL DEFAULT '*'
        CHECK (result IN ('*', '1-0', '0-1', '1/2-1/2')),
    termination text
        CHECK (char_length(btrim(termination)) BETWEEN 1 AND 80),
    started_at timestamptz,
    finished_at timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'completed') = (result <> '*')),
    CHECK ((status IN ('completed', 'abandoned')) = (finished_at IS NOT NULL)),
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE chess_game_players (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES chess_games(id) ON DELETE CASCADE,
    color text NOT NULL CHECK (color IN ('white', 'black')),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    guest_profile_id uuid REFERENCES chess_guest_profiles(id) ON DELETE SET NULL,
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, guest_profile_id) <= 1),
    UNIQUE (game_id, color),
    UNIQUE (game_id, id),
    UNIQUE (game_id, id, color),
    UNIQUE (game_id, user_id),
    UNIQUE (game_id, guest_profile_id)
);

CREATE TABLE chess_game_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES chess_games(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE
        CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    link_type text NOT NULL CHECK (link_type IN ('play', 'spectate')),
    seat_color text CHECK (seat_color IN ('white', 'black')),
    created_by_player_id uuid,
    claimed_by_player_id uuid,
    claimed_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (link_type = 'play' AND seat_color IS NOT NULL)
        OR (link_type = 'spectate' AND seat_color IS NULL)
    ),
    CHECK ((claimed_by_player_id IS NULL) = (claimed_at IS NULL)),
    CHECK (
        link_type = 'play'
        OR (claimed_by_player_id IS NULL AND claimed_at IS NULL)
    ),
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    FOREIGN KEY (game_id, created_by_player_id)
        REFERENCES chess_game_players(game_id, id),
    FOREIGN KEY (game_id, claimed_by_player_id, seat_color)
        REFERENCES chess_game_players(game_id, id, color)
);

CREATE TABLE chess_game_positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES chess_games(id) ON DELETE CASCADE,
    ply integer NOT NULL CHECK (ply >= 0),
    fen text NOT NULL CHECK (
        fen ~ '^[^[:space:]]+ [wb] (-|[KQkq]+) (-|[a-h][36]) [0-9]+ [1-9][0-9]*$'
    ),
    side_to_move text GENERATED ALWAYS AS (split_part(fen, ' ', 2)) STORED
        CHECK (side_to_move IN ('w', 'b')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, ply),
    UNIQUE (game_id, id)
);

ALTER TABLE chess_games
    ADD CONSTRAINT chess_games_current_position_fk
    FOREIGN KEY (id, current_ply)
    REFERENCES chess_game_positions(game_id, ply)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE chess_game_moves (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES chess_games(id) ON DELETE CASCADE,
    ply integer NOT NULL CHECK (ply > 0),
    position_before_ply integer GENERATED ALWAYS AS (ply - 1) STORED,
    played_by_player_id uuid NOT NULL,
    client_move_id uuid NOT NULL DEFAULT gen_random_uuid(),
    uci text NOT NULL CHECK (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
    from_square text GENERATED ALWAYS AS (substring(uci FROM 1 FOR 2)) STORED,
    to_square text GENERATED ALWAYS AS (substring(uci FROM 3 FOR 2)) STORED,
    promotion text GENERATED ALWAYS AS (nullif(substring(uci FROM 5 FOR 1), '')) STORED,
    san text NOT NULL CHECK (char_length(btrim(san)) BETWEEN 1 AND 32),
    played_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, ply),
    UNIQUE (game_id, client_move_id),
    FOREIGN KEY (game_id, played_by_player_id)
        REFERENCES chess_game_players(game_id, id),
    FOREIGN KEY (game_id, position_before_ply)
        REFERENCES chess_game_positions(game_id, ply)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (game_id, ply)
        REFERENCES chess_game_positions(game_id, ply)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE OR REPLACE FUNCTION advance_chess_game_on_move()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    game_ply integer;
    game_status text;
    moving_color text;
    before_turn text;
    after_turn text;
BEGIN
    SELECT current_ply, status
    INTO game_ply, game_status
    FROM chess_games
    WHERE id = NEW.game_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chess game % does not exist.', NEW.game_id;
    END IF;

    IF game_status NOT IN ('waiting', 'active') THEN
        RAISE EXCEPTION 'Chess game % cannot accept moves while %.', NEW.game_id, game_status;
    END IF;

    IF NEW.position_before_ply <> game_ply THEN
        RAISE EXCEPTION 'Chess game % expected ply %, received ply %.',
            NEW.game_id, game_ply + 1, NEW.ply;
    END IF;

    SELECT color
    INTO moving_color
    FROM chess_game_players
    WHERE game_id = NEW.game_id AND id = NEW.played_by_player_id;

    SELECT side_to_move
    INTO before_turn
    FROM chess_game_positions
    WHERE game_id = NEW.game_id AND ply = NEW.position_before_ply;

    SELECT side_to_move
    INTO after_turn
    FROM chess_game_positions
    WHERE game_id = NEW.game_id AND ply = NEW.ply;

    IF moving_color IS NULL OR before_turn IS NULL OR after_turn IS NULL THEN
        RAISE EXCEPTION 'Chess move % is missing its player or position state.', NEW.id;
    END IF;

    IF (moving_color = 'white' AND before_turn <> 'w')
        OR (moving_color = 'black' AND before_turn <> 'b') THEN
        RAISE EXCEPTION 'Chess move % was submitted out of turn.', NEW.id;
    END IF;

    IF after_turn = before_turn THEN
        RAISE EXCEPTION 'Chess move % must pass the turn to the opponent.', NEW.id;
    END IF;

    UPDATE chess_games
    SET current_ply = NEW.ply,
        status = 'active',
        started_at = COALESCE(started_at, NEW.played_at),
        last_activity_at = NEW.played_at
    WHERE id = NEW.game_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER chess_game_moves_advance_game
AFTER INSERT ON chess_game_moves
FOR EACH ROW EXECUTE FUNCTION advance_chess_game_on_move();

CREATE VIEW chess_game_current_positions AS
SELECT
    game.id AS game_id,
    game.public_id,
    game.variant,
    game.status,
    game.result,
    position.ply,
    position.fen,
    position.side_to_move,
    game.last_activity_at
FROM chess_games AS game
JOIN chess_game_positions AS position
    ON position.game_id = game.id AND position.ply = game.current_ply;

CREATE INDEX chess_guest_profiles_expiry_idx
    ON chess_guest_profiles (expires_at);
CREATE INDEX chess_games_activity_idx
    ON chess_games (last_activity_at DESC);
CREATE INDEX chess_games_open_idx
    ON chess_games (last_activity_at DESC)
    WHERE status IN ('waiting', 'active');
CREATE INDEX chess_game_players_guest_idx
    ON chess_game_players (guest_profile_id)
    WHERE guest_profile_id IS NOT NULL;
CREATE INDEX chess_game_players_user_idx
    ON chess_game_players (user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX chess_game_links_game_idx
    ON chess_game_links (game_id, created_at DESC);
CREATE INDEX chess_game_links_expiry_idx
    ON chess_game_links (expires_at)
    WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

CREATE TRIGGER chess_guest_profiles_set_updated_at
BEFORE UPDATE ON chess_guest_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER chess_games_set_updated_at
BEFORE UPDATE ON chess_games
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
