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

## Optimization 3: [coming next — Fix N+1 queries]

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
