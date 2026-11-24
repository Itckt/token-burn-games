"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { parse } = require("../js/notation.js");
const { effect } = require("../js/analysis.js");
const { slots, applyNet } = require("./papernet.js");
const { seeded } = require("./helpers.js");

test("the analyzer counts pieces that move or turn in place, and ignores center artwork", () => {
  for (const [text, corners, edges, repetitions] of [
    ["", 0, 0, 1], ["R R′", 0, 0, 1], ["(R U R′ U)5", 0, 0, 1], ["R", 4, 4, 4], ["F2", 4, 4, 2],
    ["[R,U]", 4, 3, 6], ["[R′ D′ R,U]", 3, 0, 3], ["R U", 6, 7, 105],
    ["[(R′ D′ R D)2,U]", 2, 0, 3], // Two corners twist in their own slots.
    ["U R2 F B R B2 R U2 L B2 R U′ D′ R2 F R′ L B2 U2 F2", 0, 12, 2] // Every edge flips in place.
  ]) {
    const moves = Object.freeze(parse(text));
    assert.deepEqual(effect(moves), { corners, edges, repetitions }, text);
    assert.deepEqual(effect(cube.inverseSequence(moves)), effect(moves));
  }
  assert.throws(() => effect(["R", "X"]), RangeError);
});

test("the predicted order is the first exact return in a separate sticker-grid simulation", () => {
  const original = Object.fromEntries(Object.entries(slots).map(([face, cells]) =>
    [face, cells.map(piece => ({ piece, color: face }))]));
  for (const moves of [parse("R U"), parse("[R,U]"), parse("[F:U2]"), cube.STARTER,
    ...[15, 482, 310, 2026].map(seed => cube.scramble(9, seeded(seed)))]) {
    let net = applyNet(original, moves);
    const affected = new Set();
    for (const [face, cells] of Object.entries(net)) {
      for (const tile of cells) if (tile.color !== face) affected.add(tile.piece);
    }
    let repeats = 1;
    while (!Object.entries(net).every(([face, cells]) => cells.every(tile => tile.color === face))) {
      assert.ok(repeats < 1260, "exceeded the largest possible 3×3×3 move order");
      net = applyNet(net, moves);
      repeats++;
    }
    const pieces = [...affected];
    assert.deepEqual(effect(moves), { corners: pieces.filter(p => p.length === 3).length,
      edges: pieces.filter(p => p.length === 2).length, repetitions: repeats });
  }
});
