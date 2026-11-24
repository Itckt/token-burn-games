"use strict";

// Register the whole suite in one Node process, including in restricted shells.
require("./test/dictionary.test.js");
require("./test/cli.test.js");
require("./test/web.test.js");
