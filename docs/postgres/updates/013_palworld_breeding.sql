CREATE TABLE palworld_dataset (
    id smallint PRIMARY KEY CHECK (id = 1),
    data_version text NOT NULL,
    revision text NOT NULL
        CHECK (revision ~ '^[a-f0-9]{64}$'),
    pal_count integer NOT NULL,
    breeding_row_count integer NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE palworld_pals (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pal_key text NOT NULL UNIQUE,
    internal_name text NOT NULL,
    name text NOT NULL,
    paldex_no integer NULL,
    is_variant boolean NOT NULL DEFAULT false,
    in_pal_database boolean NOT NULL,
    CHECK (pal_key = lower(internal_name))
);

CREATE INDEX palworld_pals_name_idx
    ON palworld_pals (lower(name));

CREATE TABLE palworld_breeding_pairs (
    source_row integer PRIMARY KEY CHECK (source_row >= 1),
    parent1_pal_id integer NOT NULL
        REFERENCES palworld_pals(id) ON DELETE CASCADE,
    parent2_pal_id integer NOT NULL
        REFERENCES palworld_pals(id) ON DELETE CASCADE,
    child_pal_id integer NOT NULL
        REFERENCES palworld_pals(id) ON DELETE CASCADE,
    parent1_gender text NOT NULL
        CHECK (parent1_gender IN ('WILDCARD', 'MALE', 'FEMALE')),
    parent2_gender text NOT NULL
        CHECK (parent2_gender IN ('WILDCARD', 'MALE', 'FEMALE'))
);

CREATE INDEX palworld_breeding_pairs_parents_idx
    ON palworld_breeding_pairs (parent1_pal_id, parent2_pal_id);
CREATE INDEX palworld_breeding_pairs_parents_reverse_idx
    ON palworld_breeding_pairs (parent2_pal_id, parent1_pal_id);
CREATE INDEX palworld_breeding_pairs_child_idx
    ON palworld_breeding_pairs (child_pal_id);

CREATE TABLE palworld_passive_skills (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    rank integer NOT NULL
);

CREATE INDEX palworld_passive_skills_rank_name_idx
    ON palworld_passive_skills (rank, name);

COMMENT ON TABLE palworld_dataset IS
    'Singleton provenance row for the imported Palworld breeding dataset.';
COMMENT ON TABLE palworld_pals IS
    'Palworld pals keyed by lower-cased internal name; ids are referenced by breeding pairs.';
COMMENT ON TABLE palworld_breeding_pairs IS
    'One row per source breeding-table row: two parents (with gender constraints) produce a child.';
COMMENT ON TABLE palworld_passive_skills IS
    'Palworld passive skills and their rank tier.';