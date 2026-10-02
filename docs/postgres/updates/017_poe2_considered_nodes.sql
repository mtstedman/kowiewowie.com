ALTER TABLE poe2_saved_builds
    ADD COLUMN considered_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(considered_node_ids) = 'array');
