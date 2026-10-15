ALTER TABLE poe2_saved_builds
    ADD COLUMN inventory jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(inventory) = 'array');
