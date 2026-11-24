"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math");
const T = require("../js/track");
const P = require("../js/physics");
const {near, vector} = require("./numeric");

const starter = T.build(T.PRESETS.switchback);
const blank = T.build(T.PRESETS.empty);
const newWorld = () => new P.World(blank);
const R = T.RADIUS;

test("closest point covers triangle faces, three edges, and three corners", () => {
  const tri = P.triangle([0, 0, 0], [0, 0, 3], [3, 0, 0]);
  vector(tri.n, [0, 1, 0]);
  vector(tri.min, [0, 0, 0]);
  vector(tri.max, [3, 0, 3]);
  for (const [p, q] of [
    [[1, 2, 1], [1, 0, 1]], [[-2, 1, -1], [0, 0, 0]], [[-1, 0, 4], [0, 0, 3]],
    [[4, 1, -1], [3, 0, 0]], [[-1, 1, 2], [0, 0, 2]], [[1, 1, -1], [1, 0, 0]],
    [[2, 0, 2], [1.5, 0, 1.5]]
  ]) vector(P.closestPoint(p, tri), q);
});

test("spatial buckets include every nearby triangle at seams and inverted track surfaces", () => {
  const surface = new P.Surface(starter);
  const faces = new Set(Array.from(surface.cells.values()).flat());
  assert.equal(faces.size, surface.count);
  assert.ok(surface.count > 1000);
  const loop = starter.sections.find(s => s.type === "loop");
  const frames = [starter.launch, starter.sections[2].samples[0], ...[0, 29, 57, 85, 114].map(i => loop.samples[i])];
  for (const f of frames) {
    const p = T.point(f, 0, R - 0.012, 0.1);
    const candidates = new Set(surface.near(p));
    const hits = [...faces].filter(tri => M.length(M.sub(P.closestPoint(p, tri), p)) <= R);
    assert.ok(hits.length > 0);
    assert.ok(hits.every(tri => candidates.has(tri)));
    assert.ok(candidates.size < surface.count / 4);
  }
  const count = surface.count;
  surface.insert(P.triangle([0, 0, 0], [1, 0, 0], [2, 0, 0]));
  assert.equal(surface.count, count);
  assert.deepEqual(surface.near([1000, 1000, 1000]), []);
});

test("an open channel resolves penetration and allows a marble to leave the surface", () => {
  const world = newWorld(), f = blank.launch;
  const ball = P.marble(T.point(f, 0, R - 0.04, 0), [0, -2, 0]);
  assert.ok(P.surfaceContact(ball, world.surface));
  near(ball.p[1], f.p[1] + R);
  assert.ok(ball.v[1] >= 0);
  const flying = P.marble(T.point(f, 0, R + 0.2, 0), [3, 2, 0]);
  assert.equal(P.surfaceContact(flying, world.surface), false);
  vector(flying.v, [3, 2, 0]);
  const wall = P.marble(T.point(f, 0, 0.43, 0.86 - R), [0, 0, 3]);
  // Move into the positive-side wall with a centre above the bevel.
  wall.p[2] += 0.05;
  assert.ok(P.surfaceContact(wall, world.surface));
  assert.ok(wall.v[2] < 1);
});

test("floor impulse applies restitution and solid-sphere rolling friction", () => {
  const ball = P.marble([0, R - 0.02, 0], [7, -2.5, 0]);
  P.staticContact(ball, [0, 1, 0], 0.02, 0.2, 1);
  near(ball.p[1], R);
  near(ball.v[1], 0.5);
  near(ball.v[0], 5);
  near(ball.spin[2], -5 / R);
  near(M.add(ball.v, M.cross(ball.spin, [0, -R, 0]))[0], 0);
  const resting = P.marble([0, R, 0], [0, -0.1, 0]);
  P.staticContact(resting, [0, 1, 0], 0, 0.8);
  near(resting.v[1], 0);
  const exiting = P.marble([0, R, 0], [1, 2, 3]);
  P.staticContact(exiting, [0, 1, 0], 0.01);
  vector(exiting.v, [1, 2, 3]);
  vector(exiting.spin, [0, 0, 0]);
});

test("sphere impulses conserve momentum, exchange velocity elastically, and separate overlap", () => {
  const a = P.marble([0, 2, 3], [5, 0, 0]), b = P.marble([0.7, 2, 3], [-1, 0, 0]);
  assert.ok(P.collideMarbles(a, b, 1));
  vector(a.v, [-1, 0, 0]);
  vector(b.v, [5, 0, 0]);
  near(M.length(M.sub(a.p, b.p)), 2 * R);
  vector(M.add(a.p, b.p), [0.7, 4, 6]);
  b.p[0] += 0.01;
  assert.equal(P.collideMarbles(a, b), false);
});

test("glancing collisions cause spin and dissipate energy without creating net impulse", () => {
  const a = P.marble([0, 1, 0], [5, 0, 3]), b = P.marble([0.7, 1, 0], [-1, 0, 0]);
  const energy = ball => M.dot(ball.v, ball.v) / 2 + 0.2 * R * R * M.dot(ball.spin, ball.spin);
  const before = energy(a) + energy(b), momentum = M.add(a.v, b.v);
  P.collideMarbles(a, b);
  vector(M.add(a.v, b.v), momentum);
  assert.ok(M.length(a.spin) > 0 && M.length(b.spin) > 0);
  assert.ok(energy(a) + energy(b) < before);
  const c = P.marble([0, 0, 0]), d = P.marble([0, 0, 0]);
  assert.ok(P.collideMarbles(c, d));
  near(M.length(M.sub(c.p, d.p)), 2 * R);
  vector(c.v, [0, 0, 0]);
  const away = P.marble([0, 1, 0], [-2, 0, 0]), still = P.marble([0.7, 1, 0]);
  P.collideMarbles(away, still);
  vector(away.v, [-2, 0, 0]);
  vector(still.v, [0, 0, 0]);
});

test("the release gate clamps speed, rejects overlaps and enforces the marble limit", () => {
  const w = newWorld();
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(w.spawn(invalid), false);
  assert.ok(w.spawn(-20, 2));
  const ball = w.balls[0];
  assert.equal(ball.color, 2);
  vector(ball.v, [0, 0, 0]);
  vector(ball.p, w.launchPosition);
  assert.notEqual(ball.p, w.launchPosition);
  assert.equal(w.canSpawn(), false);
  assert.equal(w.spawn(10), false);
  assert.equal(w.dropped, 1);
  ball.p[0] += 3;
  assert.ok(w.spawn(50));
  near(M.length(w.balls[1].v), 16);
  while (w.balls.length < P.MAX_BALLS) {
    w.balls.at(-1).p[0] += 20 + w.balls.length;
    assert.ok(w.spawn(10));
  }
  w.balls.at(-1).p[0] += 10;
  assert.equal(w.canSpawn(), false);
  assert.equal(w.spawn(10), false);
  w.clear();
  assert.equal(w.dropped + w.completed + w.balls.length + w.accumulator, 0);
  assert.ok(w.canSpawn());
});

test("gravity produces free fall, a table bounce, and eventual collection", () => {
  const w = newWorld(), b = P.marble([50, 3, 50]);
  w.balls.push(b);
  for (let i = 0; i < 45; i++) w.step();
  near(b.v[1], -P.GRAVITY * 0.25, 0.005);
  near(b.p[1], 3 - 0.5 * P.GRAVITY * 0.25 ** 2, 0.015);
  while (!b.onTable && b.age < 2) w.step();
  assert.ok(b.onTable && b.v[1] > 0);
  near(b.p[1], R);
  for (let i = 0; i < 800; i++) {
    w.step();
    assert.ok(b.p[1] >= R - 1e-9);
  }
  assert.equal(w.balls.length, 0);
  assert.equal(w.completed, 0);
});

test("a zero-speed drop settles on the launch floor with no horizontal drift", () => {
  const w = newWorld();
  w.spawn(0);
  const b = w.balls[0];
  for (let i = 0; i < 360; i++) w.step();
  vector(b.p, T.point(blank.launch, 0, R, 0), 0.00001);
  assert.ok(M.length(b.v) < 0.01);
  assert.equal(w.spawn(10), false);
  b.age = 90 - P.DT / 2;
  w.step();
  assert.equal(w.balls.length, 0);
});

test("fixed stepping yields the same trajectory and spin at 30, 60 and 144 Hz", () => {
  const trajectories = [];
  for (const refresh of [30, 60, 144]) {
    const w = new P.World(starter);
    w.spawn(10);
    let steps = 0;
    for (let i = 0; i < refresh * 4; i++) steps += w.advance(1 / refresh);
    assert.equal(steps, 4 / P.DT);
    trajectories.push(w.balls[0]);
    for (const field of ["p", "v", "spin", "q"]) vector(w.balls[0][field], trajectories[0][field], 1e-11);
  }
});

test("pause, fractional interpolation, and long-frame bounds preserve the clock", () => {
  const w = newWorld();
  w.spawn(4);
  const b = w.balls[0], initial = b.p.slice();
  assert.equal(w.advance(P.DT * 1.5), 1);
  vector(w.position(b), M.lerp(initial, b.p, 0.5));
  const p = b.p.slice(), remainder = w.accumulator;
  w.paused = true;
  assert.equal(w.advance(1), 0);
  vector(w.position(b), p);
  near(w.accumulator, remainder);
  w.paused = false;
  for (const dt of [0, -1, NaN, Infinity]) assert.equal(w.advance(dt), 0);
  assert.equal(w.advance(10000), 18);
  near(w.accumulator, remainder);
  w.clear();
  assert.equal(w.accumulator, 0);
});

test("a default release travels around the entire inverted loop and scores exactly once", () => {
  const w = new P.World(starter);
  w.spawn();
  const ball = w.balls[0], loop = starter.sections.find(s => s.type === "loop");
  // Four gates pin the route through the loop; a shortcut to the finish cannot pass.
  const gates = [29, 57, 85, 114].map(i => T.point(loop.samples[i], 0, R, 0));
  let gate = 0, captured = false;
  for (let i = 0; i < 18 / P.DT && w.balls.length; i++) {
    w.step();
    if (gate < gates.length && M.length(M.sub(ball.p, gates[gate])) < 0.64) {
      if (gate === 1) assert.ok(ball.v[0] < 0, "travels backwards across the crown");
      gate++;
    }
    if (ball.finished) {
      captured = true;
      assert.equal(gate, gates.length);
      assert.equal(w.completed, 1);
    }
    assert.equal(ball.onTable, false);
    near(Math.hypot(...ball.q), 1);
  }
  assert.ok(captured);
  assert.equal(w.completed, 1);
  assert.equal(w.balls.length, 0);
});

test("an underpowered marble falls out of the open loop and misses the finish", () => {
  const w = new P.World(starter);
  w.spawn(5);
  const b = w.balls[0];
  for (let i = 0; i < 15 / P.DT && w.balls.length; i++) w.step();
  assert.equal(b.onTable, true);
  assert.equal(b.finished, false);
  assert.equal(w.completed, 0);
  assert.equal(w.balls.length, 0);
});

test("the second layout runs at its default speed and spaced marble drops can share one course", () => {
  for (const c of [T.build(T.PRESETS.hairpin), starter]) {
    const w = new P.World(c);
    let peakInPlay = 0;
    for (let i = 0; i < 20 / P.DT; i++) {
      if ([0, 360, 720].includes(i)) assert.ok(w.spawn(10, i / 360));
      peakInPlay = Math.max(peakInPlay, w.balls.length);
      w.step();
    }
    assert.equal(peakInPlay, 3);
    assert.equal(w.dropped, 3);
    assert.equal(w.completed, 3);
    assert.equal(w.balls.length, 0);
  }
});

test("the finish sensor excludes off-lane, tabled, and airborne misses", () => {
  for (const [y, z, tabled, expected] of [[R, 0, false, 1], [2, 0, false, 0], [R, 1.4, false, 0], [R, 0, true, 0]]) {
    const w = newWorld();
    const b = P.marble(T.point(blank.finish, -0.03, y, z), M.mul(blank.finish.t, 4));
    b.run.split = 0;
    b.onTable = tabled;
    w.balls.push(b);
    for (let i = 0; i < 3; i++) w.step();
    assert.equal(w.completed, expected);
  }
});

test("powered beds change forward rolling speed once per step and preserve lateral motion", () => {
  for (const type of ["drive", "brake"]) {
    const c = T.build({height: 4, pieces: ["right", type]});
    const surface = new P.Surface(c), section = c.sections[2];
    // Mid-bed is both a longitudinal seam and the edge of two floor triangles.
    const f = T.atDistance(section, section.length/2), strip = T.STRIPS[type];
    for (const initial of [-10, -3, 0, 3.9, 4.02, 10, 11.97, 13]) {
      const b = P.marble(T.point(f,0,R-0.003), M.add(M.mul(f.t,initial),M.mul(f.b,0.7)));
      b.spin = M.mul(M.cross(f.n,b.v),1/R);
      assert.ok(P.surfaceContact(b,surface,P.DT));
      const speed = M.dot(b.v,f.t);
      const target = type === "drive" ? Math.max(12,initial) : M.clamp(initial,-4,4);
      near(speed, initial + M.clamp(target-initial,-strip.acceleration*P.DT,strip.acceleration*P.DT));
      near(M.dot(b.v,f.b), 0.7);
      near(M.dot(b.v,f.n), 0);
      vector(M.add(b.v,M.cross(b.spin,M.mul(f.n,-R))),[0,0,0]);
    }
  }
});

test("strip hardware only drives contact with the inset bed, clear of leads, air and side walls", () => {
  const c = T.build({height: 4, pieces: ["drive"]}), section = c.sections[1], surface = new P.Surface(c);
  for (const [along, height, side, contact] of [
    [0.2,R-0.002,0,true], [section.length-0.2,R-0.002,0,true],
    [2,R+0.15,0,false], [2,-0.1,0,false], [2,0.43,0.56,true]
  ]) {
    const f = T.atDistance(section,along), b = P.marble(T.point(f,0,height,side));
    assert.equal(P.surfaceContact(b,surface,P.DT),contact);
    vector(b.v,[0,0,0]);
  }
});

test("a five metre-per-second relay launch takes the drive through the loop and slows on the brake", () => {
  const c = T.build(T.PRESETS.relay), w = new P.World(c);
  assert.ok(w.spawn(5));
  const ball = w.balls[0];
  const gates = ["drive", "loop", "brake"].map(type => {
    const s = c.sections.find(part => part.type === type);
    return T.atDistance(s, type === "loop" ? s.length/2 : s.length-0.3);
  });
  const speeds = [];
  for (let i=0; i<15/P.DT && !ball.finished; i++) {
    w.step();
    const next = gates[speeds.length];
    if (next && M.length(M.sub(ball.p,T.point(next,0,R))) < 0.6) speeds.push(M.dot(ball.v,next.t));
  }
  assert.equal(speeds.length,3);
  assert.ok(speeds[0] > 11.5 && speeds[1] > 0);
  assert.ok(speeds[2] > 0 && speeds[2] < 5);
  assert.equal(w.completed,1);
  assert.equal(ball.onTable,false);
  const passive = new P.World(T.build({...T.PRESETS.relay,
    pieces: T.PRESETS.relay.pieces.map(type => type === "drive" ? "straight" : type)}));
  passive.spawn(5);
  for (let i=0; i<15/P.DT && passive.balls.length; i++) passive.step();
  assert.equal(passive.completed,0);
});

test("resuming a paused marble never displays an older pose before the next fixed step", () => {
  const w = newWorld();
  w.spawn(8);
  w.advance(P.DT * 2.25);
  const b = w.balls[0];
  w.paused = true;
  const held = w.position(b).slice();
  w.paused = false;
  vector(w.position(b),held);
  w.advance(P.DT * 0.25);
  vector(w.position(b),held);
  for (const dt of [0, -1, NaN, Infinity]) w.step(dt);
  vector(w.position(b),held);
  w.advance(P.DT);
  assert.ok(w.position(b)[0] > held[0]);
});

test("a maximum-length loop layout supports a full world of moving spheres", () => {
  const course = T.build({height: 4, pieces: Array(T.LIMIT).fill("loop")});
  const w = new P.World(course);
  for (let i = 0; i < P.MAX_BALLS; i++) {
    const frame = T.atDistance(course.sections[i + 1], 1);
    w.balls.push(P.marble(T.point(frame, 0, R + 0.01, 0), M.mul(frame.t, 9), i % 5));
  }
  assert.equal(w.canSpawn(), false);
  for (let i = 0; i < 120; i++) w.advance(1 / 60);
  assert.equal(w.balls.length, P.MAX_BALLS);
  for (const b of w.balls) {
    for (const state of [b.p, b.v, b.spin, b.q]) assert.ok(state.every(Number.isFinite));
    near(Math.hypot(...b.q), 1);
    near(b.age, 2);
  }
});
