# Month 3 Challenge: 70% Load Time Reduction

## Challenge Overview

You are given a slow e-commerce application. Your mission is to achieve at least 70% load time reduction through systematic profiling and optimization.

**Time Allocation:** 3 hours (during session)
**Difficulty:** Advanced

## Starting Point

### Application Profile
- **Type:** E-commerce product catalog with search
- **Stack:** Node.js/Express + PostgreSQL + React frontend
- **Current Performance:**
  - Homepage: 4.5s load time
  - Product listing: 3.2s
  - Product detail: 2.8s
  - Search: 5.1s

### Known Issues (to discover through profiling)
- N+1 queries on product listings
- Missing database indexes
- Unoptimized images
- No caching layer
- Synchronous blocking operations
- Large JavaScript bundles

## Technical Constraints

- Cannot change the database schema structure significantly
- Must maintain all existing functionality
- Target: 70% reduction in average load time
- Document every optimization with metrics

---

## Deliverables

### 1. Performance Audit Report (25 points)

**File:** `{your-name}-month3-audit.md`

**Required Sections:**

```markdown
# Performance Audit Report

## Executive Summary
- Current state summary
- Critical issues identified
- Recommended priority order

## Methodology
- Tools used
- Testing conditions
- Baseline measurements

## Findings

### Critical Issues (P0)
| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|

### High Priority (P1)
| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|

### Medium Priority (P2)
| Issue | Impact | Location | Effort |
|-------|--------|----------|--------|

## Database Analysis
- Slow query log analysis
- Missing index identification
- N+1 query detection

## Frontend Analysis
- Bundle size breakdown
- Render blocking resources
- Core Web Vitals scores

## Backend Analysis
- API response time breakdown
- CPU/Memory profiling results
- I/O bottlenecks

## Recommendations
[Prioritized list with estimated impact]
```

**Evaluation Criteria:**
- Thoroughness of analysis (5 pts)
- Issue prioritization (5 pts)
- Root cause identification (5 pts)
- Tool usage proficiency (5 pts)
- Documentation clarity (5 pts)

---

### 2. Before/After Metrics (25 points)

**File:** `{your-name}-month3-metrics.md`

**Required Content:**

```markdown
# Performance Metrics Documentation

## Test Environment
- Hardware specifications
- Network conditions
- Data volume

## Baseline Measurements

### Page Load Times
| Page | TTFB | FCP | LCP | TTI |
|------|------|-----|-----|-----|
| Homepage | 1.2s | 2.1s | 3.8s | 4.5s |
| Product List | ... | ... | ... | ... |
| Product Detail | ... | ... | ... | ... |
| Search | ... | ... | ... | ... |

### API Response Times
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| GET /products | ... | ... | ... |
| GET /products/:id | ... | ... | ... |
| GET /search | ... | ... | ... |

### Database Metrics
| Query | Avg Time | Calls/Page |
|-------|----------|------------|
| ... | ... | ... |

## Post-Optimization Measurements

### Page Load Times (After)
| Page | TTFB | FCP | LCP | TTI | Improvement |
|------|------|-----|-----|-----|-------------|
| Homepage | ... | ... | ... | ... | -XX% |
| ... | ... | ... | ... | ... | ... |

### API Response Times (After)
| Endpoint | P50 | P95 | P99 | Improvement |
|----------|-----|-----|-----|-------------|
| ... | ... | ... | ... | -XX% |

## Summary
- Overall improvement: XX%
- Target achieved: Yes/No
```

**Evaluation Criteria:**
- Measurement accuracy (5 pts)
- Comprehensive coverage (5 pts)
- Clear before/after comparison (5 pts)
- Proper statistical reporting (5 pts)
- Target achievement (5 pts)

---

### 3. Code Optimization Documentation (25 points)

**File:** `{your-name}-month3-optimizations.md`

**Required Content:**

```markdown
# Code Optimizations Applied

## Optimization 1: [Name]

### Problem
[Description of the issue]

### Root Cause
[Why this was happening]

### Solution
```code
// Before
[original code]

// After
[optimized code]
```

### Impact
- Metric improved: [specific metric]
- Improvement: [percentage]

### Trade-offs
[Any downsides or considerations]

---

## Optimization 2: [Name]
[Same structure...]

---

## Database Optimizations

### Indexes Added
```sql
-- Index 1: [purpose]
CREATE INDEX idx_name ON table(column);
-- Improvement: query time reduced from Xms to Yms

-- Index 2: [purpose]
...
```

### Query Rewrites
```sql
-- Before (N+1 problem)
SELECT * FROM products WHERE id = ?; -- called N times

-- After (batch query)
SELECT * FROM products WHERE id IN (?...);
-- Improvement: N queries → 1 query
```

## Caching Implementations
[Cache keys, TTLs, invalidation strategy]
```

**Required Optimizations (minimum):**
- [ ] 2 database query optimizations
- [ ] 2 backend code optimizations
- [ ] 2 frontend optimizations
- [ ] Caching implementation

**Evaluation Criteria:**
- Number of optimizations (5 pts)
- Impact measurement (5 pts)
- Code quality (5 pts)
- Documentation clarity (5 pts)
- Trade-off awareness (5 pts)

---

### 4. Caching Strategy Document (25 points)

**File:** `{your-name}-month3-caching.md`

**Required Content:**

```markdown
# Caching Strategy

## Overview
- Caching layer architecture
- Technology choices and rationale

## Cache Hierarchy
```
Client Browser Cache (static assets)
        ↓
CDN Cache (edge locations)
        ↓
Application Cache (Redis)
        ↓
Database Query Cache
```

## Caching Policies

### Static Assets
| Asset Type | Cache Duration | Strategy |
|------------|----------------|----------|
| Images | 1 year | Immutable + versioning |
| CSS/JS | 1 year | Immutable + hash |
| HTML | No cache | Always fresh |

### API Responses
| Endpoint | TTL | Invalidation |
|----------|-----|--------------|
| /products | 5 min | On product update |
| /search | 1 min | Time-based |
| /user/* | No cache | Personalized |

### Database Queries
| Query Pattern | Cache Key | TTL |
|---------------|-----------|-----|
| Product by ID | product:{id} | 10 min |
| Category list | categories | 1 hour |

## Invalidation Strategy
- Event-based invalidation
- TTL fallback
- Cache warming procedures

## Monitoring
- Hit/miss ratio targets
- Eviction monitoring
- Memory usage alerts

## Implementation Details
[Code snippets for cache get/set/invalidate]
```

**Evaluation Criteria:**
- Strategy completeness (5 pts)
- Appropriate TTLs (5 pts)
- Invalidation approach (5 pts)
- Implementation quality (5 pts)
- Monitoring consideration (5 pts)

---

## Submission Guidelines

### File Naming Convention
```
{your-name}-month3-audit.md
{your-name}-month3-metrics.md
{your-name}-month3-optimizations.md
{your-name}-month3-caching.md
```

### Submission Checklist
- [ ] Performance audit complete
- [ ] Before/after metrics documented
- [ ] At least 6 optimizations documented
- [ ] Caching strategy document complete
- [ ] 70% improvement target achieved (or justified)

---

## Scoring Guide

| Grade | Score | Description |
|-------|-------|-------------|
| Exceptional | 90-100 | Exceeds 70% target, comprehensive documentation |
| Proficient | 75-89 | Meets target, solid documentation |
| Developing | 60-74 | Close to target, some gaps |
| Beginning | <60 | Below target, incomplete documentation |

**Passing Score:** 75%

---

## Hints and Tips

### Quick Wins
1. Add missing indexes (30-50% DB improvement)
2. Enable gzip compression (60-70% transfer reduction)
3. Implement connection pooling
4. Add Redis caching for hot paths

### Database Profiling
```sql
-- Enable slow query log
SET log_min_duration_statement = 100; -- ms

-- Find missing indexes
SELECT schemaname, tablename,
       seq_scan, seq_tup_read,
       idx_scan, idx_tup_fetch
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan;

-- Identify N+1 queries
SELECT query, calls, mean_time
FROM pg_stat_statements
ORDER BY calls DESC LIMIT 20;
```

### Node.js Profiling
```javascript
// Enable built-in profiler
node --prof app.js

// Use clinic.js for flame graphs
npx clinic flame -- node app.js

// Memory leak detection
node --inspect app.js
// Open chrome://inspect
```

### Redis Caching Pattern
```javascript
async function getCachedProduct(id) {
  const cacheKey = `product:${id}`;

  // Try cache first
  let product = await redis.get(cacheKey);
  if (product) {
    return JSON.parse(product);
  }

  // Cache miss - fetch from DB
  product = await db.products.findById(id);

  // Store in cache with TTL
  await redis.setex(cacheKey, 600, JSON.stringify(product));

  return product;
}
```

---

## Offline Milestones (Before Month 4)

Complete these before the next session:

- [ ] Implement performance regression testing
- [ ] Set up continuous performance monitoring
- [ ] Create performance budget for the team
- [ ] Add automated Lighthouse CI checks
- [ ] Document optimization playbook
- [ ] Implement CDN caching strategy

---

*Challenge Version: 1.0*
*Last Updated: December 2025*
