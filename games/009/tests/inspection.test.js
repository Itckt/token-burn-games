"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math");
const T = require("../js/track");
const C = require("../js/camera");
const P = require("../js/physics");
const Trials = require("../js/trials");
const {near, vector} = require("./numeric");

test("a follow view holds the horizon and keeps a moving marble in frame on wide and portrait stages", () => {
  const course = T.build(T.PRESETS.switchback);
  for (const [w, h] of [[1050,660], [320,460]]) {
    const camera = new C.Orbit();
    camera.setCourse(course);
    camera.resize(w, h, true);
    const normalView = camera.update(0, true);
    const world = new P.World(course);
    world.spawn(10);
    camera.follow(world.launchPosition);
    const closeup = camera.update(0, true);
    assert.ok(closeup.half < normalView.half);
    for (let i = 0; i < 60 * 6; i++) {
      world.advance(1 / 60);
      const ball = world.followBall, p = world.position(ball);
      camera.follow(p, ball.v);
      const view = camera.update(1 / 60);
      const ndc = M.transform(view.vp, p);
      assert.ok(ndc.every(value => Number.isFinite(value) && Math.abs(value) < 1));
      vector(view.up, normalView.up);
      assert.ok(M.length(M.sub(camera.wantTarget, p)) <= 1.000001);
    }
    camera.fit(true);
    assert.equal(camera.following, false);
    vector(camera.update(0).vp, normalView.vp);
  }
});

test("follow zoom survives motion and rotation, scales on resize, and yields to a course preset", () => {
  const c = new C.Orbit();
  c.setCourse(T.build({height: 4, pieces: Array(T.LIMIT).fill("straight")}));
  c.resize(1100, 500, true);
  c.follow([1,2,3]);
  c.zoom(0.5);
  c.follow([3,2,1], [100,0,0]);
  vector(c.wantTarget, [4,2,1]);
  near(c.wantHalf, c.followHalf * 0.5);
  c.resize(300, 600, true);
  near(c.half, c.followHalf * 0.5);
  c.zoom(0.00001);
  near(c.wantHalf, c.followHalf * 0.25);
  c.orbit(20, -5);
  assert.ok(c.following);
  const start = c.target.slice();
  c.update(1/60);
  assert.notDeepEqual(c.target, start);
  assert.notDeepEqual(c.target, c.wantTarget);
  c.update(0, true);
  vector(c.target, c.wantTarget);
  c.preset("front");
  assert.equal(c.following, false);
  near(c.wantHalf, c.fitHalf);
});

test("the follow subject falls back to a surviving runner, then the last collecting marble", () => {
  const world = new P.World(T.build(T.PRESETS.hairpin));
  assert.equal(world.followBall, null);
  world.spawn(10);
  const first = world.followBall;
  world.advance(0.1);
  assert.ok(world.spawn(12, 2));
  const second = world.followBall;
  assert.notEqual(second, first);
  second.run.state = "off-track";
  assert.equal(world.followBall, first);
  first.run.state = "finished";
  assert.equal(world.followBall, second);
  world.balls.pop();
  assert.equal(world.followBall, first);
  world.clear();
  assert.equal(world.followBall, null);
});

test("slow motion scales bounded wall time while physics and timing retain fixed solver ticks", () => {
  const course = T.build(T.PRESETS.relay);
  const normal = new P.World(course);
  normal.spawn(7);
  for (let i = 0; i < 60; i++) normal.advance(1 / 60);
  for (const rate of [0.25, 0.5, 1]) {
    const world = new P.World(course);
    world.spawn(7);
    for (const invalid of [0, -1, Infinity, NaN, 1.01]) assert.equal(world.advance(60, invalid), 0);
    for (let i = 0; i < 60 / rate; i++) world.advance(1 / 60, rate);
    for (const field of ["p", "q", "v", "spin"]) vector(world.followBall[field], normal.followBall[field]);
    near(world.followBall.run.time, normal.followBall.run.time);
    assert.equal(world.advance(30, rate), Math.floor(0.1 * rate / P.DT + 1e-9));
  }
});

test("paused stepping moves the marble, clock and ghost together and preserves the fractional frame on resume", () => {
  const world = new P.World(T.build(T.PRESETS.empty));
  world.spawn(8);
  for (let i = 0; i < 3 / P.DT && world.hasWork; i++) world.step();
  assert.ok(world.timing.best);
  world.paused = true;
  assert.equal(world.stepFrame(), false);
  world.paused = false;
  world.spawn(6);
  assert.equal(world.stepFrame(), false);
  world.advance(P.DT * 1.5);
  const ball = world.followBall;
  const start = ball.age, remainder = world.accumulator;
  world.paused = true;
  assert.ok(world.stepFrame());
  near(ball.age, start + 1 / 60);
  near(ball.run.time, ball.age);
  vector(world.ghost(), Trials.ghostPosition(world.timing.best, ball.age));
  const pose = world.position(ball).slice(), ghost = world.ghost();
  world.advance(600, 0.25);
  near(world.accumulator, remainder);
  world.paused = false;
  vector(world.position(ball), pose);
  vector(world.ghost(), ghost);
});
