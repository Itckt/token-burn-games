"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/track");
const M = require("../js/math");
const G = require("../js/mesh");
const P = require("../js/physics");
const Pick = require("../js/picking");
const Trials = require("../js/trials");
const B = require("../js/blueprint");
const {near, vector} = require("./numeric");

test("both decks have solid channel faces and the open span has neither a face nor a collider, also after a corner", () => {
  for (const pieces of [["jump"], ["right", "jump"]]) {
    const c = T.build({height: 4, pieces}), section = c.sections.find(s => s.type === "jump");
    const [takeoff, landing] = section.decks;
    const a = takeoff.at(-1), b = landing[0], heading = section.samples[0].t;
    near(M.dot(M.sub(b.p, a.p), heading), 2);
    assert.ok(a.t[1] > 0 && b.t[1] < 0);
    vector(section.samples.at(-1).t, heading);
    near(section.end.p[1], 4);
    const midpoint = T.atDistance(section, (a.s+b.s)/2);
    const surface = new P.Surface(c);
    // A short jump can strike the nose of the landing below the top surface.
    for (const [lip, sign] of [[a,1], [b,-1]]) {
      const normal = M.mul(lip.t, sign);
      const ball = P.marble(T.point(lip,sign*0.32,-0.09), M.mul(normal,-6));
      assert.ok(P.surfaceContact(ball, surface));
      assert.ok(M.dot(ball.v, normal) > 0);
    }
    for (const f of [takeoff[9], landing[12]]) {
      const ball = P.marble(T.point(f, 0, T.RADIUS-0.005));
      assert.ok(P.surfaceContact(ball, surface));
    }
    for (const side of [-0.7, 0, 0.7]) {
      const ball = P.marble(T.point(midpoint, 0, T.RADIUS-0.01, side));
      assert.equal(P.surfaceContact(ball, surface), false);
    }
    for (const miniature of [true, false]) {
      const mesh = Pick.pickMesh(G.sectionMesh(section, miniature));
      const pick = f => Pick.nearestSection([mesh], {origin: M.add(f.p, [0,4,0]), direction: [0,-1,0], limit: 10});
      assert.equal(pick(takeoff[9]), 0);
      assert.equal(pick(landing[12]), 0);
      assert.equal(pick(midpoint), -1);
    }
  }
});

test("a fast podium run flies ballistically and lands on the catch deck, while a slower attempt drops through", () => {
  const c = T.build(T.PRESETS.podium), jump = c.sections.find(s => s.type === "jump");
  const lip = jump.decks[0].at(-1).p[0], catchStart = jump.decks[1][0].p[0];
  for (const speed of [7, 10]) {
    const world = new P.World(c);
    world.spawn(speed);
    const ball = world.followBall;
    let freeTicks = 0, landed = false;
    for (let i = 0; i < 12/P.DT && ball.run.state === "rolling"; i++) {
      const x = ball.p[0], vy = ball.v[1];
      world.step();
      if (!ball.onTable && Math.min(x,ball.p[0]) > lip+T.RADIUS && Math.max(x,ball.p[0]) < catchStart-T.RADIUS) {
        near(ball.v[1], (vy-P.GRAVITY*P.DT)*Math.exp(-0.004*P.DT), 1e-9);
        freeTicks++;
      }
      if (x > catchStart && x < jump.end.p[0] && ball.v[1] > vy+0.03 && !ball.onTable) landed = true;
    }
    assert.ok(freeTicks > 20);
    assert.equal(landed, speed === 10);
    assert.equal(ball.run.state, speed === 10 ? "finished" : "off-track");
    assert.equal(world.completed, speed === 10 ? 1 : 0);
    if (speed === 10) near(ball.run.time, 7.322, 0.001);
  }
});

test("an airborne midpoint uses a taller, finite gate and can time a one-piece jump", () => {
  const c = T.build({height: 4, pieces: ["jump"]}), gate = c.split;
  assert.ok(gate.freeStanding);
  const at = (x, y, z) => T.point(gate,x,y,z);
  near(Trials.crossing(gate, at(-0.2, 1.8, 0), at(0.2, 1.8, 0)), 0.5);
  for (const [y, z] of [[2.5, 0], [0.7, 1.1], [-0.1, 0]]) {
    assert.equal(Trials.crossing(gate, at(-0.2,y,z), at(0.2,y,z)), null);
  }
  const world = new P.World(c);
  world.spawn(10);
  for (let i = 0; i < 4/P.DT && !world.completed; i++) world.step();
  assert.equal(world.completed, 1);
  assert.ok(world.timing.best.split > 0 && world.timing.best.split < world.timing.best.time);
});

test("gate height rebuilds the launch and downstream ramps, round-trips exactly, and uses one history entry", () => {
  const editor = new T.Editor({name: "Terrace", height: 4, pieces: ["ramp", ...Array(T.LIMIT-1).fill("jump")]});
  const original = editor.layout;
  for (const invalid of [null, "7.1", NaN, Infinity, 0.89, 12.01, 4]) assert.equal(editor.setHeight(invalid), false);
  assert.equal(editor.past.length, 0);
  for (const height of [0.9, 5.725, 12]) {
    assert.ok(editor.setHeight(height));
    const course = T.build(editor.layout);
    near(course.launch.p[1], height);
    near(course.sections[1].end.p[1], height === 0.9 ? 3.45 : height-3.1);
    assert.deepEqual(B.decode(B.encode(editor.layout)), editor.layout);
    assert.ok(editor.undo());
    assert.deepEqual(editor.layout, original);
    assert.equal(editor.setHeight(4), false);
    assert.ok(editor.redo());
    near(editor.layout.height, height);
    editor.undo();
  }
});
