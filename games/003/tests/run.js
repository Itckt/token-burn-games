'use strict';
// Load node:test suites in one process, including in shells that restrict child processes.
const {readdirSync} = require('node:fs');
const {join} = require('node:path');
for (const file of readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort()) {
  require(join(__dirname,file));
}
