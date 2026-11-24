"use strict";

const assert = require("node:assert/strict");

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function close(actual, expected, epsilon = 0.00001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function vectorClose(actual, expected, epsilon) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], epsilon));
}

function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value),
    removeItem: key => items.delete(key) };
}

module.exports = { seeded, close, vectorClose, memoryStorage };
