"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { simulate, extendRun, ruleTable, flipBit, transformRule, transformRun, asText, asSvg, DEFAULTS, MAX_SIZE } = require("../automaton.js");

const first = options => simulate({ ...options, rows: 1 }).history[0].join("");

// A separate oracle uses padded strings and reads Wolfram's table from left to right.
function referenceStep(state, outputs, boundary) {
  const edge = boundary === "fixed-on" ? "1" : "0";
  const padded = boundary === "wrap" ? state.at(-1) + state + state[0] : edge + state + edge;
  return Array.from(state, (_, x) => outputs[7 - parseInt(padded.slice(x, x + 3), 2)]).join("");
}

test("all 256 rules match an independent oracle for every 1–5 cell state under all three boundaries", () => {
  for (let rule = 0; rule < 256; rule++) {
    const outputs = rule.toString(2).padStart(8, "0");
    for (let width = 1; width <= 5; width++) {
      for (let word = 0; word < 2 ** width; word++) {
        const seed = word.toString(2).padStart(width, "0");
        for (const boundary of ["fixed", "fixed-on", "wrap"]) {
          const { history } = simulate({ rule, seed, width, boundary, rows: 4 });
          let expected = seed;
          for (const row of history) {
            assert.equal(row.join(""), expected, `rule ${rule}, seed ${seed}, ${boundary}`);
            expected = referenceStep(expected, outputs, boundary);
          }
        }
      }
    }
  }
});

test("all lookup tables use 111..000 ordering and each edit toggles precisely one bit", () => {
  for (let rule = 0; rule < 256; rule++) {
    const binary = rule.toString(2).padStart(8, "0");
    const table = ruleTable(rule);
    assert.deepEqual(table.map(entry => entry.pattern), ["111", "110", "101", "100", "011", "010", "001", "000"]);
    assert.equal(table.map(entry => entry.output).join(""), binary);
    table.forEach(({ pattern, output }, i) => {
      const flipped = flipBit(rule, pattern);
      const expected = binary.slice(0, i) + (1 - output) + binary.slice(i + 1);
      assert.equal(flipped, parseInt(expected, 2));
      assert.equal(flipBit(flipped, pattern), rule);
    });
  }
});

test("Rule 90 draws the eight-row triangle from a single cell", () => {
  const expected = [
    ".......#.......", "......#.#......", ".....#...#.....", "....#.#.#.#....",
    "...#.......#...", "..#.#.....#.#..", ".#...#...#...#.", "#.#.#.#.#.#.#.#", "",
  ].join("\n");
  assert.equal(asText(simulate({ rule: 90, width: 15, rows: 8 }).history), expected);
});

test("Rule 30 has the expected left/right orientation and Rule 110 retains its right edge", () => {
  assert.equal(asText(simulate({ rule: 30, width: 11, rows: 6 }).history), [
    ".....#.....", "....###....", "...##..#...", "..##.####..", ".##..#...#.", "##.####.###", "",
  ].join("\n"));
  assert.deepEqual(simulate({ rule: 110, width: 9, rows: 4 }).history.map(row => row.join("")),
    ["000010000", "000110000", "001110000", "011010000"]);
});

test("fixed boundaries supply zero outside while the actual edge cells can change", () => {
  const state = { rule: 170, width: 5, rows: 3, seed: "10000" };
  assert.deepEqual(simulate(state).history.map(row => row.join("")), ["10000", "00000", "00000"]);
  assert.deepEqual(simulate({ ...state, boundary: "wrap" }).history.map(row => row.join("")),
    ["10000", "00001", "00010"]);
  assert.equal(simulate({ rule: 255, width: 5, rows: 2, seed: "0" }).history[1].join(""), "11111");
});

test("presets and custom seeds centre correctly for odd, even and tiny widths", () => {
  for (const [width, seed, expected] of [
    [5, "single", "00100"], [6, "single", "000100"], [1, "single", "1"],
    [8, "alternating", "10101010"], [5, "alternating", "10101"],
    [8, "campus", "00101010"], [2, "campus", "11"], [1, "campus", "1"],
    [7, "101", "0010100"], [6, "1", "000100"], [5, "10", "01000"],
    [5, "00101", "00101"], [6, "00", "000000"],
  ]) assert.equal(first({ width, seed }), expected);
});

test("random seeds use the specified 32-bit sequence and are prefix-stable as width changes", () => {
  for (const key of [0, 1, 42, 12345678, 0xffffffff]) {
    let state = BigInt(key);
    let expected = "";
    for (let i = 0; i < 80; i++) {
      state = (1664525n * state + 1013904223n) % 4294967296n;
      expected += state < 2147483648n ? "0" : "1";
    }
    assert.equal(first({ width: 80, seed: "random", key }), expected);
    assert.equal(first({ width: 26, seed: "random", key: String(key) }), expected.slice(0, 26));
  }
  assert.notEqual(first({ width: 63, seed: "random", key: 0 }), first({ width: 63, seed: "random", key: 1 }));
});

test("one row is generation zero and histories have independent row storage", () => {
  const options = Object.freeze({ rule: "204", seed: "1001", width: "4", rows: "3" });
  const a = simulate(options);
  assert.deepEqual(a.settings, { rule: 204, seed: "1001", width: 4, rows: 3, key: 42, boundary: "fixed" });
  a.history[0].fill(0);
  assert.equal(a.history[1].join(""), "1001");
  assert.equal(first(options), "1001");
  const one = simulate({ rule: 255, rows: 1, width: 1, seed: "0" });
  assert.equal(asText(one.history), ".\n");
  assert.deepEqual(simulate().settings, DEFAULTS);
});

test("limits are inclusive and the largest diagram has the requested dimensions", () => {
  const { history } = simulate({ rule: 255, width: MAX_SIZE, rows: MAX_SIZE, key: 0xffffffff });
  assert.equal(history.length, 512);
  assert.equal(history[511].length, 512);
  assert.ok(history[511].every(value => value === 1));
  assert.equal(simulate({ rule: 0, width: 1, rows: 2, key: 0 }).history[1][0], 0);
});

test("invalid sizes, rules, keys, seeds and boundary names fail before simulation", () => {
  for (const [field, examples] of Object.entries({
    rule: [-1, 256, 2.5, NaN, Infinity, "1e2", "7x", "", false, null],
    width: [0, 513, "8.5", " "], rows: [0, -1, 513, true],
    key: [-1, 0x100000000, "abc", 0.1],
    seed: ["", "1012", "random!", "00 1", 1, null], boundary: ["", "periodic", 0],
  })) {
    for (const value of examples) assert.throws(() => simulate({ [field]: value }), RangeError);
  }
  assert.throws(() => simulate({ width: 1, seed: "01" }), /fit/);
  for (const pattern of ["00", "1110", "01a", "", 101]) assert.throws(() => flipBit(12, pattern), /three-bit/);
  assert.throws(() => ruleTable(256), /Rule/);
  assert.throws(() => flipBit(-1, "111"), /Rule/);
});

test("SVG paths reconstruct every live cell, including contiguous runs at the right edge", () => {
  const { history } = simulate({ rule: 30, seed: "00110111", width: 8, rows: 9, boundary: "wrap" });
  const svg = asSvg(history);
  assert.match(svg, /width="48" height="54" viewBox="0 0 8 9"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  const path = svg.match(/ d="([^"]+)"/)[1];
  const rows = history.map(row => Array(row.length).fill(0));
  const runs = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  assert.equal(runs.map(run => run[0]).join(""), path);
  for (const [, x, y, length, back] of runs) {
    assert.equal(length, back);
    assert.ok(Number(x) + Number(length) <= 8);
    for (let i = Number(x); i < Number(x) + Number(length); i++) {
      assert.equal(rows[y][i], 0);
      rows[y][i] = 1;
    }
  }
  assert.deepEqual(rows, history.map(row => Array.from(row)));
});

test("an all-off SVG still has its full background and an all-on row forms a single run", () => {
  const blank = asSvg(simulate({ rule: 0, width: 4, seed: "0", rows: 2 }).history);
  assert.match(blank, /<rect width="4" height="2"/);
  assert.doesNotMatch(blank, /<path/);
  assert.match(asSvg(simulate({ width: 4, seed: "1111", rows: 1 }).history), /d="M0 0h4v1h-4z"/);
});

test("rule families include Rule 30's four orientations and partition the atlas into 88 classes", () => {
  const classes = new Set();
  for (let rule = 0; rule < 256; rule++) {
    const mirror = transformRule(rule, "mirror");
    const invert = transformRule(rule, "invert");
    const both = transformRule(rule, "both");
    assert.equal(transformRule(mirror, "mirror"), rule);
    assert.equal(transformRule(invert, "invert"), rule);
    assert.equal(transformRule(both, "both"), rule);
    assert.equal(transformRule(invert, "mirror"), both);
    assert.equal(transformRule(mirror, "invert"), both);
    classes.add(Math.min(rule, mirror, invert, both));
  }
  assert.equal(classes.size, 88);
  assert.deepEqual(["mirror", "invert", "both"].map(mode => transformRule("30", mode)), [86, 135, 149]);
  assert.throws(() => transformRule(0, "sideways"), /mirror/);
  assert.throws(() => transformRule(256, "invert"), /Rule/);
});

test("transformed rules reproduce the corresponding pixel transformation of every generation", () => {
  for (let rule = 0; rule < 256; rule++) {
    for (const boundary of ["fixed", "fixed-on", "wrap"]) {
      const original = simulate({ rule, boundary, width: 6, rows: 7, seed: "10110" });
      const states = original.history.map(row => row.join(""));
      for (const mode of ["mirror", "invert", "both"]) {
        const result = transformRun(original, mode);
        const expected = states.map(word => {
          if (mode !== "invert") word = [...word].reverse().join("");
          if (mode !== "mirror") word = word.replace(/[01]/g, bit => bit === "0" ? "1" : "0");
          return word;
        });
        assert.equal(result.settings.seed, expected[0]);
        assert.deepEqual(result.history.map(row => row.join("")), expected);
      }
      assert.deepEqual(original.history.map(row => row.join("")), states);
    }
  }
});

test("mirroring even-width and keyed seeds transforms the actual starting cells", () => {
  const single = simulate({ width: 4, rows: 1 });
  assert.equal(transformRun(single, "mirror").settings.seed, "0100");
  const random = simulate({ rule: 30, width: 32, rows: 8, seed: "random", key: 0 });
  const inverted = transformRun(random, "invert");
  assert.equal(inverted.settings.boundary, "fixed-on");
  assert.equal(inverted.settings.key, 0);
  assert.deepEqual(transformRun(inverted, "invert").history, random.history);
});

test("extending a run resumes from its last row and checks the full row budget first", () => {
  const run = simulate({ rule: 30, width: 9, rows: 2, seed: "random", key: 1, boundary: "fixed-on" });
  const extended = extendRun(extendRun(run, 3), "2");
  assert.deepEqual(extended, simulate({ ...run.settings, rows: 7 }));
  assert.equal(run.history.length, 2);
  assert.equal(run.settings.rows, 2);
  assert.equal(extendRun(run, MAX_SIZE - 2).history.length, MAX_SIZE);
  assert.throws(() => extendRun(run, MAX_SIZE - 1), /Row count/);
  assert.throws(() => extendRun(run, 0), /Step count/);
});
