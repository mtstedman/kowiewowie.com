CREATE TABLE poe2_tree_versions (
    version text PRIMARY KEY
        CHECK (version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$'),
    source_url text NOT NULL
        CHECK (source_url ~ '^https://'),
    source_commit text NOT NULL
        CHECK (source_commit ~ '^[a-f0-9]{40}$'),
    source_sha256 text NOT NULL
        CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
    importer_revision integer NOT NULL CHECK (importer_revision >= 1),
    is_current boolean NOT NULL DEFAULT false,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX poe2_tree_versions_current_idx
    ON poe2_tree_versions (is_current)
    WHERE is_current;

CREATE TABLE poe2_tree_classes (
    tree_version text NOT NULL
        REFERENCES poe2_tree_versions(version) ON DELETE CASCADE,
    class_index smallint NOT NULL CHECK (class_index >= 0),
    name text NOT NULL CHECK (name <> ''),
    start_node_id integer NULL,
    PRIMARY KEY (tree_version, class_index),
    UNIQUE (tree_version, name)
);

CREATE TABLE poe2_tree_ascendancies (
    tree_version text NOT NULL,
    ascendancy_id text NOT NULL CHECK (ascendancy_id <> ''),
    class_index smallint NOT NULL,
    position smallint NOT NULL CHECK (position >= 0),
    name text NULL,
    PRIMARY KEY (tree_version, ascendancy_id),
    UNIQUE (tree_version, class_index, position),
    FOREIGN KEY (tree_version, class_index)
        REFERENCES poe2_tree_classes (tree_version, class_index) ON DELETE CASCADE
);

CREATE TABLE poe2_tree_nodes (
    tree_version text NOT NULL
        REFERENCES poe2_tree_versions(version) ON DELETE CASCADE,
    node_id integer NOT NULL CHECK (node_id >= 0),
    export_id text NULL,
    kind text NOT NULL
        CHECK (kind IN ('classStart', 'ascendancyStart', 'mastery', 'keystone', 'jewelSocket', 'notable', 'small', 'placeholder')),
    name text NOT NULL,
    stats text[] NOT NULL,
    x double precision NOT NULL
        CHECK (x > '-Infinity'::double precision AND x < 'Infinity'::double precision),
    y double precision NOT NULL
        CHECK (y > '-Infinity'::double precision AND y < 'Infinity'::double precision),
    ascendancy_id text NULL CHECK (ascendancy_id <> ''),
    is_free boolean NOT NULL DEFAULT false,
    is_multiple_choice boolean NOT NULL DEFAULT false,
    multiple_choice_parent_id integer NULL,
    unlock_ascendancy_id text NULL,
    PRIMARY KEY (tree_version, node_id),
    FOREIGN KEY (tree_version, multiple_choice_parent_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, unlock_ascendancy_id)
        REFERENCES poe2_tree_ascendancies (tree_version, ascendancy_id) ON DELETE CASCADE,
    CHECK ((kind = 'placeholder') = (export_id IS NULL)),
    CHECK (kind <> 'ascendancyStart' OR ascendancy_id IS NOT NULL)
);

CREATE INDEX poe2_tree_nodes_choice_parent_idx
    ON poe2_tree_nodes (tree_version, multiple_choice_parent_id)
    WHERE multiple_choice_parent_id IS NOT NULL;
CREATE INDEX poe2_tree_nodes_unlock_ascendancy_idx
    ON poe2_tree_nodes (tree_version, unlock_ascendancy_id)
    WHERE unlock_ascendancy_id IS NOT NULL;

-- Two classes can share one start node, so the class row points at the node.
-- Deferred because classes are written before the nodes that reference them.
ALTER TABLE poe2_tree_classes
    ADD FOREIGN KEY (tree_version, start_node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX poe2_tree_classes_start_node_idx
    ON poe2_tree_classes (tree_version, start_node_id)
    WHERE start_node_id IS NOT NULL;

CREATE TABLE poe2_tree_edges (
    tree_version text NOT NULL,
    edge_index integer NOT NULL CHECK (edge_index >= 0),
    from_node_id integer NOT NULL,
    to_node_id integer NOT NULL,
    orbit integer NULL,
    orbit_x double precision NULL,
    orbit_y double precision NULL,
    PRIMARY KEY (tree_version, edge_index),
    FOREIGN KEY (tree_version, from_node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, to_node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE,
    CHECK (num_nulls(orbit_x, orbit_y) IN (0, 2))
);

CREATE INDEX poe2_tree_edges_from_idx
    ON poe2_tree_edges (tree_version, from_node_id);
CREATE INDEX poe2_tree_edges_to_idx
    ON poe2_tree_edges (tree_version, to_node_id);

CREATE TABLE poe2_tree_node_unlock_requirements (
    tree_version text NOT NULL,
    node_id integer NOT NULL,
    position smallint NOT NULL CHECK (position >= 0),
    required_node_id integer NOT NULL,
    PRIMARY KEY (tree_version, node_id, position),
    FOREIGN KEY (tree_version, node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, required_node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE
);

CREATE INDEX poe2_tree_node_unlock_requirements_required_idx
    ON poe2_tree_node_unlock_requirements (tree_version, required_node_id);

CREATE TABLE poe2_tree_node_keystones_in_radius (
    tree_version text NOT NULL,
    node_id integer NOT NULL,
    position smallint NOT NULL CHECK (position >= 0),
    keystone_node_id integer NOT NULL,
    PRIMARY KEY (tree_version, node_id, position),
    FOREIGN KEY (tree_version, node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, keystone_node_id)
        REFERENCES poe2_tree_nodes (tree_version, node_id) ON DELETE CASCADE
);

CREATE INDEX poe2_tree_node_keystones_in_radius_keystone_idx
    ON poe2_tree_node_keystones_in_radius (tree_version, keystone_node_id);

CREATE TABLE poe2_tree_skill_overrides (
    tree_version text NOT NULL
        REFERENCES poe2_tree_versions(version) ON DELETE CASCADE,
    override_id integer NOT NULL CHECK (override_id >= 0),
    export_id text NULL,
    name text NULL,
    stats text[] NULL,
    ascendancy_id text NULL,
    PRIMARY KEY (tree_version, override_id)
);

-- node_id has no foreign key: the pinned export names two node IDs (both on
-- Druid) that do not exist in its node list. The planner skips and counts them.
CREATE TABLE poe2_tree_class_override_pairs (
    tree_version text NOT NULL,
    class_index smallint NOT NULL,
    node_id integer NOT NULL CHECK (node_id >= 0),
    override_id integer NOT NULL,
    PRIMARY KEY (tree_version, class_index, node_id),
    FOREIGN KEY (tree_version, class_index)
        REFERENCES poe2_tree_classes (tree_version, class_index) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, override_id)
        REFERENCES poe2_tree_skill_overrides (tree_version, override_id) ON DELETE CASCADE
);

CREATE INDEX poe2_tree_class_override_pairs_override_idx
    ON poe2_tree_class_override_pairs (tree_version, override_id);

CREATE TABLE poe2_tree_ascendancy_override_pairs (
    tree_version text NOT NULL,
    ascendancy_id text NOT NULL,
    node_id integer NOT NULL CHECK (node_id >= 0),
    override_id integer NOT NULL,
    PRIMARY KEY (tree_version, ascendancy_id, node_id),
    FOREIGN KEY (tree_version, ascendancy_id)
        REFERENCES poe2_tree_ascendancies (tree_version, ascendancy_id) ON DELETE CASCADE,
    FOREIGN KEY (tree_version, override_id)
        REFERENCES poe2_tree_skill_overrides (tree_version, override_id) ON DELETE CASCADE
);

CREATE INDEX poe2_tree_ascendancy_override_pairs_override_idx
    ON poe2_tree_ascendancy_override_pairs (tree_version, override_id);

COMMENT ON TABLE poe2_tree_versions IS
    'Imported Path of Exile 2 passive-tree exports with provenance; exactly one row may be current.';
COMMENT ON TABLE poe2_tree_classes IS
    'Export classes in export order; start_node_id is the class start (shared by paired classes).';
COMMENT ON TABLE poe2_tree_ascendancies IS
    'Export ascendancies in class order; a NULL name marks an unreleased placeholder.';
COMMENT ON TABLE poe2_tree_nodes IS
    'Passive nodes keyed by skill hash with position, stat text and allocation-rule attributes.';
COMMENT ON TABLE poe2_tree_edges IS
    'Official node connections in export order, with optional orbit-arc geometry.';
COMMENT ON TABLE poe2_tree_node_unlock_requirements IS
    'Nodes that must all be allocated before node_id can be allocated (unlockConstraint.nodes).';
COMMENT ON TABLE poe2_tree_node_keystones_in_radius IS
    'Keystones whose radius contains node_id (keystonesInRadius).';
COMMENT ON TABLE poe2_tree_skill_overrides IS
    'Replacement name and stat records applied by class and ascendancy override pairs.';
COMMENT ON TABLE poe2_tree_class_override_pairs IS
    'Class-specific replacements: node_id shows override_id for that class.';
COMMENT ON TABLE poe2_tree_ascendancy_override_pairs IS
    'Ascendancy-specific replacements: node_id shows override_id for that ascendancy.';
