# Code Optimizations Applied

---

## Optimization 1: Replace bcrypt with HMAC in request signing middleware

### Problem
Every HTTP request — before any route handler ran — was blocked for 300–500ms by a synchronous bcrypt hash operation. This serialized the entire server: no second request could be processed until the first one's bcrypt call finished.

### Root Cause
`signing.js` called `bcrypt.hashSync(payload, 12)`. bcrypt with cost factor 12 intentionally performs ~4096 hashing rounds to resist brute-force password cracking. That design property is correct for password storage but catastrophic on a hot request path. `hashSync` (synchronous) blocks Node's single-threaded event loop for the full duration, stalling every other in-flight request.

### Solution

```diff
- const bcrypt = require('bcrypt');
+ const crypto = require('crypto');

+ const SECRET = process.env.SIGNING_SECRET || 'dev-secret';

  module.exports = function signing(req, res, next) {
    const payload = `${req.method}:${req.path}:${Date.now()}`;
-   const signature = bcrypt.hashSync(payload, 12);
+   const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    res.setHeader('X-Request-Signature', signature.slice(0, 24));
    next();
  };
```

### Impact
- **Metric improved:** API response time (all endpoints)
- **Expected improvement:** ~300–500ms removed from every request's baseline latency
- **Event loop:** No longer blocked — concurrent requests can now be processed in parallel

### Trade-offs
- The old bcrypt "signature" was never verified anywhere, so no functionality is lost.
- HMAC requires a stable `SIGNING_SECRET` env var. Fallback `'dev-secret'` is fine for dev; production should set a real secret.

---

## Optimization 2: Replace single pg.Client with pg.Pool

### Problem
The entire backend shared one database connection (`pg.Client`). All queries across all concurrent requests were serialized through that single connection. Three simultaneous requests meant the second and third waited for the first to finish every query before they could start.

### Root Cause
`pg.Client` is a single persistent connection — it can only run one query at a time. `getClient()` returned the same instance to every route handler, so they all queued on the same socket.

### Solution

```diff
- const { Client } = require('pg');
+ const { Pool } = require('pg');

- const client = new Client({
-   connectionString: process.env.DATABASE_URL || 'postgres://shop:shop@localhost:5432/shop',
- });
- let connected = false;
- async function getClient() {
-   if (!connected) {
-     await client.connect();
-     connected = true;
-   }
-   return client;
- }
+ const pool = new Pool({
+   connectionString: process.env.DATABASE_URL || 'postgres://shop:shop@localhost:5432/shop',
+   max: 10,
+   idleTimeoutMillis: 30000,
+   connectionTimeoutMillis: 2000,
+ });
+ function getClient() {
+   return pool;
+ }

  module.exports = { getClient };
```

`Pool` maintains up to 10 connections. Each `pool.query()` checks out a free connection, runs the query, and returns it automatically — no changes needed in the routes since they already call `db.query(...)`.

### Impact
- **Metric improved:** Throughput (req/sec) and response time under concurrent load
- **Expected improvement:** Near-linear scaling up to 10 concurrent requests instead of full serialization
- **Resilience:** Pool automatically reconnects on dropped connections

### Trade-offs
- Pool holds up to 10 open connections even when idle. Standard practice and worth the resource cost.
- `max: 10` can be tuned up if Postgres `max_connections` allows it.

---

## Optimization 3: Eliminate N+1 queries with JOIN queries

### Problem
Every route that returned a list of products ran 2 extra DB queries **per product** — one to fetch the category, one to aggregate ratings. With 5,000 products on the list page this meant **10,001 queries per request** instead of 1.

```
GET /products
  → SELECT * FROM products          (1 query, returns 5000 rows)
  → for each product:
      SELECT * FROM categories ...  (1 query × 5000 = 5000)
      SELECT AVG(rating) ...        (1 query × 5000 = 5000)
  = 10,001 total queries
```

Affected routes: `GET /home`, `GET /products`, `GET /search`.

### Root Cause
An `enrich()` helper in `home.js` and inline loops in `products.js` and `search.js` iterated over a product array in JavaScript, firing individual queries for each row. This is the classic N+1 anti-pattern — the application is doing work the database should do in a single pass.

### Solution

Replace the loop + per-product queries with a single `LEFT JOIN` + `GROUP BY` query per section. The DB joins categories and aggregates reviews in one pass.

```diff
- // home.js — old: fetch products, then loop with 2 queries each
- const { rows: featured } = await db.query(
-   'SELECT id, name, price, category_id, image_path FROM products WHERE featured = TRUE ...'
- );
- featured: await enrich(db, featured)   // → N×2 more queries inside

+ // home.js — new: everything in one query
+ const { rows: featured } = await db.query(`
+   SELECT p.id, p.name, p.price, p.category_id, p.image_path,
+          c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug,
+          COALESCE(AVG(r.rating), 0)::float AS avg_rating,
+          COUNT(r.id)::int AS review_count
+   FROM products p
+   LEFT JOIN categories c ON c.id = p.category_id
+   LEFT JOIN reviews r ON r.product_id = p.id
+   WHERE p.featured = TRUE
+   GROUP BY p.id, c.id, c.name, c.slug
+   ORDER BY p.created_at DESC
+   LIMIT $1`, [config.featuredLimit]);
+ featured: featured.map(shape)          // → pure JS, zero extra queries
```

Same pattern applied to `newArrivals`, `topRated` (home.js), `GET /products` list, and `GET /search`.

### Impact
- **Metric improved:** Response time for `/home`, `/products`, `/search`
- **Expected improvement:** Query count drops from O(N) to O(1) per request — the single biggest latency reduction after the bcrypt fix
- **Example:** Product list page: 10,001 queries → 1 query

### Trade-offs
- The JOIN query is more complex SQL but far more efficient at scale.
- `GROUP BY` with `LEFT JOIN reviews` on an unindexed `reviews.product_id` still does a full scan — adding the index (Fix #4) completes the optimization.

---

## Optimization 4: Add missing database indexes

### Problem
The schema had primary keys only. Every query filtering, joining, or sorting hit a full sequential scan — Postgres had to read every row in the table to find matches.

### Root Cause
`001_schema.sql` explicitly left out all non-PK indexes as part of the challenge. The impact:
- `reviews.product_id` — 50,000-row seq scan on every rating JOIN/GROUP BY
- `products.featured` — 5,000-row seq scan to find ~handful of featured rows
- `products.created_at` — full sort of 5,000 rows on every list query
- `products.category_id` — 5,000-row scan on every category JOIN
- `ILIKE '%q%'` — B-tree indexes are useless for leading-wildcard search; full scan every search

### Solution

New migration `002_indexes.sql`:

```sql
-- reviews.product_id: most-hit column in the entire workload
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);

-- products.featured: partial index — only indexes the TRUE rows
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = TRUE;

-- products.created_at: covers ORDER BY created_at DESC on every list query
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

-- products.category_id: covers JOIN categories ON c.id = p.category_id
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- Trigram GIN indexes: enable fast ILIKE '%q%' search on name + description
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm        ON products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);
```

### Impact
- **reviews.product_id:** Rating aggregation goes from full 50k-row scan to direct index lookup — biggest DB-level win alongside Fix #3
- **featured partial index:** Home featured section scan: 5,000 rows → only indexed TRUE rows
- **created_at index:** Eliminates full sort on every list/home query
- **Trigram indexes:** Search query goes from full table scan to GIN index lookup

### Trade-offs
- Indexes consume disk space and add a small overhead to INSERT/UPDATE on those columns. Acceptable cost for a read-heavy product catalog.
- `pg_trgm` GIN indexes are large (trigrams expand the index size) but necessary for ILIKE support. A full-text `tsvector` index would be even faster for word-level search but requires query changes.

---

## Optimization 5: Add pagination to GET /products

### Problem
`GET /products` returned all 5,000 products in a single response — even after the N+1 fix. This meant:
- DB returns 5,000 rows every request
- Node serializes a ~2MB JSON payload
- Browser renders 5,000 `<ProductCard>` components at once
- Client-side `_.sortBy` + `.filter` iterates 5,000 items on every keystroke

### Root Cause
No `LIMIT`/`OFFSET` on the query and no pagination concept in the frontend. The API was designed to dump everything and let the client deal with it.

### Solution

**Backend** — `?page=N&limit=20`, capped at 100 per page. Runs the paginated query and a count query in parallel with `Promise.all`:

```diff
- 'SELECT ... FROM products ... ORDER BY created_at DESC'
+ 'SELECT ... FROM products ... ORDER BY created_at DESC LIMIT $1 OFFSET $2'

+ Response now includes: { total, page, limit, totalPages, count, products }
```

**Frontend** — `ProductList.jsx` gains page state and Prev/Next controls. Filter now applies within the current page (server-side search via `/search` handles cross-page search).

### Impact
- **Metric improved:** `GET /products` response time and payload size
- **Payload:** ~2MB → ~40KB per page (20 products × ~2KB each)
- **Render:** 5,000 DOM nodes → 20 per page
- **DB work:** Returns 20 rows instead of 5,000

### Trade-offs
- Client-side filter now only searches the current page. Users needing full search should use the `/search` page (which queries the DB across all products).
- `Promise.all` for data + count adds one extra query per request, but both are fast with indexes in place.

---

## Optimization 6: Cache config in memory instead of reading from disk per request

### Problem
`loadConfig()` was called at the top of every request handler in `home.js` and `products.js`. Each call did a synchronous `fs.readFileSync` + `JSON.parse` — blocking the event loop on every single request.

### Root Cause
`config.js` was intentionally written to re-read from disk on every call. The comment even says "intentionally not cached." The config file (`config.json`) never changes at runtime, so there is no reason to re-read it.

### Solution

```diff
- // Read config from disk on every call — intentionally not cached.
- function loadConfig() {
-   const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
-   return JSON.parse(raw);
- }

+ // Read once at module load time — config does not change at runtime.
+ const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
+
+ function loadConfig() {
+   return config;
+ }
```

Node caches the module after first `require()`, so the file is read exactly once when the server starts, then every subsequent `loadConfig()` call returns the already-parsed object instantly.

### Impact
- **Metric improved:** Latency on all routes that call `loadConfig()` (`/home`, `/products`)
- **Improvement:** Eliminates a synchronous disk read + JSON parse on every request — effectively ~0ms overhead instead of ~1–2ms of blocking I/O

### Trade-offs
- Config changes require a server restart to take effect. Acceptable for static app config; not suitable for feature flags that need live reloads.

---

## Optimization 7: [coming next — Cache thumbnails]

---

## Optimization 8: [coming next — Add gzip compression]

---

## Optimization 9: [coming next — HTTP Cache-Control headers]

---

## Optimization 10: [coming next — Redis caching for hot API paths]

---

## Optimization 11: [coming next — Remove MUI icons + lodash from frontend bundle]

---

## Optimization 12: [coming next — React.lazy code splitting]

---

## Database Optimizations Summary

### Indexes Added

```sql
CREATE INDEX idx_reviews_product_id        ON reviews(product_id);
CREATE INDEX idx_products_featured         ON products(featured) WHERE featured = TRUE;
CREATE INDEX idx_products_created_at       ON products(created_at DESC);
CREATE INDEX idx_products_category_id      ON products(category_id);
CREATE INDEX idx_products_name_trgm        ON products USING GIN (name gin_trgm_ops);
CREATE INDEX idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);
```

### Query Rewrites

*(to be filled)*

## Caching Implementation Summary

- Cache store: Redis (provisioned, not yet wired)
- Keys & TTLs: *(to be filled)*
- Invalidation strategy: *(to be filled)*
- Hit/miss ratio observed: *(to be measured)*
