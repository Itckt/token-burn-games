"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../js/heat");
const T = require("../js/track");
const P = require("../js/physics");
const {near} = require("./numeric");
const blank = T.build(T.PRESETS.empty);

test("a heat snapshots three distinct finishes and clamps each pace to the launch range", () => {
  const plan = H.lineup(15.5, 4, 5);
  assert.deepEqual(plan.map(entry => entry.color), [4, 0, 1]);
  assert.deepEqual(plan.map(entry => entry.speed), [13.5, 15.5, 16]);
  assert.deepEqual(H.lineup(0.5, 2, 3).map(entry => entry.speed), [0, 0.5, 2.5]);
  const heat = new H.PaceHeat(plan, 5);
  plan[0].speed = 0;
  assert.equal(heat.entries[0].speed, 13.5);
  for (const args of [[NaN,0,3], [Infinity,0,3], [10,-1,3], [10,3,3], [10,1,2], [10,1.5,4], [10,1,3.5]]) {
    assert.deepEqual(H.lineup(...args), []);
    assert.equal(new P.World(blank).startHeat(...args), false);
  }
});

test("heats span empty-track gaps and produce identical releases, splits and ranks at different playback rates", () => {
  let reference;
  for (const [hz, rate] of [[30,1], [60,0.5], [144,0.25]]) {
    const world = new P.World(blank);
    assert.ok(world.startHeat(10, 4, 5));
    const heat = world.heat;
    assert.equal(world.startHeat(), false);
    let emptyGap = false;
    for (let i = 0; i < hz * 7 / rate && world.hasWork; i++) {
      world.advance(1 / hz, rate);
      emptyGap ||= heat.pending && !world.balls.length;
    }
    assert.ok(emptyGap);
    assert.equal(world.hasWork, false);
    assert.equal(heat.active, false);
    assert.equal(world.accumulator, 0);
    assert.equal(world.dropped, 3);
    assert.equal(world.completed, 3);
    const times = heat.entries.map(entry => entry.releasedAt);
    times.forEach((time, i) => near(time, i * H.GAP));
    const rows = heat.standings();
    assert.deepEqual(rows.map(entry => entry.place), [1, 2, 3]);
    assert.deepEqual(rows.map(entry => entry.speed), [12, 10, 8]);
    if (reference) assert.deepEqual({times, rows}, reference);
    reference = {times, rows};
    assert.ok(world.startHeat());
    assert.equal(world.completed, 3);
    assert.notEqual(world.heat, heat);
  }
});

test("all three relay runners share the physical loop, split and course record", () => {
  const world = new P.World(T.build(T.PRESETS.relay));
  world.startHeat(7, 0, 5);
  let peak = 0;
  for (let i = 0; i < 60 * 18 && world.hasWork; i++) {
    world.advance(1 / 60);
    peak = Math.max(peak, world.balls.length);
  }
  assert.equal(peak, 3);
  assert.equal(world.completed, 3);
  assert.equal(world.hasWork, false);
  const rows = world.heat.standings();
  assert.deepEqual(rows.map(row => row.speed), [9, 7, 5]);
  assert.ok(rows.every(row => row.split > 0 && row.split < row.millis / 1000));
  near(world.timing.best.time, rows[0].millis / 1000, 0.00051);
  assert.equal(world.timing.latest, world.heat.entries[2].ball);
});

test("one paused inspection frame can cross a scheduled release during an empty-track gap", () => {
  const world = new P.World(blank);
  world.startHeat(10);
  for (let i = 0; i < Math.round(H.GAP / P.DT) - 1; i++) world.step();
  assert.equal(world.balls.length, 0);
  assert.ok(world.heat.pending);
  world.paused = true;
  const clock = world.timing.clock;
  assert.ok(world.stepFrame());
  near(world.timing.clock, clock + 1 / 60);
  assert.equal(world.dropped, 2);
  assert.equal(world.balls.length, 1);
  near(world.heat.entries[1].releasedAt, H.GAP);
  near(world.followBall.age, P.DT * 2);
  assert.equal(world.advance(60), 0);
  assert.equal(world.heat.entries[2].ball, null);
});

test("full slots and occupied gates defer a release and the next gap starts at the actual launch", () => {
  const world = new P.World(blank);
  for (let i = 0; i < P.MAX_BALLS; i++) world.balls.push(P.marble([100 + i * 3, 10, 0]));
  world.startHeat(8, 0, 3);
  assert.equal(world.heat.standings()[0].state, "waiting");
  assert.equal(world.dropped, 0);
  world.balls.pop();
  world.step();
  assert.equal(world.dropped, 1);
  assert.equal(world.balls.length, P.MAX_BALLS);
  near(world.heat.entries[0].releasedAt, P.DT);
  near(world.heat.due, P.DT + H.GAP);
  assert.equal(world.spawn(), false);
  world.clear();
  assert.equal(world.heat, null);
  assert.equal(world.hasWork, false);
  assert.equal(world.advance(10), 0);
});

test("a parked marble blocks queued runners within a bounded wait and pausing holds the deadline", () => {
  const world = new P.World(blank);
  world.spawn(0);
  world.startHeat();
  world.paused = true;
  assert.equal(world.advance(500), 0);
  near(world.timing.clock, 0);
  assert.equal(world.heat.next, 0);
  world.paused = false;
  for (let i = 0; i < 17 / P.DT && world.heat.pending; i++) world.step();
  near(world.timing.clock, H.GATE_WAIT * 3 + H.GAP * 2);
  assert.deepEqual(world.heat.standings().map(entry => [entry.state, entry.place]),
    [["blocked", null], ["blocked", null], ["blocked", null]]);
  assert.equal(world.dropped, 1);
  assert.equal(world.completed, 0);
  assert.equal(world.heat.active, false);
});

test("a gate clearing at the deadline can release, and standings share places at displayed precision", () => {
  const heat = new H.PaceHeat(H.lineup(10, 1, 4), 0);
  heat.dispatch(H.GATE_WAIT - 0.01, () => null);
  assert.equal(heat.next, 0);
  for (let i = 0; i < 3; i++) {
    heat.dispatch(H.GATE_WAIT + i * H.GAP, () => P.marble([0, 3, 0]));
  }
  assert.equal(heat.active, true);
  const [first, second, third] = heat.entries.map(entry => entry.ball.run);
  Object.assign(first, {state: "finished", time: 8.1232});
  Object.assign(second, {state: "finished", time: 8.1231});
  Object.assign(third, {state: "off-track", time: 2});
  assert.deepEqual(heat.standings().map(row => [row.lane,row.place]), [[0,1],[1,1],[2,null]]);
  assert.equal(heat.active, false);
  Object.assign(third, {state: "finished", time: 8.124});
  assert.deepEqual(heat.standings().map(row => row.place), [1,1,3]);
  first.state = "timed-out";
  assert.deepEqual(heat.standings().map(row => row.lane), [1,2,0]);
});

test("the timing board advances once for simultaneous finishers and orders them within their shared tick", () => {
  for (const order of [[1, 2], [2, 1]]) {
    const world = new P.World(blank);
    world.timing.clock = 12;
    for (const number of order) {
      const fraction = number === 1 ? 0.75 : 0.25;
      const from = T.point(blank.finish, -4 * P.DT * fraction, 0.8, number === 1 ? -0.45 : 0.45);
      const ball = P.marble(from, [4,0,0], 0, number);
      ball.run.split = 0;
      world.balls.push(ball);
    }
    world.step();
    near(world.timing.clock, 12 + P.DT);
    assert.equal(world.completed, 2);
    assert.deepEqual(world.timing.recent.map(record => record.number), [1,2]);
    near(world.timing.recent[0].crossedAt, 12 + 0.75 * P.DT);
    near(world.timing.recent[1].crossedAt, 12 + 0.25 * P.DT);
    assert.equal(world.timing.best.number, 2);
  }
});
