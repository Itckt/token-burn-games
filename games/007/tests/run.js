"use strict";

// Register the tests in this process so the suite also runs in shells that
// restrict child processes. node:test sets the exit status on failure.
const { readdirSync } = require("node:fs");
const files = readdirSync(__dirname).filter(name => name.endsWith(".test.js")).sort();
for (const file of files) require("./" + file);
