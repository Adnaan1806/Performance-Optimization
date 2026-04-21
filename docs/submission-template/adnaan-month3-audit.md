# Performance Audit Report

## Executive Summary

The application had **12 deliberate performance bottlenecks** across the backend, database, and frontend. The single most damaging was `bcrypt.hashSync(cost=12)` running synchronously in a middleware on every request, blocking the Node.js event loop for ~400ms before any route handler could run. Combined with N+1 database queries, a single shared DB connection, and a ~4MB JS bundle, the app was effectively unusable under any load.

**Critical issues identified (P0):**
1. bcrypt on every request — 400ms event-loop block
2. Single `pg.Client` — all queries serialised
3. N+1 queries — up to 10,001 DB queries per `/products` request
4. No pagination — all 5,000 products loaded in one response

**Recommended priority order:**
1. bcrypt → connection pool → N+1 → indexes → pagination → config cache → thumbnail cache → compression → cache headers → Redis → frontend bundle → code splitting

---

## Methodology

- **Tools used:**
  - `autocannon` (15s, 10 connections) for API throughput and latency
  - Code inspection for bottleneck identification
  - `pg_stat_statements` (enabled via `docker-compose.yml`) for slow query analysis
  - Vite build output for bundle size analysis
  - `Intl.RelativeTimeFormat` / native APIs as replacements

- **Testing conditions:**
  - Windows 11 Pro, Docker Desktop, 16 CPUs
  - All services running locally via Docker Compose
  - 50 categories, 5,000 products, 50,762 reviews seeded

- **Baseline measurements:** See `adnaan-month3-metrics.md`

---

## Findings

### Critical Issues (P0)

| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|
| `bcrypt.hashSync(cost=12)` on every request | +400ms blocking latency per request, serialises all concurrency | `src/middleware/signing.js` | Low — replace with `crypto.createHmac` |
| Single `pg.Client` (no pool) | All queries from all requests queue on one socket | `src/db.js` | Low — swap `Client` for `Pool` |
| N+1 queries on all list/home/search routes | Up to 10,001 queries for `/products`, ~180 for `/home` | `src/routes/home.js`, `products.js`, `search.js` | Medium — rewrite with JOIN queries |
| No pagination on `GET /products` | 5,000 rows returned, ~2MB JSON, 5,000 DOM nodes rendered | `src/routes/products.js`, `ProductList.jsx` | Medium — add LIMIT/OFFSET + page controls |

### High Priority (P1)

| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|
| Sharp thumbnail regenerated on every `GET /products/:id` | ~300ms CPU per request for identical inputs | `src/routes/products.js` | Low — in-memory Map cache |
| `loadConfig()` reads JSON from disk per request | Synchronous I/O on every request to `/home` and `/products` | `src/config.js` | Low — read once at module load |
| No gzip compression | Full JSON payloads sent uncompressed (60–80% larger) | `src/server.js` | Low — add `compression` middleware |
| No HTTP Cache-Control / ETags | Browsers re-download images and API responses on every visit | `src/server.js` | Low — add headers per route |
| ILIKE on unindexed columns | Full 5,000-row table scan on every search | `src/routes/search.js` | Low — add `pg_trgm` GIN index |
| Redis provisioned but never used | All hot paths hit PostgreSQL on every request | None | Medium — wire up cache-aside |

### Medium Priority (P2)

| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|
| No DB indexes (reviews.product_id, products.featured, etc.) | Full seq scans on 50k reviews for every rating aggregation | Schema | Low — one migration file |
| `@mui/icons-material` fully imported (~4MB) | ~4MB of unused JS in the browser bundle | `src/main.jsx` | Low — delete import |
| `moment` imported (~231KB) | Used only for `fromNow()`, replaceable with `Intl.RelativeTimeFormat` | `ProductCard.jsx`, `ProductDetail.jsx` | Low — replace with native |
| `lodash` fully imported (~70KB) | Used only for `_.map` and `_.truncate` | `Home.jsx`, `ProductCard.jsx` | Low — replace with native |
| No code splitting | All pages bundled together; user downloads all page code upfront | `App.jsx` | Low — add `React.lazy` |

---

## Database Analysis

**Slow query log analysis (`log_min_duration_statement=100ms` enabled via docker-compose.yml):**
- Rating aggregation queries (`SELECT AVG(rating) FROM reviews WHERE product_id = $1`) were the heaviest — called N times (once per product) with a full 50k-row seq scan each time due to missing index on `reviews.product_id`
- The top-rated subquery (`GROUP BY product_id HAVING COUNT(*) >= 3`) also scanned all 50k reviews
- ILIKE `%q%` search on `products.name` and `products.description` did full 5k-row table scans

**Missing indexes identified:**
- `reviews.product_id` — most critical; hit on every rating aggregation
- `products.featured` — WHERE clause in home featured section
- `products.created_at` — ORDER BY on all list queries
- `products.category_id` — JOIN condition
- GIN trigram on `products.name`, `products.description` — for ILIKE search

**N+1 query detection:**
- `home.js`: `enrich()` helper called in a loop — 2 queries × N products per section
- `products.js` GET /: inline loop — 2 queries × 5,000 products = 10,001 total
- `search.js`: category loop — 1 query × N results

All fixed by rewriting with `LEFT JOIN` + `GROUP BY` in a single query per route.

---

## Frontend Analysis

**Bundle size (before):**
- Single chunk, ~4.3MB raw / ~1MB+ gzip
- `@mui/icons-material`: ~4MB (0% of icons actually used)
- `moment`: ~231KB (used for one `fromNow()` call)
- `lodash`: ~70KB (used for `_.map` and `_.truncate`)

**Bundle size (after):**
- `index.js` (React + router): 54.6KB gzip
- Page chunks: 0.45–1.47KB gzip each (lazy-loaded)
- **~96% reduction in initial JS download**

**Render-blocking resources:**
- Fat bundle delayed JS parse + execution, pushing back FCP and TTI significantly
- No code splitting meant all page code parsed even for pages never visited

**Core Web Vitals (estimated after):**
- FCP: ~300ms (vs ~2s+ before)
- LCP: ~400ms (vs ~4.5s before)
- TTI: ~400–600ms (vs ~4.5–5.1s before)

---

## Backend Analysis

**API response time breakdown (before → after):**

| Bottleneck | Before | After |
|-----------|--------|-------|
| Signing middleware | +400ms every request | <1ms (HMAC) |
| DB connection wait | Queued behind single Client | Pool (10 connections) |
| N+1 queries (products list) | ~50s (10,001 queries) | ~4ms (1 query) |
| Thumbnail generation | ~300ms per `/products/:id` | 0ms (cached after first) |
| Config file read | ~1ms sync I/O per request | 0ms (module-level cache) |
| Response payload (no gzip) | ~2MB JSON | ~40KB gzip |

**CPU/Memory profiling:**
- `bcrypt.hashSync(cost=12)` was the primary CPU bottleneck — monopolising the event loop thread
- After removal, CPU usage normalized and throughput scaled linearly with connection pool

**I/O bottlenecks:**
- `fs.readFileSync` in `loadConfig()` — synchronous disk read per request, now cached at startup
- `sharp` image processing — CPU-bound, now cached in-memory after first generation

---

## Recommendations

Prioritised by impact-to-effort ratio:

1. **[Done] bcrypt → HMAC** — highest impact single change, zero functionality lost
2. **[Done] pg.Pool** — unlocks true concurrency, prerequisite for everything else
3. **[Done] Eliminate N+1** — order-of-magnitude query reduction
4. **[Done] DB indexes** — completes the DB optimisation, especially `reviews.product_id`
5. **[Done] Pagination** — prevents O(N) response growth as catalog scales
6. **[Done] Cache config + thumbnails** — eliminates remaining sync I/O
7. **[Done] Compression + Cache-Control** — large wins for repeat visitors
8. **[Done] Redis cache-aside** — removes DB load on hot repeat requests
9. **[Done] Trim frontend bundle** — 96% JS reduction improves parse + render time
10. **[Done] Code splitting** — further reduces initial load to only what's needed
