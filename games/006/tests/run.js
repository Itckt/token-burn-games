'use strict';
// Run node:test in this process, including in sandboxes that restrict child processes.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
for (const name of readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort()) {
  require(join(__dirname, name));
}
