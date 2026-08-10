CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    password_hash text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending')),
    roles text[] NOT NULL DEFAULT ARRAY['user']::text[] CHECK (cardinality(roles) > 0),
    email_verified_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE oauth_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'github')),
    provider_subject text NOT NULL,
    provider_email text,
    profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject),
    UNIQUE (user_id, provider)
);

CREATE TABLE oauth_authorization_requests (
    state_hash char(64) PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('google', 'github')),
    code_verifier text NOT NULL,
    redirect_uri text NOT NULL,
    return_to text NOT NULL DEFAULT '/',
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_authorization_requests_expiry_idx ON oauth_authorization_requests (expires_at);

CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id uuid NOT NULL,
    token_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by_id uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    created_by_ip inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, created_at DESC);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE recipes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL,
    summary text NOT NULL,
    image_url text,
    ingredients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ingredients) = 'array'),
    instructions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(instructions) = 'array'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE magic_decks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL,
    format text NOT NULL,
    colors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(colors) = 'array'),
    commander text,
    card_count integer NOT NULL DEFAULT 0 CHECK (card_count >= 0),
    summary text NOT NULL,
    strategy text NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE magic_deck_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id uuid NOT NULL REFERENCES magic_decks(id) ON DELETE CASCADE,
    section text NOT NULL,
    section_position integer NOT NULL CHECK (section_position >= 0),
    card_position integer NOT NULL CHECK (card_position >= 0),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
    card_name text NOT NULL,
    UNIQUE (deck_id, section_position, card_position)
);
CREATE INDEX magic_deck_cards_deck_idx ON magic_deck_cards (deck_id, section_position, card_position);

CREATE TABLE magic_guides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id uuid REFERENCES magic_decks(id) ON DELETE SET NULL,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL,
    summary text NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE magic_guide_sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guide_id uuid NOT NULL REFERENCES magic_guides(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    heading text NOT NULL,
    body text NOT NULL,
    UNIQUE (guide_id, position)
);
CREATE INDEX magic_guide_sections_guide_idx ON magic_guide_sections (guide_id, position);

CREATE TABLE games (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL,
    short_description text NOT NULL,
    strategy_notes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(strategy_notes) = 'array'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE music_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL,
    artist text NOT NULL,
    spotify_url text NOT NULL,
    notes text,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recipes_public_idx ON recipes (published_at DESC) WHERE status = 'published';
CREATE INDEX magic_decks_public_idx ON magic_decks (published_at DESC) WHERE status = 'published';
CREATE INDEX magic_guides_public_idx ON magic_guides (published_at DESC) WHERE status = 'published';
CREATE INDEX games_public_idx ON games (published_at DESC) WHERE status = 'published';
CREATE INDEX music_entries_public_idx ON music_entries (published_at DESC) WHERE status = 'published';

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER oauth_accounts_set_updated_at BEFORE UPDATE ON oauth_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER magic_decks_set_updated_at BEFORE UPDATE ON magic_decks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER magic_guides_set_updated_at BEFORE UPDATE ON magic_guides FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER games_set_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER music_entries_set_updated_at BEFORE UPDATE ON music_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

