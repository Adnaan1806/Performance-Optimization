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

## Optimization 4: [coming next — Add DB indexes]

---

## Optimization 5: [coming next — Pagination on GET /products]

---

## Optimization 6: [coming next — Cache loadConfig() in memory]

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

*(to be filled)*

### Query Rewrites

*(to be filled)*

## Caching Implementation Summary

- Cache store: Redis (provisioned, not yet wired)
- Keys & TTLs: *(to be filled)*
- Invalidation strategy: *(to be filled)*
- Hit/miss ratio observed: *(to be measured)*
