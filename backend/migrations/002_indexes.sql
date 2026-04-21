-- Migration 002: Add missing indexes identified during performance audit.
-- The base schema (001) intentionally had primary keys only.

-- 1. reviews.product_id
--    Every rating JOIN and GROUP BY scans all 50k reviews to match a product.
--    This is the single most-hit column in the entire query workload.
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);

-- 2. products.featured
--    WHERE featured = TRUE on the home route scans all 5k products.
--    Partial index only covers the TRUE rows — smaller, faster.
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = TRUE;

-- 3. products.created_at
--    ORDER BY created_at DESC on nearly every list query requires a full sort
--    without this index.
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

-- 4. products.category_id
--    JOIN categories ON c.id = p.category_id scans products without this.
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- 5. Trigram indexes for ILIKE search on name and description.
--    ILIKE '%q%' cannot use a B-tree index (leading wildcard).
--    pg_trgm breaks text into character trigrams and indexes them in a GIN,
--    allowing fast substring/ILIKE lookups.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm        ON products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);
