"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { simulate, MAX_SIZE } = require("../automaton.js");
const { analyzeHistory, findPredecessors } = require("../analysis.js");

test("activity distinguishes the seed, extinction and an unchanged fixed point", () => {
  const { history } = simulate({ rule: 0, seed: "101", width: 3, rows: 5 });
  const { activity, cycle } = analyzeHistory(history);
  assert.deepEqual(activity, [
    { live: 2, changed: null }, { live: 0, changed: 2 }, { live: 0, changed: 0 },
    { live: 0, changed: 0 }, { live: 0, changed: 0 },
  ]);
  assert.deepEqual(cycle, { start: 1, repeat: 2, period: 1 });
  assert.equal(analyzeHistory(history.slice(0, 2)).cycle, null);
});

test("cycles compare whole states and keep the first return even after further laps", () => {
  const { history } = simulate({ rule: 170, width: 7, rows: 17, boundary: "wrap" });
  const { activity, cycle } = analyzeHistory(history);
  assert.deepEqual(cycle, { start: 0, repeat: 7, period: 7 });
  assert.ok(activity.every(row => row.live === 1));
  assert.ok(activity.slice(1).every(row => row.changed === 2));
  assert.equal(analyzeHistory(history.slice(0, 7)).cycle, null);
  assert.deepEqual(analyzeHistory(history.slice(0, 1)), { activity: [{ live: 1, changed: null }], cycle: null });
});

test("a return on the final available generation is detected on a wide ring", () => {
  const { history } = simulate({ rule: 170, width: 511, rows: MAX_SIZE, boundary: "wrap" });
  assert.equal(analyzeHistory(history.slice(0, -1)).cycle, null);
  assert.deepEqual(analyzeHistory(history).cycle, { start: 0, repeat: 511, period: 511 });
});

test("a transient before an oscillation is excluded from the period", () => {
  const { history } = simulate({ rule: 7, seed: "01001", width: 5, rows: 8 });
  assert.deepEqual(history.slice(0, 5).map(row => row.join("")), ["01001", "11011", "00000", "11111", "00000"]);
  assert.equal(analyzeHistory(history.slice(0, 4)).cycle, null);
  assert.deepEqual(analyzeHistory(history).cycle, { start: 2, repeat: 4, period: 2 });
});

test("predecessor counts and first three samples match exhaustive forward evolution", () => {
  for (let width = 1; width <= 5; width++) {
    const states = Array.from({ length: 2 ** width }, (_, n) => n.toString(2).padStart(width, "0"));
    for (let rule = 0; rule < 256; rule++) {
      for (const boundary of ["fixed", "fixed-on", "wrap"]) {
        const parents = new Map(states.map(state => [state, []]));
        for (const seed of states) {
          const { history } = simulate({ rule, width, boundary, seed, rows: 2 });
          parents.get(history[1].join("")).push(seed);
        }
        for (const [target, expected] of parents) {
          assert.deepEqual(findPredecessors(target, rule, boundary),
            { count: BigInt(expected.length), samples: expected.slice(0, 3) },
            `Rule ${rule}, width ${width}, ${boundary}, target ${target}`);
        }
      }
    }
  }
});

test("512-cell searches retain exact counts, leading zeros and sorted samples", () => {
  const zero = "0".repeat(MAX_SIZE);
  const one = "1".repeat(MAX_SIZE);
  for (const boundary of ["fixed", "fixed-on", "wrap"]) {
    assert.deepEqual(findPredecessors(zero, 0, boundary), {
      count: 2n ** 512n, samples: [zero, zero.slice(1) + "1", zero.slice(2) + "10"],
    });
    assert.deepEqual(findPredecessors(one, 0, boundary), { count: 0n, samples: [] });
  }
  assert.deepEqual(findPredecessors(zero, 90, "wrap"), {
    count: 4n, samples: [zero, "01".repeat(256), "10".repeat(256)],
  });
  assert.deepEqual(findPredecessors(zero.slice(1), 90, "wrap"), {
    count: 2n, samples: [zero.slice(1), one.slice(1)],
  });
});

test("predecessor queries enforce the same width, rule and boundary limits as forward runs", () => {
  for (const target of ["", "012", null, 101, "0".repeat(MAX_SIZE + 1)]) {
    assert.throws(() => findPredecessors(target, 30, "wrap"), RangeError);
  }
  assert.throws(() => findPredecessors("0", 256, "wrap"), /Rule/);
  assert.throws(() => findPredecessors("0", 30, "loop"), /Boundary/);
  assert.deepEqual(findPredecessors("1", "204", "fixed-on"), { count: 1n, samples: ["1"] });
});
