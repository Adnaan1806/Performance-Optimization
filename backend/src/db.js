const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://shop:shop@localhost:5432/shop',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Returns the pool directly — pool.query() checks out a connection,
// runs the query, and returns it automatically.
function getClient() {
  return pool;
}

module.exports = { getClient };
