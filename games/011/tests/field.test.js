"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const field = require("../js/field");
const storm = require("../js/storm");
const { TAU } = require("../js/math");
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " differs from " + b);

test("the shared echo texture has a dry eye and perimeter and reaches every legend band at peak", () => {
  const map = field.echoMap();
  assert.equal(field.echoMap(), map);
  assert.equal(map.data.length, 4 * map.width * map.height);
  assert.equal(field.sampleMap(map, 0, 0), 0);
  const thresholds = field.BANDS.map(b => b.rate);
  const counts = new Set();
  const peak = storm.readings(1, 34).rain;
  for (let row = 0; row < map.height; row++) for (let col = 0; col < map.width; col++) {
    const i = 4 * (row * map.width + col);
    assert.equal(map.data[i + 3], 255);
    if (!row || !col || row === map.height - 1 || col === map.width - 1) assert.equal(map.data[i], 0);
    const rate = peak * map.data[i] / 255;
    counts.add(thresholds.filter(threshold => rate >= threshold).length);
  }
  assert.equal(counts.size, 1 + thresholds.length);
});

test("surface sampling matches linear texture filtering at texel centres, seams and clamped edges", () => {
  const map = { width: 2, height: 2, data: Uint8Array.from([0, 0, 0, 255, 64, 0, 0, 255, 128, 0, 0, 255, 255, 0, 0, 255]) };
  const half = field.MAP_EXTENT / 2;
  close(field.sampleMap(map, -half, -half), 0);
  close(field.sampleMap(map, half, -half), 64 / 255);
  close(field.sampleMap(map, -half, half), 128 / 255);
  close(field.sampleMap(map, 0, 0), (64 + 128 + 255) / (4 * 255));
  close(field.sampleMap(map, 1000, 1000), 1);
  close(field.sampleMap(map, -1000, 0), 64 / 255);
});

test("across all ten signals the eye is calm, the eyewall has peak wind and pressure recovers outwards", () => {
  for (let signal = 1; signal <= 10; signal++) {
    const state = { strength: storm.normalized(signal), time: 14, phase: 1.4 };
    const peak = storm.readings(state.strength, state.time);
    const [eye, wall, band] = ["eye", "wall", "band"].map(name => field.sample(state, field.preset(name, state)));
    assert.deepEqual([eye.zone, wall.zone, band.zone], ["Eye", "Eyewall", "Rainband"]);
    assert.equal(eye.bearing, null); assert.equal(eye.km, 0); assert.equal(eye.rain, 0);
    assert.ok(eye.wind < 0.1 * wall.wind && wall.wind > band.wind);
    close(wall.wind, peak.wind); close(eye.pressure, peak.pressure);
    assert.ok(wall.rain > peak.rain * 0.65 && band.rain > peak.rain * 0.5);
    assert.ok(eye.pressure < wall.pressure && wall.pressure < band.pressure && band.pressure < 1012);
    close(wall.km, 2.06 * storm.radialScale(state.strength) * field.KM_PER_UNIT);
  }
});

test("echoes co-rotate with rendered cloud centres while a fixed ground probe sees a passing band", () => {
  const particle = { r: 6.5, theta: storm.armAngle(6.5, 1), y: 1.3 };
  const expected = field.sampleMap(field.echoMap(), particle.r * Math.cos(particle.theta), particle.r * Math.sin(particle.theta));
  for (const strength of [0, 0.45, 1]) for (const phase of [0, 2.5, TAU - 0.0001]) {
    const state = { strength, phase, time: 17 };
    const pose = [];
    storm.cloudPose(particle, phase, strength, pose);
    const point = { x: pose[0], z: pose[2] };
    const local = field.sample(state, point);
    close(local.rain / storm.readings(strength, state.time).rain, expected);
    state.phase += 1.1;
    const later = field.sample(state, point);
    assert.ok(later.rain < local.rain * 0.25);
    close(later.wind, local.wind); close(later.pressure, local.pressure);
  }
});

test("probe bearings use north at negative Z and east at positive X", () => {
  const state = storm.makeState();
  for (const [x, z, degrees] of [[0, -3, 0], [3, 0, 90], [0, 3, 180], [-3, 0, 270]]) {
    const sample = field.sample(state, { x, z });
    assert.equal(sample.km, 30); assert.equal(sample.bearing, degrees);
  }
});
