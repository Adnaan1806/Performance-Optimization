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

## Optimization 7: Cache generated thumbnails in memory

### Problem
Every `GET /products/:id` ran `sharp().resize(400,400).jpeg()` on a 2000×2000 source image — 200–500ms of CPU work per request, every time, with no caching.

### Root Cause
The route comment even said "No cache, no CDN." The seeder generates only 20 unique source images shared across all 5,000 products, so the same resize was being repeated indefinitely for identical inputs.

### Solution

```diff
+ const thumbnailCache = new Map();
+
+ async function getThumbnail(imagePath) {
+   if (thumbnailCache.has(imagePath)) return thumbnailCache.get(imagePath);
+   const imageAbs = path.join(__dirname, '..', 'images', imagePath);
+   if (!fs.existsSync(imageAbs)) return null;
+   const buf = await sharp(imageAbs).resize(400, 400, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
+   const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
+   thumbnailCache.set(imagePath, dataUri);
+   return dataUri;
+ }

- // Regenerate a thumbnail on every single request. No cache, no CDN.
- const imageAbs = path.join(__dirname, '..', 'images', product.image_path);
- let thumbnailBase64 = null;
- if (fs.existsSync(imageAbs)) {
-   const buf = await sharp(imageAbs).resize(400, 400, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
-   thumbnailBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
- }
+ const thumbnailBase64 = await getThumbnail(product.image_path);
```

### Impact
- **Metric improved:** `GET /products/:id` response time
- **First request per image:** unchanged (~200–500ms for sharp to process)
- **All subsequent requests:** 0ms — returned directly from Map
- **Cache fills after:** 20 unique product detail page views (one per source image)

### Trade-offs
- Cache lives in process memory — cleared on server restart. Acceptable since re-warming takes at most 20 requests.
- Memory cost: 20 images × ~40KB base64 each ≈ ~800KB total. Negligible.

---

## Optimization 8: Add gzip compression middleware

### Problem
All API responses and static files were sent as raw uncompressed bytes. A single `/products` page response was ~40KB of JSON; the `/products` full list (before pagination) was ~2MB. No `Content-Encoding` header was set — the server comment even said "No compression middleware on purpose."

### Root Cause
`server.js` had no compression middleware registered. Express does not compress responses by default.

### Solution

```diff
+ const compression = require('compression');

  const app = express();
+ app.use(compression());
  app.use(express.json());
```

`compression` is the standard Express middleware that negotiates gzip/deflate with the client via `Accept-Encoding`, compresses the response body, and sets `Content-Encoding: gzip`. It skips compression for already-compressed formats (images, etc.) automatically.

### Impact
- **Metric improved:** Transfer size and TTFB on all JSON API responses
- **Typical reduction:** 60–80% on JSON payloads (text compresses extremely well)
- **Example:** A 40KB paginated `/products` response → ~8KB over the wire

### Trade-offs
- Small CPU cost per response for compression. Negligible compared to what we saved with the bcrypt fix.
- Already-compressed assets (JPEGs) are skipped automatically — no double-compression waste.

---

## Optimization 9: Add HTTP Cache-Control headers for images and API responses

### Problem
Two intentional omissions in `server.js`:
1. Images served with `etag: false, lastModified: false` — browsers re-downloaded every product image on every page visit
2. No `Cache-Control` on any API response — browsers and proxies treated everything as uncacheable and re-fetched on every navigation

### Root Cause
The comments in the original code explicitly said "No Cache-Control / ETag on purpose." Both `etag` and `lastModified` were disabled on the static image server, and no cache headers were set on any route.

### Solution

```diff
+ function cacheFor(seconds) {
+   return (req, res, next) => {
+     if (req.method === 'GET') {
+       res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`);
+     }
+     next();
+   };
+ }

- app.use('/images', express.static(..., { etag: false, lastModified: false }));
+ app.use('/images', express.static(..., { maxAge: '1y', immutable: true }));

- app.use('/home', homeRouter);
- app.use('/products', productsRouter);
- app.use('/search', searchRouter);
+ app.use('/home',     cacheFor(60),  homeRouter);
+ app.use('/products', cacheFor(300), productsRouter);
+ app.use('/search',   cacheFor(30),  searchRouter);
```

### TTL Rationale

| Route | TTL | Reason |
|-------|-----|--------|
| `/images` | 1 year + immutable | Static files that never change at runtime |
| `/home` | 60s | Featured/new arrivals change infrequently |
| `/products` | 300s (5min) | Product catalog is stable; 5min stale is acceptable |
| `/search` | 30s | Search results are more dynamic; short TTL to stay fresh |

`stale-while-revalidate` means the browser serves the stale cache instantly while fetching a fresh copy in the background — users never wait.

### Impact
- **Images:** Second visit to any product page loads images from browser cache (0 network requests for images)
- **API:** Repeat navigation to `/products` or `/home` within the TTL window: instant — served from cache with no round trip to the server
- **Metric improved:** Repeat-visit LCP, TTFB, and total transfer size

### Trade-offs
- PATCH responses (`/products/:id`) are excluded via `req.method === 'GET'` guard — mutations are never cached.
- Product updates won't be visible to users until their cache TTL expires (up to 5min). Acceptable for a catalog app; would need cache invalidation (Redis + ETags) for stricter freshness requirements.

---

## Optimization 10: Wire up Redis caching for hot API paths

### Problem
Redis was provisioned in Docker Compose (`REDIS_URL` env var set, container running) but never connected to or used. Every request hit PostgreSQL regardless of how recently the same query had run.

### Root Cause
No Redis client module existed in the codebase. The challenge README explicitly noted "Redis service running (intentionally unused — wire it up)."

### Solution

**`src/cache.js`** — shared cache-aside helper:
```javascript
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });

async function withCache(key, ttl, fetchFn) {
  try {
    const cached = await redis.get(key);
    if (cached !== null) return JSON.parse(cached);
  } catch { /* Redis unavailable — fall through */ }

  const value = await fetchFn();

  try { await redis.setex(key, ttl, JSON.stringify(value)); } catch {}

  return value;
}
```

Applied to the three hottest read routes:

| Route | Cache Key | TTL |
|-------|-----------|-----|
| `GET /home` | `home` | 60s |
| `GET /products?page=N&limit=M` | `products:page:N:limit:M` | 300s |
| `GET /search?q=Q` | `search:q` | 30s |

TTLs match the HTTP `Cache-Control` headers from Fix #9 — both caching layers stay in sync.

### Impact
- **Cache hit:** DB queries skipped entirely — response served from Redis in ~1ms
- **Cache miss (first request):** Same as before — DB query runs, result stored
- **Metric improved:** TTFB and DB load on repeat requests to all three routes

### Trade-offs
- Redis errors are caught silently — if Redis goes down the app keeps working, just without caching.
- `maxRetriesPerRequest: 1` prevents a slow/unavailable Redis from blocking requests.
- Search cache is keyed by query string — a unique search term per user won't benefit until the same query repeats.

---

## Optimization 11: Remove MUI icons, lodash, and moment from frontend bundle

### Problem
Three heavyweight libraries were imported but almost entirely unused, bloating the JS bundle the browser had to download and parse before anything rendered.

| Library | Bundle cost | Actual usage |
|---------|-------------|--------------|
| `@mui/icons-material` (all icons) | ~4MB raw | **Zero** — `import * as _AllIcons` in `main.jsx`, never referenced |
| `moment` | ~231KB | `fromNow()` in `ProductCard` + `ProductDetail` |
| `lodash` | ~70KB | `_.map` (Home), `_.truncate` (ProductCard) |

### Root Cause
- `main.jsx` imported the entire MUI icon library with a side-effectful `import *` just to keep it in the bundle — intentional bloat with a comment to that effect.
- `Home.jsx` used `_.map` when `Array.prototype.map` is identical.
- `ProductCard.jsx` used `_.truncate` (a simple string operation) and `moment` (a 231KB library) just for a relative time string.

### Solution

**`main.jsx`** — delete the import entirely:
```diff
- import * as _AllIcons from '@mui/icons-material';
- _AllIcons;
```

**`Home.jsx`** — native array method:
```diff
- import _ from 'lodash';
- {_.map(items, (p) => <ProductCard key={p.id} product={p} />)}
+ {items.map((p) => <ProductCard key={p.id} product={p} />)}
```

**`ProductCard.jsx`** + **`ProductDetail.jsx`** — replace `_.truncate` and `moment` with native equivalents:
```diff
- import _ from 'lodash';
- import moment from 'moment';
- const name = _.truncate(product.name, { length: 36 });
- const when = moment(product.created_at).fromNow();
+ const name = product.name.length > 36 ? product.name.slice(0, 33) + '...' : product.name;
+ // timeAgo() uses Intl.RelativeTimeFormat — built into every modern browser, 0KB
```

### Impact

| | Before | After |
|---|---|---|
| JS bundle (raw) | ~4.3MB+ | **169KB** |
| JS bundle (gzip) | ~1MB+ | **55KB** |
| Build time | slow | 1.47s |

**~96% reduction in bundle size.**

### Trade-offs
- `Intl.RelativeTimeFormat` requires a modern browser (supported in all browsers since 2020 — no concern for this app).
- `moment` and `lodash` are still listed in `package.json` — they can be removed from dependencies entirely but the app works correctly without them being imported.

---

## Optimization 12: React.lazy code splitting for page routes

### Problem
All 4 page components were statically imported in `App.jsx` — bundled into a single JS file. A user landing on the homepage downloaded the code for `ProductDetail`, `ProductList`, and `Search` immediately, even if they never visited those pages.

### Root Cause
Standard static `import` statements are resolved at build time and placed into one chunk. No dynamic splitting was configured.

### Solution

```diff
- import Home from './pages/Home.jsx';
- import ProductList from './pages/ProductList.jsx';
- import ProductDetail from './pages/ProductDetail.jsx';
- import Search from './pages/Search.jsx';
+ import React, { useState, lazy, Suspense } from 'react';
+
+ const Home          = lazy(() => import('./pages/Home.jsx'));
+ const ProductList   = lazy(() => import('./pages/ProductList.jsx'));
+ const ProductDetail = lazy(() => import('./pages/ProductDetail.jsx'));
+ const Search        = lazy(() => import('./pages/Search.jsx'));

- <Routes>...</Routes>
+ <Suspense fallback={<p>Loading…</p>}>
+   <Routes>...</Routes>
+ </Suspense>
```

`React.lazy` + dynamic `import()` tells Vite to emit each page as a separate chunk. `Suspense` shows a fallback while the chunk is being fetched on first navigation.

### Impact

| Chunk | Size (gzip) | Loaded when |
|-------|-------------|-------------|
| `index.js` (React + router) | 54.6KB | Always |
| `Home.js` | 0.45KB | `/` |
| `ProductList.js` | 0.71KB | `/products` |
| `ProductDetail.js` | 0.79KB | `/products/:id` |
| `Search.js` | 0.47KB | `/search` |

- **Initial load (homepage):** downloads only `index.js` (54.6KB gzip) — page chunks load on demand
- **Subsequent navigation:** chunks are cached by the browser — near-instant

### Trade-offs
- First navigation to each page incurs a small extra network round-trip to fetch its chunk. Given each page chunk is under 1KB gzip, this is imperceptible.
- `Suspense` fallback shows "Loading…" briefly on the first visit to each page.

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

- **Cache store:** Redis 7 (ioredis client)
- **Keys & TTLs:**
  - `home` → 60s
  - `products:page:N:limit:M` → 300s
  - `search:<query>` → 30s
- **Invalidation strategy:** TTL-based expiry. On PATCH `/products/:id` the relevant page cache would need to be invalidated — not yet implemented (acceptable for a read-heavy catalog).
- **Resilience:** Redis errors caught silently — app degrades gracefully to DB-only mode
- **Hit/miss ratio observed:** All 3 keys confirmed stored after first request; subsequent requests served from cache
