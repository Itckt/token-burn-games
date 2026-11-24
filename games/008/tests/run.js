"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

// Register every suite with node:test in this process. Works in restricted shells, too.
for (const file of readdirSync(__dirname).filter(name => name.endsWith(".test.js")).sort()) {
  require(join(__dirname, file));
}
