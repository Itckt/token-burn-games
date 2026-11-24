"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const notebook = require("../js/notebook");
const storm = require("../js/storm");
const cycle = require("../js/lifecycle");
const field = require("../js/field");
const { TAU } = require("../js/math");
const { createPage } = require("./support/page");

function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null,
    setItem(key, value) { items.set(key, value); }, removeItem(key) { items.delete(key); } };
}

function checkPose(actual, expected) {
  for (const k of ["signal", "time", "strength", "phase", "rainTravel"]) assert.equal(actual[k], expected[k], k);
}

test("captures preserve fractional manual strength and reconstruct a life-cycle instant from time", () => {
  const s = storm.makeState(), point = { x: 1.2, z: -4.3 };
  storm.setSignal(s, 10); storm.advance(s, 0.11);
  const before = { ...s };
  const manual = notebook.decode(JSON.stringify(notebook.capture(s, point, false)));
  storm.advance(s, 2); point.x = 8;
  checkPose(notebook.pose(manual), before);
  assert.notEqual(manual.strength, storm.normalized(manual.signal));
  assert.equal(manual.x, 1.2);
  for (const time of [0, 16, 30.45, 34, 42, 60]) {
    const instant = cycle.at(time), record = notebook.capture(instant, point, true);
    assert.deepEqual(notebook.pose(notebook.decode(JSON.stringify(record))), instant);
    assert.equal(record.strength, undefined);
  }
});

test("unknown versions, damaged times, fields and out-of-range stations are ignored individually", () => {
  const original = notebook.capture(storm.makeState(), { x: -12, z: 0 }, false);
  for (const edit of [{ version: 2 }, { mode: "automatic" }, { mode: "cycle", time: 60.01 }, { time: -1 },
    { time: null }, { time: 1e25 }, { signal: "5" }, { signal: 1.2 }, { signal: 11 }, { strength: 1.2 },
    { phase: TAU }, { phase: -0.1 }, { rainTravel: null }, { x: "0" }, { z: 0.1 }]) {
    assert.equal(notebook.decode(JSON.stringify({ ...original, ...edit })), null);
  }
  for (const raw of [null, "", "}", "[]", "null", "1", "{}"]) assert.equal(notebook.decode(raw), null);
  assert.deepEqual(notebook.decode(JSON.stringify({ ...original, extra: "ignored" })), original);
  const storage = memoryStorage(), book = notebook.open(storage);
  storage.setItem("course", "Kowloon Tong practical");
  book.write("A", original); book.write("B", original);
  const aKey = [...storage.items.keys()].find(key => key.endsWith(".A"));
  storage.setItem(aKey, "{");
  const next = notebook.open(storage);
  assert.equal(next.entries.A, null); assert.deepEqual(next.entries.B, original);
  next.write("B", null); assert.equal(storage.getItem(aKey), "{");
  assert.equal(storage.getItem("course"), "Kowloon Tong practical");
  assert.throws(() => next.write("C", original), RangeError);
});

test("differences use the displayed precision with signed decreases, increases and an unsigned zero", () => {
  assert.equal(notebook.difference(29.96, 30.26, 1), "+0.3");
  assert.equal(notebook.difference(970.40, 969.51, 0), "0");
  assert.equal(notebook.difference(60, 23.12, 1), "−36.9");
  assert.equal(notebook.difference(0.01, 0.00, 1), "0.0");
});

test("capture, compare and inspect restore the exact sampled storm, point and timeline mode", () => {
  const storage = memoryStorage(), p = createPage({ storage });
  p.run(4);
  assert.equal(p.get("notebook-sheet").hidden, true);
  p.get("signal").value = "9"; p.get("signal").fire("input"); p.step(20);
  const before = p.last(), a = field.sample(before, { x: 0, z: 0 });
  p.data("capture", "A").click();
  assert.equal(p.get("notebook-sheet").hidden, false); assert.match(p.get("site-A").textContent, /Eye · 0\.0 km/);
  assert.equal(p.get("record-A").hidden, false); assert.equal(p.get("record-B").hidden, true);
  assert.equal(p.get("wind-diff").textContent, "—");
  p.get("cycle-time").value = "32.4"; p.get("cycle-time").fire("input");
  p.key("p"); p.data("probe", "wall").click(); p.key("g"); p.key("x"); p.step();
  const other = p.last(), b = field.sample(other, field.preset("wall", other));
  p.data("capture", "B").click();
  for (const [metric, { digits }] of Object.entries(field.METRICS)) {
    assert.equal(p.get(metric + "-A").textContent, a[metric].toFixed(digits));
    assert.equal(p.get(metric + "-B").textContent, b[metric].toFixed(digits));
    assert.equal(p.get(metric + "-diff").textContent, notebook.difference(a[metric], b[metric], digits));
  }
  p.data("recall", "A").click(); p.step(100000);
  checkPose(p.last(), before);
  assert.equal(p.get("cycle-stage").textContent, "Manual control");
  assert.equal(p.get("probe-location").textContent, "Eye · 0.0 km");
  assert.equal(p.get("probe-wind").textContent, p.get("wind-A").textContent);
  assert.equal(p.get("signal").value, "9"); assert.equal(p.get("viewport-signal").value, "9");
  assert.equal(p.get("status-text").textContent, "Simulation paused");
  assert.equal(p.doc.activeElement, p.get("probe-toggle"));
  assert.equal(p.last().imagery, "wind"); assert.equal(p.last().section.enabled, true); assert.equal(p.frames.size, 0);
  p.data("recall", "B").click(); p.step(100000);
  checkPose(p.last(), other);
  assert.equal(p.get("cycle-stage").textContent, "Deepening");
  assert.match(p.get("probe-location").textContent, /^Eyewall/);
  assert.equal(p.get("probe-rain").textContent, p.get("rain-B").textContent);
  assert.equal(p.frames.size, 0);
  p.key(" "); p.step(5000); checkPose(p.last(), other);
  p.step(20); checkPose(p.last(), cycle.at(32.4 + 0.02));
  p.win.fire("pagehide", { persisted: false });
  const reload = createPage({ storage, reducedMotion: true });
  assert.equal(reload.get("rain-diff").textContent, p.get("rain-diff").textContent);
  reload.data("recall", "B").click(); reload.step(); checkPose(reload.last(), other);
  reload.data("clear", "A").click();
  assert.equal(reload.doc.activeElement, reload.data("capture", "A"));
  assert.equal(reload.get("site-A").textContent, "—"); assert.equal(reload.get("rain-diff").textContent, "—");
  assert.equal(reload.get("record-B").hidden, false);
  reload.data("clear", "B").click();
  assert.equal(reload.get("notebook-sheet").hidden, true); assert.equal(storage.items.size, 0);
});

test("capturing again replaces only that slot and closing a previously placed probe samples the eye", () => {
  const p = createPage({ reducedMotion: true, storage: memoryStorage() });
  p.key("p"); p.data("probe", "wall").click(); p.data("capture", "A").click();
  p.data("probe", "band").click(); p.data("capture", "B").click();
  const site = p.get("site-B").textContent, rain = p.get("rain-B").textContent;
  p.key("p"); p.data("capture", "A").click();
  assert.match(p.get("site-A").textContent, /^Eye · 0\.0 km/);
  assert.equal(p.get("rain-A").textContent, "0.0");
  assert.equal(p.get("site-B").textContent, site); assert.equal(p.get("rain-B").textContent, rain);
});

test("denied, missing and quota-limited storage retain working in-page observations even without WebGL", () => {
  const denied = () => { throw new Error("Storage unavailable"); };
  for (const option of [{}, { storageDenied: true }, { storage: { getItem: denied, setItem: denied, removeItem: denied } }]) {
    const p = createPage({ ...option, noWebGL: true });
    p.data("stage", "2").click(); p.key("p"); p.data("probe", "wall").click();
    p.data("capture", "A").click(); assert.match(p.get("notebook-status").textContent, /for this page/);
    const rain = p.get("rain-A").textContent;
    p.data("stage", "0").click(); p.data("recall", "A").click();
    assert.equal(p.get("cycle-stage").textContent, "Peak");
    assert.equal(p.get("probe-rain").textContent, rain);
    assert.equal(p.get("status-text").textContent, "Graphics offline");
    p.data("clear", "A").click();
    assert.equal(p.get("notebook-sheet").hidden, true); assert.equal(p.frames.size, 0);
  }
});

test("inspecting a saved point during context loss restores the active cut and station on the first draw", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true, storage: memoryStorage() });
  const canvas = p.get("storm-canvas");
  p.data("stage", "2").click(); p.key("x");
  p.get("section-distance").value = "42"; p.get("section-distance").fire("input");
  p.get("section-probe").click(); p.data("capture", "A").click(); p.step();
  const before = p.last(), location = p.get("probe-location").textContent;
  canvas.fire("webglcontextlost"); p.data("stage", "0").click(); p.data("probe", "eye").click();
  p.data("recall", "A").click();
  assert.equal(p.frames.size, 0); assert.equal(p.get("section-tray").hidden, false);
  assert.equal(p.get("probe-marker").hidden, true); assert.equal(p.get("probe-location").textContent, location);
  assert.ok(p.gl.resources.every(r => r.deleted));
  canvas.fire("webglcontextrestored"); canvas.fire("webglcontextrestored"); p.step(30000);
  assert.equal(p.log.attempts, 2); assert.equal(p.get("probe-marker").hidden, false);
  assert.deepEqual(p.last(), before); assert.equal(p.frames.size, 0);
  assert.equal(p.gl.draws.at(-4).uniforms.uTransect[2], 4.2);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});
