CREATE TABLE open_deck_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'filled', 'closed')),
    filled_nomination_id uuid,
    eviction_vote_threshold integer NOT NULL DEFAULT 3
        CHECK (eviction_vote_threshold BETWEEN 1 AND 100),
    filled_at timestamptz,
    closed_at timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),
    CHECK ((status = 'filled') = (filled_nomination_id IS NOT NULL)),
    CHECK ((status = 'filled') = (filled_at IS NOT NULL)),
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE open_deck_set_nominations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id uuid NOT NULL REFERENCES open_deck_slots(id) ON DELETE CASCADE,
    set_name text NOT NULL CHECK (char_length(btrim(set_name)) BETWEEN 1 AND 120),
    nominated_by text CHECK (char_length(btrim(nominated_by)) BETWEEN 1 AND 120),
    status text NOT NULL DEFAULT 'eligible'
        CHECK (status IN ('eligible', 'filled', 'evicted')),
    filled_at timestamptz,
    evicted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'filled' OR filled_at IS NOT NULL),
    CHECK ((status = 'evicted') = (evicted_at IS NOT NULL)),
    UNIQUE (slot_id, id)
);

CREATE UNIQUE INDEX open_deck_set_nominations_name_unique_idx
    ON open_deck_set_nominations (slot_id, lower(set_name));

ALTER TABLE open_deck_slots
    ADD CONSTRAINT open_deck_slots_filled_nomination_fk
    FOREIGN KEY (id, filled_nomination_id)
    REFERENCES open_deck_set_nominations(slot_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE open_deck_fill_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id uuid NOT NULL,
    nomination_id uuid NOT NULL,
    voter_identity_hash text NOT NULL CHECK (voter_identity_hash ~ '^[a-f0-9]{64}$'),
    voter_display_name text CHECK (char_length(btrim(voter_display_name)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (nomination_id, voter_identity_hash),
    FOREIGN KEY (slot_id, nomination_id)
        REFERENCES open_deck_set_nominations(slot_id, id)
        ON DELETE CASCADE
);

CREATE TABLE open_deck_eviction_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id uuid NOT NULL,
    target_nomination_id uuid NOT NULL,
    voter_identity_hash text NOT NULL CHECK (voter_identity_hash ~ '^[a-f0-9]{64}$'),
    voter_display_name text CHECK (char_length(btrim(voter_display_name)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (target_nomination_id, voter_identity_hash),
    FOREIGN KEY (slot_id, target_nomination_id)
        REFERENCES open_deck_set_nominations(slot_id, id)
        ON DELETE CASCADE
);

CREATE INDEX open_deck_slots_schedule_idx
    ON open_deck_slots (start_at ASC, end_at ASC);
CREATE INDEX open_deck_slots_status_idx
    ON open_deck_slots (status, start_at ASC);
CREATE INDEX open_deck_set_nominations_slot_status_idx
    ON open_deck_set_nominations (slot_id, status, created_at ASC);
CREATE INDEX open_deck_fill_votes_slot_idx
    ON open_deck_fill_votes (slot_id, created_at ASC);
CREATE INDEX open_deck_eviction_votes_slot_idx
    ON open_deck_eviction_votes (slot_id, created_at ASC);

CREATE TRIGGER open_deck_slots_set_updated_at
BEFORE UPDATE ON open_deck_slots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER open_deck_set_nominations_set_updated_at
BEFORE UPDATE ON open_deck_set_nominations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
