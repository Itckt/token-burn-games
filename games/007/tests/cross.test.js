"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const cross = require("../js/cross.js");
const { slots, applyNet } = require("./papernet.js");
const { seeded } = require("./helpers.js");

// Track individual paper stickers. One sticker locates and orients a whole
// edge. This oracle does not use the simulator's cubie coordinates or moves.
const cells = Object.entries(slots).flatMap(([face, names]) =>
  names.flatMap((name, index) => name.length === 2 ? [{ face, name, index }] : []));
const labels = Object.fromEntries(Object.entries(slots).map(([face, names]) =>
  [face, names.map((_, i) => cells.findIndex(c => c.face === face && c.index === i))]));
const permutations = cube.ALL_MOVES.map(move => {
  const net = applyNet(labels, [move]), next = [];
  cells.forEach(({ face, index }, location) => { next[net[face][index]] = location; });
  return next;
});
const encode = positions => positions.reduce((key, cell) => 24 * key + cell, 0);

function paperCross(net, face) {
  const home = cells.filter(cell => cell.face === face);
  return home.map(({ name, index }) => {
    const id = labels[face][index];
    const current = cells.find(cell => net[cell.face][cell.index] === id);
    return { name, slot: current.name, aligned: current.index === index && current.face === face };
  });
}

test("each cross needs four oriented edges matching both centers and ignores the opposite layer", () => {
  for (const face of cube.FACES) {
    const opposite = cube.FACES.find(f => cube.FACE[f].axis === cube.FACE[face].axis && f !== face);
    const pieces = cube.turn(cube.create(), opposite);
    assert.equal(cube.isSolved(pieces), false);
    assert.equal(cross.inspect(pieces, face).aligned, 4);
    assert.deepEqual(cross.route(pieces, face), []);
    cube.turn(pieces, face);
    assert.ok(cube.facelets(pieces)[face].every(letter => letter === face));
    assert.equal(cross.inspect(pieces, face).aligned, 0);
    assert.deepEqual(cross.route(pieces, face), [cube.inverse(face)]);
  }
  for (const bad of ["", "u", "XX", null, "constructor"]) {
    assert.throws(() => cross.inspect(cube.create(), bad), RangeError);
    assert.throws(() => cross.route(cube.create(), bad), RangeError);
  }
});

test("the location and alignment of all four edges agree with individually labeled paper stickers", () => {
  const pieces = cube.create(), rng = seeded(590);
  let net = labels, foundFlippedAtHome = false;
  for (const move of cube.scramble(150, rng)) {
    cube.turn(pieces, move);
    net = applyNet(net, [move]);
    for (const face of cube.FACES) {
      const expected = paperCross(net, face).sort((a, b) => a.name.localeCompare(b.name));
      const report = cross.inspect(pieces, face);
      assert.deepEqual(report.edges.sort((a, b) => a.name.localeCompare(b.name)), expected);
      assert.equal(report.aligned, expected.filter(e => e.aligned).length);
      if (expected.some(e => e.name === e.slot && !e.aligned)) foundFlippedAtHome = true;
    }
  }
  assert.ok(foundFlippedAtHome);
});

// Exact distances for all reachable four-sticker arrangements using a full
// one-sided BFS. Base 24 keeps the independent table small enough for Node.
function paperDistances(face) {
  const chosen = cells.filter(cell => cell.face === face);
  const goal = encode(chosen.map(c => labels[c.face][c.index]));
  const distances = new Int8Array(24 ** 4).fill(-1);
  const queue = new Uint32Array(distances.length);
  let head = 0, tail = 1;
  queue[0] = goal;
  distances[goal] = 0;
  while (head < tail) {
    const key = queue[head++];
    const a = Math.floor(key / 13824), b = Math.floor(key / 576) % 24;
    const c = Math.floor(key / 24) % 24, d = key % 24;
    for (const p of permutations) {
      const next = ((p[a] * 24 + p[b]) * 24 + p[c]) * 24 + p[d];
      if (distances[next] !== -1) continue;
      distances[next] = distances[key] + 1;
      queue[tail++] = next;
    }
  }
  assert.equal(tail, 12 * 11 * 10 * 9 * 16);
  return { chosen, distances, furthest: queue[tail - 1] };
}

test("cross hints attain independent minimum distances on every face, including eight-turn cases", () => {
  for (const face of cube.FACES) {
    const { chosen, distances, furthest } = paperDistances(face);
    const home = chosen.map(c => labels[c.face][c.index]);
    const starts = [cube.STARTER, ...Array.from({ length: 15 }, (_, i) => cube.scramble(20, seeded(i + 57)))];
    // Make a real cube at the farthest paper position by retracing its
    // distance gradient. This also exercises each intermediate distance.
    let cellsAt = [Math.floor(furthest / 13824), Math.floor(furthest / 576) % 24,
      Math.floor(furthest / 24) % 24, furthest % 24];
    assert.equal(distances[furthest], 8);
    const back = [];
    while (distances[encode(cellsAt)]) {
      const distance = distances[encode(cellsAt)];
      const move = permutations.findIndex(p => distances[encode(cellsAt.map(c => p[c]))] === distance - 1);
      assert.ok(move >= 0);
      back.push(cube.ALL_MOVES[move]);
      cellsAt = cellsAt.map(c => permutations[move][c]);
    }
    const hardest = cube.inverseSequence(back);
    for (let i = 0; i <= hardest.length; i++) starts.push(hardest.slice(0, i));
    for (const moves of starts) {
      const net = applyNet(labels, moves), pieces = cube.apply(cube.create(), moves);
      const before = cube.clone(pieces);
      const key = encode(home.map(id => cells.findIndex(c => net[c.face][c.index] === id)));
      const route = cross.route(pieces, face);
      assert.equal(route.length, distances[key]);
      assert.deepEqual(pieces, before);
      const final = paperCross(applyNet(net, route), face);
      assert.ok(final.every(edge => edge.aligned));
    }
  }
});
