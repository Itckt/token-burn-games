"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const doppler = require("../js/doppler");
const field = require("../js/field");
const storm = require("../js/storm");
const shaders = require("../js/shaders");
const { createPage } = require("./support/page");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " differs from " + b);

test("a beam aligned, opposed or perpendicular to the flow measures full, reversed or zero wind", () => {
  const point = { x: 2, z: 0 };
  // At the eastern eyewall the wind blows 18 degrees west of north.
  const west = Math.sin(Math.PI / 10), north = Math.cos(Math.PI / 10);
  close(doppler.velocity(point, { x: 2 + west, z: north }, 91), 91);
  close(doppler.velocity(point, { x: 2 - west, z: -north }, 91), -91);
  close(doppler.velocity(point, { x: 2 + north, z: -west }, 91), 0);
  assert.equal(doppler.velocity(point, point, 91), null);
  assert.equal(doppler.velocity({ x: 0, z: 0 }, point, 8), null);
  assert.equal(doppler.velocity({ x: doppler.BLIND_RADIUS, z: 0 }, point, 8), null);
  assert.equal(doppler.velocity(point, { x: 2, z: 0.0005 }, 91), null);
  assert.equal(doppler.reading(null), "—");
  assert.equal(doppler.reading(-0.4), "0 km/h");
  assert.equal(doppler.reading(-0.5), "1 km/h toward");
  assert.equal(doppler.reading(0.5), "1 km/h away");
});

test("Doppler measures the rate of change of antenna range throughout all ten wind fields", () => {
  for (let signal = 1; signal <= 10; signal++) {
    const state = { ...storm.makeState(), strength: storm.normalized(signal), time: 13.3 };
    for (const radius of [0.3, field.WALL_RADIUS * storm.radialScale(state.strength), field.RANGE]) {
      for (const angle of [-2.4, -0.7, 0, 1.4, 2.1]) {
        const p = { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
        const sample = field.sample(state, p), bearing = sample.flowBearing * Math.PI / 180;
        const vx = sample.wind * Math.sin(bearing), vz = -sample.wind * Math.cos(bearing);
        for (const site of [...Object.values(doppler.SITES), { x: 0, z: 0 }]) {
          const rangeKm = dt => Math.hypot((p.x - site.x) * field.KM_PER_UNIT + dt * vx,
            (p.z - site.z) * field.KM_PER_UNIT + dt * vz);
          const dt = 0.00002;
          const measured = (rangeKm(dt) - rangeKm(-dt)) / (2 * dt);
          const radial = doppler.velocity(p, site, sample.wind);
          assert.ok(Math.abs(radial - measured) < 0.00003);
          assert.ok(Math.abs(radial) <= sample.wind + 1e-10);
        }
      }
    }
  }
});

test("Radar switches products, moves the antenna independently of the probe and shares its scale with the draw", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.data("imagery", "radar").click(); p.step();
  assert.equal(p.get("radar-products").hidden, false);
  assert.equal(p.get("radar-sites").hidden, true);
  p.data("product", "doppler").click();
  p.gl.draws.length = 0; p.step();
  assert.deepEqual(p.gl.draws.map(draw => draw.name), ["doppler"]);
  assert.equal(p.get("radar-key").hidden, true);
  assert.equal(p.get("doppler-key").hidden, false);
  assert.equal(p.get("radar-sites").hidden, false);
  assert.equal(p.data("imagery", "radar").getAttribute("aria-pressed"), "true");
  assert.equal(p.data("product", "doppler").getAttribute("aria-pressed"), "true");
  assert.equal(p.get("radar-place").disabled, true);
  assert.match(shaders.doppler.fragment, /dot\(windDirection\(p, r\), beam \/ range\)/);
  assert.match(shaders.doppler.fragment, /rangeGrid\(beam, width\)/);
  for (const [i, stop] of doppler.STOPS.entries()) {
    assert.equal(Number(p.data("velocity", String(i)).textContent), stop.speed);
    assert.ok(p.get("doppler-ramp").style["--ramp"].includes(stop.color));
    const channels = stop.color.slice(1).match(/../g).map(channel => (parseInt(channel, 16) / 255).toFixed(4));
    assert.ok(shaders.doppler.fragment.includes("vec3(" + channels.join(", ") + ")"));
  }
  p.key("p"); p.data("probe", "wall").click(); p.step();
  const point = field.preset("wall", p.last()), resources = p.gl.resources.length, uploads = p.gl.uploads;
  const check = site => {
    const draw = p.gl.draws.at(-1), state = p.last();
    assert.equal(draw.name, "doppler"); assert.equal(draw.count, 6);
    assert.deepEqual(draw.uniforms.uSite, [site.x, site.z]);
    close(draw.uniforms.uPeakWind, storm.readings(state.strength, state.time).wind);
    close(draw.uniforms.uScale, storm.radialScale(state.strength));
    const v = doppler.velocity(point, site, field.sample(state, point).wind);
    assert.equal(p.get("probe-radial").textContent, doppler.reading(v));
    assert.equal(p.frames.size, 0);
  };
  check(doppler.SITES.campus);
  p.data("site", "pier").click(); p.step(); check(doppler.SITES.pier);
  assert.match(p.get("radar-coordinates").textContent, /40.0 km E · 55.0 km S/);
  for (const level of [1, 5, 10]) { p.input("signal", level); p.step(); check(doppler.SITES.pier); }
  p.get("radar-place").click(); p.step(); check(point);
  assert.equal(p.get("probe-radial").textContent, "—");
  p.data("probe", "eye").click(); p.step();
  assert.deepEqual(p.gl.draws.at(-1).uniforms.uSite, [point.x, point.z]);
  assert.equal(p.get("probe-radial").textContent, "—");
  p.get("radar-place").click(); p.data("probe", "wall").click(); p.step();
  assert.match(p.get("probe-radial").textContent, /toward$/);
  p.data("layer", "grid").click(); p.step();
  assert.equal(p.gl.draws.at(-1).uniforms.uGrid, 0);
  assert.equal(p.gl.resources.length, resources); assert.equal(p.gl.uploads, uploads);
  p.key("b", { repeat: true }); assert.equal(p.get("doppler-key").hidden, false);
  p.data("product", "radar").click(); p.step();
  assert.equal(p.gl.draws.at(-1).name, "radar"); assert.equal(p.get("radial-reading").hidden, true);
  p.key("b"); p.step(); assert.deepEqual(p.gl.draws.at(-1).uniforms.uSite, [0, 0]);
  p.key("p"); assert.equal(p.get("radar-place").disabled, true);
  p.data("site", "pier").focus(); p.key("b", { target: p.doc.activeElement });
  assert.equal(p.doc.activeElement, p.data("imagery", "cloud"));
  assert.equal(p.get("radar-products").hidden, true);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});
