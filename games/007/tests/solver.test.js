"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");
const cube = require("../js/cube.js");
const solver = require("../js/solver.js");
const { seeded } = require("./helpers.js");
const identity = () => cube.coordinates(cube.create());

function solvedByRoute(state) {
  const before = structuredClone(state);
  const moves = solver.solve(state);
  assert.deepEqual(state, before);
  assert.ok(moves.length <= 30);
  const end = moves.reduce((s, m) => {
    const i = cube.ALL_MOVES.indexOf(m);
    assert.notEqual(i, -1);
    return solver.following(s, i);
  }, state);
  assert.deepEqual(end, identity());
  return moves;
}

test("coordinate transitions agree with the independent piece rotations in mixed positions", () => {
  const pieces = cube.create();
  for (const turn of cube.scramble(36, seeded(925))) {
    cube.turn(pieces, turn);
    const from = cube.coordinates(pieces);
    assert.ok(solver.valid(from));
    cube.ALL_MOVES.forEach((m, i) => {
      assert.deepEqual(solver.following(from, i), cube.coordinates(cube.turn(cube.clone(pieces), m)));
    });
  }
});

test("validation detects twisted corners, flipped edges, parity, duplicates, holes and malformed arrays", () => {
  const impossible = [
    s => { s.co[0] = 1; }, s => { s.eo[0] = 1; }, s => { [s.cp[0], s.cp[1]] = [1, 0]; },
    s => { s.ep[0] = 1; }, s => { s.co.pop(); }, s => { s.co[3] = 3; }, s => { s.eo[1] = -1; },
    s => { s.eo[7] = NaN; }, s => { s.cp[2] = 1.5; }, s => { s.ep[11] = 12; },
    s => { delete s.cp[1]; }, s => { delete s.eo[3]; }, s => { s.co = { length: 8 }; }
  ];
  for (const change of impossible) {
    const state = identity();
    change(state);
    assert.equal(solver.valid(state), false);
    assert.throws(() => solver.solve(state), /unreachable/);
  }
  for (const bad of [null, {}, undefined]) assert.throws(() => solver.solve(bad), RangeError);
  const typed = Object.fromEntries(Object.entries(identity()).map(([k, a]) => [k, Uint8Array.from(a)]));
  assert.ok(solver.valid(typed));
  assert.deepEqual(solver.solve(typed), []);
});

test("a solved puzzle needs no moves and all one-turn states get the single inverse", () => {
  assert.deepEqual(solver.solve(identity()), []);
  for (const m of cube.ALL_MOVES) {
    assert.deepEqual(solver.solve(cube.coordinates(cube.turn(cube.create(), m))), [cube.inverse(m)]);
  }
});

test("state-only solutions restore every sticker on starter, half-turn and long seeded scrambles", () => {
  const cases = [cube.STARTER, ["U2", "D2", "F2", "B2", "L2", "R2"]];
  for (let seed = 1; seed <= 16; seed++) cases.push(cube.scramble(seed * 7, seeded(seed * 572)));
  for (const moves of cases) {
    const pieces = cube.apply(cube.create(), moves);
    const coordinate = cube.coordinates(pieces);
    const result = solvedByRoute(coordinate);
    assert.ok(cube.isSolved(cube.apply(pieces, result)), moves.join(" "));
  }
});

test("the solver handles legal states with no associated move history, including superflip", () => {
  const superflip = identity();
  superflip.eo.fill(1);
  solvedByRoute(superflip);
  const random = seeded(6661);
  for (let trial = 0; trial < 12; trial++) {
    const s = identity();
    for (const p of [s.cp, s.ep]) {
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
      }
    }
    for (const [o, modulus] of [[s.co, 3], [s.eo, 2]]) {
      for (let i = 0; i < o.length - 1; i++) o[i] = Math.floor(random() * modulus);
      o[o.length - 1] = (modulus - o.reduce((a, b) => a + b, 0) % modulus) % modulus;
    }
    if (!solver.valid(s)) [s.ep[0], s.ep[1]] = [s.ep[1], s.ep[0]];
    assert.ok(solver.valid(s));
    solvedByRoute(s);
  }
});

test("the packaged worker builds its own tables and returns the right ticket for successes and errors", { timeout: 20000 }, async t => {
  const adapter = `const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    parentPort.on('message', data => self.onmessage({ data }));`;
  const worker = new Worker(adapter + "\n" + solver.workerSource(), { eval: true });
  t.after(() => worker.terminate());
  const pieces = cube.apply(cube.create(), cube.scramble(22, seeded(9)));
  const message = once(worker, "message");
  worker.postMessage({ ticket: 17, state: cube.coordinates(pieces) });
  const [reply] = await message;
  assert.equal(reply.ticket, 17);
  assert.ok(cube.isSolved(cube.apply(pieces, reply.moves)));
  const error = once(worker, "message");
  worker.postMessage({ ticket: 18, state: null });
  const [rejected] = await error;
  assert.equal(rejected.ticket, 18);
  assert.match(rejected.error, /unreachable/);
  const missing = once(worker, "message");
  worker.postMessage(null);
  assert.match((await missing)[0].error, /unreachable/);
  const recovered = once(worker, "message");
  worker.postMessage({ ticket: 19, state: identity() });
  assert.deepEqual((await recovered)[0], { ticket: 19, moves: [] });
});
