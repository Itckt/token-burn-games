"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cycle = require("../js/lifecycle");
const storm = require("../js/storm");
const { TAU } = require("../js/math");
const ui = require("../js/ui");
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, a + " differs from " + b);

test("life cycle stage boundaries are continuous and either end can be sought directly", () => {
  for (const [time, signal, name] of [[0, 1, "Formation"], [16, 4, "Deepening"], [34, 10, "Peak"], [42, 10, "Decay"], [60, 2, "Decay"]]) {
    const pose = cycle.at(time);
    assert.equal(pose.stage.name, name); assert.equal(pose.signal, signal);
    close(pose.strength, storm.normalized(signal));
    for (const neighbor of [cycle.at(time - 1e-7), cycle.at(time + 1e-7)]) {
      close(neighbor.strength, pose.strength); close(neighbor.rainTravel, pose.rainTravel, 1e-6);
      close(Math.cos(neighbor.phase), Math.cos(pose.phase), 1e-6);
    }
  }
  assert.deepEqual(cycle.at(-3), cycle.at(0));
  assert.deepEqual(cycle.at(5e8), cycle.at(cycle.DURATION));
  for (const invalid of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(cycle.at(invalid), null);
    assert.equal(cycle.readingsAt(invalid), null);
  }
});

test("life cycle seeking reproduces integrated spin and fall, including the phase wrap during decay", () => {
  const dt = 0.025;
  let phase = 0, travel = 0;
  const visited = new Set();
  for (let i = 1; i <= cycle.DURATION / dt; i++) {
    const time = i * dt;
    const midpoint = cycle.at(time - dt / 2), pose = cycle.at(time);
    phase += dt * storm.spinRate(midpoint.strength);
    travel += dt * storm.fallRate(midpoint.strength);
    visited.add(pose.signal);
    assert.ok(pose.strength >= 0 && pose.strength <= 1 && pose.phase >= 0 && pose.phase < TAU);
    close(pose.phase, phase % TAU, 0.000002); close(pose.rainTravel, travel, 0.00002);
  }
  assert.ok(phase > TAU); assert.equal(visited.size, 10);
  const before = cycle.at(25.4);
  cycle.at(59.8); cycle.at(0);
  assert.deepEqual(cycle.at(25.4), before);
});

test("scrubbed telemetry reconstructs the preceding storm and clamps pre-formation history to the start", () => {
  for (const time of [46, 1.2, 0, 31.4]) {
    const pose = cycle.at(time);
    const history = ui.makeHistory(pose.strength, time, cycle.readingsAt);
    history.samples.forEach((sample, index) => {
      const t = Math.max(0, time - (history.samples.length - 1 - index) * ui.SAMPLE_INTERVAL);
      assert.deepEqual(sample, storm.readings(cycle.at(t).strength, t));
    });
    ui.record(history, pose.strength, time + 1.03, cycle.readingsAt);
    assert.deepEqual(history.samples.at(-1), cycle.readingsAt(history.last));
  }
});
