const fs = require('fs');
const path = require('path');

// Read once at module load time — config does not change at runtime.
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

function loadConfig() {
  return config;
}

module.exports = { loadConfig };
