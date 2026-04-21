# Caching Strategy

> Rename this file to `{your-name}-month3-caching.md`.

## Overview

- Caching layer architecture:
- Technology choices and rationale:

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
| Images |  |  |
| CSS/JS |  |  |
| HTML |  |  |

### API Responses

| Endpoint | TTL | Invalidation |
|----------|-----|--------------|
| /home |  |  |
| /products |  |  |
| /products/:id |  |  |
| /search |  |  |

### Database Queries

| Query Pattern | Cache Key | TTL |
|---------------|-----------|-----|
| Product by ID | product:{id} |  |
| Category list | categories |  |

## Invalidation Strategy

- Event-based invalidation (e.g., `PATCH /products/:id` triggers):
- TTL fallback:
- Cache warming procedures:

## Monitoring

- Hit/miss ratio targets:
- Eviction monitoring:
- Memory usage alerts:

## Implementation Details

```javascript
// Cache get
// Cache set (with TTL)
// Cache invalidate (on write)
```
