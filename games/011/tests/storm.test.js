"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("../js/storm");
const m = require("../js/math");
const ui = require("../js/ui");
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " differs from " + b);

test("signal inputs snap, clamp and ignore non-finite values", () => {
  const state = s.makeState();
  assert.equal(state.signal, 5); assert.equal(s.setSignal(state, "5"), false);
  for (const [value, expected] of [[1.6, 2], ["9", 9], [-40, 1], [101, 10]]) {
    assert.equal(s.setSignal(state, value), true); assert.equal(state.signal, expected);
  }
  for (const value of [Infinity, -Infinity, NaN, "storm"]) assert.equal(s.setSignal(state, value), false);
  assert.equal(state.signal, 10);
  assert.equal(s.LEVELS.length, 10);
  assert.notEqual(s.makeState().layers, state.layers);
});

test("each of ten levels increases cloud population, rainfall, spin, fall speed and wind", () => {
  for (let level = 1; level < 10; level++) {
    const a = s.normalized(level), b = s.normalized(level + 1);
    for (const metric of [s.cloudCount, s.rainCount, s.spinRate, s.fallRate]) assert.ok(metric(b) > metric(a));
    for (let t = -10; t < 60; t += 1.3) {
      const low = s.readings(a, t), high = s.readings(b, t);
      assert.ok(high.wind > low.wind && high.rain > low.rain && high.pressure < low.pressure);
      assert.ok(high.pressure > 900 && high.rain > 0 && low.wind > 0);
    }
  }
  assert.equal(s.cloudCount(1), s.MAX_CLOUDS); assert.equal(s.rainCount(1), s.MAX_RAIN);
});

test("signal changes ease towards target without resetting storm position", () => {
  const state = s.makeState(), start = state.strength;
  s.advance(state, 1.5); const phase = state.phase;
  s.setSignal(state, 10);
  assert.equal(state.strength, start); assert.equal(state.phase, phase);
  s.advance(state, 0.15); assert.ok(state.strength > start && state.strength < 1);
  s.advance(state, 3); close(state.strength, 1, 0.0001);
  s.setSignal(state, 1); s.advance(state, 6); close(state.strength, 0, 0.0001);
});

test("motion integrated at 30, 60 and 144 frames per second agrees during a signal transition", () => {
  const reference = s.makeState(); s.setSignal(reference, 9); s.advance(reference, 2);
  for (const fps of [30, 60, 144]) {
    const state = s.makeState(); s.setSignal(state, 9);
    for (let i = 0; i < 2 * fps; i++) s.advance(state, 1 / fps);
    for (const key of ["time", "phase", "strength", "rainTravel"]) close(state[key], reference[key]);
  }
});

test("pause freezes the model, accepts static signal previews, and resumes smoothly", () => {
  const state = s.makeState();
  s.advance(state, 1); s.setSignal(state, 8); state.playing = false;
  const before = structuredClone(state);
  s.advance(state, 4); assert.deepEqual(state, before);
  s.setSignal(state, 2); close(state.strength, 1 / 9);
  assert.equal(state.time, 1); assert.equal(state.phase, before.phase);
  state.playing = true; s.advance(state, 0.01);
  close(state.time, 1.01); assert.ok(state.rainTravel > before.rainTravel);
});

test("playback rates scale simulated travel and long sessions retain bounded phase", () => {
  const slow = s.makeState(), fast = s.makeState();
  slow.speed = 0.5; fast.speed = 2;
  s.advance(slow, 2); s.advance(fast, 2);
  for (const key of ["time", "phase", "rainTravel"]) close(fast[key], 4 * slow[key]);
  s.advance(fast, 3600 * 7); assert.ok(fast.phase >= 0 && fast.phase < m.TAU);
  const before = structuredClone(fast);
  for (const dt of [0, -2, NaN, Infinity]) s.advance(fast, dt);
  assert.deepEqual(fast, before);
});

test("seeded generators reproduce particles and keep every prefix stable", () => {
  const a = s.randomSource(73), b = s.randomSource(73);
  for (let i = 0; i < 500; i++) { const n = a(); assert.equal(n, b()); assert.ok(n >= 0 && n < 1); }
  for (const builder of [s.makeRain, s.makeClouds]) {
    assert.deepEqual(builder(71, 120).slice(0, 80), builder(71, 80));
    assert.notDeepEqual(builder(72, 5), builder(71, 5));
    assert.deepEqual(builder(2, 0), []);
  }
});

test("clouds form elevated spiral bands around an open eye, bounded in every orientation", () => {
  const clouds = s.makeClouds(), pose = new Float64Array(7);
  assert.equal(clouds.length, s.MAX_CLOUDS);
  let narrow = 0, outer = 0;
  for (const p of clouds) {
    for (const [phase, strength] of [[0, 0], [2.7, 0.5], [6.28, 1]]) {
      s.cloudPose(p, phase, strength, pose, 1);
      const radius = Math.hypot(pose[1], pose[3]);
      assert.ok(pose.every(Number.isFinite) && radius > 1.1 && radius < 13);
      assert.ok(pose[2] > 0 && pose[2] < 3.4);
      close(pose[0], 0); close(pose[6], 0);
      assert.ok(p.tile >= 0 && p.tile < 4 && p.size > 0 && p.stretch >= 1);
    }
    if (p.r > 5) {
      outer++;
      const error = Math.min(...[0, 1, 2].map(arm => Math.abs(Math.atan2(
        Math.sin(p.theta - s.armAngle(p.r, arm)), Math.cos(p.theta - s.armAngle(p.r, arm))
      ))));
      if (error < 0.38) narrow++;
    }
  }
  assert.ok(outer > 450 && narrow / outer > 0.74);
  const p = clouds[0], a = [], b = [];
  s.cloudPose(p, 0, 0, a); s.cloudPose(p, 0.5, 0, b);
  assert.ok(a[0] * b[2] - a[2] * b[0] < 0, "counterclockwise from above");
  s.cloudPose(p, 0, 1, b);
  assert.ok(Math.hypot(b[0], b[2]) < Math.hypot(a[0], a[2]), "bands tighten");
});

test("the default camera contains the central storm and almost all outer cloud centres", () => {
  const state = s.makeState(), clouds = s.makeClouds().slice(0, s.cloudCount(state.strength));
  for (const aspect of [1.28, 1.88, 2.13]) {
    const view = m.cameraFrame(m.makeCamera(), aspect);
    let visible = 0, left = 1, right = 0;
    for (const p of clouds) {
      const pose = []; s.cloudPose(p, state.phase, state.strength, pose);
      const projected = m.project(view.vp, pose.slice(0, 3), 1, 1);
      visible += Number(projected.visible);
      if (p.r < 4) assert.ok(projected.visible);
      left = Math.min(left, projected.x); right = Math.max(right, projected.x);
    }
    assert.ok(visible / clouds.length > 0.96);
    assert.ok(right - left > 0.7, "clouds occupy the viewport");
  }
});

test("rain wraps at the sea, drifts with wind, and streaks lengthen with intensity", () => {
  const drop = { r: 4, theta: 0.7, start: 0.25, rate: 1, height: 2, length: 0.27 };
  const state = s.makeState(), a = [], b = [];
  state.strength = 0; s.rainPose(drop, state, a);
  state.rainTravel = 0.1; s.rainPose(drop, state, b);
  close(a[1] - b[1], 0.2); close(Math.hypot(a[0], a[2]), 4);
  assert.ok(b[0] !== a[0] && b[2] !== a[2]);
  state.rainTravel = 1; s.rainPose(drop, state, b);
  a.forEach((v, i) => close(v, b[i]));
  state.strength = 1; s.rainPose(drop, state, b);
  assert.ok(b[4] - b[1] > a[4] - a[1]);
  const all = s.makeRain(); assert.equal(all.length, s.MAX_RAIN);
  for (const p of all) {
    s.rainPose(p, state, b);
    assert.ok(b.every(Number.isFinite) && b[1] >= 0 && b[4] >= b[1] && b[4] <= p.height + 0.009);
    assert.ok(p.r > 1 && p.r < 13 && p.brightness >= 0 && p.brightness < 1);
  }
});

test("telemetry history is bounded, time-based and holds still while paused", () => {
  const history = ui.makeHistory(0.5);
  assert.equal(history.samples.length, ui.HISTORY_LENGTH);
  const initial = structuredClone(history.samples);
  ui.record(history, 0.5, 0.1); assert.deepEqual(history.samples, initial);
  ui.record(history, 0.5, ui.SAMPLE_INTERVAL); assert.deepEqual(history.samples[0], initial[1]);
  ui.record(history, 1, 500000);
  assert.equal(history.samples.length, ui.HISTORY_LENGTH); assert.ok(history.samples.every(p => p.wind > 180));
  assert.ok(500000 - history.last < ui.SAMPLE_INTERVAL);
});

test("elapsed time formats minute and hour boundaries", () => {
  for (const [seconds, label] of [[0, "00:00"], [59.99, "00:59"], [60, "01:00"], [3602, "01:00:02"], [86401, "24:00:01"]]) {
    assert.equal(ui.clock(seconds), label);
  }
});

test("equal model time gives the same signal transition at every playback speed", () => {
  const reference = s.makeState();
  s.setSignal(reference, 10); s.advance(reference, 0.7);
  for (const speed of [0.5, 1, 2]) {
    const state = s.makeState(); state.speed = speed; s.setSignal(state, 10);
    for (let frame = 0; frame < 42; frame++) s.advance(state, 0.7 / (42 * speed));
    for (const key of ["time", "phase", "strength", "rainTravel"]) close(state[key], reference[key]);
  }
});
