"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Clock, SPEEDS, START_DAYS, MIN_DAYS, MAX_DAYS, dateAt, parseUTCMinute } = require("../js/time.js");
const { orbits, orbitalState, systemAt, compileOrbit } = require("../js/physics.js");
const { bodies, planets } = require("../js/catalog.js");
const { dot, cross, scale, normalize } = require("../js/math.js");
const { apsisDay, signalRange, AU_DAY_TO_KM_S, SWEEP_FRACTION } = require("../js/observations.js");
const { apsisSector } = require("../js/geometry.js");
const { lightTimeText } = require("../js/instruments.js");

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + " differs from " + expected);
}

test("UTC minute input round-trips leap days, the J2000 epoch and four-digit calendar limits", () => {
  for (const value of ["0001-01-01T00:00", "0099-08-24T23:59", "2000-02-29T15:30",
    "2024-03-10T02:30", "2026-01-01T00:00", "9999-12-31T23:59"]) {
    const days = parseUTCMinute(value);
    assert.ok(Number.isFinite(days), value);
    assert.equal(dateAt(days).toISOString(), value + ":00.000Z");
  }
  assert.equal(parseUTCMinute("2000-01-01T12:00"), 0);
  assert.equal(parseUTCMinute("2026-01-01T00:00"), START_DAYS);
  for (const value of ["", null, 0, "0000-01-01T00:00", "10000-01-01T00:00", "2100-02-29T12:00",
    "1900-02-29T00:00", "2026-04-31T00:01", "2026-03-31T24:00", "2026-03-31T09:60",
    "2026-01-01", "2026-01-01T00:00+08:00", "2026-01-01T00:01:00"]) {
    assert.equal(parseUTCMinute(value), null, String(value));
  }
});

test("frame-sized increments reach midnight exactly and reverse through the same instants at every speed", () => {
  for (const [index, speed] of SPEEDS.entries()) {
    const clock = new Clock();
    clock.setSpeed(index);
    for (let frame = 0; frame < 60; frame++) clock.advance(1 / 60);
    assert.equal(clock.date.toISOString(), dateAt(START_DAYS + speed).toISOString());
    clock.reverse();
    for (let frame = 0; frame < 120; frame++) clock.advance(1 / 120);
    assert.equal(clock.days, START_DAYS);
    assert.equal(clock.direction, -1);
    assert.equal(clock.speed, speed);
  }
});

test("a successful seek pauses at the exact instant and invalid seeks preserve the clock", () => {
  const clock = new Clock();
  clock.reverse();
  clock.setSpeed(5);
  for (const bad of [null, "0", NaN, Infinity, MIN_DAYS - 1, MAX_DAYS + 1]) {
    assert.equal(clock.seek(bad), false);
    assert.equal(clock.days, START_DAYS);
    assert.equal(clock.paused, false);
  }
  clock.advance(1 / 60);
  assert.equal(clock.seek(0), true);
  assert.equal(clock.paused, true);
  clock.advance(8000);
  assert.equal(clock.days, 0);
  clock.paused = false;
  clock.advance(1);
  assert.equal(clock.days, -30);
});

test("enormous finite playback intervals stop at valid calendar boundaries and allow travel back inside", () => {
  const clock = new Clock();
  clock.setSpeed(6);
  clock.advance(Number.MAX_VALUE);
  assert.equal(clock.date.toISOString(), "9999-12-31T23:59:59.999Z");
  assert.equal(clock.paused, true);
  clock.reverse();
  clock.paused = false;
  clock.advance(Number.MAX_VALUE);
  assert.equal(clock.date.toISOString(), "0001-01-01T00:00:00.000Z");
  assert.equal(clock.paused, true);
  clock.reverse();
  clock.paused = false;
  clock.advance(0.01);
  assert.equal(clock.date.toISOString(), "0001-01-02T00:00:00.000Z");
  assert.equal(clock.paused, false);
});

test("apsis predictions bracket any date in both directions and agree with the orbital extrema", () => {
  for (const orbit of Object.values(orbits)) {
    for (const day of [MIN_DAYS, -10000.25, 0, START_DAYS, MAX_DAYS]) {
      for (const kind of ["perihelion", "aphelion"]) {
        const next = apsisDay(orbit, day, kind), prev = apsisDay(orbit, day, kind, -1);
        assert.ok(prev < day && next > day);
        near(next - prev, orbit.period, 1e-8);
        const radius = orbit.a * (1 + (kind === "perihelion" ? -orbit.e : orbit.e));
        for (const at of [next, prev]) {
          const state = orbitalState(orbit, at);
          near(state.distance, radius);
          near(dot(state.position, state.velocity), 0);
          near(apsisDay(orbit, at, kind) - at, orbit.period, 1e-8);
          near(at - apsisDay(orbit, at, kind, -1), orbit.period, 1e-8);
          near(apsisDay(orbit, at - 1 / 86400, kind), at);
          near(apsisDay(orbit, at + 1 / 86400, kind, -1), at);
        }
      }
    }
  }
  assert.throws(() => apsisDay(orbits.earth, 0, "constructor"), RangeError);
  assert.throws(() => apsisDay(orbits.earth, 0, "aphelion", 0), RangeError);
});

test("each swept sector joins the focus to a timed arc and covers one twelfth of the display ellipse", () => {
  const steps = 48;
  for (const planet of planets) {
    const orbit = orbits[planet.id], axis = planet.track;
    const expectedArea = Math.PI * axis ** 2 * orbit.minorRatio * SWEEP_FRACTION;
    for (const kind of ["perihelion", "aphelion"]) {
      const data = apsisSector(orbit, axis, kind, steps);
      const vertex = index => Array.from(data.subarray(index * 3, (index + 1) * 3));
      assert.equal(data.length, (steps + 3) * 3);
      assert.deepEqual(vertex(0), [0, 0, 0]);
      assert.deepEqual(vertex(steps + 2), [0, 0, 0]);
      const center = apsisDay(orbit, START_DAYS, kind);
      for (const i of [0, 8, 24, 32, steps]) {
        const day = center + (i / steps - 0.5) * orbit.period * SWEEP_FRACTION;
        const expected = scale(orbitalState(orbit, day).position, axis / orbit.a);
        vertex(i + 1).forEach((value, j) => near(value, expected[j], 0.000002));
      }
      let area = 0;
      for (let i = 1; i <= steps; i++) area += Math.hypot(...cross(vertex(i), vertex(i + 1))) / 2;
      near(area / expectedArea, 1, 0.00005);
    }
  }
});

test("equal-time arcs widen near perihelion and converge to the same angle on circular orbits", () => {
  function arcAngle(orbit, kind) {
    const data = apsisSector(orbit, 1, kind);
    return Math.acos(dot(normalize(data.slice(3, 6)), normalize(data.slice(-6, -3))));
  }
  assert.ok(arcAngle(orbits.mercury, "perihelion") > 2 * arcAngle(orbits.mercury, "aphelion"));
  const circle = compileOrbit([1, 0, 12, 45, 90, 23]);
  near(arcAngle(circle, "perihelion"), arcAngle(circle, "aphelion"), 1e-7);
  assert.throws(() => apsisSector(circle, 1, "aphelion", 1), RangeError);
  assert.throws(() => apsisSector(circle, NaN, "perihelion"), RangeError);
  assert.throws(() => apsisSector(circle, 1, "parhelion"), RangeError);
});

test("one-way signal time uses the physical baseline and handles coincident and transverse motion", () => {
  const from = { position: [90, 0, 0], positionAU: [1, 0, 0], velocity: [0, 0, 0] };
  const to = { position: [-7, 0, 0], positionAU: [1, 0, 1], velocity: [0.5, 0, -1] };
  const result = signalRange(from, to);
  assert.equal(result.au, 1);
  near(result.lightSeconds, 499.004783836);
  near(result.rateKmS, -1731.456836806, 1e-8);
  assert.deepEqual(signalRange(to, from), result);
  assert.deepEqual(signalRange(to, { ...from, positionAU: to.positionAU }), { au: 0, lightSeconds: 0, rateKmS: 0 });
  assert.equal(signalRange(from, { ...to, velocity: [1, 0, 0] }).rateKmS, 0);
  assert.equal(lightTimeText(result.lightSeconds), "8m 19s");
  assert.equal(lightTimeText(59.6), "1m 00s");
  assert.equal(lightTimeText(3599.9), "1h 00m 00s");
  assert.equal(lightTimeText(0), "0 s");
});

test("the signed range rate matches the change in physical separation for all body pairs", () => {
  const dt = 0.001;
  for (const day of [-480.12, START_DAYS]) {
    const states = systemAt(day), before = systemAt(day - dt), after = systemAt(day + dt);
    for (const [i, from] of bodies.entries()) {
      for (const to of bodies.slice(i + 1)) {
        const range = signalRange(states[from.id], states[to.id]);
        if (from.id === "sun") near(range.au, states[to.id].distance);
        const lengthAt = frame => Math.hypot(...frame[to.id].positionAU.map((v, k) => v - frame[from.id].positionAU[k]));
        near(range.rateKmS, (lengthAt(after) - lengthAt(before)) / (2 * dt) * AU_DAY_TO_KM_S, 1e-6);
        assert.deepEqual(signalRange(states[to.id], states[from.id]), range);
      }
    }
  }
});
