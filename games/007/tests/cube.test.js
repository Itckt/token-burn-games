"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const math = require("../js/math.js");
const { seeded } = require("./helpers.js");

test("the solved cube has 26 distinct pieces and nine stickers of each color", () => {
  const pieces = cube.create();
  assert.equal(pieces.length, 26);
  assert.equal(new Set(pieces.map(p => p.pos.join())).size, 26);
  assert.deepEqual([1, 2, 3].map(n => pieces.filter(p => p.faces.length === n).length), [6, 12, 8]);
  assert.equal(new Set(cube.FACES.map(f => cube.FACE[f].color)).size, 6);
  for (const f of cube.FACES) assert.equal(pieces.filter(p => p.faces.includes(f)).length, 9);
  assert.ok(cube.isSolved(pieces));
  const coordinates = cube.coordinates(pieces);
  assert.deepEqual(coordinates.cp, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(coordinates.ep, Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(coordinates.co, Array(8).fill(0));
  assert.deepEqual(coordinates.eo, Array(12).fill(0));
});

test("every face is clockwise when viewed from outside that face", () => {
  const destinations = [
    ["U", [1, 1, 1], [-1, 1, 1]], ["R", [1, 1, 1], [1, 1, -1]],
    ["F", [1, 1, 1], [1, -1, 1]], ["D", [1, -1, 1], [1, -1, -1]],
    ["L", [-1, 1, 1], [-1, -1, 1]], ["B", [1, 1, -1], [-1, 1, -1]]
  ];
  for (const [face, home, expected] of destinations) {
    const pieces = cube.turn(cube.create(), face);
    assert.deepEqual(pieces.find(p => p.home.join() === home.join()).pos, expected);
  }
  const frontEdge = cube.turn(cube.create(), "R").find(p => p.home.join() === "1,0,1");
  assert.deepEqual(cube.stickerNormal(frontEdge, "F"), [0, 1, 0]);
});

test("all 18 moves affect only their nine pieces and cancel exactly with their inverse", () => {
  const initial = cube.create();
  for (const move of cube.ALL_MOVES) {
    const pieces = cube.turn(cube.create(), move);
    const { axis, side } = cube.describe(move);
    assert.equal(pieces.filter(p => p.pos[axis] === side).length, 9);
    for (const [i, p] of pieces.entries()) {
      if (initial[i].pos[axis] === side) assert.notDeepEqual(p.basis, initial[i].basis);
      else assert.deepEqual(p, initial[i]);
    }
    assert.equal(cube.isSolved(pieces), false);
    assert.equal(cube.inverse(cube.inverse(move)), move);
    assert.deepEqual(cube.turn(pieces, cube.inverse(move)), initial);
  }
  for (const f of cube.FACES) {
    assert.deepEqual(cube.apply(cube.create(), [f, f, f, f]), initial);
    assert.deepEqual(cube.apply(cube.create(), [f, f]), cube.turn(cube.create(), f + "2"));
  }
});

test("simplification combines runs modulo four without changing stickers or center rotations", () => {
  assert.deepEqual(cube.simplify(["R", "U2", "U2", "R"]), ["R2"]);
  assert.deepEqual(cube.simplify(["L'", "L2", "L'"]), []);
  const random = seeded(8712);
  const moves = Array.from({ length: 700 }, () => cube.ALL_MOVES[Math.floor(random() * 18)]);
  const shorter = cube.simplify(moves);
  assert.ok(shorter.length < moves.length);
  assert.ok(shorter.every((m, i) => !i || m[0] !== shorter[i - 1][0]));
  assert.deepEqual(cube.apply(cube.create(), shorter), cube.apply(cube.create(), moves));
});

test("long sessions keep exact lattice positions, right-handed bases and outward stickers", () => {
  const pieces = cube.create(), moves = cube.scramble(1800, seeded(2026));
  cube.apply(pieces, moves);
  assert.equal(new Set(pieces.map(p => p.pos.join())).size, 26);
  const counts = new Map();
  for (const piece of pieces) {
    assert.ok([...piece.basis, ...piece.pos].every(n => n === 0 || n === 1 || n === -1));
    const [x, y, z] = [0, 3, 6].map(i => piece.basis.slice(i, i + 3));
    assert.equal(math.dot(x, x), 1);
    assert.equal(math.dot(y, y), 1);
    assert.equal(math.dot(math.cross(x, y), z), 1);
    if (piece.faces.length === 1) assert.deepEqual(piece.home, piece.pos);
    for (const f of piece.faces) {
      const normal = cube.stickerNormal(piece, f);
      assert.equal(math.dot(normal, piece.pos), 1);
      counts.set(normal.join(), (counts.get(normal.join()) || 0) + 1);
    }
  }
  assert.deepEqual([...counts.values()], Array(6).fill(9));
  cube.apply(pieces, moves.slice().reverse().map(cube.inverse));
  assert.deepEqual(pieces, cube.create());
});

test("a clone owns all of its arrays and can be turned independently", () => {
  const original = cube.create(), other = cube.clone(original);
  cube.turn(other, "F'");
  for (const key of ["home", "basis", "pos", "faces"]) assert.notEqual(original[0][key], other[0][key]);
  other[0].home[0] = 100;
  other[0].faces.length = 0;
  assert.deepEqual(original, cube.create());
});

test("scrambles use every move type, avoid repeating an axis, and support seeded replay", () => {
  const moves = cube.scramble(250, seeded(17));
  assert.deepEqual(moves, cube.scramble(250, seeded(17)));
  assert.notDeepEqual(moves, cube.scramble(250, seeded(18)));
  assert.equal(new Set(moves).size, 18);
  moves.forEach((m, i) => {
    assert.ok(cube.ALL_MOVES.includes(m));
    if (i) assert.notEqual(cube.describe(m).axis, cube.describe(moves[i - 1]).axis);
  });
  assert.equal(cube.scramble().length, 20);
  assert.deepEqual(cube.scramble(0), []);
  for (const bad of [-1, 1.5, Infinity, "20"]) assert.throws(() => cube.scramble(bad), RangeError);
});

test("an identity sampled for a 20-turn scramble becomes a mix without drawing more random numbers", () => {
  const identity = Array.from({ length: 5 }, () => ["R", "U", "R", "U'"]).flat();
  assert.ok(cube.isSolved(cube.apply(cube.create(), identity)));
  const samples = [];
  let axis = -1;
  for (const move of identity) {
    const faces = cube.FACES.filter(f => cube.FACE[f].axis !== axis);
    samples.push((faces.indexOf(move[0]) + 0.5) / faces.length);
    samples.push((["", "'", "2"].indexOf(move.slice(1)) + 0.5) / 3);
    axis = cube.FACE[move[0]].axis;
  }
  const mix = cube.scramble(20, () => samples.shift());
  assert.equal(samples.length, 0);
  assert.equal(mix.length, 20);
  assert.deepEqual(mix.slice(0, -1), identity.slice(0, -1));
  assert.equal(mix.at(-1)[0], identity.at(-1)[0]);
  assert.equal(cube.isSolved(cube.apply(cube.create(), mix)), false);
});

test("invalid notation fails before changing any piece", () => {
  const pieces = cube.create();
  for (const bad of ["", "r", "X", "R3", "U''", "F2'", " D", "L B", null, 1]) {
    assert.throws(() => cube.turn(pieces, bad), RangeError);
  }
  assert.deepEqual(pieces, cube.create());
});
