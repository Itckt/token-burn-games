'use strict';

// Register the built-in Node tests in one process, including in restricted terminals.
const { readdirSync } = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, 'test');
for (const file of readdirSync(directory).sort()) {
  if (file.endsWith('.test.js')) require(path.join(directory, file));
}
