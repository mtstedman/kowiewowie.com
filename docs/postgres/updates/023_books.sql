CREATE TABLE books (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (char_length(slug) <= 160 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
    author text CHECK (author IS NULL OR char_length(author) BETWEEN 1 AND 255),
    amazon_url text NOT NULL CHECK (char_length(amazon_url) <= 2000 AND amazon_url ~ '^https://'),
    cover_image_url text NOT NULL CHECK (char_length(cover_image_url) <= 2000 AND cover_image_url ~ '^https://'),
    price_amount numeric(12, 2) NOT NULL CHECK (price_amount >= 0),
    price_currency text NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),
    overview text NOT NULL CHECK (char_length(overview) BETWEEN 1 AND 20000),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX books_public_idx ON books (published_at DESC) WHERE status = 'published';

CREATE TRIGGER books_set_updated_at BEFORE UPDATE ON books FOR EACH ROW EXECUTE FUNCTION set_updated_at();