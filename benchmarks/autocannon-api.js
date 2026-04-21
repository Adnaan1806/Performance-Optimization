/*
 * Runs autocannon against each API endpoint and prints a P50/P95/P99 table.
 *
 * Usage:  BASE=http://localhost:4000 node autocannon-api.js
 */
const autocannon = require('autocannon');

const BASE = process.env.BASE || 'http://localhost:4000';
const DURATION = parseInt(process.env.DURATION || '15', 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '10', 10);

const TARGETS = [
  { name: 'GET /home', url: `${BASE}/home` },
  { name: 'GET /products', url: `${BASE}/products` },
  { name: 'GET /products/:id', url: `${BASE}/products/1` },
  { name: 'GET /search?q=Pro', url: `${BASE}/search?q=Pro` },
];

function run(target) {
  return new Promise((resolve, reject) => {
    console.log(`\n--- ${target.name} (${DURATION}s, ${CONNECTIONS} connections) ---`);
    autocannon(
      { url: target.url, duration: DURATION, connections: CONNECTIONS },
      (err, result) => (err ? reject(err) : resolve({ target, result }))
    );
  });
}

(async () => {
  const rows = [];
  for (const t of TARGETS) {
    const { result } = await run(t);
    rows.push({
      endpoint: t.name,
      p50: result.latency.p50,
      p95: result.latency.p95,
      p99: result.latency.p99,
      req_sec: result.requests.average.toFixed(1),
      errors: result.errors,
      '2xx': result['2xx'],
    });
  }
  console.log('\n=== Summary (latency in ms) ===');
  console.table(rows);
})();
