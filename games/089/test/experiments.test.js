'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { World, TICK } = require('../physics.js');
const { scenes, createScene, checkpoint, readCheckpoint, readSeed, addFreeBall } = require('../scenes.js');
const { near, assertGeometry } = require('./helpers.js');

test('linear drag follows exponential decay, including drift smaller than one position ulp', () => {
  const w = new World({ drag: 2 });
  const a = w.addBall({ x: 100, y: 120, vx: 80, vy: -40 });
  w.step(Math.log(2) / 2);
  for (const [actual, expected] of [[a.x, 120], [a.y, 110], [a.vx, 40], [a.vy, -20]]) near(actual, expected);
  for (const vx of [1e-15, -1e-15]) {
    const slow = new World({ drag: 1 });
    const b = slow.addBall({ x: 50, y: 50, vx });
    slow.step(0.01);
    assert.equal(b.x, 50);
    near(b.vx / vx, Math.exp(-0.01));
  }
  for (const invalid of [-1, '1', null, Infinity, NaN]) {
    assert.throws(() => { w.drag = invalid; }, RangeError);
    assert.throws(() => World.fromSnapshot({ ...w.snapshot(), drag: invalid }), RangeError);
    assert.equal(w.drag, 2);
  }
});

test('damped contacts use elapsed clock time and an asymptotic wall stays out of reach', () => {
  const w = new World({ width: 200, height: 200, drag: 2 });
  w.addRail({ x1: 85, y1: 30, x2: 85, y2: 170, radius: 5 });
  const b = w.addBall({ x: 60, y: 100, vx: 80, radius: 10 });
  const [hit] = w.nextImpact();
  near(hit.time, -Math.log(0.75) / 2);
  near(b.x, 70);
  near(b.vx, -60);
  assert.equal(hit.type, 'rail');
  assert.deepEqual(w.nextImpact(), []);
  for (const vx of [80, -80]) {
    const court = new World({ width: 100, drag: 2 });
    const ball = court.addBall({ x: 50, y: 60, radius: 10, vx });
    const before = court.snapshot();
    assert.deepEqual(court.nextImpact(), []);
    assert.deepEqual(court.snapshot(), before);
    for (let i = 0; i < 300; i++) court.step(0.2);
    assert.equal(court.wallHits, 0);
    near(ball.x, vx > 0 ? 90 : 10);
    assert.deepEqual(court.nextImpact(), []);
  }
});

test('stopping on the second corner face resolves both, ignores older trace entries and resumes', () => {
  const w = new World({ width: 100, height: 100 });
  const b = w.addBall({ x: 50, y: 50, radius: 10, vx: 80, vy: -80 });
  const trace = [{ time: 0, wall: 'top' }];
  const isTop = e => e.wall === 'top';
  assert.equal(w.step(0.25, trace, isTop), undefined);
  assert.equal(w.step(2, trace, isTop), trace[2]);
  assert.deepEqual(trace.slice(1).map(e => [e.time, e.wall]), [[0.5, 'right'], [0.5, 'top']]);
  assert.deepEqual([w.time, b.vx, b.vy, w.wallHits], [0.5, -80, 80, 2]);
  w.step(0.5, trace, isTop);
  assert.deepEqual([b.x, b.y, w.time, trace.length], [50, 50, 1, 3]);
  assert.equal(w.step(0.5, undefined, e => e.wall === 'left').time, w.time);
  assert.equal(w.wallHits, 4);
});

test('a zero budget leaves pending hits alone and a predicate error leaves a resolved court', () => {
  const w = new World({ width: 120, height: 100 });
  const b = w.addBall({ x: 10, y: 40, radius: 10, vx: -80 });
  const initial = w.snapshot();
  assert.equal(w.step(0, [], () => true), undefined);
  assert.throws(() => w.step(1, [], 'left'), /predicate/);
  assert.deepEqual(w.snapshot(), initial);
  assert.equal(w.step(1, undefined, () => true).time, 0);
  assert.throws(() => w.step(2, undefined, () => { throw new Error('stop observing'); }), /stop observing/);
  assert.deepEqual([w.time, b.x, b.vx, w.wallHits], [1.25, 110, -80, 2]);
});

test('a forecast follows both sides of a ball collision, rail contacts and drag without changing the run', () => {
  const w = new World({ width: 240, height: 140, drag: 0.15 });
  w.addRail({ x1: 200, y1: 30, x2: 200, y2: 110, radius: 6 });
  w.addBall({ x: 50, y: 70, radius: 10, vx: 260 });
  w.addBall({ x: 105, y: 70, radius: 10 });
  const before = w.snapshot();
  const forecast = w.forecast(2, 1);
  assert.deepEqual(w.snapshot(), before);
  assert.equal(forecast.complete, true);
  const trace = [];
  w.step(1, trace);
  assert.ok(trace.some(e => e.type === 'ball') && trace.some(e => e.type === 'rail'));
  assert.equal(forecast.points.reduce((sum, p) => sum + p.hits, 0),
    trace.filter(e => e.ballId === 2 || e.otherBallId === 2).length);
  const end = forecast.points.at(-1);
  near(end.x, w.balls[1].x);
  near(end.y, w.balls[1].y);
  assert.equal(end.time, w.time);
  assert.deepEqual(w.forecast(2, 0).points, [{ time: w.time, x: end.x, y: end.y, hits: 0 }]);
  for (const [id, seconds] of [[0, 1], [3, 1], [1.5, 0], [1, -1], [1, Infinity]]) {
    assert.throws(() => w.forecast(id, seconds), RangeError);
  }
});

test('a forecast reports its collision budget and includes simultaneous hits at the horizon', () => {
  const w = new World({ width: 4, height: 4 });
  w.addBall({ x: 0.5, y: 0.5, radius: 0.5, vx: 3, vy: 3 });
  for (const seconds of [128, 129]) {
    const { complete, points } = w.forecast(1, seconds);
    assert.equal(complete, seconds === 128);
    assert.equal(points.length, 129);
    assert.deepEqual(points.at(-1), { time: 128, x: 0.5, y: 0.5, hits: 2 });
    assert.equal(w.time, 0);
  }
});

test('practice seeds reproduce clear layouts, survive checkpoints and validate the full seed range', () => {
  const layouts = new Set();
  for (const seed of [0, 1, 852, 0xffffffff]) {
    const world = createScene('practice-draw', 0.85, { seed, drag: 0.2 });
    assert.deepEqual([world.balls.length, world.bumpers.length], [6, 3]);
    assertGeometry(world);
    layouts.add(JSON.stringify(world.balls));
    assert.deepEqual(createScene('practice-draw', 0.85, { seed, drag: 0.2 }).snapshot(), world.snapshot());
    for (let i = 0; i < 60; i++) world.step();
    const saved = checkpoint({ world, scene: 'practice-draw', seed });
    const restored = readCheckpoint(JSON.stringify(saved));
    assert.equal(restored.seed, seed);
    restored.world.step(TICK);
    world.step(TICK);
    assert.deepEqual(restored.world.snapshot(), world.snapshot());
    assert.equal(readSeed(String(seed)), seed);
  }
  assert.equal(layouts.size, 4);
  for (const seed of ['3.5', -1, 2 ** 32, '', '8e2', null]) {
    assert.throws(() => scenes['practice-draw'].generate(seed), /Seed/);
  }
});

test('automatic placement handles a court with a barely fitting diameter and very large dimensions', () => {
  const narrow = new World({ width: 1e100, height: 38 });
  assert.equal(addFreeBall(narrow), null);
  const wide = new World({ width: 1.5e308, height: 120 });
  wide.addBall({ x: 20, y: 20, radius: 1 });
  const b = addFreeBall(wide);
  assert.ok(b && Number.isFinite(b.x) && b.x > 22 && b.x < wide.width);
});
