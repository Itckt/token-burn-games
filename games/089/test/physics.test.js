'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { World, TICK } = require('../physics.js');

const { near, assertGeometry } = require('./helpers.js');

test('dimensions, restitution, mass, velocity and step durations are validated', () => {
  for (const value of [0, -2, NaN, Infinity, '100']) {
    assert.throws(() => new World({ width: value }), RangeError);
    assert.throws(() => new World({ height: value }), RangeError);
  }
  const w = new World();
  for (const value of [-1, 1.1, NaN, Infinity, '1']) {
    assert.throws(() => { w.restitution = value; }, RangeError);
    assert.equal(w.restitution, 1);
  }
  for (const props of [{ mass: 0 }, { mass: -1 }, { mass: NaN }, { vx: NaN }, { vy: Infinity }]) {
    assert.throws(() => w.addBall({ x: 50, y: 50, ...props }), RangeError);
  }
  for (const duration of [-0.1, Infinity, NaN, '1']) assert.throws(() => w.step(duration), RangeError);
  assert.equal(w.time, 0);
  assert.equal(w.balls.length, 0);
});

test('placement rejects intersections and invalid geometry and allows exact touching', () => {
  const w = new World({ width: 120, height: 100 });
  const a = w.addBall({ x: 20, y: 20 });
  for (const [x, y, radius] of [
    [20, 20, 20], [59.99, 20, 20], [10, 70, 20], [110, 70, 20], [80, 95, 20],
    [80, 2, 20], [60, 50, 50], [80, 60, 0], [80, 60, -3], [NaN, 60, 10], [80, Infinity, 10]
  ]) {
    assert.equal(w.canPlace(x, y, radius), false);
    assert.throws(() => w.addBall({ x, y, radius }), RangeError);
  }
  const b = w.addBall({ x: 50, y: 20, radius: 10 });
  assert.deepEqual([a.id, b.id], [1, 2]);
  assert.equal(a.mass, 4 * b.mass);
});

test('distinct centers are required even for very small balls', () => {
  const w = new World();
  const small = { x: 25, y: 25, radius: 1e-10 };
  w.addBall(small);
  assert.throws(() => w.addBall(small), RangeError);
});

test('small geometry uses a proportional contact tolerance', () => {
  const w = new World({ width: 1e-6, height: 1e-6 });
  const radius = 1e-10;
  const a = w.addBall({ x: 50 * radius, y: 50 * radius, vx: 1e-8, radius });
  const b = w.addBall({ x: 53 * radius, y: 50 * radius, radius });
  w.step(0.002);
  assert.equal(w.ballHits, 0);
  w.step(0.02);
  assert.equal(w.ballHits, 1);
  assert.equal(a.vx, 0);
  assert.equal(b.vx, 1e-8);
});

test('very slow approaching contacts still exchange momentum', () => {
  const w = new World();
  const a = w.addBall({ x: 100, y: 100, vx: 1e-11, radius: 10 });
  const b = w.addBall({ x: 120, y: 100, radius: 10 });
  w.step(1e12);
  assert.equal(w.ballHits, 1);
  near(a.x, 100);
  near(b.x, 130);
});

test('free flight advances in seconds and zero duration leaves the world untouched', () => {
  const w = new World();
  const a = w.addBall({ x: 80, y: 90, vx: 42, vy: -18 });
  const initial = w.snapshot();
  w.step(0);
  assert.deepEqual(w.snapshot(), initial);
  w.step(0.5);
  assert.deepEqual([a.x, a.y, a.vx, a.vy], [101, 81, 42, -18]);
  w.step();
  near(w.time, 0.5 + TICK);
  near(a.x, 101 + 42 * TICK);
  assert.equal(w.ballHits + w.wallHits, 0);
});

test('empty worlds advance and snapshots are independent copies', () => {
  const w = new World();
  w.step(2);
  assert.equal(w.time, 2);
  assert.equal(w.kineticEnergy, 0);
  const a = w.addBall({ x: 60, y: 50 });
  const state = w.snapshot();
  state.balls[0].x = 0;
  state.balls.pop();
  assert.equal(w.balls.length, 1);
  assert.equal(a.x, 60);
});

for (const [side, x, y, vx, vy, endX, endY, endVX, endVY] of [
  ['left', 20, 60, -40, 3, 20, 61.5, 40, 3],
  ['right', 180, 60, 40, -3, 180, 58.5, -40, -3],
  ['top', 100, 20, 3, -40, 101.5, 20, 3, 40],
  ['bottom', 100, 100, -3, 40, 98.5, 100, -3, -40]
]) {
  test('the ' + side + ' wall reflects only the normal component', () => {
    const w = new World({ width: 200, height: 120 });
    const b = w.addBall({ x, y, vx, vy, radius: 10 });
    w.step(0.5);
    assert.deepEqual([b.x, b.y, b.vx, b.vy], [endX, endY, endVX, endVY]);
    assert.equal(w.wallHits, 1);
  });
}

test('a corner impact at the tick endpoint resolves both walls exactly once', () => {
  const w = new World({ width: 100, height: 100 });
  const a = w.addBall({ x: 50, y: 50, vx: 80, vy: -80, radius: 10 });
  w.step(0.5);
  assert.deepEqual([a.x, a.y, a.vx, a.vy], [90, 10, -80, 80]);
  w.step(0.5);
  assert.deepEqual([a.x, a.y, w.wallHits], [50, 50, 2]);
});

test('many wall contacts in one large step match an unfolded straight path', () => {
  const w = new World({ width: 100, height: 100 });
  const a = w.addBall({ x: 50, y: 50, vx: 10000, radius: 5 });
  w.step(0.2);
  near(a.x, 70);
  assert.equal(a.vx, 10000);
  assert.equal(w.wallHits, 22);
});

test('wall restitution removes just the expected normal speed, including a dead stop', () => {
  for (const e of [0, 0.35, 1]) {
    const w = new World({ restitution: e });
    const a = w.addBall({ x: 20, y: 100, vx: -80, vy: 40 });
    w.step(0.25);
    near(a.vx, e * 80);
    near(a.x, 20 + e * 20);
    assert.equal(a.vy, 40);
    assert.equal(w.wallHits, 1);
  }
});

test('fast equal-mass balls exchange velocities instead of tunnelling', () => {
  const w = new World({ width: 2000, height: 300 });
  const a = w.addBall({ x: 100, y: 120, radius: 2, vx: 3000 });
  const b = w.addBall({ x: 160, y: 120, radius: 2, vx: -3000 });
  w.step(0.03);
  near(a.vx, -3000);
  near(b.vx, 3000);
  near(a.x, 66);
  near(b.x, 194);
  assert.equal(w.ballHits, 1);
});

test('unequal masses obey momentum conservation and the specified restitution', () => {
  const w = new World({ restitution: 0.6 });
  const a = w.addBall({ x: 60, y: 60, radius: 10, mass: 2, vx: 75 });
  const b = w.addBall({ x: 100, y: 60, radius: 10, mass: 5, vx: -25 });
  const energy = w.kineticEnergy;
  w.step(0.3);
  near(a.vx, -275 / 7);
  near(b.vx, 145 / 7);
  near(b.vx - a.vx, 0.6 * 100);
  near(a.mass * a.vx + b.mass * b.vx, 25);
  assert.ok(w.kineticEnergy < energy);
});

test('an oblique collision conserves vector momentum, tangential speeds and elastic energy', () => {
  const w = new World();
  const a = w.addBall({ x: 100, y: 100, radius: 10, mass: 2, vx: 40, vy: 20 });
  const b = w.addBall({ x: 124, y: 118, radius: 10, mass: 3, vx: -8, vy: 12 });
  const energy = w.kineticEnergy;
  w.step(0.4);
  assert.equal(w.ballHits, 1);
  near(2 * a.vx + 3 * b.vx, 56);
  near(2 * a.vy + 3 * b.vy, 76);
  near(-0.8 * a.vx + 0.6 * a.vy, -20);
  near(-0.8 * b.vx + 0.6 * b.vy, 13.6);
  near(w.kineticEnergy, energy);
});

test('tangency and a near miss pass freely while a slightly closer path collides', () => {
  for (const [offset, hits] of [[20, 0], [20.001, 0], [19.999, 1]]) {
    const w = new World();
    const a = w.addBall({ x: 100, y: 100, vx: 100, radius: 10 });
    w.addBall({ x: 150, y: 100 + offset, radius: 10 });
    w.step(1);
    assert.equal(w.ballHits, hits);
    if (hits === 0) assert.deepEqual([a.x, a.y, a.vx, a.vy], [200, 100, 100, 0]);
  }
});

test('resting, parallel and separating contacts do not generate spurious hits', () => {
  for (const [v1, v2] of [[0, 0], [10, 10], [-20, 15]]) {
    const w = new World();
    w.addBall({ x: 100, y: 100, vx: v1, radius: 10 });
    w.addBall({ x: 120, y: 100, vx: v2, radius: 10 });
    w.step(1);
    assert.equal(w.ballHits, 0);
    assertGeometry(w);
  }
});

test('perfectly inelastic balls share their normal velocity across subsequent ticks', () => {
  const w = new World({ restitution: 0 });
  const a = w.addBall({ x: 100, y: 100, vx: 60, radius: 10 });
  const b = w.addBall({ x: 140, y: 100, radius: 10 });
  for (let i = 0; i < 120; i++) w.step();
  near(a.vx, 30);
  near(b.vx, 30);
  near(b.x - a.x, 20);
  assert.equal(w.ballHits, 1);
});

test('a chain of touching balls transfers an impulse at the same instant', () => {
  const w = new World();
  for (const x of [60, 100, 120]) w.addBall({ x, y: 80, vx: x === 60 ? 100 : 0, radius: 10 });
  w.step(0.2);
  assert.deepEqual(w.balls.map(b => b.vx), [0, 0, 100]);
  assert.equal(w.ballHits, 2);
  w.step(0.2);
  near(w.balls[2].x, 140);
});

test('a fully packed row settles without a zero-time collision loop', () => {
  const w = new World({ width: 100, height: 100 });
  for (const x of [10, 30, 50, 70, 90]) w.addBall({ x, y: 50, vx: x === 10 ? 60 : 0, radius: 10 });
  w.step(0.2);
  near(w.time, 0.2);
  assertGeometry(w);
  assert.ok(w.kineticEnergy < 1e-12);
});

test('a touching pair coming to rest at a wall counts each contact once', () => {
  const w = new World({ width: 200, height: 100, restitution: 0 });
  const a = w.addBall({ x: 150, y: 50, vx: 40, radius: 10, mass: 2 });
  const b = w.addBall({ x: 170, y: 50, vx: 40, radius: 10, mass: 1 });
  w.step(0.75);
  near(a.x, 170);
  near(b.x, 190);
  near(a.vx, 0);
  near(b.vx, 0);
  assert.deepEqual([w.ballHits, w.wallHits], [1, 1]);
  assertGeometry(w);
});

test('an extreme mass ratio pinned at a wall settles and preserves tangential slip', () => {
  const w = new World({ width: 200, height: 100, restitution: 0 });
  const a = w.addBall({ x: 170, y: 50, vx: 40, vy: 12, radius: 10, mass: 1e20 });
  const b = w.addBall({ x: 190, y: 50, vx: 40, vy: -9, radius: 10, mass: 1 });
  w.step(0.25);
  near(a.vx, 0);
  near(b.vx, 0);
  near(a.vy, 12);
  near(b.vy, -9);
  assert.deepEqual([w.wallHits, w.ballHits], [1, 1]);
  assertGeometry(w);
});

test('settling a jam leaves an independent simultaneous elastic collision intact', () => {
  const w = new World({ width: 100, height: 200 });
  const a = w.addBall({ x: 30, y: 150, vx: 25, radius: 10 });
  const b = w.addBall({ x: 50, y: 150, vx: -25, radius: 10 });
  for (const x of [10, 30, 50, 70, 90]) w.addBall({ x, y: 50, vx: x === 10 ? 60 : 0, radius: 10 });
  w.step(0.2);
  assert.deepEqual([a.vx, b.vx], [-25, 25]);
  assertGeometry(w);
});

function seededRandom(seed) {
  return function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function seededWorld(restitution, count = 12, random = seededRandom(308)) {
  const w = new World({ width: 450, height: 250, restitution });
  while (w.balls.length < count) {
    const radius = 4 + 9 * random();
    const x = radius + random() * (w.width - 2 * radius);
    const y = radius + random() * (w.height - 2 * radius);
    if (w.canPlace(x, y, radius)) {
      w.addBall({ x, y, radius, vx: (random() - 0.5) * 1100, vy: (random() - 0.5) * 1100 });
    }
  }
  return w;
}

test('crowded inelastic contacts with tangential drift advance through variable time steps', () => {
  const random = seededRandom(4);
  const w = seededWorld(0, 20, random);
  let elapsed = 0;
  for (let i = 0; i < 360; i++) {
    const duration = 0.015 + random() * 0.06;
    const energy = w.kineticEnergy;
    w.step(duration);
    elapsed += duration;
    assertGeometry(w);
    assert.ok(w.kineticEnergy <= energy + 1e-7);
  }
  near(w.time, elapsed);
  assert.ok(w.ballHits > 0 && w.wallHits > 0);
});

for (const e of [0, 0.77, 1]) {
  test('long seeded run stays bounded and respects energy at restitution ' + e, () => {
    const w = seededWorld(e);
    let previous = w.kineticEnergy;
    const initial = previous;
    for (let i = 0; i < 1800; i++) {
      w.step();
      assertGeometry(w);
      assert.ok(w.kineticEnergy <= previous + 1e-7);
      previous = w.kineticEnergy;
    }
    if (e === 1) near(w.kineticEnergy, initial);
    else assert.ok(w.kineticEnergy < initial);
    assert.ok(w.ballHits > 0 && w.wallHits > 0);
    near(w.time, 15);
  });
}

test('subdividing a step produces the same trajectory and impact counts', () => {
  const one = seededWorld(0.93);
  const many = seededWorld(0.93);
  one.step(0.5);
  for (let i = 0; i < 60; i++) many.step(TICK);
  assert.equal(one.ballHits, many.ballHits);
  assert.equal(one.wallHits, many.wallHits);
  for (const [i, ball] of one.balls.entries()) {
    for (const key of ['x', 'y', 'vx', 'vy']) near(ball[key], many.balls[i][key]);
  }
});

test('balls and fixed bumpers share placement rules and have independent IDs', () => {
  const w = new World({ width: 120, height: 100 });
  const post = w.addBumper({ x: 30, y: 30, radius: 20 });
  assert.equal(w.canPlace(40, 30, 10), false);
  assert.throws(() => w.addBall({ x: 50, y: 30, radius: 10 }), /clear spot/);
  const ball = w.addBall({ x: 60, y: 30, radius: 10 });
  for (const [x, y, radius] of [[60, 30, 10], [20, 40, 10], [1, 30, 10], [80, 50, 0]]) {
    assert.throws(() => w.addBumper({ x, y, radius }), /clear spot/);
  }
  assert.deepEqual([post.id, ball.id, w.addBumper({ x: 80, y: 30, radius: 10 }).id], [1, 1, 2]);
  assert.throws(() => { post.x = 99; }, TypeError);
  w.snapshot().bumpers[0].x = 99;
  assert.equal(post.x, 30);
  assert.equal(w.kineticEnergy, 0);
});

test('fast bumper hits use time of contact and the full restitution range', () => {
  for (const e of [0, 0.5, 1]) {
    const w = new World({ width: 600, height: 250, restitution: e });
    const ball = w.addBall({ x: 60, y: 100, radius: 5, vx: 6000 });
    w.addBumper({ x: 200, y: 100, radius: 15 });
    const events = [];
    w.step(0.03, events);
    near(ball.vx, -6000 * e);
    near(ball.x, 180 - 60 * e);
    assert.equal(ball.vy, 0);
    assert.deepEqual(events, [{ time: 0.02, type: 'bumper', ballId: 1, bumperId: 1, x: 185, y: 100 }]);
    assert.deepEqual([w.ballHits, w.wallHits, w.bumperHits], [0, 0, 1]);
    assert.deepEqual(w.bumpers[0], { id: 1, x: 200, y: 100, radius: 15 });
  }
});

test('a glancing bumper impact preserves tangential speed and reports its surface point', () => {
  const w = new World({ restitution: 0.5 });
  const ball = w.addBall({ x: 100, y: 120, radius: 10, vx: 100, mass: 75 });
  w.addBumper({ x: 165, y: 140, radius: 15 });
  const atEndpoint = World.fromSnapshot(w.snapshot());
  const [hit] = w.nextImpact();
  assert.deepEqual([hit.type, hit.ballId, hit.bumperId], ['bumper', 1, 1]);
  near(hit.time, 0.5);
  near(hit.x, 156);
  near(hit.y, 128);
  atEndpoint.step(0.5);
  assert.equal(atEndpoint.bumperHits, 1);
  near(atEndpoint.balls[0].vy, -72);
  near(ball.vx, 46);
  near(ball.vy, -72);
  near(-0.8 * ball.vx + 0.6 * ball.vy, -80);
  w.step(0.25);
  assert.equal(w.bumperHits, 1);
});

test('relative speeds whose squares underflow or overflow still find the first circle', () => {
  for (const speed of [1e-200, 1e200]) {
    const w = new World();
    const ball = w.addBall({ x: 100, y: 50, vx: speed, radius: 10, mass: 1 });
    w.addBumper({ x: 160, y: 50, radius: 20 });
    const [hit] = w.nextImpact();
    assert.equal(hit.type, 'bumper');
    near(hit.time * speed, 30);
    near(ball.x, 130);
    assert.equal(ball.vx, -speed);
  }
});

test('opposing finite speeds can exchange momentum even when their difference overflows', () => {
  const w = new World();
  w.addBall({ x: 150, y: 50, radius: 10, vx: 1e308, mass: 1e-310 });
  w.addBall({ x: 250, y: 50, radius: 10, vx: -1e308, mass: 1e-310 });
  near(w.kineticEnergy / 1e306, 1);
  const hits = w.nextImpact();
  assert.equal(hits.length, 1);
  near(hits[0].time * 1e308, 40);
  assert.deepEqual(w.balls.map(b => b.vx), [-1e308, 1e308]);
  near(w.kineticEnergy / 1e306, 1);
});

test('bumper tangents, near misses and separating contacts pass freely', () => {
  for (const [offset, hits] of [[20, 0], [20.001, 0], [19.999, 1]]) {
    const w = new World();
    w.addBall({ x: 100, y: 100, radius: 10, vx: 200 });
    w.addBumper({ x: 160, y: 100 + offset, radius: 10 });
    w.step(0.5);
    assert.equal(w.bumperHits, hits);
  }
  const w = new World();
  w.addBall({ x: 100, y: 50, vx: -10, radius: 10 });
  w.addBumper({ x: 130, y: 50, radius: 20 });
  assert.equal(w.nextImpact()[0].wall, 'left');
  assert.equal(w.bumperHits, 0);
});

test('a chain wedged between a bumper and a wall settles while keeping tangential motion', () => {
  const w = new World({ width: 150, height: 100 });
  w.addBumper({ x: 60, y: 50, radius: 20 });
  w.addBall({ x: 10, y: 50, radius: 10, vx: 70, vy: 4 });
  w.addBall({ x: 30, y: 50, radius: 10, vy: -3 });
  const hits = w.nextImpact();
  assert.deepEqual(hits.map(e => [e.time, e.type]), [[0, 'ball'], [0, 'bumper'], [0, 'wall']]);
  assert.deepEqual(w.balls.map(b => [Math.abs(b.vx), b.vy]), [[0, 4], [0, -3]]);
  w.step(0.2);
  assert.deepEqual([w.ballHits, w.bumperHits, w.wallHits], [1, 1, 1]);
  assertGeometry(w);
});

test('three angled fixed surfaces can trap one ball while another continues its flight', () => {
  const w = new World({ width: 260, height: 200 });
  const trapped = w.addBall({ x: 100, y: 100, vx: 50, vy: 20, radius: 10 });
  const free = w.addBall({ x: 200, y: 150, vx: -20, radius: 10 });
  for (const [x, y] of [[75, 100], [115, 120], [115, 80]]) w.addBumper({ x, y, radius: 15 });
  const events = w.nextImpact();
  assert.deepEqual(events.map(e => e.bumperId).sort(), [1, 2, 3]);
  assert.ok(events.every(e => e.time === 0 && e.ballId === 1));
  w.step(0.5);
  assert.deepEqual([trapped.x, trapped.y, trapped.vx, trapped.vy], [100, 100, 0, 0]);
  assert.equal(free.x, 190);
  assert.equal(w.bumperHits, 3);
});

test('next impact advances to a fractional timestamp, resolves the pair and then finds the wall', () => {
  const w = new World({ width: 200, height: 120 });
  w.addBall({ x: 50, y: 50, radius: 10, vx: 100 });
  w.addBall({ x: 100, y: 50, radius: 10 });
  w.step(0.25);
  const [pair] = w.nextImpact();
  assert.deepEqual(pair, { time: 0.3, type: 'ball', ballId: 1, otherBallId: 2, x: 90, y: 50 });
  assert.deepEqual(w.balls.map(b => [b.x, b.vx]), [[80, 0], [100, 100]]);
  pair.x = 0;
  const [wall] = w.nextImpact();
  near(w.time, 1.2);
  assert.deepEqual(wall, { time: w.time, type: 'wall', ballId: 2, wall: 'right', x: 200, y: 50 });
  assert.deepEqual(w.balls.map(b => [b.x, b.vx]), [[80, 0], [190, -100]]);
});

test('corner traces include both surface points at the same endpoint in stable order', () => {
  const w = new World({ width: 100, height: 100 });
  w.addBall({ x: 50, y: 50, radius: 10, vx: 80, vy: -80 });
  const copy = World.fromSnapshot(w.snapshot());
  const hits = [];
  w.step(0.5, hits);
  assert.deepEqual(hits.map(e => [e.time, e.wall, e.x, e.y]),
    [[0.5, 'right', 100, 10], [0.5, 'top', 90, 0]]);
  assert.deepEqual(copy.nextImpact(), hits);
  assert.deepEqual(copy.snapshot(), w.snapshot());
  assert.deepEqual(w.nextImpact().map(e => [e.time, e.wall]), [[1.5, 'left'], [1.5, 'bottom']]);
});

test('a rounded corner arrival resolves both walls in one jump and a nearby later hit stays separate', () => {
  for (const extra of [0, 0.00001]) {
    const w = new World();
    w.addBall({ x: 25, y: 50.6 + extra, radius: 5, vx: -20 / 0.03, vy: -45.6 / 0.03 });
    const hits = w.nextImpact();
    near(w.time, 0.03);
    if (extra === 0) {
      assert.deepEqual(hits.map(e => e.wall), ['left', 'top']);
      assert.equal(hits[0].time, hits[1].time);
      assert.deepEqual([w.balls[0].x, w.balls[0].y], [5, 5]);
    } else {
      assert.deepEqual(hits.map(e => e.wall), ['left']);
      assert.equal(w.nextImpact()[0].wall, 'top');
      assert.ok(w.time > 0.03);
    }
  }
});

test('next impact leaves empty and resting courts unchanged and zero-duration steps leave pending contact alone', () => {
  const w = new World();
  w.step(3);
  for (const add of [() => {}, () => w.addBumper({ x: 120, y: 100, radius: 10 }),
    () => w.addBall({ x: 100, y: 100, radius: 10 })]) {
    add();
    const before = w.snapshot();
    assert.deepEqual(w.nextImpact(), []);
    assert.deepEqual(w.snapshot(), before);
  }
  w.balls[0].vx = 50;
  const hits = [];
  w.step(0, hits);
  assert.deepEqual(hits, []);
  assert.throws(() => w.step(1, {}), /impact array/);
  assert.equal(w.bumperHits, 0);
  assert.equal(w.nextImpact()[0].time, 3);
  assert.equal(w.balls[0].vx, -50);
});

test('long bumper runs stay bounded and trace exactly the counted contacts', () => {
  for (const e of [0, 0.7, 1]) {
    const w = seededWorld(e);
    for (const [x, y] of [[65, 125], [225, 70], [225, 180], [380, 125]]) {
      if (w.canPlace(x, y, 20)) w.addBumper({ x, y, radius: 20 });
    }
    const initial = w.kineticEnergy;
    const posts = w.snapshot().bumpers;
    const events = [];
    for (let i = 0; i < 1800; i++) {
      const previous = w.kineticEnergy;
      w.step(TICK, events);
      assertGeometry(w);
      assert.ok(w.kineticEnergy <= previous + 1e-7);
    }
    assert.ok(w.bumperHits > 0);
    assert.deepEqual(w.bumpers, posts);
    for (const kind of ['ball', 'wall', 'bumper']) {
      assert.equal(events.filter(event => event.type === kind).length, w[kind + 'Hits']);
    }
    assert.ok(events.every((event, i) => event.time >= (events[i - 1]?.time ?? 0) && event.time <= w.time));
    if (e === 1) near(w.kineticEnergy, initial);
  }
});
