'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../physics.js');
const { createScene, readCheckpoint } = require('../scenes.js');

test('checkpoints from each kind of court continue the exact trajectory after a collision', () => {
  for (const scene of ['opening-break', 'turnstile-slalom']) {
    const original = createScene(scene, 0.73);
    original.nextImpact();
    const text = JSON.stringify({ scene, ...original.snapshot() });
    const restored = readCheckpoint(text);
    assert.equal(restored.scene, scene);
    const a = [], b = [];
    for (let i = 0; i < 720; i++) {
      original.step(undefined, a);
      restored.world.step(undefined, b);
    }
    assert.ok(a.length > 0);
    assert.deepEqual(a, b);
    assert.deepEqual(restored.world.snapshot(), original.snapshot());
  }
});

test('a legacy checkpoint restores its counters and IDs and recomputes derived energy', () => {
  const saved = {
    width: 220, height: 120, restitution: 0.4, time: 2.25, ballHits: 3, wallHits: 5,
    kineticEnergy: -1, balls: [{ id: 1, x: 40, y: 40, vx: 3, vy: 4, radius: 10, mass: 2 }]
  };
  const { world, scene } = readCheckpoint('\uFEFF' + JSON.stringify(saved));
  assert.equal(scene, 'custom');
  assert.deepEqual(world.snapshot(), { ...saved, kineticEnergy: 25 });
  saved.balls[0].x = 150;
  assert.equal(world.balls[0].x, 40);
  assert.equal(world.addBall({ x: 90, y: 60 }).id, 2);
  assert.equal(world.addBumper({ x: 160, y: 60 }).id, 1);
  assert.equal(world.bumperHits, 0);
});

test('restoration accepts contact roundoff while new placements still require clearance', () => {
  const w = new World();
  w.addBumper({ x: 150, y: 100, radius: 30 });
  assert.equal(w.canPlace(110 + 1e-13, 100, 10), false);
  w.addBall({ x: 110, y: 100, radius: 10, vx: -20 });
  const state = w.snapshot();
  state.balls[0].x += 1e-13;
  const loaded = World.fromSnapshot(state);
  assert.equal(loaded.balls[0].x, state.balls[0].x);
  loaded.step(0.5);
  assert.equal(loaded.bumperHits, 0);
  assert.equal(loaded.balls[0].x, state.balls[0].x - 10);
});

test('invalid checkpoint clocks, counters and court dimensions are rejected', () => {
  const state = createScene().snapshot();
  for (const bad of [null, [], {}, { ...state, balls: {} }, { ...state, bumpers: null },
    { ...state, width: undefined }, { ...state, height: 0 }, { ...state, restitution: null },
    { ...state, restitution: 2 }, { ...state, time: -1 }, { ...state, time: Infinity },
    { ...state, ballHits: 3.5 }, { ...state, wallHits: -1 }, { ...state, bumperHits: 1 },
    { ...state, ballHits: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => World.fromSnapshot(bad), RangeError);
  }
  assert.throws(() => readCheckpoint('{oops'), /valid JSON/);
  assert.equal(readCheckpoint(JSON.stringify({ scene: '__proto__', ...state })).scene, 'custom');
});

test('invalid IDs, shapes, and overlaps in either checkpoint body list are rejected', () => {
  const state = createScene('turnstile-slalom').snapshot();
  for (const change of [
    s => { s.balls[0].id = 2; }, s => { s.bumpers[1].id = 1; },
    s => { s.balls[1] = null; }, s => { s.balls[0].mass = 0; },
    s => { delete s.balls[0].vx; }, s => { s.balls[0].vy = NaN; },
    s => { s.bumpers[0].radius = -5; }, s => { s.bumpers[0].x = 10; },
    s => { Object.assign(s.balls[0], { x: 295, y: 175 }); },
    s => { Object.assign(s.balls[1], { x: 106, y: 159 }); },
    s => { Object.assign(s.bumpers[0], { x: 430, y: 322 }); }
  ]) {
    const damaged = structuredClone(state);
    change(damaged);
    assert.throws(() => World.fromSnapshot(damaged), RangeError);
  }
});
