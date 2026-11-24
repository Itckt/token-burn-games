"use strict";
// Register the Node test suites in one process, including in restricted shells.
const {readdirSync} = require("node:fs");
const {join} = require("node:path");
for (const file of readdirSync(__dirname).filter(name => name.endsWith(".test.js")).sort()) {
  require(join(__dirname, file));
}
