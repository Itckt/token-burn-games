"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("./support/page");
const { CommandGL } = require("./support/gl");
const M = require("../js/math");
const T = require("../js/terrain");
const S = require("../js/simulation");
const O = require("../js/observatory");
const Q = require("../js/survey");

const world = T.createWorld(), grid = T.buildGrid(world);
const time = minute => S.formatHour(minute / 60);
function frame(p, dt = 0) {
  p.advance(1, dt);
  assert.ok(p.el("scene-error").hidden, p.el("error-detail").textContent);
  assert.equal(p.frameCount(), 1);
}
function input(p, id, value) {
  const el = p.el(id);
  el.value = String(value);
  el.emit("input");
}
function lastMain(p, kind) {
  return p.gl.draws.findLast(d => d.pass === "main" && d.kind === kind).uniforms;
}
function closeVector(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-7, v + " differs from " + expected[i]));
}

test("the observatory reads the camera skyline and retimes the live scene without resurveying the bed", () => {
  const p = mount();
  p.click("study-open"); assert.equal(p.el("observatory").open, false); frame(p);
  const observatory = p.window.FieldAtlas.observatory, original = observatory.sunWindows;
  let measurements = 0;
  observatory.sunWindows = (...args) => { measurements++; return original(...args); };
  p.click("study-open");
  assert.ok(p.el("observatory").open); assert.equal(p.document.activeElement.id, "study-close");
  assert.match(p.el("study-place").textContent, /Alder Basin.*KT-0427/);
  assert.equal(p.el("site-coordinates").textContent, "X 32 · Z 144 · Eye 43.0 m");
  const line = p.el("skyline-line").getAttribute("d");
  assert.equal(line.split(" ").filter(part => part.startsWith("L")).length, 360);
  assert.doesNotMatch(line, /NaN|Infinity/);
  assert.equal(p.el("first-sun").textContent, "First sun 07:22");
  assert.equal(p.el("last-sun").textContent, "Last sun 16:19");
  assert.equal(p.el("sun-duration").textContent, "8h 58m · 1 window");
  p.click("first-sun"); frame(p);
  assert.equal(p.el("clock").textContent, "07:22"); assert.equal(p.el("cycle").getAttribute("aria-checked"), "false");
  assert.equal(p.el("sun-reading").textContent, "07:22 · Direct sun");
  closeVector(lastMain(p, "sky").uSun, S.sunDirection(7 + 22 / 60));
  input(p, "sun-minute", 441);
  assert.equal(p.el("sun-reading").textContent, "07:21 · Behind terrain");
  assert.equal(p.el("skyline-sun").dataset.shaded, "true");
  p.click("last-sun"); assert.equal(p.el("hour").value, "979");
  for (const minute of [0, 1439, 720]) {
    input(p, "sun-minute", minute); frame(p, 200);
    assert.equal(p.el("clock").textContent, time(minute));
    assert.equal(p.el("skyline-sun").hidden, minute !== 720);
    assert.equal(p.el("face-sun").disabled, minute !== 720);
    assert.equal(p.el("sun-minute").getAttribute("aria-valuetext"), p.el("sun-reading").textContent);
  }
  input(p, "skyline-bearing", 270);
  assert.match(p.el("skyline-bearing").getAttribute("aria-valuetext"), /270° W.*m away/);
  assert.equal(p.el("skyline-cursor").getAttribute("x2"), "270");
  assert.equal(measurements, 1);
  p.click("face-sun"); frame(p);
  closeVector(lastMain(p, "sky").uForward, S.sunDirection(12));
  closeVector(lastMain(p, "land").uEye, world.style.start);
  assert.equal(p.el("viewer").dataset.mode, "fly");
});

test("the summit skyline crosses the north seam and hands its exact sightline to Fly without a map canvas", () => {
  const p = mount({ no2d: true }); frame(p);
  p.click("study-open"); const original = p.el("skyline-line").getAttribute("d");
  p.click("site-summit");
  assert.equal(p.el("site-summit").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("site-camera").getAttribute("aria-pressed"), "false");
  assert.notEqual(p.el("skyline-line").getAttribute("d"), original);
  input(p, "skyline-bearing", 0); const north = p.el("ridge-reading").textContent;
  input(p, "skyline-bearing", 360); assert.equal(p.el("ridge-reading").textContent, north);
  assert.equal(p.el("bearing-label").textContent, "360° N");
  p.click("visit-bearing"); frame(p);
  const eye = O.summit(grid); eye[1] += 3;
  assert.equal(p.el("viewer").dataset.mode, "fly"); assert.ok(!p.el("observatory").open);
  assert.equal(p.document.activeElement, p.el("world")); closeVector(lastMain(p, "land").uEye, eye);
  closeVector(lastMain(p, "sky").uForward, M.direction(0, O.horizonAt(grid, eye, 0).angle));
  p.key("keydown", "KeyW"); frame(p, 100); p.key("keyup", "KeyW");
  assert.notDeepEqual(lastMain(p, "land").uEye, eye);
});

test("a route station stands three metres above raised water and returns to the exposed bed", () => {
  const p = mount({ no2d: true }); frame(p);
  input(p, "lake-level", 7); frame(p);
  const route = Q.buildRoute(grid, Q.inletPath(world), 7);
  const station = Q.stationAt(route, route.length * 0.4);
  assert.ok(station.height < 7);
  input(p, "station", 400);
  for (const water of [true, false]) {
    if (!water) p.click("water");
    p.click("study-open"); p.click("site-route");
    assert.equal(p.el("site-route").getAttribute("aria-pressed"), "true");
    const eye = [station.x, (water ? 7 : station.height) + 3, station.z];
    assert.ok(p.el("site-coordinates").textContent.endsWith("Eye " + eye[1].toFixed(1) + " m"));
    p.click("visit-bearing"); frame(p); closeVector(lastMain(p, "land").uEye, eye);
    assert.equal(p.el("station").value, "400");
  }
});

test("both dialogs pause a tour across long frame gaps and Escape works from a focused study slider", () => {
  const p = mount({ no2d: true }); frame(p);
  p.click("tour"); frame(p, 500);
  for (const dialog of ["observatory", "guide"]) {
    const position = lastMain(p, "land").uEye;
    p.click(dialog === "guide" ? "guide-open" : "study-open");
    if (dialog === "observatory") {
      p.key("keydown", "KeyF", "f"); p.key("keydown", "Slash", "?");
      assert.ok(!p.el("guide").open);
      p.el("skyline-bearing").focus();
    }
    frame(p, 4000); closeVector(lastMain(p, "land").uEye, position);
    p.key("keydown", "Escape", "Escape");
    assert.ok(!p.el(dialog).open);
    frame(p, 8000); closeVector(lastMain(p, "land").uEye, position);
    assert.equal(p.el("viewer").dataset.mode, "tour");
    frame(p, 100); assert.notDeepEqual(lastMain(p, "land").uEye, position);
  }
});

test("an entirely shaded station keeps a usable clock and disables both sunlight jumps", () => {
  const p = mount({ no2d: true });
  p.window.FieldAtlas.terrain.buildGrid = () => T.buildGrid({ number: 3, heightAt: (x, z) => z === 66 ? 160 : 0 }, 8);
  frame(p); p.click("study-open");
  assert.equal(p.el("sun-duration").textContent, "0h 0m · 0 windows");
  assert.equal(p.el("sun-windows").getAttribute("d"), "");
  assert.ok(p.el("first-sun").disabled && p.el("last-sun").disabled);
  input(p, "sun-minute", 720); p.click("first-sun"); p.click("last-sun"); frame(p);
  assert.equal(p.el("sun-reading").textContent, "12:00 · Behind terrain");
  assert.equal(p.el("skyline-sun").dataset.shaded, "true");
});

test("shadow fallback, context loss, a pending seed and missing WebGL leave the observatory controls consistent", () => {
  const p = mount({ shadows: false, no2d: true }); frame(p);
  assert.ok(p.el("shadows").disabled && !p.el("shadows-unavailable").hidden);
  assert.equal(p.el("shadows").getAttribute("aria-checked"), "false");
  p.click("study-open"); assert.ok(p.el("observatory").open);
  p.el("world").emit("webglcontextlost");
  assert.ok(!p.el("observatory").open && p.el("study-open").disabled);
  p.gl = new CommandGL();
  p.el("world").emit("webglcontextrestored"); frame(p);
  assert.ok(!p.el("shadows").disabled && p.el("shadows-unavailable").hidden);
  assert.equal(p.el("shadows").getAttribute("aria-checked"), "true");
  assert.ok(p.gl.draws.some(d => d.pass === "shadow"));
  p.click("shadows"); frame(p);
  assert.equal(lastMain(p, "land").uShade[0], 0);
  p.el("seed").value = "Kowloon-Study-Break";
  p.el("seed-form").emit("submit"); p.click("study-open"); assert.ok(!p.el("observatory").open);
  frame(p); p.click("study-open");
  assert.ok(p.el("study-place").textContent.endsWith("Kowloon-Study-Break"));
  assert.equal(p.el("first-sun").textContent, "First sun 07:38"); assert.equal(p.el("last-sun").textContent, "Last sun 16:27");
  assert.equal(lastMain(p, "water").uShade[0], 0);
  const off = mount({ webgl: false }); off.click("study-open");
  assert.ok(off.el("study-open").disabled && off.el("shadows").disabled && !off.el("observatory").open);
  assert.match(off.el("error-detail").textContent, /WebGL is unavailable/);
});
