"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { hitSurface } = require("../js/math.js");
const { seeded } = require("./helpers.js");
const { slots, applyNet } = require("./papernet.js");

test("all 54 projected facelets agree with independent folded-edge transfers, including back and down", () => {
  const pieces = cube.create(), solved = Object.fromEntries(cube.FACES.map(f => [f, Array(9).fill(f)]));
  const moves = [...cube.STARTER, ...cube.ALL_MOVES, ...cube.scramble(80, seeded(440))];
  let expected = solved;
  for (const move of [...moves, ...cube.inverseSequence(moves)]) {
    expected = applyNet(expected, [move]);
    cube.turn(pieces, move);
    assert.deepEqual(cube.facelets(pieces), expected, move);
  }
  assert.deepEqual(expected, solved);
  const copy = cube.facelets(pieces);
  copy.D.fill("X");
  assert.deepEqual(cube.facelets(pieces), solved);
});

test("all twenty tracked identities, sticker directions and cell indices follow an independently labeled net", () => {
  const pieces = cube.create(), names = [...cube.CORNERS, ...cube.EDGES];
  const originals = new Map(names.map(name => [name, cube.inspectPiece(pieces, name).piece]));
  assert.equal(new Set(originals.values()).size, 20);
  let net = Object.fromEntries(Object.entries(slots).map(([face, cells]) =>
    [face, cells.map(name => ({ name, home: face }))]));
  for (const move of [...cube.ALL_MOVES, ...cube.scramble(40, seeded(189))]) {
    cube.turn(pieces, move);
    net = applyNet(net, [move]);
    for (const name of names) {
      const { piece, slot, stickers } = cube.inspectPiece(pieces, name);
      assert.equal(piece, originals.get(name));
      assert.deepEqual(stickers.map(s => s.home), [...name]);
      for (const s of stickers) {
        assert.equal(slot, slots[s.face][s.index]);
        assert.deepEqual(net[s.face][s.index], { name, home: s.home });
      }
    }
  }
  for (const invalid of ["", "R", "XYZ", "rf", null]) assert.equal(cube.inspectPiece(pieces, invalid), null);
});

test("a malformed later turn in a batch leaves every piece at its original position and orientation", () => {
  const pieces = cube.apply(cube.create(), cube.STARTER), before = cube.clone(pieces);
  assert.throws(() => cube.apply(pieces, ["R", "F2", "X"]), RangeError);
  assert.deepEqual(pieces, before);
});

test("world-space ray hits resolve the actual mixed piece in every cell on all six faces", () => {
  const moves = cube.scramble(30, seeded(807)), pieces = cube.apply(cube.create(), moves);
  const expected = applyNet(slots, moves);
  for (const face of cube.FACES) {
    const [right, up, normal] = cube.FRAMES[face];
    for (let i = 0; i < 9; i++) {
      const col = i % 3 - 1 + .14, row = 1 - Math.floor(i / 3) - .17;
      const origin = normal.map((value, k) => 7 * value + col * right[k] + row * up[k]);
      const hit = hitSurface(origin, normal.map(n => -2 * n));
      assert.equal(hit.face, face);
      assert.equal(hit.point[cube.FACE[face].axis], 1.5 * cube.FACE[face].side);
      assert.equal(cube.pieceAtSurface(pieces, hit), i === 4 ? null : expected[face][i]);
    }
  }
  assert.deepEqual(hitSurface([0, 0, 0], [0, 0, -2]), { face: "B", point: [0, 0, -1.5] });
  const cornerHit = hitSurface([5, 5, 5], [-1, -1, -1]);
  assert.deepEqual(cornerHit.point, [1.5, 1.5, 1.5]);
  assert.equal(cube.pieceAtSurface(cube.create(), cornerHit), "URF");
  assert.equal(hitSurface([0, 0, 0], [0, 0, 0]), null);
  assert.equal(hitSurface([5, 5, 0], [0, -1, 0]), null);
});
