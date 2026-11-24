"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const storm = require("../js/storm");
const field = require("../js/field");
const drift = require("../js/drift");
const { createPage } = require("./support/page");
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);

// Independent integration of the probe's velocity vector, in world units per hour.
function integrate(state, point, hours) {
  const scale = storm.radialScale(state.strength), peak = storm.readings(state.strength, state.time).wind;
  function velocity(p) {
    const dir = field.windDirection(p.x, p.z);
    const speed = peak * field.windFraction(Math.hypot(p.x, p.z) / scale) / field.KM_PER_UNIT;
    return { x: speed * dir.x, z: speed * dir.z };
  }
  const offset = (p, v, dt) => ({ x: p.x + v.x * dt, z: p.z + v.z * dt });
  const steps = 2400, dt = hours / steps;
  let p = point, length = 0;
  for (let i = 0; i < steps; i++) {
    const a = velocity(p), b = velocity(offset(p, a, dt / 2));
    const c = velocity(offset(p, b, dt / 2)), d = velocity(offset(p, c, dt));
    const next = { x: p.x + dt / 6 * (a.x + 2 * b.x + 2 * c.x + d.x),
      z: p.z + dt / 6 * (a.z + 2 * b.z + 2 * c.z + d.z) };
    length += Math.hypot(next.x - p.x, next.z - p.z) * field.KM_PER_UNIT;
    p = next;
  }
  return { p, length };
}

test("parcel endpoints and travel distances match independent vector integration inside, outside and across the eyewall", () => {
  const state = storm.makeState();
  for (const level of [1, 5, 10]) {
    Object.assign(state, { strength: storm.normalized(level), signal: level, time: 18.4 });
    for (const point of [{ x: 12, z: 0 }, { x: -3.1, z: 1.4 }, { x: 0.7, z: -1.1 }, { x: -0.3, z: -0.4 }]) {
      const launch = drift.release(state, point);
      for (const minutes of [15, 30, 60]) {
        const route = drift.trace(launch, minutes), physical = integrate(state, point, route.elapsed / 60);
        close(physical.p.x, route.end.x, 2e-6);
        close(physical.p.z, route.end.z, 2e-6);
        close(physical.length, route.distanceKm, 0.00015);
        assert.ok(route.elapsed > 0 && route.elapsed <= minutes);
        assert.ok(route.endKm <= Math.hypot(point.x, point.z) * field.KM_PER_UNIT);
        if (route.reachedEye) close(route.endKm, drift.EYE_LIMIT_KM);
        else close(route.elapsed, minutes);
      }
    }
  }
});

test("zero travel, the undefined eye bearing and the one-kilometre limit all have finite stationary results", () => {
  const state = { ...storm.makeState(), strength: 1 };
  for (const x of [0, 0.04, 0.1]) {
    const route = drift.trace(drift.release(state, { x, z: 0 }), 60);
    assert.equal(route.reachedEye, true); close(route.elapsed, 0); close(route.distanceKm, 0);
    close(route.end.x, x); close(route.end.z, 0);
  }
  const launch = drift.release(state, { x: 2, z: 0 });
  const still = drift.trace(launch, 0);
  assert.equal(still.reachedEye, false); close(still.end.x, 2); close(still.end.z, 0);
  const stop = drift.trace(launch, 60);
  assert.ok(stop.reachedEye && stop.elapsed < 60);
  assert.ok(drift.trace(launch, stop.elapsed - 0.001).endKm > drift.EYE_LIMIT_KM);
  assert.deepEqual(drift.trace(launch, 120).end, stop.end);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => drift.trace(launch, invalid), RangeError);
  for (const invalid of [null, { x: NaN, z: 0 }, { x: 12.1, z: 0 }]) assert.throws(() => drift.release(state, invalid), RangeError);
});

test("launch copies the actual strength, release position and time, independent of later storm and probe edits", () => {
  const state = storm.makeState(), point = { x: 4, z: 1 };
  storm.setSignal(state, 10); storm.advance(state, 0.1);
  const launch = drift.release(state, point), first = drift.trace(launch, 30);
  close(launch.wind, field.sample(state, field.preset("wall", state)).wind);
  point.x = 9; storm.advance(state, 45);
  assert.deepEqual(drift.trace(launch, 30), first);
  assert.notDeepEqual(drift.trace(drift.release(state, point), 30).end, first.end);
});

test("a release opens the wind map, keeps its origin through signal and horizon edits, and samples its arrival", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.step(); p.key("p"); p.data("probe", "band").click();
  const source = field.preset("band", p.last()), launch = drift.release(p.last(), source);
  p.get("drift-release").click(); p.step();
  assert.equal(p.last().imagery, "wind");
  assert.equal(p.get("drift-result").hidden, false);
  assert.match(p.get("drift-summary").textContent, /Signal 5 at release/);
  const checkRoute = (minutes, surface) => {
    const expected = drift.trace(launch, minutes), uniforms = p.gl.draws.filter(d => d.name === surface).at(-1).uniforms;
    close(uniforms.uRelease[0], source.x); close(uniforms.uRelease[1], source.z);
    close(uniforms.uArrival[0], expected.end.x); close(uniforms.uArrival[1], expected.end.z);
    assert.equal(uniforms.uArrival[2], 1);
    return expected;
  };
  checkRoute(30, "wind");
  p.data("probe", "eye").click(); p.get("signal-up").click();
  p.data("horizon", "60").click(); p.step(); const expected = checkRoute(60, "wind");
  assert.equal(p.data("horizon", "60").getAttribute("aria-pressed"), "true");
  assert.equal(p.data("horizon", "30").getAttribute("aria-pressed"), "false");
  assert.match(p.get("drift-summary").textContent, /Signal 5 at release/);
  p.get("drift-inspect").click(); p.step();
  const local = field.sample(p.last(), expected.end);
  assert.equal(p.get("probe-wind").textContent, local.wind.toFixed(0));
  assert.equal(p.get("probe-rain").textContent, local.rain.toFixed(1));
  for (const [imagery, surface] of [["cloud", "sea"], ["radar", "radar"], ["pressure", "pressure"]]) {
    p.data("imagery", imagery).click(); p.step(); checkRoute(60, surface);
  }
  const canvas = p.get("storm-canvas");
  canvas.fire("webglcontextlost"); assert.equal(p.get("pressure-key").hidden, true);
  canvas.fire("webglcontextrestored"); p.step(9000); checkRoute(60, "pressure");
  assert.equal(p.get("pressure-key").hidden, false);
  p.get("drift-clear").click(); p.step();
  assert.equal(p.doc.activeElement, p.get("drift-release")); assert.equal(p.get("drift-result").hidden, true);
  assert.equal(p.gl.draws.at(-1).uniforms.uArrival[2], 0);
  assert.equal(p.frames.size, 0);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("closing the probe clears its trail and recovers keyboard focus, including without WebGL", () => {
  const p = createPage({ noWebGL: true });
  assert.equal(p.data("imagery", "pressure").disabled, true);
  p.key("p"); p.data("probe", "eye").click(); p.get("drift-release").click();
  assert.match(p.get("drift-summary").textContent, /0\.0 km travelled.*Within 1 km/);
  p.get("drift-inspect").click(); p.key("p", { target: p.doc.activeElement });
  assert.equal(p.get("drift-result").hidden, true);
  assert.equal(p.doc.activeElement, p.get("probe-toggle"));
  p.key("p"); assert.equal(p.get("drift-result").hidden, true);
  assert.equal(p.frames.size, 0);
});
