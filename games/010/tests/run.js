'use strict';
// Run node:test in this process, including in shells that restrict child processes.
const fs=require('node:fs');
const path=require('node:path');
for (const name of fs.readdirSync(__dirname).filter(n=>n.endsWith('.test.js')).sort()) {
  require(path.join(__dirname,name));
}
