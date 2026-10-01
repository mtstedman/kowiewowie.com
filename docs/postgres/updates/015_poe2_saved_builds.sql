CREATE TABLE poe2_saved_builds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    guest_profile_id uuid REFERENCES chess_guest_profiles(id) ON DELETE CASCADE,
    character_name text NOT NULL
        CHECK (char_length(btrim(character_name)) BETWEEN 1 AND 64),
    build_name text NOT NULL
        CHECK (char_length(btrim(build_name)) BETWEEN 1 AND 80),
    class_id text NOT NULL
        CHECK (char_length(class_id) BETWEEN 1 AND 64),
    ascendancy_id text NULL
        CHECK (ascendancy_id IS NULL OR char_length(ascendancy_id) BETWEEN 1 AND 64),
    tree_version text NOT NULL
        CHECK (char_length(tree_version) BETWEEN 1 AND 32),
    allocated_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(allocated_node_ids) = 'array'),
    must_have_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(must_have_node_ids) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, guest_profile_id) = 1)
);

CREATE INDEX poe2_saved_builds_user_idx
    ON poe2_saved_builds (user_id, updated_at DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX poe2_saved_builds_guest_idx
    ON poe2_saved_builds (guest_profile_id, updated_at DESC)
    WHERE guest_profile_id IS NOT NULL;

CREATE TRIGGER poe2_saved_builds_set_updated_at
BEFORE UPDATE ON poe2_saved_builds
FOR EACH ROW EXECUTE FUNCTION set_updated_at();