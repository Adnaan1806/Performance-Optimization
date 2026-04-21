# Caching Strategy

## Overview

The application uses a **three-layer caching architecture** to minimise repeated work at every level — from the browser down to the database.

- **Browser cache** — HTTP `Cache-Control` headers tell browsers to keep static assets and API responses locally, eliminating round trips for repeat visits
- **Application cache (Redis)** — hot API responses cached in Redis so repeated requests never reach the database
- **In-process cache** — config and thumbnails cached in Node.js memory for zero-overhead access within a process

**Technology choices:**
- Redis 7 (Alpine) — already provisioned, fast, battle-tested for cache-aside workloads
- `ioredis` client — robust Node.js Redis client with automatic reconnection and per-command timeout
- `express` `compression` middleware — gzip at the transport layer (complements caching by reducing transfer size)
- Native `Cache-Control` headers — no extra library needed

---

## Cache Hierarchy

```
Browser Cache (Cache-Control headers)
        ↓  on miss
Redis Application Cache (ioredis, cache-aside)
        ↓  on miss
PostgreSQL (indexed queries, connection pool)
        ↓
Node.js In-Process Cache (config, thumbnails)
```

---

## Caching Policies

### Static Assets

| Asset Type | Cache Duration | Strategy |
|------------|----------------|----------|
| Product images (JPG) | 1 year | `Cache-Control: public, max-age=31536000, immutable` — filename never changes |
| JS chunks (hashed) | 1 year | Vite appends content hash to filename — safe to cache forever |
| CSS (hashed) | 1 year | Same as JS |
| `index.html` | No cache | Always fresh — contains references to hashed assets |

### API Responses

| Endpoint | HTTP TTL | Redis TTL | Invalidation |
|----------|----------|-----------|--------------|
| `GET /home` | 60s (`stale-while-revalidate=300`) | 60s | TTL expiry |
| `GET /products?page=N` | 300s (`stale-while-revalidate=1500`) | 300s | TTL expiry |
| `GET /products/:id` | 300s | Not cached (thumbnail in-process) | TTL expiry |
| `GET /search?q=Q` | 30s (`stale-while-revalidate=150`) | 30s | TTL expiry |
| `PATCH /products/:id` | Not cached | — | Mutates data |

`stale-while-revalidate` means the browser serves the stale cached response instantly while fetching a fresh copy in the background — users never wait on TTL expiry.

### In-Process Caches (Node.js Memory)

| Data | Cache mechanism | TTL | Invalidation |
|------|----------------|-----|--------------|
| `config.json` | Module-level constant | Forever | Server restart |
| Thumbnails (base64) | `Map<image_path, dataUri>` | Forever | Server restart |

Only 20 unique source images exist — the thumbnail Map fills after 20 unique product detail visits.

---

## Redis Cache Keys

| Key pattern | Example | TTL |
|-------------|---------|-----|
| `home` | `home` | 60s |
| `products:page:N:limit:M` | `products:page:1:limit:20` | 300s |
| `search:<query>` | `search:shirt` | 30s |

---

## Invalidation Strategy

**TTL-based (primary):**
All Redis keys use `SETEX` with explicit TTLs. Keys expire automatically — no manual invalidation required for read-heavy catalog data where a few minutes of staleness is acceptable.

**Event-based (future improvement):**
`PATCH /products/:id` currently does not invalidate the Redis cache. The correct approach would be:
```javascript
// In PATCH /products/:id handler, after successful UPDATE:
await redis.del('home');
await redis.del(`products:page:1:limit:20`); // or scan + del pattern
// product:id key (if added) would also be deleted here
```

**Cache warming:**
No explicit warming — the cache fills on first request per key. Given the small number of distinct keys (`home`, ~250 product pages, search terms), warm-up is fast under normal traffic.

---

## Implementation Details

**`src/cache.js` — shared cache-aside helper:**

```javascript
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,  // fail fast; don't hang requests on Redis issues
});

redis.on('error', (err) => console.warn('[cache] Redis error:', err.message));

// Cache get + set with fallback to fetchFn on miss
async function withCache(key, ttl, fetchFn) {
  try {
    const cached = await redis.get(key);
    if (cached !== null) return JSON.parse(cached);  // cache HIT
  } catch { /* Redis down — fall through to DB */ }

  const value = await fetchFn();                     // cache MISS

  try { await redis.setex(key, ttl, JSON.stringify(value)); } catch {}

  return value;
}
```

**Usage in routes:**
```javascript
// home.js
const data = await withCache('home', 60, async () => {
  // ... run 3 JOIN queries against PostgreSQL
  return { site, featured, newArrivals, topRated };
});
res.json(data);

// products.js
const cacheKey = `products:page:${page}:limit:${limit}`;
const data = await withCache(cacheKey, 300, async () => { ... });

// search.js
const data = await withCache(`search:${q.toLowerCase()}`, 30, async () => { ... });
```

**HTTP Cache-Control (server.js):**
```javascript
function cacheFor(seconds) {
  return (req, res, next) => {
    if (req.method === 'GET') {
      res.set('Cache-Control',
        `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`);
    }
    next();
  };
}

app.use('/images',   express.static(..., { maxAge: '1y', immutable: true }));
app.use('/home',     cacheFor(60),  homeRouter);
app.use('/products', cacheFor(300), productsRouter);
app.use('/search',   cacheFor(30),  searchRouter);
```

---

## Monitoring

| Metric | Target | How to check |
|--------|--------|--------------|
| Redis hit ratio | >80% on warm cache | `redis-cli INFO stats` → `keyspace_hits / (keyspace_hits + keyspace_misses)` |
| Redis memory usage | <50MB | `redis-cli INFO memory` → `used_memory_human` |
| Key eviction | 0 evictions | `redis-cli INFO stats` → `evicted_keys` |
| TTL correctness | Keys expire on schedule | `redis-cli TTL <key>` |

**Quick check commands:**
```bash
# See all cached keys and their TTLs
docker compose exec redis redis-cli KEYS "*"
docker compose exec redis redis-cli TTL home
docker compose exec redis redis-cli TTL "products:page:1:limit:20"

# Cache hit/miss stats
docker compose exec redis redis-cli INFO stats | grep keyspace
```
