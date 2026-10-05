-- Which collectible figures a visitor owns. A collection belongs to a
-- registered user, or to a guest browser that holds the long-lived
-- wowie_collection cookie (only its SHA-256 is stored).
CREATE TABLE collectible_guest_collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cookie_token_hash text NOT NULL UNIQUE
        CHECK (cookie_token_hash ~ '^[a-f0-9]{64}$'),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER collectible_guest_collections_set_updated_at
BEFORE UPDATE ON collectible_guest_collections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per owned figure: the shelf's listing id and the figure's name, as
-- the shelf keys them. Not foreign keys, so a catalog refresh that retires a
-- listing never deletes what someone owns.
CREATE TABLE collectible_owned_figures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    guest_collection_id uuid REFERENCES collectible_guest_collections(id) ON DELETE CASCADE,
    product_id text NOT NULL
        CHECK (product_id ~ '^[A-Za-z0-9:._-]{1,200}$'),
    figure_name text NOT NULL
        CHECK (char_length(figure_name) <= 300),
    quantity integer NOT NULL
        CHECK (quantity BETWEEN 1 AND 1000000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, guest_collection_id) = 1)
);

CREATE UNIQUE INDEX collectible_owned_figures_user_key
    ON collectible_owned_figures (user_id, product_id, figure_name)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX collectible_owned_figures_guest_key
    ON collectible_owned_figures (guest_collection_id, product_id, figure_name)
    WHERE guest_collection_id IS NOT NULL;

CREATE TRIGGER collectible_owned_figures_set_updated_at
BEFORE UPDATE ON collectible_owned_figures
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
