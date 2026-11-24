"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../js/math");
const field = require("../js/field");
const relief = require("../js/relief");
const { createPage } = require("./support/page");

test("comparison clears and draws disjoint pixel columns with a single projection, including both ends", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  const stage = p.get("stage"); stage.clientWidth = 715; stage.clientHeight = 410;
  p.win.devicePixelRatio = 1.4; p.win.fire("resize"); p.step();
  const gl = p.gl, canvas = p.get("storm-canvas");
  assert.equal(canvas.width, 1001);
  p.get("compare-toggle").click(); p.step();
  assert.equal(p.last().imagery, "radar"); assert.equal(p.last().comparing, true);
  assert.equal(p.get("compare-divider").hidden, false); assert.equal(p.get("cloud-markers").hidden, false);
  assert.equal(p.get("compare-map-name").textContent, "Rain rate");
  p.key("i"); p.key("x"); p.step();
  const allocations = gl.resources.length, uploads = gl.uploads;
  for (const percent of [37, 1, 99, 100, 0, 50]) {
    gl.draws.length = 0; gl.clears.length = 0;
    p.input("compare-position", percent); p.step();
    const left = Math.round(1001 * percent / 100), h = canvas.height;
    const optical = ["sea", "rain", "deck", "cloud"];
    assert.deepEqual(gl.draws.map(d => d.name), [...(left ? optical : []), ...(left < 1001 ? ["pressure"] : [])]);
    const clears = [];
    if (left) clears.push({ mask: gl.COLOR_BUFFER_BIT, scissor: [0, 0, left, h] });
    if (left < 1001) clears.push({ mask: gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, scissor: [left, 0, 1001 - left, h] });
    assert.deepEqual(gl.clears, clears);
    for (const draw of gl.draws) {
      const pressure = draw.name === "pressure";
      assert.deepEqual(draw.scissor, pressure ? [left, 0, 1001 - left, h] : [0, 0, left, h]);
      assert.equal(draw.depthTest, pressure);
      assert.deepEqual(draw.uniforms.uVP, gl.draws[0].uniforms.uVP);
    }
    assert.equal(gl.capabilities.has(gl.SCISSOR_TEST), false);
    assert.equal(stage.style["--split"], percent + "%");
    assert.match(p.get("compare-position").getAttribute("aria-valuetext"), new RegExp("^" + percent + "% clouds"));
    assert.equal(p.last().time, 0); assert.equal(p.frames.size, 0);
    assert.equal(gl.resources.length, allocations); assert.equal(gl.uploads, uploads);
  }
  p.data("layer", "rain").click(); p.data("imagery", "wind").click(); gl.draws.length = 0; p.step();
  assert.deepEqual(gl.draws.map(d => d.name), ["sea", "deck", "cloud", "wind"]);
  assert.deepEqual(gl.draws[0].uniforms.uTransect, gl.draws[3].uniforms.uTransect);
  p.get("compare-position").focus(); p.key("c", { target: p.doc.activeElement });
  gl.draws.length = 0; p.step(); assert.deepEqual(gl.draws.map(d => d.name), ["wind"]);
  assert.equal(p.doc.activeElement, p.get("compare-toggle")); assert.equal(gl.draws[0].scissor, null);
  assert.equal(p.get("cloud-markers").hidden, true); assert.equal(p.data("layer", "rain").disabled, true);
  p.key("c"); p.data("imagery", "cloud").click(); gl.draws.length = 0; p.step();
  assert.equal(p.get("compare-divider").hidden, true); assert.equal(p.last().comparing, false);
  assert.deepEqual(gl.draws.map(d => d.name), ["sea", "deck", "cloud"]);
  assert.ok(gl.draws.every(d => d.scissor === null));
  p.win.fire("pagehide", { persisted: false }); assert.ok(gl.resources.every(r => r.deleted));
});

test("moving the divider across a tap selects sea or visible relief, with that surface's own probe marker", () => {
  const p = createPage({ reducedMotion: true }), stage = p.get("stage"), c = p.get("storm-canvas");
  const width = 900, height = 420, left = 47, top = 113;
  stage.getBoundingClientRect = () => ({ width, height, left, top });
  p.data("stage", "2").click(); p.key("i"); p.key("c"); p.key("p"); p.step();
  const view = math.cameraFrame(math.makeCamera(), width / height);
  const pose = p.last(), model = relief.surface(pose);
  const x = width / 2, y = height / 2;
  const flat = math.seaPoint(view, x, y, width, height), terrain = relief.pick(model, view, x, y, width, height);
  assert.ok(Math.hypot(flat.x - terrain.x, flat.z - terrain.z) > 1);
  const transform = (point, altitude) => {
    const pixel = math.project(view.vp, [point.x, altitude, point.z], width, height);
    return "translate(" + pixel.x.toFixed(2) + "px," + pixel.y.toFixed(2) + "px)";
  };
  for (const [percent, point] of [[75, flat], [25, terrain], [100, flat], [0, terrain], [50, terrain]]) {
    p.input("compare-position", percent); p.step();
    const event = { button: 0, pointerId: 5, clientX: x + left, clientY: y + top };
    c.fire("pointerdown", event); c.fire("pointerup", event); p.step();
    const local = field.sample(pose, point);
    assert.equal(p.get("probe-pressure").textContent, local.pressure.toFixed(0));
    assert.equal(p.get("probe-rain").textContent, local.rain.toFixed(1));
    assert.equal(p.get("cloud-probe").style.transform, transform(point, 0));
    assert.equal(p.get("probe-marker").style.transform, transform(point, relief.height(model, point.x, point.z)));
    assert.equal(p.get("probe-marker").hidden, false); assert.equal(p.get("cloud-probe").hidden, false);
  }
  p.data("probe", "wall").click(); p.data("layer", "clouds").click(); p.step();
  assert.equal(p.get("cloud-eye").style.opacity, "0"); assert.equal(p.get("eye-marker").style.opacity, "1");
  p.key("p"); p.step(); assert.equal(p.get("cloud-probe").hidden, true); assert.equal(p.get("probe-marker").hidden, true);
});

test("comparison survives a graphics interruption, and two views share a single playback clock", async () => {
  const p = createPage({ actualGraphics: true, fullscreen: "native", reducedMotion: true });
  const canvas = p.get("storm-canvas");
  p.key("b"); p.key("c"); p.key("c", { repeat: true }); p.data("site", "pier").click();
  p.input("compare-position", 67); p.input("light-time", 1110); p.data("speed", "2").click();
  await p.get("expand").click().done; p.input("viewport-signal", 9); p.key(" "); p.step(); p.step(30);
  const before = p.last(); assert.ok(Math.abs(before.time - 0.06) < 1e-10);
  assert.equal(before.imagery, "doppler"); assert.equal(before.comparing, true);
  p.get("compare-position").focus();
  canvas.fire("webglcontextlost"); p.step(90000);
  assert.equal(p.frames.size, 0); assert.equal(p.get("compare-divider").hidden, true);
  assert.equal(p.get("doppler-key").hidden, true); assert.equal(p.get("light-time").disabled, true);
  assert.equal(p.doc.activeElement, canvas); assert.ok(p.gl.resources.every(r => r.deleted));
  canvas.fire("webglcontextrestored"); p.step(90000);
  assert.deepEqual(p.last(), before); assert.equal(p.get("compare-position").value, "67");
  assert.equal(p.get("compare-divider").hidden, false); assert.equal(p.get("doppler-key").hidden, false);
  assert.equal(p.get("light-time").value, "1110"); assert.deepEqual(p.gl.draws.at(-1).uniforms.uSite, [4, 5.5]);
  p.step(50); assert.ok(Math.abs(p.last().time - 0.16) < 1e-10);
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("the divider keeps native range keys and the graphics fallback and help dialog isolate imagery controls", () => {
  const p = createPage({ reducedMotion: true });
  p.key("c"); const input = p.get("compare-position");
  for (const key of ["ArrowUp", "ArrowLeft", "Home", "End"]) assert.equal(p.key(key, { target: input }).defaultPrevented, false);
  assert.equal(p.get("signal").value, "5");
  p.key("?"); p.key("b"); p.key("c"); p.key("Escape"); p.step();
  assert.ok(p.last().comparing); assert.equal(p.last().imagery, "radar");
  const offline = createPage({ noWebGL: true });
  offline.key("c"); offline.key("b");
  assert.equal(offline.get("compare-toggle").disabled, true); assert.equal(offline.get("compare-divider").hidden, true);
  assert.equal(offline.get("light-time").disabled, true); assert.equal(offline.get("doppler-key").hidden, true);
  assert.equal(offline.frames.size, 0); assert.equal(offline.get("graphics-message").hidden, false);
});
