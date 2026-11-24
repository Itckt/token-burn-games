'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../physics.js');
const { createScene } = require('../scenes.js');
const { near } = require('./helpers.js');

function vertical(x, y1 = 0, y2 = 100) {
  return { x1: x, y1, x2: x, y2 };
}

test('timing gates may span the court, cross one another and occupy the same space as a solid', () => {
  const w = new World({ width: 200, height: 100 });
  w.addBumper({ x: 60, y: 50, radius: 10 });
  w.addGate(vertical(60));
  w.addGate({ x1: 0, y1: 50, x2: 200, y2: 50 });
  assert.equal(w.canPlace(100, 50, 5), true);
  w.addBall({ x: 100, y: 50, radius: 5 });
  w.addRail({ ...vertical(130, 20, 80), radius: 3 });
  assert.equal(w.addGate(vertical(130)).id, 3);
  for (const segment of [vertical(60, 5, 5), vertical(-1), vertical(201), vertical(30, 0, 101),
    vertical(NaN), vertical(20, -Infinity), { x1: 45, x2: 60, y2: 90 }]) {
    assert.equal(w.canPlaceGate(segment), false);
    assert.throws(() => w.addGate(segment), /timing gate/);
  }
  assert.equal(w.gates.length, 3);
});

test('one high-speed tick records every pass on the way to and from several wall impacts', () => {
  const w = new World({ width: 100, height: 100 });
  w.addBall({ x: 20, y: 40, radius: 5, vx: 32768 });
  const unmarked = World.fromSnapshot(w.snapshot());
  const gate = w.addGate(vertical(50));
  const impacts = [], crossings = [];
  w.step(1 / 128, { impacts, crossings });
  unmarked.step(1 / 128);
  assert.deepEqual(crossings.map(e => [e.time * 32768, e.direction, e.vx]), [
    [30, 'forward', 32768], [120, 'reverse', -32768], [210, 'forward', 32768]
  ]);
  assert.ok(crossings.every(e => e.gateId === 1 && e.ballId === 1 && e.x === 50 && e.y === 40));
  assert.deepEqual(gate.counts, { forward: 2, reverse: 1 });
  assert.deepEqual(impacts.map(e => e.wall), ['right', 'left', 'right']);
  const { gates, ...physicalState } = w.snapshot();
  assert.deepEqual(physicalState, unmarked.snapshot());
});

test('a finite angled gate measures center arrivals at either endpoint and ignores departures and tangents', () => {
  const gate = { x1: 60, y1: 20, x2: 100, y2: 60 };
  for (const [y, expected] of [[19.99, 0], [20, 1], [40, 1], [60, 1], [60.01, 0]]) {
    const w = new World();
    w.addGate(gate);
    w.addGate({ x1: gate.x2, y1: gate.y2, x2: gate.x1, y2: gate.y1 });
    w.addBall({ x: 40, y, radius: 5, vx: 100 });
    const crossings = [];
    w.step(1, { crossings });
    assert.equal(crossings.length, 2 * expected);
    if (expected) {
      assert.deepEqual(crossings.map(e => e.direction), ['forward', 'reverse']);
      near(crossings[0].x, y + 40);
      near(crossings[0].time, y / 100);
    }
  }
  for (const [vx, vy] of [[20, 20], [0, 0], [12, -8]]) {
    const w = new World();
    w.addGate(gate);
    w.addBall({ x: 80, y: 40, radius: 5, vx, vy });
    const events = [];
    w.step(0.5, { crossings: events });
    assert.deepEqual(events, []);
  }
});

test('crossings from one flight are chronological across gates and balls, including equal-time arrivals', () => {
  const w = new World();
  w.time = 4.5;
  w.addGate(vertical(80));
  w.addGate(vertical(60));
  w.addBall({ x: 20, y: 30, vx: 40, radius: 5 });
  w.addBall({ x: 40, y: 70, vx: 40, radius: 5 });
  const earlier = { time: 3 };
  const readings = [earlier];
  w.step(2, { crossings: readings });
  assert.equal(readings[0], earlier);
  assert.deepEqual(readings.slice(1).map(e => [e.time, e.ballId, e.gateId]),
    [[5, 2, 2], [5.5, 1, 2], [5.5, 2, 1], [6, 1, 1]]);
});

test('a gate at a rebound records arrival speed once and a checkpoint on the line resumes cleanly', () => {
  const w = new World({ width: 100, height: 100, restitution: 0.5 });
  w.addBall({ x: 50, y: 50, radius: 10, vx: 80 });
  w.addGate(vertical(90));
  const readings = [];
  const hit = w.step(3, { stopOn: e => e.wall === 'right', crossings: readings });
  assert.equal(hit.time, 0.5);
  assert.deepEqual(readings.map(e => [e.time, e.x, e.vx]), [[0.5, 90, 80]]);
  assert.equal(w.balls[0].vx, -40);
  const copy = World.fromSnapshot(w.snapshot());
  const resumed = [];
  assert.equal(copy.nextImpact(resumed)[0].wall, 'left');
  assert.deepEqual(resumed, []);
  assert.deepEqual(copy.gates[0].counts, { forward: 1, reverse: 0 });
});

test('gate arrivals at a wall use the same timestamp as the impact on a large imported clock', () => {
  const w = new World({ width: 100, height: 100 });
  w.time = 2 ** 52;
  w.addGate(vertical(10));
  w.addBall({ x: 50, y: 50, radius: 10, vx: 200 });
  const impacts = [], crossings = [];
  w.step(2, { impacts, crossings });
  const wallTimes = impacts.filter(e => e.wall === 'left').map(e => e.time);
  assert.deepEqual(wallTimes, [2 ** 52 + 1, 2 ** 52 + 1]);
  assert.deepEqual(crossings.map(e => e.time), wallTimes);
});

test('an impact predicate still sees only collisions when both event streams share one array', () => {
  const w = new World({ width: 100, height: 100 });
  w.addGate(vertical(60));
  w.addBall({ x: 50, y: 50, vx: 40, radius: 10 });
  const events = [];
  const hit = w.step(2, { impacts: events, crossings: events, stopOn: () => true });
  assert.deepEqual(events.map(e => [e.type, e.time]), [['gate', 0.25], ['wall', 1]]);
  assert.equal(hit, events[1]);
  assert.equal(w.time, hit.time);
});

test('dragged gate readings use clock time and incident speed and exclude the asymptotic stopping point', () => {
  for (const split of [false, true]) {
    const w = new World({ drag: 1 });
    w.addGate(vertical(90));
    w.addGate(vertical(150));
    w.addBall({ x: 30, y: 50, radius: 5, vx: 120 });
    const readings = [];
    const before = w.snapshot();
    assert.deepEqual(w.nextImpact(readings), []);
    assert.deepEqual(w.snapshot(), before);
    assert.deepEqual(w.forecast(1).points.map(p => p.hits), [0, 0]);
    assert.deepEqual(w.snapshot(), before);
    if (split) {
      for (let i = 0; i < 256; i++) w.step(0.25, { crossings: readings });
    } else {
      w.step(64, { crossings: readings });
    }
    assert.equal(readings.length, 1);
    assert.equal(readings[0].gateId, 1);
    near(readings[0].time, Math.log(2));
    near(readings[0].vx, 60);
    near(readings[0].x, 90);
    assert.deepEqual(w.gates[1].counts, { forward: 0, reverse: 0 });
  }
});

test('independent wall settings resolve both faces at a corner and accept a perfectly soft surface', () => {
  const w = new World({ width: 100, height: 100, restitution: 0.75 });
  const ball = w.addBall({ x: 50, y: 50, radius: 10, vx: 80, vy: 80 });
  w.setSurfaceRestitution('wall:right', 0);
  w.setSurfaceRestitution('wall:bottom', 0.25);
  assert.deepEqual(w.nextImpact().map(e => e.wall), ['right', 'bottom']);
  near(ball.vx, 0);
  near(ball.vy, -20);
  w.restitution = 0.6;
  w.nextImpact();
  near(ball.vy, 12);
  w.setSurfaceRestitution('wall:bottom', null);
  w.nextImpact();
  near(ball.vy, -7.2);
  assert.deepEqual(w.surfaceRestitution, { 'wall:right': 0 });
});

test('a bumper override preserves tangential velocity and fixed-surface settings leave ball pairs alone', () => {
  const w = new World();
  w.addBumper({ x: 112, y: 116, radius: 10 });
  const b = w.addBall({ x: 100, y: 100, vx: 100, radius: 10 });
  w.setSurfaceRestitution('bumper:1', 0.5);
  w.nextImpact();
  near(b.vx, 46);
  near(b.vy, -72);
  const pair = new World();
  pair.setSurfaceRestitution('wall:right', 0);
  const first = pair.addBall({ x: 100, y: 80, radius: 10, vx: 90 });
  const second = pair.addBall({ x: 120, y: 80, radius: 10 });
  pair.nextImpact();
  assert.deepEqual([first.vx, second.vx], [0, 90]);
});

test('head-on impacts against posts and rails retain a representable very soft rebound', () => {
  for (const kind of ['bumper', 'rail']) {
    const w = new World({ restitution: 1e-18 });
    if (kind === 'rail') w.addRail({ ...vertical(150, 40, 160), radius: 10 });
    else w.addBumper({ x: 150, y: 100, radius: 10 });
    const b = w.addBall({ x: 50, y: 100, radius: 10, vx: 120 });
    assert.equal(w.nextImpact()[0].type, kind);
    near(b.vx / -1.2e-16, 1);
    near(b.vy, 0);
  }
});

test('ball pairs retain very soft rebounds and exchange unequal incident speeds at full elasticity', () => {
  for (const [e, incidentA, incidentB, expectedA, expectedB] of [
    [1e-18, 120, -120, -1.2e-16, 1.2e-16], [1, 1e50, 1, 1, 1e50]
  ]) {
    const w = new World({ restitution: e });
    const a = w.addBall({ x: 50, y: 50, radius: 10, vx: incidentA });
    const b = w.addBall({ x: 70, y: 50, radius: 10, vx: incidentB });
    w.nextImpact();
    near(a.vx / expectedA, 1);
    near(b.vx / expectedB, 1);
  }
});

test('an applied vector impulse changes momentum by the requested amount for each mass', () => {
  const w = new World();
  const a = w.addBall({ x: 100, y: 200, vx: -30, vy: 8, mass: 1 });
  const b = w.addBall({ x: 300, y: 200, vx: -30, vy: 8, mass: 4 });
  for (const ball of [a, b]) {
    assert.equal(w.applyImpulse(ball.id, 120, -32), ball);
    near(ball.mass * (ball.vx + 30), 120);
    near(ball.mass * (ball.vy - 8), -32);
  }
  assert.deepEqual([a.x, a.y, b.x, b.y, w.time, w.ballHits, w.wallHits], [100, 200, 300, 200, 0, 0, 0]);
  const copy = World.fromSnapshot(w.snapshot());
  w.step(1);
  copy.step(1);
  assert.deepEqual(copy.snapshot(), w.snapshot());
});

test('an impulse into a wall is resolved on the next physics action at the same clock time', () => {
  const w = new World();
  const b = w.addBall({ x: 20, y: 75, mass: 2 });
  w.step(3);
  w.applyImpulse(b.id, -80, 12);
  w.step(0);
  assert.equal(w.wallHits, 0);
  assert.deepEqual(w.nextImpact().map(e => [e.time, e.wall]), [[3, 'left']]);
  assert.deepEqual([b.vx, b.vy], [40, 6]);
});

test('invalid impulses leave both velocity components intact and opposing large impulses can cancel', () => {
  const w = new World();
  const b = w.addBall({ x: 60, y: 70, vx: -1.5e308, mass: 0.5 });
  const state = w.snapshot();
  for (const args of [[0, 1, 2], [2, 1, 2], ['1', 0, 0], [1, NaN, 0], [1, 1, Infinity], [1, 2, 1.5e308]]) {
    assert.throws(() => w.applyImpulse(...args), RangeError);
    assert.deepEqual(w.snapshot(), state);
  }
  w.applyImpulse(1, 1.5e308, 4);
  assert.deepEqual([b.vx, b.vy], [1.5e308, 8]);
});

test('gates and surface settings round-trip independently and reset clears only measurements', () => {
  const w = createScene('return-lanes');
  const readings = [];
  w.nextImpact(readings);
  const saved = w.snapshot();
  const copy = World.fromSnapshot(saved);
  assert.deepEqual(copy.snapshot(), saved);
  assert.deepEqual(copy.gates[0].counts, { forward: 2, reverse: 0 });
  saved.gates[0].counts.forward = 99;
  saved.surfaceRestitution['rail:2'] = 1;
  const later = [], again = [];
  w.step(3, { crossings: later });
  copy.step(3, { crossings: again });
  assert.deepEqual(again, later);
  assert.deepEqual(copy.snapshot(), w.snapshot());
  const balls = copy.snapshot().balls;
  copy.resetMeasurements();
  assert.equal(copy.time, 0);
  assert.equal(copy.railHits, 0);
  assert.deepEqual(copy.gates[0].counts, { forward: 0, reverse: 0 });
  assert.deepEqual(copy.surfaceRestitution, { 'rail:2': 0.5 });
  assert.deepEqual(copy.snapshot().balls, balls);
});

test('checkpoint validation rejects damaged gates, unknown surfaces and invalid overrides before use', () => {
  const w = createScene('return-lanes');
  for (const target of ['rail:0', 'rail:3', 'rail:01', 'bumper:1', 'ball:1', 'wall:constructor', '__proto__']) {
    assert.throws(() => w.setSurfaceRestitution(target, 0.4), /Unknown fixed surface/);
  }
  for (const invalid of [undefined, -0.1, 1.1, '0', NaN]) {
    assert.throws(() => w.setSurfaceRestitution('rail:2', invalid), RangeError);
  }
  assert.deepEqual(w.surfaceRestitution, { 'rail:2': 0.5 });
  for (const change of [
    s => { s.gates = null; }, s => { s.gates[0].id = 3; }, s => { s.gates[0].x2 = -1; },
    s => { s.gates[0].counts = null; }, s => { s.gates[0].counts.reverse = 0.5; },
    s => { s.gates[0].counts.forward = -1; }, s => { s.surfaceRestitution = []; },
    s => { s.surfaceRestitution = null; }, s => { s.surfaceRestitution['rail:1'] = null; },
    s => { s.surfaceRestitution['rail:99'] = 0; }
  ]) {
    const damaged = w.snapshot();
    change(damaged);
    assert.throws(() => World.fromSnapshot(damaged), RangeError);
  }
  const before = w.snapshot();
  assert.throws(() => w.step(1, { crossings: {} }), /crossing array/);
  assert.throws(() => w.step(1, { crossings: [] }, () => true), /step options/);
  assert.throws(() => w.nextImpact({}), /crossing array/);
  assert.deepEqual(w.snapshot(), before);
});
