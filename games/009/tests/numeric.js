"use strict";
const assert = require("node:assert/strict");

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} within ${tolerance} of ${expected}`);
}
function vector(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => near(actual[i], value, tolerance));
}
module.exports = {near, vector};
