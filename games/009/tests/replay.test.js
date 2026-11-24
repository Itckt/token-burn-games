"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/track");
const M = require("../js/math");
const P = require("../js/physics");
const Trial = require("../js/trials");
const Replay = require("../js/replay");
const {near, vector} = require("./numeric");

function finishRun(layout, speed, hz, rate = 1) {
  const world = new P.World(T.build(layout));
  world.spawn(speed, 2);
  const ball = world.followBall;
  for (let i = 0; i < (Trial.TIME_LIMIT + 1)*hz/rate && ball.run.state === "rolling"; i++) world.advance(1/hz, rate);
  assert.notEqual(ball.run.state, "rolling");
  return world;
}
const gate = x => ({p:[x,0,0], t:[1,0,0], n:[0,1,0], b:[0,0,1]});
const rotation = time => [0,0,Math.sin(time*2),Math.cos(time*2)];

test("replays store uniform poses and the exact sub-tick finish, including the rotation and speed", () => {
  const board = new Trial.TimingBoard({split:gate(0.47), finish:gate(1.173)});
  const ball = P.marble([0,0.38,0], [4,0,0], 1, 17);
  board.release(ball);
  const dt = 0.017;
  while (!ball.finished && ball.age < 1) {
    ball.prev = ball.p; ball.prevQ = ball.q;
    ball.age += dt;
    ball.p = [4*ball.age, 0.38, 0];
    ball.q = rotation(ball.age);
    board.update(ball, dt);
  }
  const record = board.lastReplay;
  assert.equal(record.state, "finished");
  near(record.time, 1.173/4);
  assert.equal(record.path, board.best.path);
  assert.equal(record.rotations.length, Math.ceil(record.time*Replay.SAMPLE_HZ)+1);
  assert.equal(record.path.length, record.speeds.length);
  for (const t of [0, 0.002, 1/30, record.split, record.time-0.00003, record.time]) {
    const pose = Replay.pose(record,t);
    vector(pose.p, [4*t,0.38,0]);
    vector(pose.q, rotation(t), 5e-6);
    near(Math.hypot(...pose.q), 1);
    near(pose.speed, 4);
    assert.equal(pose.number,17);
    assert.equal(pose.color,1);
    pose.q.fill(0); pose.p.fill(123);
    vector(Replay.pose(record, t).p, [4*t,0.38,0]);
  }
  for (const t of [-1, Infinity, NaN, record.time+0.000001]) assert.equal(Replay.pose(record,t),null);
  assert.equal(ball.run.rotations, null);
  assert.equal(ball.run.speeds, null);
});

test("the replay and speed trace are deterministic at different wall rates for a jump and a miss", () => {
  for (const speed of [7, 10]) {
    const base = finishRun(T.PRESETS.podium,speed,60).timing.lastReplay;
    assert.equal(base.state, speed === 7 ? "off-track" : "finished");
    const endpoint = Replay.pose(base,base.time);
    if (speed === 7) near(endpoint.p[1], T.RADIUS);
    assert.ok(base.speeds.every(v => Number.isFinite(v) && v >= 0));
    assert.ok(Math.max(...base.speeds)-Math.min(...base.speeds) > 2);
    near(base.speeds[0], speed);
    for (const [hz,rate] of [[30,1], [144,0.5]]) {
      assert.deepEqual(finishRun(T.PRESETS.podium,speed,hz,rate).timing.lastReplay, base);
    }
  }
});

test("a timed-out run keeps its bounded trace through collection and clears with the course records", () => {
  const world = finishRun(T.PRESETS.empty, 0, 30), record = world.timing.lastReplay;
  assert.equal(record.state, "timed-out");
  near(record.time, Trial.TIME_LIMIT);
  assert.equal(record.path.length, Trial.TIME_LIMIT*Replay.SAMPLE_HZ+1);
  assert.equal(world.balls.length, 0);
  near(Replay.pose(record,record.time).speed, 0, 1e-6);
  assert.equal(world.timing.best, null);
  assert.ok(world.spawn(12));
  assert.equal(world.timing.lastReplay, record);
  world.clear();
  assert.equal(world.timing.lastReplay, null);
});

test("the last replay comes from the latest crossing within a tick, including ties and later table landings", () => {
  const board = new Trial.TimingBoard({split:gate(0.1), finish:gate(1)});
  function arrival(number, fraction) {
    const ball = P.marble([1-fraction,0.38,0], [5,0,0], 0, number);
    ball.age = 0.1;
    ball.run.split = 0;
    ball.p[0] += 1;
    return ball;
  }
  const later = arrival(3,0.9), earlier = arrival(9,0.1), tie = arrival(4,0.9);
  board.advance([later, tie, earlier], 0.1);
  assert.equal(board.lastReplay.number, 4);
  assert.equal(board.best.number, 9);
  const miss = arrival(2,0.5);
  miss.onTable = true;
  board.advance([miss], 0.1);
  assert.equal(board.lastReplay.number, 2);
  assert.equal(board.lastReplay.state, "off-track");
  assert.equal(board.completed, 3);
  assert.equal(board.best.number, 9);
});

test("seeking, resuming and restarting stop exactly at the end, even for a zero-duration trace", () => {
  const player = new Replay.Player();
  player.seek(1); player.toggle(); player.advance(1);
  assert.equal(player.time, 0);
  const record = {time: 1.07};
  player.open(record);
  for (const dt of [NaN, Infinity, -1]) player.advance(dt);
  player.advance(0.031);
  near(player.time, 0.031);
  player.seek(NaN);
  assert.equal(player.playing, true);
  player.seek(-0.2);
  near(player.time, 0);
  player.advance(2);
  near(player.time, 0);
  player.seek(4);
  near(player.time, record.time);
  player.toggle();
  near(player.time, 0);
  player.advance(2);
  near(player.time, record.time);
  assert.equal(player.playing, false);
  player.close();
  assert.equal(player.record, null);
  player.open({time: 0}); player.toggle(); player.advance(1);
  assert.equal(player.playing, false);
  near(player.time, 0);
});

test("the live stripe and centre use the same interpolation fraction and resume from the held orientation", () => {
  const world = new P.World(T.build(T.PRESETS.empty));
  world.spawn(8);
  const ball = world.followBall;
  ball.spin = [3, 2, -1];
  world.advance(P.DT*1.5);
  vector(world.orientation(ball), M.mixRotation(ball.prevQ, ball.q, 0.5));
  assert.notDeepEqual(world.orientation(ball), ball.q);
  world.paused = true;
  const held = world.orientation(ball);
  world.paused = false;
  vector(world.orientation(ball), held);
  vector(M.mixRotation(held, held.map(x => -x), 0.5), held);
  world.advance(P.DT*0.25);
  vector(world.orientation(ball), held);
});
