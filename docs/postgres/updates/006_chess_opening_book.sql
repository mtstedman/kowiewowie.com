CREATE TABLE chess_openings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_opening_id bigint REFERENCES chess_openings(id) ON DELETE SET NULL,
    eco_code text NOT NULL
        CHECK (eco_code ~ '^[A-E][0-9]{2}(/[0-9]{2})?$'),
    name text NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 240),
    search_document tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', eco_code || ' ' || name)
    ) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_opening_id IS NULL OR parent_opening_id <> id)
);

CREATE UNIQUE INDEX chess_openings_eco_name_unique
    ON chess_openings (eco_code, lower(name));
CREATE INDEX chess_openings_parent_idx
    ON chess_openings (parent_opening_id)
    WHERE parent_opening_id IS NOT NULL;
CREATE INDEX chess_openings_name_prefix_idx
    ON chess_openings (lower(name) text_pattern_ops);
CREATE INDEX chess_openings_search_idx
    ON chess_openings USING gin (search_document);

CREATE TABLE chess_opening_positions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    opening_id bigint REFERENCES chess_openings(id) ON DELETE SET NULL,
    epd text NOT NULL UNIQUE
        CHECK (
            epd ~ '^[^[:space:]]+ [wb] (-|[KQkq]+) (-|[a-h][36])$'
        ),
    representative_pgn text,
    representative_uci text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((representative_pgn IS NULL) = (representative_uci IS NULL)),
    CHECK (
        representative_pgn IS NULL
        OR (
            char_length(btrim(representative_pgn)) > 0
            AND representative_uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?( [a-h][1-8][a-h][1-8][qrbn]?)*$'
        )
    ),
    CHECK (opening_id IS NULL OR representative_pgn IS NOT NULL)
);

CREATE INDEX chess_opening_positions_opening_idx
    ON chess_opening_positions (opening_id)
    WHERE opening_id IS NOT NULL;

CREATE TABLE chess_opening_moves (
    from_position_id bigint NOT NULL
        REFERENCES chess_opening_positions(id) ON DELETE CASCADE,
    uci text NOT NULL
        CHECK (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
    san text NOT NULL
        CHECK (char_length(btrim(san)) BETWEEN 1 AND 32),
    to_position_id bigint NOT NULL
        REFERENCES chess_opening_positions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_position_id, uci)
);

CREATE INDEX chess_opening_moves_destination_idx
    ON chess_opening_moves (to_position_id);

CREATE TRIGGER chess_openings_set_updated_at
BEFORE UPDATE ON chess_openings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER chess_opening_positions_set_updated_at
BEFORE UPDATE ON chess_opening_positions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE chess_openings IS
    'ECO opening and variation labels; parent_opening_id is taxonomy only, not move ancestry.';
COMMENT ON TABLE chess_opening_positions IS
    'Unique standard-chess EPD states in the opening book, optionally carrying an opening label and representative line.';
COMMENT ON TABLE chess_opening_moves IS
    'Directed legal book edges; converging destination positions represent transpositions.';
