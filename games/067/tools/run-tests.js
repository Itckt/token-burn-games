"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Register the node:test cases in one process, including on restricted desktops.
const directory = path.join(__dirname, "..", "test");
for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".test.js")).sort()) {
  require(path.join(directory, file));
}
