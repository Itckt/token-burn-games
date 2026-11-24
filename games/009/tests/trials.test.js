"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/track");
const P = require("../js/physics");
const M = require("../js/math");
const Trials = require("../js/trials");
const {near, vector} = require("./numeric");

const gate = x => ({p: [x,2,0], t: [1,0,0], n: [0,1,0], b: [0,0,1]});
const onLane = x => [x,2+T.RADIUS,0];
function move(board, ball, x, dt) {
  ball.prev = ball.p;
  ball.p = onLane(x);
  ball.age += dt;
  board.update(ball,dt);
}

test("swept gates read forward crossings at the intersection, including on an inverted loop", () => {
  const loop = T.piece("loop", {p: [2,3,4], yaw: 0.6});
  for (const frame of [gate(0), T.atDistance(loop, loop.length/2)]) {
    const at = (x, y = T.RADIUS, z = 0) => T.point(frame,x,y,z);
    near(Trials.crossing(frame,at(-1),at(3)),0.25);
    near(Trials.crossing(frame,at(-1,0.4,1.2),at(1,0.4,0.2)),0.5);
    for (const [a,b] of [[at(1),at(-1)], [at(0.2),at(0.2)], [at(-1),at(-0.1)],
      [at(-1,0.4,1),at(1,0.4,1)], [at(-1,1.2),at(1,1.2)], [at(-1,-0.05),at(1,-0.05)]]) {
      assert.equal(Trials.crossing(frame,a,b),null);
    }
  }
});

test("the split arms the flag in order and a stationary marble in the bay cannot score", () => {
  const board = new Trials.TimingBoard({split: gate(0.5), finish: gate(1)});
  const ball = P.marble(onLane(0.8));
  move(board,ball,1.1,0.1);
  move(board,ball,1.1,0.1);
  move(board,ball,0.1,0.1);
  assert.equal(ball.run.split,null);
  assert.equal(board.completed,0);
  move(board,ball,0.9,0.2);
  near(ball.run.split,0.4);
  move(board,ball,1.1,0.1);
  near(ball.run.time,0.55);
  assert.equal(board.completed,1);
  move(board,ball,0.5,0.1);
  move(board,ball,1.5,0.1);
  assert.equal(board.completed,1);
  const reverseOrder = new Trials.TimingBoard({split: gate(0.8), finish: gate(0.2)});
  const shortcut = P.marble(onLane(0));
  move(reverseOrder,shortcut,1,0.1);
  assert.equal(reverseOrder.completed,0);
  assert.ok(shortcut.run.split !== null);
});

test("the ghost interpolates uniform samples and the exact sub-step finish, without aliasing", () => {
  const board = new Trials.TimingBoard({split: gate(0.47), finish: gate(1.173)});
  const ball = P.marble(onLane(0),[4,0,0],2,9);
  board.release(ball);
  for (let i=1; !ball.finished && i<50; i++) move(board,ball,4*i*0.017,0.017);
  const record = board.best;
  near(record.split,0.47/4);
  near(record.time,1.173/4);
  assert.equal(record.path.length,Math.ceil(record.time*Trials.SAMPLE_HZ)+1);
  assert.equal(record.number,9);
  assert.equal(record.color,2);
  for (const time of [0,0.013,1/Trials.SAMPLE_HZ,record.split,record.time-0.0001,record.time]) {
    vector(Trials.ghostPosition(record,time),onLane(time*4));
  }
  for (const outside of [-0.1,record.time+0.01,NaN,Infinity]) assert.equal(Trials.ghostPosition(record,outside),null);
  const endpoint = Trials.ghostPosition(record,record.time);
  endpoint[0] = 12345;
  near(record.path.at(-1)[0],1.173);
  assert.equal(ball.run.path,null);
  assert.equal(board.recent[0].path,undefined);
});

test("concurrent drops keep independent clocks, a frozen opponent, and only three recent results", () => {
  const board = new Trials.TimingBoard({split: gate(1), finish: gate(2)});
  function start(number) {
    const ball = P.marble(onLane(0),[0,0,0],number%5,number);
    board.release(ball);
    return ball;
  }
  move(board,start(1),2,1);
  const firstBest = board.best;
  const second = start(2), third = start(3);
  move(board,third,1,0.4);
  move(board,second,2,0.7);
  assert.equal(board.best.number,2);
  assert.equal(board.latest,third);
  assert.equal(board.opponent,firstBest);
  near(third.run.time,0.4);
  move(board,third,2,0.4);
  move(board,start(4),2,0.7);
  assert.equal(board.best.number,2, "ties retain the first record");
  assert.deepEqual(board.recent.map(r => r.number),[4,3,2]);
  assert.equal(board.completed,4);
  const miss = start(5);
  miss.onTable = true;
  move(board,miss,2,0.2);
  assert.equal(miss.run.state,"off-track");
  assert.equal(miss.run.path,null);
  assert.equal(board.completed,4);
});

test("the deadline uses crossing time within the last step and retires a timed-out trace", () => {
  for (const [x,state] of [[3,"finished"], [1.2,"timed-out"]]) {
    const board = new Trials.TimingBoard({split: gate(0.25), finish: gate(1)});
    const ball = P.marble(onLane(0));
    move(board,ball,0,Trials.TIME_LIMIT-0.05);
    assert.ok(ball.run.path.length <= Trials.TIME_LIMIT*Trials.SAMPLE_HZ+1);
    move(board,ball,x,0.1);
    assert.equal(ball.run.state,state);
    assert.equal(ball.run.path,null);
    assert.ok(ball.run.time <= Trials.TIME_LIMIT);
    assert.equal(board.completed,state === "finished" ? 1 : 0);
  }
});

test("recorded relay times and positions agree at 30, 60 and 144 Hz", () => {
  const course = T.build(T.PRESETS.relay);
  let expected;
  for (const hz of [30,60,144]) {
    const w = new P.World(course);
    w.spawn(5);
    for (let i=0; i<hz*14 && !w.completed; i++) w.advance(1/hz);
    assert.equal(w.completed,1);
    const best = w.timing.best;
    assert.ok(best.time > best.split && best.split > 0);
    vector(best.path[0],w.launchPosition);
    near(M.dot(M.sub(best.path.at(-1),course.finish.p),course.finish.t),0);
    if (expected) assert.deepEqual(best,expected);
    expected = best;
  }
});

test("ghost playback follows the newest accepted launch, pauses with physics and clears with scores", () => {
  const w = new P.World(T.build(T.PRESETS.empty));
  w.spawn(9);
  while (w.balls.length) w.step();
  const best = w.timing.best;
  assert.ok(best);
  assert.equal(w.ghost(),null);
  w.advance(1/59);
  assert.equal(w.accumulator,0);
  w.spawn(5);
  const runner = w.timing.latest;
  assert.equal(w.spawn(8),false);
  assert.equal(w.timing.latest,runner);
  vector(w.ghost(),best.path[0]);
  w.advance(P.DT*4.5);
  vector(w.ghost(),Trials.ghostPosition(best,P.DT*3.5));
  w.paused = true;
  const held = w.ghost();
  w.advance(60);
  vector(w.ghost(),held);
  w.paused = false;
  vector(w.ghost(),held);
  while (runner.age <= best.time+P.DT) w.step();
  assert.equal(w.ghost(),null);
  assert.equal(w.balls.length,1);
  w.clear();
  assert.equal(w.ghost(),null);
  assert.equal(w.timing.best,null);
  assert.equal(w.timing.latest,null);
  assert.equal(w.completed,0);
});
