"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage } = require("./support/page");
const m = require("../js/math");
const field = require("../js/field");

function pointer(canvas, type, x, y, id = 1) {
  canvas.fire("pointer" + type, { pointerId: id, button: 0, clientX: x, clientY: y });
}
function tap(canvas, x, y) {
  pointer(canvas, "down", x, y);
  pointer(canvas, "up", x, y);
}

test("switching imagery routes the real entry to radar and preserves camera, clock and optical layer choices", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.step();
  const start = p.last();
  p.data("layer", "clouds").click(); p.data("imagery", "radar").click();
  p.gl.draws.length = 0; p.step();
  assert.deepEqual(p.gl.draws.map(d => d.name), ["radar"]);
  assert.equal(p.last().imagery, "radar");
  assert.equal(p.last().time, start.time); assert.deepEqual(p.last().back, start.back);
  assert.equal(p.get("radar-key").hidden, false);
  for (const [i, band] of field.BANDS.entries()) {
    const swatch = p.data("band", String(i));
    assert.equal(swatch.textContent, String(band.rate)); assert.equal(swatch.style["--echo"], band.color);
  }
  assert.equal(p.data("layer", "rain").disabled, true);
  p.data("layer", "rain").click(); assert.equal(p.data("layer", "rain").checked, true);
  p.data("layer", "grid").click(); p.step();
  assert.equal(p.gl.draws.at(-1).uniforms.uGrid, 0); assert.equal(p.get("radar-rings").hidden, true);
  p.key("v", { repeat: true }); assert.equal(p.data("imagery", "radar").getAttribute("aria-pressed"), "true");
  p.key("v"); p.gl.draws.length = 0; p.step();
  assert.deepEqual(p.gl.draws.map(d => d.name), ["sea", "rain"]);
  assert.equal(p.get("radar-key").hidden, true);
  assert.equal(p.data("layer", "clouds").disabled, false);
  assert.deepEqual(p.last().layers, { clouds: false, rain: true, grid: false });
  assert.equal(p.frames.size, 0);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("a tap samples the world position under the cursor after a page offset and a close tap leaves the camera steady", () => {
  const p = createPage({ reducedMotion: true }), canvas = p.get("storm-canvas");
  const width = 900, height = 420, left = 73, top = 180;
  p.get("stage").getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
  p.get("probe-toggle").click(); p.step();
  assert.match(p.get("probe-location").textContent, /^Eyewall/);
  const start = p.last(), view = m.cameraFrame(m.makeCamera(), width / height);
  const point = { x: 3.2, z: -2.4 }, pixel = m.project(view.vp, [point.x, 0, point.z], width, height);
  const x = left + pixel.x, y = top + pixel.y;
  pointer(canvas, "down", x - 1, y + 2); pointer(canvas, "move", x, y); pointer(canvas, "up", x, y);
  p.step();
  const sample = field.sample(start, point);
  assert.equal(p.get("probe-rain").textContent, sample.rain.toFixed(1));
  assert.equal(p.get("probe-wind").textContent, sample.wind.toFixed(0));
  assert.equal(p.get("probe-pressure").textContent, sample.pressure.toFixed(0));
  assert.match(p.get("probe-location").textContent, /40\.0 km · 053°/);
  assert.equal(p.get("probe-marker").style.transform, "translate(" + pixel.x.toFixed(2) + "px," + pixel.y.toFixed(2) + "px)");
  assert.deepEqual(p.last().back, start.back);
  const prior = p.get("probe-location").textContent;
  tap(canvas, left + 5, top + 5); p.step();
  assert.equal(p.get("probe-location").textContent, prior);
  assert.match(p.get("probe-hint").textContent, /within 120 km/);
  tap(canvas, left + width / 2, top + height / 2); p.step();
  assert.equal(p.get("probe-location").textContent, "Eye · 0.0 km");
  assert.equal(p.get("probe-rain").textContent, "0.0");
  assert.equal(p.get("eye-marker").style.opacity, "0");
  assert.equal(p.get("probe-marker").hidden, false);
  assert.match(p.get("probe-hint").textContent, /Tap the sea/);
});

test("probe presets and keyboard movement work while paused and stay within the instrument range", () => {
  const p = createPage({ reducedMotion: true }), canvas = p.get("storm-canvas");
  p.key("p"); p.step();
  p.data("probe", "band").click(); assert.match(p.get("probe-location").textContent, /^Rainband/);
  p.data("probe", "eye").click(); canvas.focus();
  p.key("ArrowUp", { target: canvas, shiftKey: true });
  assert.match(p.get("probe-location").textContent, /5\.0 km · 000°/);
  for (let i = 0; i < 36; i++) p.key("ArrowUp", { target: canvas, shiftKey: true });
  assert.match(p.get("probe-location").textContent, /120\.0 km · 000°/);
  assert.equal(p.get("signal").value, "5");
  assert.equal(p.key("ArrowLeft", { target: p.get("signal"), shiftKey: true }).defaultPrevented, false);
  p.key("ArrowUp", { target: canvas }); p.step();
  assert.equal(p.get("signal").value, "6"); assert.equal(p.last().time, 0);
  p.data("probe", "eye").click();
  p.key("p", { target: p.doc.activeElement }); p.step();
  assert.equal(p.doc.activeElement, p.get("probe-toggle"));
  assert.equal(p.get("probe-tray").hidden, true); assert.equal(p.get("probe-marker").hidden, true);
  assert.equal(p.get("eye-marker").style.opacity, "1");
  p.key("p"); p.step(); assert.equal(p.get("probe-location").textContent, "Eye · 0.0 km");
  assert.equal(p.frames.size, 0);
});

test("drag, pinch, pointer cancellation and focus loss leave a placed probe fixed", () => {
  const p = createPage({ reducedMotion: true }), c = p.get("storm-canvas");
  p.key("p"); p.data("probe", "band").click(); p.step();
  const location = p.get("probe-location").textContent, before = p.last();
  pointer(c, "down", 450, 200); pointer(c, "move", 480, 210);
  pointer(c, "move", 450, 201); pointer(c, "up", 450, 201);
  p.run(100); assert.notDeepEqual(p.last().back, before.back);
  pointer(c, "down", 450, 200); pointer(c, "down", 480, 200, 2);
  pointer(c, "move", 510, 200, 2); pointer(c, "up", 510, 200, 2); pointer(c, "up", 450, 200);
  p.run(110); assert.ok(p.last().distance < before.distance);
  pointer(c, "down", 450, 200); pointer(c, "cancel", 450, 200); pointer(c, "up", 450, 200);
  pointer(c, "down", 450, 200); p.win.fire("blur"); pointer(c, "up", 450, 200);
  assert.equal(p.get("probe-location").textContent, location);
});

test("new shortcuts respect the help dialog and repeated key events", () => {
  const p = createPage();
  p.key("?"); p.key("?", { repeat: true }); assert.equal(p.get("help-dialog").open, true);
  p.key("p"); p.key("v"); p.key("Escape");
  assert.equal(p.get("probe-toggle").getAttribute("aria-pressed"), "false");
  assert.equal(p.data("imagery", "cloud").getAttribute("aria-pressed"), "true");
  p.key("p"); p.key("p", { repeat: true });
  assert.equal(p.get("probe-toggle").getAttribute("aria-pressed"), "true");
});
