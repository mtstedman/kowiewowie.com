ALTER TABLE collectible_products
    DROP CONSTRAINT IF EXISTS collectible_products_brand_check;

ALTER TABLE collectible_products
    ADD CONSTRAINT collectible_products_brand_check
        CHECK (brand IN ('skullpanda', 'nommi', 'sonny-angel')),
    ADD COLUMN price_kind text NULL CHECK (price_kind IS NULL OR price_kind IN ('retail', 'asking', 'sold')),
    ADD COLUMN price_source_url text NULL,
    ADD COLUMN price_observed_on date NULL,
    ADD COLUMN release_year smallint NULL CHECK (release_year IS NULL OR release_year BETWEEN 2000 AND 2100);

ALTER TABLE collectible_variants
    ADD COLUMN price_kind text NULL CHECK (price_kind IS NULL OR price_kind IN ('retail', 'asking', 'sold')),
    ADD COLUMN price_source_url text NULL,
    ADD COLUMN price_observed_on date NULL;

CREATE INDEX collectible_products_release_year_idx
    ON collectible_products (release_year);

CREATE INDEX collectible_products_price_idx
    ON collectible_products (price_cents);
