CREATE TABLE trivia_question_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE
        CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    display_order integer NOT NULL CHECK (display_order > 0),
    question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 300),
    correct_answer text NOT NULL
        CHECK (char_length(btrim(correct_answer)) BETWEEN 1 AND 200),
    choices jsonb NOT NULL
        CHECK (jsonb_typeof(choices) = 'array' AND jsonb_array_length(choices) >= 2),
    explanation text CHECK (char_length(btrim(explanation)) BETWEEN 1 AND 500),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (choices ? correct_answer)
);

CREATE INDEX trivia_question_catalog_active_order_idx
    ON trivia_question_catalog (display_order, slug)
    WHERE is_active;

CREATE TRIGGER trivia_question_catalog_set_updated_at
BEFORE UPDATE ON trivia_question_catalog
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
