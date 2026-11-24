"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { simulate, MAX_SIZE } = require("../automaton.js");
const {
  compareSeedFlip, parseObservations, ruleEvidence, matchingRules, mapBasins, MAX_BASIN_WIDTH,
} = require("../analysis.js");

const boundaries = ["fixed", "fixed-on", "wrap"];
const words = width => Array.from({ length: 2 ** width }, (_, n) => n.toString(2).padStart(width, "0"));
const infer = (text, boundary) => matchingRules(ruleEvidence(parseObservations(text), boundary).at(-1));

test("the Rule 90 damage mask spreads, reaches both edges, then heals", () => {
  const run = simulate({ rule: 90, width: 7, rows: 6 });
  const result = compareSeedFlip(run);
  assert.equal(result.cell, 3);
  assert.equal(result.seed, "0000000");
  assert.deepEqual(result.differences.map(row => row.join("")),
    ["0001000", "0010100", "0100010", "1010101", "0000000", "0000000"]);
  assert.deepEqual(result.distances, [1, 2, 2, 4, 0, 0]);
  assert.equal(result.firstAgreement, 4);
  assert.equal(compareSeedFlip(simulate({ ...run.settings, rows: 4 })).firstAgreement, null);
});

test("damage follows an edge cell around a ring and out through either fixed boundary", () => {
  for (const boundary of boundaries) {
    const run = simulate({ rule: 170, width: 4, rows: 5, seed: "1010", boundary });
    const result = compareSeedFlip(run, "0");
    assert.equal(result.seed, "0010");
    const ring = boundary === "wrap";
    assert.deepEqual(result.differences.map(row => row.join("")), ring
      ? ["1000", "0001", "0010", "0100", "1000"] : ["1000", "0000", "0000", "0000", "0000"]);
    assert.equal(result.firstAgreement, ring ? null : 1);
  }
});

test("comparisons flip the realized random seed and leave the original run intact", () => {
  const run = simulate({ rule: 110, width: 18, rows: 11, seed: "random", key: 0, boundary: "fixed-on" });
  const before = simulate(run.settings);
  for (const cell of [0, 9, 17]) {
    const result = compareSeedFlip(run, cell);
    const flipped = Array.from(run.history[0]);
    flipped[cell] = 1 - flipped[cell];
    assert.equal(result.seed, flipped.join(""));
    const other = simulate({ ...run.settings, seed: flipped.join("") });
    for (const [g, row] of run.history.entries()) {
      const bits = Array.from(row, (bit, x) => Number(bit !== other.history[g][x]));
      assert.deepEqual(Array.from(result.differences[g]), bits);
      assert.equal(result.distances[g], bits.filter(Boolean).length);
    }
    result.differences[0].fill(0);
  }
  assert.deepEqual(run, before);
  assert.equal(compareSeedFlip(run).cell, 9);
});

test("damage handles a single cell, a single row, both endpoint columns and invalid indexes", () => {
  const tiny = simulate({ width: 1, rows: 1, seed: "0" });
  assert.deepEqual(compareSeedFlip(tiny), {
    cell: 0, seed: "1", differences: [Uint8Array.of(1)], distances: [1], firstAgreement: null,
  });
  const wide = simulate({ rule: 204, width: MAX_SIZE, rows: 2, seed: "0" });
  assert.deepEqual(compareSeedFlip(wide, MAX_SIZE - 1).distances, [1, 1]);
  for (const cell of [-1, 1, 0.5, "", null]) assert.throws(() => compareSeedFlip(tiny, cell), /Seed cell/);
});

test("a ring containing all eight neighbourhoods identifies each of the 256 rules in one step", () => {
  for (let rule = 0; rule < 256; rule++) {
    const run = simulate({ rule, width: 8, rows: 2, seed: "00010111", boundary: "wrap" });
    const [seedOnly, pair] = ruleEvidence(run.history, "wrap").map(matchingRules);
    assert.equal(seedOnly.outputs, "????????");
    assert.deepEqual(seedOnly.rules, Array.from({ length: 256 }, (_, n) => n));
    assert.deepEqual(pair, { outputs: rule.toString(2).padStart(8, "0"), rules: [rule] });
  }
});

test("inference matches brute-force replay for every observed pair up to width three", () => {
  for (let width = 1; width <= 3; width++) {
    const states = words(width);
    for (const boundary of boundaries) {
      for (const seed of states) {
        const matches = new Map(states.map(target => [target, []]));
        for (let rule = 0; rule < 256; rule++) {
          const run = simulate({ rule, seed, width, rows: 2, boundary });
          matches.get(run.history[1].join("")).push(rule);
        }
        for (const [target, rules] of matches) {
          assert.deepEqual(infer(seed + "/" + target, boundary).rules, rules, `${seed}/${target}, ${boundary}`);
        }
      }
    }
  }
});

test("inference retains earlier constraints and detects conflicts within and across transitions", () => {
  const [empty, off, conflict] = ruleEvidence(parseObservations("0/0/1"), "wrap").map(matchingRules);
  assert.equal(empty.rules.length, 256);
  assert.equal(off.outputs, "???????0");
  assert.equal(off.rules.length, 128);
  assert.deepEqual(conflict, { outputs: "???????!", rules: [] });
  assert.deepEqual(infer("000/010", "fixed"), conflict);
  assert.throws(() => ruleEvidence(parseObservations("0"), "loop"), /Boundary/);
});

test("literal observations preserve leading zeros, accept pasted lines and enforce rectangular limits", () => {
  assert.deepEqual(parseObservations(" 001\r\n 010 \n100 ").map(row => row.join("")), ["001", "010", "100"]);
  for (const input of [null, "", "   ", "10/", "/10", "00//01", "1\n\n0", "1x", "0 1", "00/1"]) {
    assert.throws(() => parseObservations(input), RangeError);
  }
  assert.throws(() => parseObservations("0".repeat(MAX_SIZE + 1)), /width/);
  assert.throws(() => parseObservations(Array(MAX_SIZE + 1).fill("0").join("/")), /count/);
  const zeros = "0".repeat(MAX_SIZE);
  const rows = parseObservations(Array(MAX_SIZE).fill(zeros).join("\n"));
  assert.equal(rows.length, MAX_SIZE);
  assert.equal(rows.at(-1).join(""), zeros);
  assert.equal(matchingRules(ruleEvidence(rows, "fixed").at(-1)).rules.length, 128);
});

// Independently follow every seed all the way to its first repeat, including
// paths shared with previous seeds. Only the forward step uses the simulator.
function basinsByReplay(rule, width, boundary) {
  const states = words(width);
  const next = new Map(states.map(seed => [
    seed, simulate({ rule, width, boundary, seed, rows: 2 }).history[1].join(""),
  ]));
  const basins = new Map();
  for (const seed of states) {
    const path = [];
    let state = seed;
    while (!path.includes(state)) { path.push(state); state = next.get(state); }
    const steps = path.indexOf(state);
    const cycle = path.slice(steps).sort();
    const representative = cycle[0];
    if (!basins.has(representative)) {
      basins.set(representative, { representative, period: cycle.length, size: 0, maxSteps: steps, example: seed });
    }
    const basin = basins.get(representative);
    basin.size++;
    if (steps > basin.maxSteps) { basin.maxSteps = steps; basin.example = seed; }
  }
  return [...basins.values()].sort((a, b) => b.size - a.size || a.representative.localeCompare(b.representative));
}

test("basin membership totals, cycle lengths, depths and witnesses match replay for all rules", () => {
  for (let rule = 0; rule < 256; rule++) {
    for (let width = 1; width <= 4; width++) {
      for (const boundary of boundaries) {
        assert.deepEqual(mapBasins(rule, width, boundary), basinsByReplay(rule, width, boundary),
          `Rule ${rule}, width ${width}, ${boundary}`);
      }
    }
  }
});

test("basin maps handle 4096 fixed points, one deep basin and periods beyond the diagram limit", () => {
  const width = MAX_BASIN_WIDTH;
  const identity = mapBasins("204", String(width), "wrap");
  assert.equal(identity.length, 4096);
  for (const [i, basin] of identity.entries()) {
    const seed = i.toString(2).padStart(width, "0");
    assert.deepEqual(basin, { representative: seed, period: 1, size: 1, maxSteps: 0, example: seed });
  }
  assert.deepEqual(mapBasins(170, width, "fixed-on"), [{
    representative: "1".repeat(width), period: 1, size: 4096, maxSteps: width, example: "0".repeat(width),
  }]);
  const long = mapBasins(45, 11, "wrap").find(basin => basin.representative === "00000000001");
  assert.equal(long.period, 979);
});

test("basin queries validate the state-space limit, rule and boundary", () => {
  for (const width of [0, MAX_BASIN_WIDTH + 1, 0.5, "", null]) {
    assert.throws(() => mapBasins(30, width, "wrap"), /Basin width/);
  }
  assert.throws(() => mapBasins(256, 4, "fixed"), /Rule/);
  assert.throws(() => mapBasins(0, 4, "ring"), /Boundary/);
});
