const fs = require('fs');
const path = require('path');

// Read config from disk on every call — intentionally not cached.
function loadConfig() {
  const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

module.exports = { loadConfig };
