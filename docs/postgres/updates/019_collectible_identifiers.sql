-- Retail identifiers on collectibles: the store's SKU and the product barcode
-- (UPC/EAN/JAN digits) when a source publishes them. Both stay optional; a
-- refresh that omits one keeps the stored value.
ALTER TABLE collectible_products
    ADD COLUMN sku text NULL CHECK (sku IS NULL OR length(sku) BETWEEN 1 AND 64),
    ADD COLUMN barcode text NULL CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');

ALTER TABLE collectible_variants
    ADD COLUMN sku text NULL CHECK (sku IS NULL OR length(sku) BETWEEN 1 AND 64),
    ADD COLUMN barcode text NULL CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');
