"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lighting = require("../js/lighting");
const math = require("../js/math");
const { createPage } = require("./support/page");
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, a + " differs from " + b);

test("the light follows a unit east-to-west arc with a cyclic midnight and finite colours all day", () => {
  for (let minute = 0; minute <= lighting.DAY; minute += 15) {
    const light = lighting.at(minute);
    close(Math.hypot(...light.direction), 1); assert.ok(light.direction[1] >= 0);
    assert.ok(light.contrast >= 0 && light.contrast <= 1);
    for (const color of [light.water, light.shadow, light.lit, light.rain]) {
      assert.ok(color.every(channel => channel >= 0 && channel <= 1));
    }
    assert.deepEqual(lighting.at(minute - lighting.DAY), light);
    assert.deepEqual(lighting.at(minute + lighting.DAY), light);
  }
  assert.ok(lighting.at(420).direction[0] > 0.9);
  assert.ok(lighting.at(1020).direction[0] < -0.9);
  assert.ok(lighting.at(720).direction[1] > 0.9 && lighting.at(720).direction[2] > 0);
  assert.equal(lighting.clock(0), "00:00"); assert.equal(lighting.clock(1440), "24:00");
  assert.equal(lighting.clock(375), "06:15");
  for (const input of [NaN, Infinity, undefined]) assert.deepEqual(lighting.at(input), lighting.at(lighting.DEFAULT_MINUTES));
});

test("sunset and sunrise interpolate the palette and hand directional light over without a jump", () => {
  for (const [minute, period] of [[0, "Night"], [360, "Dawn"], [720, "Daylight"], [1080, "Dusk"]]) {
    assert.equal(lighting.at(minute).period, period);
    const before = lighting.at(minute - 0.01), after = lighting.at(minute + 0.01);
    for (const color of ["lit", "shadow", "rain", "water"]) {
      before[color].forEach((c, i) => close(c, after[color][i], 0.0002));
    }
    before.direction.forEach((v, i) => close(v * before.contrast, after.direction[i] * after.contrast, 0.0002));
  }
  const night = lighting.at(0), day = lighting.at(720), dusk = lighting.at(1080);
  assert.ok(night.lit[0] < day.lit[0] && night.lit[2] > night.lit[0]);
  assert.ok(dusk.lit[0] > dusk.lit[2] && dusk.lit[2] < day.lit[2]);
});

test("the lighting dial relights water, deck, billboard normals and rain while a paused storm stays fixed", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true }); p.step();
  const before = p.last(), view = math.cameraFrame(math.makeCamera(), 900 / 420);
  const allocations = p.gl.resources.length, uploads = p.gl.uploads;
  const values = ["wind", "rain", "pressure"].map(name => p.get(name + "-value").textContent);
  for (const minute of [0, 375, 720, 1065, 1440]) {
    p.input("light-time", minute); p.gl.draws.length = 0; p.step(5000);
    const light = lighting.at(minute);
    const [water, rain, deck, cloud] = p.gl.draws.map(d => d.uniforms);
    assert.deepEqual(water.uLightDir, light.direction); assert.deepEqual(water.uWater, light.water);
    assert.deepEqual(water.uLit, light.lit); close(water.uContrast, light.contrast);
    assert.deepEqual(water.uEye, view.eye); assert.deepEqual(rain.uRainColor, light.rain);
    assert.deepEqual(deck.uLit, cloud.uLit); assert.deepEqual(deck.uShadow, cloud.uShadow);
    assert.deepEqual(cloud.uShadow, light.shadow); assert.deepEqual(cloud.uLit, light.lit);
    assert.deepEqual(cloud.uIncident, light.incident);
    assert.deepEqual(deck.uLightDir, light.direction); close(deck.uContrast, light.contrast);
    [view.right, view.up, view.back].forEach((v, i) => close(cloud.uSun[i], math.dot(light.direction, v) * light.contrast));
    assert.equal(p.get("light-time").getAttribute("aria-valuetext"), lighting.clock(minute) + ", " + light.period);
    assert.equal(p.last().time, before.time); assert.equal(p.last().phase, before.phase);
    assert.equal(p.last().rainTravel, before.rainTravel);
    assert.deepEqual(["wind", "rain", "pressure"].map(name => p.get(name + "-value").textContent), values);
    assert.equal(p.gl.resources.length, allocations); assert.equal(p.gl.uploads, uploads); assert.equal(p.frames.size, 0);
  }
  const sun = p.gl.draws.at(-1).uniforms.uSun;
  p.key("d"); p.step(); p.step(50);
  assert.notDeepEqual(p.gl.draws.at(-1).uniforms.uSun, sun);
  assert.deepEqual(p.gl.draws.at(-4).uniforms.uLightDir, lighting.at(0).direction);
  p.key("g"); p.step(); assert.equal(p.get("light-time").disabled, true);
  const map = p.gl.draws.at(-1);
  p.key("c"); p.input("light-time", 720); p.step();
  assert.equal(p.get("light-time").disabled, false);
  const comparedMap = p.gl.draws.at(-1);
  assert.equal(comparedMap.name, "wind"); assert.equal(comparedMap.uniforms.uPeakWind, map.uniforms.uPeakWind);
  assert.equal(comparedMap.uniforms.uScale, map.uniforms.uScale); assert.equal(comparedMap.uniforms.uLit, undefined);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});
