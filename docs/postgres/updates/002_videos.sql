CREATE TABLE videos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL,
    description text,
    youtube_id text NOT NULL CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
    channel_title text NOT NULL,
    thumbnail_url text,
    duration_seconds integer CHECK (duration_seconds >= 0),
    view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX videos_public_idx ON videos (published_at DESC) WHERE status = 'published';

CREATE TRIGGER videos_set_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
