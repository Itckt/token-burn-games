"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const field = require("../js/field");
const section = require("../js/section");
const storm = require("../js/storm");
const cycle = require("../js/lifecycle");
const shaders = require("../js/shaders");
const { createPage } = require("./support/page");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " differs from " + b);

function slide(p, name, value) {
  const control = p.get(name);
  control.value = String(value);
  control.fire("input");
}

test("signed transect distances put both ends on the instrument perimeter and the cut faces the camera", () => {
  for (const [bearing, x, z] of [[0, 0, -1], [90, 1, 0], [180, 0, 1], [270, -1, 0], [360, 0, -1]]) {
    const axis = section.axis(bearing);
    close(axis.x, x); close(axis.z, z);
    for (const km of [-120, -42, 0, 26, 120]) {
      const point = section.pointAt(axis, km);
      close(point.x, x * km / 10); close(point.z, z * km / 10);
    }
  }
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const axis = section.axis(degrees);
    for (const back of [[1, 0, 0], [-1, 0, 0], [0.3, 0.8, -0.51], [0, 1, 0]]) {
      const normal = section.nearNormal(axis, back);
      close(Math.hypot(normal.x, normal.z), 1);
      close(normal.x * axis.x + normal.z * axis.z, 0);
      assert.ok(normal.x * back[0] + normal.z * back[2] >= -1e-9);
    }
  }
});

test("all 121 surface samples match the probe, remain in chart bounds and reverse on the opposite bearing", () => {
  const values = new Float64Array(section.COUNT);
  assert.equal(values.length, 121);
  for (const signal of [1, 5, 10]) for (const bearing of [0, 65, 170]) {
    const state = { strength: storm.normalized(signal), phase: 2.8, time: 15 };
    const axis = section.axis(bearing);
    for (const [metric, bounds] of Object.entries(field.METRICS)) {
      assert.equal(section.profile(state, axis, metric, values), values);
      const reverse = section.profile(state, section.axis(bearing + 180), metric);
      values.forEach((val, index) => {
        assert.ok(val >= bounds.min && val <= bounds.max);
        close(val, reverse[reverse.length - 1 - index]);
        const point = section.pointAt(axis, -120 + index * 2);
        close(val, field.sample(state, point)[metric]);
      });
    }
  }
});

test("the transect resolves both eyewalls, a central pressure minimum and moving rainbands", () => {
  const state = cycle.at(34), axis = section.axis(40);
  const wind = section.profile(state, axis, "wind"), mid = (wind.length - 1) / 2;
  const peak = wind.indexOf(Math.max(...wind.slice(0, mid)));
  assert.ok(peak < mid && Math.abs((mid - peak) * 2 - 20) <= 2);
  close(wind[peak], wind[wind.length - 1 - peak]);
  assert.ok(wind[mid] < wind[peak] / 10);
  const pressure = section.profile(state, axis, "pressure");
  assert.equal(pressure[mid], Math.min(...pressure));
  const rain = section.profile(state, axis, "rain");
  assert.equal(rain[mid], 0);
  assert.notDeepEqual(rain, section.profile({ ...state, phase: state.phase + 1 }, axis, "rain"));
});

test("the real renderer cuts the near side of all optical passes and marks the same station on both maps", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.step();
  const uploads = p.gl.uploads;
  p.get("section-toggle").click();
  slide(p, "section-bearing", 35); slide(p, "section-distance", -46); p.step();
  const axis = section.axis(35);
  function checkSurface(draw) {
    const [x, z, station] = draw.uniforms.uTransect;
    close(x, axis.x); close(z, axis.z); close(station, -4.6);
  }
  function checkCut() {
    const draws = p.gl.draws.slice(-4), normal = section.nearNormal(axis, p.last().back);
    checkSurface(draws[0]);
    for (const draw of draws.slice(1)) {
      close(draw.uniforms.uCut[0], normal.x); close(draw.uniforms.uCut[1], normal.z);
      assert.match(shaders[draw.name].fragment, /discard;/);
    }
    return normal;
  }
  const before = checkCut();
  assert.equal(p.gl.uploads, uploads, "opening the cut does not rebuild particles");
  const c = p.get("storm-canvas");
  c.fire("pointerdown", { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  c.fire("pointermove", { pointerId: 1, clientX: 524, clientY: 0 });
  c.fire("pointerup", { pointerId: 1, clientX: 524, clientY: 0 });
  p.run(100);
  const after = checkCut();
  close(after.x, -before.x); close(after.z, -before.z);
  for (const name of ["wind", "radar"]) {
    p.data("imagery", name).click(); p.gl.draws.length = 0; p.step();
    assert.deepEqual(p.gl.draws.map(d => d.name), [name]); checkSurface(p.gl.draws[0]);
  }
  p.data("imagery", "cloud").click(); p.key("x"); p.step();
  assert.deepEqual(p.gl.draws.at(-4).uniforms.uTransect.slice(0, 2), [0, 0]);
  for (const draw of p.gl.draws.slice(-3)) assert.deepEqual(draw.uniforms.uCut, [0, 0]);
  assert.equal(p.frames.size, 0);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("profile controls read the visible instant, place the probe, handle keys and work with graphics offline", () => {
  for (const options of [{ reducedMotion: true }, { noWebGL: true }]) {
    const p = createPage(options);
    p.key("?"); p.key("x"); p.key("g"); p.key("Escape");
    assert.equal(p.get("section-tray").hidden, true);
    p.key("x"); p.key("x", { repeat: true });
    assert.equal(p.get("section-toggle").getAttribute("aria-expanded"), "true");
    slide(p, "section-bearing", 405); slide(p, "section-distance", -220);
    assert.equal(p.get("section-bearing").value, "355"); assert.equal(p.get("section-distance").value, "-120");
    slide(p, "section-bearing", 45); slide(p, "section-distance", -22);
    slide(p, "cycle-time", 28.5);
    const point = section.pointAt(section.axis(45), -22);
    const local = field.sample(cycle.at(28.5), point);
    for (const [metric, format] of Object.entries(field.METRICS)) {
      p.data("metric", metric).click();
      const label = "22 km SW · " + format.label + " " + local[metric].toFixed(format.digits) + " " + format.unit;
      assert.equal(p.get("section-reading").textContent, label);
      assert.equal(p.get("section-distance").getAttribute("aria-valuetext"), label);
      assert.equal(p.get("profile-unit").textContent, "Surface " + format.label.toLowerCase() + " (" + format.unit + ")");
      assert.equal(p.data("metric", metric).getAttribute("aria-pressed"), "true");
    }
    assert.equal(p.get("section-end").textContent, "120 km NE");
    assert.ok(p.get("profile-curve").getContext("2d").calls > section.COUNT);
    p.get("section-probe").click();
    assert.equal(p.get("probe-tray").hidden, false);
    assert.match(p.get("probe-location").textContent, /22\.0 km · 225°/);
    assert.equal(p.get("probe-rain").textContent, local.rain.toFixed(1));
    assert.equal(p.get("probe-pressure").textContent, local.pressure.toFixed(0));
    const input = p.get("section-distance");
    input.focus();
    assert.equal(p.key("ArrowRight", { target: input }).defaultPrevented, false);
    p.key("x", { target: input }); p.step();
    assert.equal(p.doc.activeElement, p.get("section-toggle"));
    assert.equal(p.get("section-tray").hidden, true);
    assert.equal(p.frames.size, 0);
    p.key("x"); assert.equal(p.get("section-distance").value, "-22");
  }
});

test("a frozen profile reuses its samples when orbiting, resizing or moving the cursor, and sleeps when closed", () => {
  const p = createPage({ reducedMotion: true });
  const model = p.win.Isobar.section, profile = model.profile;
  let samples = 0;
  model.profile = (...args) => { samples++; return profile(...args); };
  p.step(); assert.equal(samples, 0);
  p.key("x"); p.step(); assert.equal(samples, 1);
  slide(p, "section-distance", 36); p.win.fire("resize"); p.key("d"); p.run(100);
  assert.equal(samples, 1); assert.equal(p.frames.size, 0);
  slide(p, "section-bearing", 125); assert.equal(samples, 2);
  p.data("metric", "rain").click(); assert.equal(samples, 3);
  slide(p, "signal", 10); assert.equal(samples, 4);
  p.key("x"); p.key(" "); p.run(65);
  assert.equal(samples, 4); assert.ok(p.last().time > 1);
  p.key("x"); assert.equal(samples, 5);
});
