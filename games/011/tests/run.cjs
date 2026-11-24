"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

// The built-in test runner can execute all suites in this process.
// This also works on machines that restrict spawning child processes.
for (const name of readdirSync(__dirname).filter(name => name.endsWith(".test.js")).sort()) {
  require(join(__dirname, name));
}
