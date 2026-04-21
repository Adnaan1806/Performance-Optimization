const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,  // fail fast per command; don't hang the request
});

redis.on('error', (err) => {
  // Log but don't crash — app works without cache, just slower.
  console.warn('[cache] Redis error:', err.message);
});

/**
 * Cache-aside helper.
 * Tries Redis first; on miss runs `fetchFn`, stores the result, and returns it.
 *
 * @param {string} key     - Redis key
 * @param {number} ttl     - TTL in seconds
 * @param {Function} fetchFn - async () => value  (called on cache miss)
 */
async function withCache(key, ttl, fetchFn) {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch {
    // Redis unavailable — fall through to DB.
  }

  const value = await fetchFn();

  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch {
    // Store failed — not fatal.
  }

  return value;
}

module.exports = { redis, withCache };
