"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const field = require("../js/field");
const storm = require("../js/storm");
const cycle = require("../js/lifecycle");
const { createPage } = require("./support/page");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " differs from " + b);

test("surface flow has unit length, cyclonic rotation and inward drift in every quadrant", () => {
  for (let angle = 0; angle < 2 * Math.PI; angle += 0.19) {
    const x = Math.cos(angle), z = Math.sin(angle);
    for (const radius of [0.01, 2.06, 12]) {
      const vector = field.windDirection(radius * x, radius * z);
      close(Math.hypot(vector.x, vector.z), 1);
      close(x * vector.x + z * vector.z, -Math.sin(field.INFLOW));
      close(x * vector.z - z * vector.x, -Math.cos(field.INFLOW));
    }
  }
  assert.equal(field.windDirection(0, 0), null);
  const state = storm.makeState();
  assert.equal(field.sample(state, { x: 0, z: 0 }).flowBearing, null);
  close(field.sample(state, { x: 4, z: 0 }).flowBearing, 342);
  close(field.sample(state, { x: 0, z: -4 }).flowBearing, 252);
});

test("the wind scale peaks continuously at the contracting eyewall at every signal", () => {
  const wall = field.WALL_RADIUS;
  close(field.windFraction(wall - 1e-9), 1); close(field.windFraction(wall + 1e-9), 1);
  let previousRadius = Infinity;
  for (let signal = 1; signal <= 10; signal++) {
    const state = { strength: storm.normalized(signal), time: 38, phase: 0.5 };
    const radius = wall * storm.radialScale(state.strength);
    const peak = storm.readings(state.strength, state.time).wind;
    const at = r => field.sample(state, { x: r, z: 0 }).wind;
    close(at(radius), peak);
    close(at(0), peak * field.EYE_WIND);
    assert.ok(at(radius / 2) < peak && at(radius * 2) < peak && at(12) < at(radius * 2));
    assert.ok(radius < previousRadius);
    previousRadius = radius;
  }
});

test("wind imagery draws one surface pass using the displayed scale, model speed and probe direction", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.step();
  p.data("layer", "clouds").click();
  p.data("imagery", "wind").click();
  const allocations = p.gl.resources.length, uploads = p.gl.uploads;
  for (let level = 1; level <= 10; level++) {
    p.get("signal").value = String(level); p.get("signal").fire("input");
    p.gl.draws.length = 0; p.step();
    assert.deepEqual(p.gl.draws.map(d => d.name), ["wind"]);
    const draw = p.gl.draws[0], state = p.last();
    assert.equal(draw.count, 6); assert.equal(draw.blended, false);
    close(draw.uniforms.uPeakWind, storm.readings(state.strength, state.time).wind);
    close(draw.uniforms.uScale, storm.radialScale(state.strength));
    assert.equal(draw.uniforms.uPulse, 0);
    assert.equal(p.gl.resources.length, allocations); assert.equal(p.gl.uploads, uploads);
  }
  assert.equal(p.get("wind-key").hidden, false); assert.equal(p.get("radar-key").hidden, true);
  assert.equal(p.get("eye-marker").style.opacity, "1");
  for (const [index, stop] of field.WIND_STOPS.entries()) {
    assert.equal(p.data("stop", String(index)).textContent, String(stop.speed));
    assert.ok(p.get("wind-ramp").style["--ramp"].includes(stop.color));
  }
  assert.equal(p.data("layer", "rain").disabled, true);
  p.data("layer", "grid").click(); p.step();
  assert.equal(p.gl.draws.at(-1).uniforms.uGrid, 0); assert.equal(p.get("wind-rings").hidden, true);
  p.key("p"); p.data("probe", "eye").click();
  assert.equal(p.get("probe-flow").textContent, "—");
  p.key("ArrowRight", { target: p.get("storm-canvas"), shiftKey: true });
  assert.equal(p.get("probe-flow").textContent, "342°");
  p.key("g", { repeat: true }); assert.equal(p.data("imagery", "wind").getAttribute("aria-pressed"), "true");
  p.key("g"); p.step();
  assert.equal(p.last().imagery, "cloud"); assert.equal(p.get("wind-key").hidden, true);
  assert.deepEqual(p.last().layers, { clouds: false, rain: true, grid: false });
  assert.equal(p.frames.size, 0);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("wind tracers follow the model clock through playback, pause, rewind and graphics restoration", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.key("g"); p.data("stage", "1").click(); p.step();
  const check = t => close(p.gl.draws.at(-1).uniforms.uPulse, (cycle.at(t).rainTravel % 2) / 2);
  check(16);
  p.data("speed", "2").click(); p.key(" "); p.step(4000); p.step(25); check(16.05);
  p.key(" "); p.step(7000); check(16.05); assert.equal(p.frames.size, 0);
  p.data("stage", "0").click(); p.step(); check(0);
  p.get("storm-canvas").fire("webglcontextlost");
  assert.equal(p.get("wind-key").hidden, true); assert.equal(p.frames.size, 0);
  p.get("storm-canvas").fire("webglcontextrestored"); p.step(6000);
  assert.equal(p.get("wind-key").hidden, false); check(0);
  assert.equal(p.gl.draws.at(-1).name, "wind");
});
