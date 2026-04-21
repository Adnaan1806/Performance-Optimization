# Month 3 Performance Challenge — Starter

A deliberately-slow e-commerce app for the BISTEC Hearts Academy senior-engineer track, Month 3: Performance Optimization.

> **Mission:** Profile the app, identify bottlenecks, and achieve at least **70% load time reduction** across the four pages.

Full rubric: [`docs/CHALLENGE.md`](docs/CHALLENGE.md)

---

## What you get

- Node.js + Express backend talking to PostgreSQL
- React + Vite frontend
- Redis service running (intentionally unused — wire it up)
- ~5,000 products, 50 categories, ~50,000 reviews seeded
- `autocannon` + Lighthouse benchmark harness

## What's broken (on purpose)

Expect to find — through profiling, not by reading the code:

- N+1 queries
- Missing indexes
- No connection pool
- Synchronous blocking work in request handlers
- Unoptimized images (multi-MB JPGs rendered at thumbnail size)
- Fat JS bundle (full `lodash`, `moment`, all MUI icons, no splitting)
- No HTTP caching, no compression
- Redis provisioned but never used

Your job is to measure first, fix second, measure again.

---

## Quick start (Docker path — boot everything)

```bash
cp .env.example .env
docker compose up --build
# backend: http://localhost:4000
# frontend: http://localhost:5173
# db:      localhost:5432 (shop/shop)
# redis:   localhost:6379
```

Once containers are up, seed the database:

```bash
docker compose exec backend node seed/seed.js
```

Seeding takes ~2 minutes for 5k products / 50k reviews.

## Local dev path (for profiling)

Profilers like `clinic.js` and `node --prof` work best outside containers.

```bash
# Start only DB and Redis in Docker
docker compose up db redis

# Backend (separate terminal)
cd backend
npm install
npm run migrate     # applies migrations/001_schema.sql
npm run seed        # 5k products, 50k reviews
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

---

## Measure baseline before touching anything

```bash
cd benchmarks
node autocannon-api.js      # API P50/P95/P99
./lighthouse.sh             # Core Web Vitals for all 4 pages
```

Record the numbers in `benchmarks/baseline.md`. Then optimize. Then re-run and fill the "after" columns.

## Profiling cheatsheet

```bash
# Postgres — see slow queries
docker compose exec db psql -U shop -d shop \
  -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Postgres — missing indexes
docker compose exec db psql -U shop -d shop -c \
  "SELECT relname, seq_scan, idx_scan FROM pg_stat_user_tables ORDER BY seq_scan DESC;"

# Node flame graph
cd backend
npx clinic flame -- node src/server.js

# Frontend bundle analyzer
cd frontend
npm run build -- --mode analyze
```

---

## Submitting

See [`docs/submission-template/`](docs/submission-template/) — four pre-structured Markdown files matching the rubric. Rename each with your name (e.g. `chandima-month3-audit.md`) and fill them in.

Full evaluation criteria in [`docs/CHALLENGE.md`](docs/CHALLENGE.md).

---

## Reset

```bash
docker compose down -v     # wipes the database volume
docker compose up --build
docker compose exec backend node seed/seed.js
```
