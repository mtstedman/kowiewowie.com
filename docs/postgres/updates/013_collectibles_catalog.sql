CREATE TABLE collectible_products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    brand text NOT NULL CHECK (brand IN ('skullpanda', 'nommi')),
    source_key text NOT NULL,
    external_id text NOT NULL,
    title text NOT NULL,
    product_url text NOT NULL,
    image_url text NULL,
    price_cents integer NULL CHECK (price_cents IS NULL OR price_cents >= 0),
    currency text NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_key, external_id)
);

CREATE TABLE collectible_variants (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint NOT NULL REFERENCES collectible_products(id) ON DELETE CASCADE,
    name text NOT NULL,
    is_secret boolean NOT NULL DEFAULT false,
    image_url text NULL,
    price_cents integer NULL CHECK (price_cents IS NULL OR price_cents >= 0),
    currency text NULL,
    position integer NOT NULL DEFAULT 0,
    UNIQUE (product_id, name)
);

CREATE INDEX collectible_products_brand_idx
    ON collectible_products (brand);