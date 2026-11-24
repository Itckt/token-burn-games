'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../physics.js');
const { createScene, addFreeBall } = require('../scenes.js');

const { near, assertGeometry } = require('./helpers.js');

const level = { x1: 50, y1: 80, x2: 170, y2: 80, radius: 10 };

test('rail placement checks the entire segment, both ends and all body types in either order', () => {
  const w = new World({ width: 260, height: 200 });
  assert.equal(w.canPlaceRail(level), true);
  const a = w.addRail(level);
  assert.ok(Object.isFrozen(a));
  for (const invalid of [
    { ...level, x1: 8 }, { ...level, y2: 191 }, { ...level, radius: 0 },
    { ...level, x2: 50 }, { ...level, y2: NaN }, level,
    { x1: 110, y1: 20, x2: 110, y2: 140 }, // Crossing interiors, distant endpoints.
    { ...level, x1: 180, x2: 230 }, { ...level, y1: 95, y2: 95 }
  ]) {
    assert.equal(w.canPlaceRail(invalid), false);
    assert.throws(() => w.addRail(invalid), /rail/);
  }
  for (const obstacle of ['addBall', 'addBumper']) {
    const circle = { x: 110, y: 76, radius: 6 };
    assert.equal(w.canPlace(circle.x, circle.y, circle.radius), false);
    assert.throws(() => w[obstacle](circle), /clear spot/);
    const reverse = new World();
    reverse[obstacle](circle);
    assert.throws(() => reverse.addRail(level), /clear path/);
  }
  assert.equal(w.canPlace(32, 80, 10), false);
  assert.equal(w.addBall({ x: 110, y: 55, radius: 15 }).id, 1);
  assert.equal(w.addBumper({ x: 30, y: 80, radius: 10 }).id, 1);
  assert.equal(w.addRail({ ...level, x1: 190, x2: 230 }).id, 2);
  assert.equal(w.addRail({ x1: 35, y1: 152, x2: 200, y2: 152 }).radius, 8);
});

test('both faces of an angled rail preserve tangent speed at every elasticity, in either endpoint order', () => {
  for (const reversed of [false, true]) {
    const ends = reversed ? [180, 160, 100, 100] : [100, 100, 180, 160];
    const [x1, y1, x2, y2] = ends;
    for (const side of [-1, 1]) {
      for (const e of [0, 0.5, 1]) {
        const w = new World({ width: 300, height: 300, restitution: e });
        w.addRail({ x1, y1, x2, y2, radius: 5 });
        const b = w.addBall({ x: 140 + side * 12, y: 130 - side * 16, radius: 5,
          vx: -8 - side * 24, vy: -6 + side * 32 });
        const [hit] = w.nextImpact();
        assert.deepEqual([hit.type, hit.railId, hit.ballId], ['rail', 1, 1]);
        near(hit.time, 0.25);
        near(hit.x, 138 + side * 3);
        near(hit.y, 128.5 - side * 4);
        near(b.vx, -8 + side * 24 * e);
        near(b.vy, -6 - side * 32 * e);
        w.step(0.25);
        assert.equal(w.railHits, 1);
      }
    }
  }
});

test('a fast oblique hit on a rounded end reports its radial contact point and outgoing velocity', () => {
  const w = new World();
  w.addRail({ x1: 200, y1: 100, x2: 300, y2: 100, radius: 10 });
  const b = w.addBall({ x: 64, y: 112, vx: 6000, radius: 10 });
  const hits = [];
  w.step(0.025, hits);
  assert.equal(w.railHits, 1);
  const [hit] = hits;
  near(hit.time, 0.02);
  near(hit.x, 192);
  near(hit.y, 106);
  near(b.vx, -1680);
  near(b.vy, 5760);
  near(b.x, 184 - 8.4);
  near(b.y, 112 + 28.8);
});

test('exact tangents and near misses pass along a whole rail, and a seam counts once', () => {
  const rail = { x1: 200, y1: 100, x2: 300, y2: 100, radius: 10 };
  for (const [y, hits] of [[120, 0], [120.000001, 0], [119.999999, 1]]) {
    const w = new World();
    w.addRail(rail);
    w.addBall({ x: 64, y, vx: 6000, radius: 10 });
    w.step(0.05);
    assert.equal(w.railHits, hits);
  }
  for (const x of [200, 300]) {
    const w = new World();
    w.addRail(rail);
    const b = w.addBall({ x, y: 60, vy: 100, radius: 10 });
    const hits = [];
    w.step(0.2, hits);
    assert.deepEqual(hits, [{ time: 0.2, type: 'rail', ballId: 1, railId: 1, x, y: 90 }]);
    assert.equal(b.vy, -100);
    w.step(0.1, hits);
    assert.equal(hits.length, 1);
  }
});

test('fast travel between two rails resolves every impact within one tick', () => {
  const w = new World();
  for (const y of [40, 100]) w.addRail({ x1: 80, x2: 200, y1: y, y2: y, radius: 5 });
  const b = w.addBall({ x: 100, y: 60, radius: 5, vy: 24000 });
  const hits = [];
  w.step(undefined, hits);
  near(b.y, 80);
  assert.equal(b.vy, -24000);
  assert.deepEqual(hits.map(h => h.railId), [2, 1, 2, 1, 2]);
  assert.equal(w.railHits, hits.length);
  assert.equal(w.wallHits, 0);
});

test('roundoff at an oblique cap seam leaves no gap between the two contact equations', () => {
  for (const reversed of [false, true]) {
    const w = new World();
    const [x1, y1, x2, y2] = reversed ? [180, 160, 100, 100] : [100, 100, 180, 160];
    w.addRail({ x1, y1, x2, y2, radius: 5 });
    const b = w.addBall({ x: 108, y: 91.5, vx: -20, vy: 5, radius: 5 });
    const [hit] = w.nextImpact();
    assert.equal(hit.type, 'rail');
    near(hit.time, 0.1);
    near(hit.x, 103);
    near(hit.y, 96);
    near(b.vx, -0.8);
    near(b.vy, -20.6);
    w.step(0.1);
    assert.equal(w.railHits, 1);
  }
});

test('a ball wedged against a rail and wall retains its tangential drift', () => {
  const w = new World({ width: 200, height: 100 });
  w.addRail({ x1: 35, y1: 35, x2: 165, y2: 35, radius: 5 });
  const b = w.addBall({ x: 100, y: 15, radius: 15, vx: 4, vy: 40 });
  const hits = w.nextImpact();
  assert.deepEqual(hits.map(h => [h.time, h.type]), [[0, 'rail'], [0, 'wall']]);
  w.step(0.5);
  assert.deepEqual([b.x, b.y, b.vx, Math.abs(b.vy)], [102, 15, 4, 0]);
  assert.deepEqual([w.railHits, w.wallHits], [1, 1]);
});

test('crowded bank shots stay clear of posts and rails and respect energy with and without drag', () => {
  for (const [e, drag] of [[1, 0], [0.7, 0.08], [0, 0]]) {
    const w = createScene('bank-shot', e, { drag });
    w.addBumper({ x: 250, y: 112, radius: 16 });
    for (let i = 0; i < 8; i++) assert.ok(addFreeBall(w));
    const initial = w.kineticEnergy;
    for (let i = 0; i < 960; i++) {
      const previous = w.kineticEnergy;
      w.step();
      assertGeometry(w);
      assert.ok(w.kineticEnergy <= previous + 1e-7);
    }
    assert.ok(w.railHits > 0 && w.wallHits > 0 && w.ballHits > 0);
    if (e === 1) near(w.kineticEnergy, initial);
  }
});

test('rail checkpoints survive continued play and reject damaged shapes, counters and overlaps', () => {
  const w = createScene('bank-shot', 0.9, { drag: 0.13 });
  w.nextImpact();
  const state = w.snapshot();
  assert.equal(state.railHits, 1);
  const restored = World.fromSnapshot(JSON.parse(JSON.stringify(state)));
  state.rails[0].x1 = 800;
  const a = [], b = [];
  for (let i = 0; i < 720; i++) {
    w.step(undefined, a);
    restored.step(undefined, b);
  }
  assert.ok(a.some(hit => hit.type === 'rail'));
  assert.deepEqual(b, a);
  assert.deepEqual(restored.snapshot(), w.snapshot());
  const initial = createScene('bank-shot').snapshot();
  for (const change of [
    s => { s.rails = null; }, s => { s.rails[0] = null; }, s => { s.rails[0].id = 9; },
    s => { delete s.rails[0].radius; }, s => { s.railHits = -1; }, s => { s.railHits = 2.5; },
    s => { s.rails = []; s.railHits = 1; }, s => { s.rails[0].x2 = Infinity; },
    s => { Object.assign(s.rails[1], s.rails[0], { id: 2 }); },
    s => { Object.assign(s.balls[0], { x: s.rails[0].x1, y: s.rails[0].y1 }); }
  ]) {
    const bad = structuredClone(initial);
    change(bad);
    assert.throws(() => World.fromSnapshot(bad), RangeError);
  }
});
