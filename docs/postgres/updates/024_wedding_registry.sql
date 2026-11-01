-- Wedding registry: one profile per registered user, the registries the couple
-- enrolled in, and the popular products they picked for each registry.
CREATE TABLE wedding_registry_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    partner_one_name text NOT NULL CHECK (char_length(partner_one_name) BETWEEN 1 AND 120),
    partner_two_name text NOT NULL CHECK (char_length(partner_two_name) BETWEEN 1 AND 120),
    wedding_date date,
    contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
    shipping_address text CHECK (shipping_address IS NULL OR char_length(shipping_address) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER wedding_registry_profiles_set_updated_at
BEFORE UPDATE ON wedding_registry_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wedding_registry_enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registry_key text NOT NULL CHECK (registry_key IN ('amazon', 'target', 'zola')),
    status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled')),
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, registry_key)
);

CREATE INDEX wedding_registry_enrollments_user_idx ON wedding_registry_enrollments (user_id);

CREATE TRIGGER wedding_registry_enrollments_set_updated_at
BEFORE UPDATE ON wedding_registry_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wedding_registry_product_picks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registry_key text NOT NULL CHECK (registry_key IN ('amazon', 'target', 'zola')),
    product_key text NOT NULL CHECK (product_key ~ '^[a-z0-9-]{1,80}$'),
    status text NOT NULL DEFAULT 'picked' CHECK (status IN ('picked', 'added')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, registry_key, product_key)
);

CREATE INDEX wedding_registry_product_picks_user_idx ON wedding_registry_product_picks (user_id);

CREATE TRIGGER wedding_registry_product_picks_set_updated_at
BEFORE UPDATE ON wedding_registry_product_picks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
