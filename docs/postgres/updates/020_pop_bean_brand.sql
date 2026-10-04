-- POP BEAN (Pop Mart's bean-sized blind-box figures) joins the collectible lines.
ALTER TABLE collectible_products
    DROP CONSTRAINT IF EXISTS collectible_products_brand_check;

ALTER TABLE collectible_products
    ADD CONSTRAINT collectible_products_brand_check
        CHECK (brand IN ('skullpanda', 'nommi', 'sonny-angel', 'pop-bean'));
