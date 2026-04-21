# Baseline & Result Tracker

Record your numbers here. First column is your untouched baseline (before any fix). Last column is after all optimizations.

## Page Load (Lighthouse desktop preset)

| Page            | TTFB | FCP | LCP | TTI | After TTFB | After FCP | After LCP | After TTI | Δ (TTI) |
|-----------------|------|-----|-----|-----|------------|-----------|-----------|-----------|---------|
| Home            |      |     |     |     |            |           |           |           |         |
| Product List    |      |     |     |     |            |           |           |           |         |
| Product Detail  |      |     |     |     |            |           |           |           |         |
| Search          |      |     |     |     |            |           |           |           |         |

## API Latency (autocannon, 15s @ 10 conn)

| Endpoint              | P50 | P95 | P99 | After P50 | After P95 | After P99 | Δ (P95) |
|-----------------------|-----|-----|-----|-----------|-----------|-----------|---------|
| GET /home             |     |     |     |           |           |           |         |
| GET /products         |     |     |     |           |           |           |         |
| GET /products/:id     |     |     |     |           |           |           |         |
| GET /search?q=Pro     |     |     |     |           |           |           |         |

## Bundle Size

| File                 | Baseline (KB) | After (KB) | Δ |
|----------------------|---------------|------------|---|
| Main JS chunk        |               |            |   |
| Vendor chunk         |               |            |   |
| Total JS transferred |               |            |   |

## Database

Run this before and after:

```sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

| Query | Baseline mean (ms) | After mean (ms) | Δ |
|-------|--------------------|-----------------|---|
|       |                    |                 |   |

## Overall Improvement

| Metric         | Baseline | After | Reduction |
|----------------|----------|-------|-----------|
| Avg page TTI   |          |       |           |
| Avg API P95    |          |       |           |

**Target:** ≥ 70% reduction in average page TTI.
