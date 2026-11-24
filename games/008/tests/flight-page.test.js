"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("./support/page");
const { CommandGL } = require("./support/gl");
const T = require("../js/terrain");
const S = require("../js/simulation");
const P = require("../js/probe");
const M = require("../js/math");
const Q = require("../js/survey");
const R = require("../js/relay");
const art = require("../js/cartography");

function frame(page, count = 1, ms = 1000 / 60) {
  page.advance(count, ms);
  assert.ok(page.el("scene-error").hidden, page.el("error-detail").textContent);
  assert.equal(page.frameCount(), 1);
}
function plot(page, ...points) {
  page.click("plot-route");
  assert.ok(page.el("relay-start").disabled);
  const map = page.el("survey"), rect = map.getBoundingClientRect();
  const frame = art.mapFrame(rect.width, rect.height, null, true);
  for (const [x, z] of points) {
    const [px, py] = art.mapPoint(frame, x, z);
    map.emit("click", { clientX: rect.left + px, clientY: rect.top + py });
  }
  assert.equal(page.el("route-name").textContent, "Plotted transect");
}
function aim(page, yawDelta, pitchDelta) {
  const canvas = page.el("world");
  page.pointer(canvas, "pointerdown", 2, 100, 100);
  page.pointer(canvas, "pointermove", 2, 100 + yawDelta / 0.004, 100 - pitchDelta / 0.004);
  page.pointer(canvas, "pointerup", 2, 100, 100);
  frame(page, 32, 100);
}
const mainGround = page => page.gl.draws.findLast(d => !d.reflected && d.kind === "land" && d.uniforms.uKind === 0);

test("the illustrated caldera preset, custom crossing, profile, clock and relaunch all work from index.html", () => {
  const p = mount(); frame(p);
  const option = p.document.querySelectorAll("[data-preset]").find(b => b.dataset.preset === "caldera");
  assert.ok(option.querySelector("canvas").ink.fills > 50);
  p.el("seed").value = "Last-Minibus"; option.emit("click"); frame(p);
  const world = T.createWorld("Last-Minibus", "caldera"), grid = T.buildGrid(world);
  const route = Q.buildRoute(grid, Q.inletPath(world)), course = R.buildCourse(grid, route);
  assert.equal(p.el("place-name").textContent, "Lantern Caldera");
  assert.equal(option.getAttribute("aria-pressed"), "true");
  assert.equal(p.el("route-name").textContent, "Crater crossing");
  assert.equal(p.el("route-length").textContent, Math.round(route.length) + " m");
  assert.equal(p.el("route-wet").textContent, Math.round(route.submerged) + " m");
  p.el("hour").value = "1090"; p.el("hour").emit("input");
  p.click("relay-start"); frame(p);
  assert.deepEqual(mainGround(p).uniforms.uEye, course.launch.position);
  assert.equal(p.el("clock").textContent, "18:10");
  assert.equal(p.el("relay-gate").textContent, "Gate 1 of " + course.gates.length);
  p.click("relay-end");
  plot(p, [-12, 48], [-12, -16]); p.click("restore-route"); frame(p);
  assert.equal(p.el("route-name").textContent, "Crater crossing");
  assert.equal(p.el("route-length").textContent, Math.round(route.length) + " m");
  p.click("dice"); frame(p); assert.match(p.el("seed").value, /^LC-\d{6}$/);
});

test("the crosshair sounds water, follows a raised lake, reads the exposed bed and clears a sky miss", () => {
  const p = mount(); frame(p);
  p.click("fly"); p.click("probe");
  const world = T.createWorld(), grid = T.buildGrid(world), start = S.homeCamera(world.style);
  const target = [world.riverCenter(55), 0, 55], delta = M.subtract(target, start.position);
  const yaw = Math.atan2(delta[0], -delta[2]), pitch = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
  const ray = M.direction(yaw, pitch);
  const ink = p.el("survey").ink, diamonds = [];
  let pathStart;
  ink.moveTo = (x, y) => { pathStart = [x, y]; };
  const stroke = ink.stroke.bind(ink);
  ink.stroke = () => { if (ink.strokeStyle === "#ffedbd") diamonds.push(pathStart); stroke(); };
  const allocations = p.gl.buffers.length;
  aim(p, yaw - start.yaw, pitch - start.pitch);
  assert.equal(p.el("probe").getAttribute("aria-pressed"), "true"); assert.ok(!p.el("probe-reading").hidden);
  assert.equal(p.el("probe-surface").textContent, "Water · " + (-grid.surfaceAt(target[0], target[2])).toFixed(1) + " m deep");
  const map = p.el("survey"), mapFrame = art.mapFrame(map.width, map.height, start.position, false);
  const [x, z] = art.mapPoint(mapFrame, target[0], target[2]);
  const r = Math.max(4, Math.min(map.width, map.height) * 0.029) * 1.12;
  // Map motion is quantised to 1/8 m to avoid repainting for subpixel drift.
  assert.ok(diamonds.some(([px, py]) => Math.hypot(px - x, py - z + r) <= mapFrame.unit * Math.SQRT2 / 8));
  p.el("lake-level").value = "8"; p.el("lake-level").emit("input"); frame(p);
  const lake = P.cast(grid, start.position, ray, 8);
  assert.equal(p.el("probe-surface").textContent, "Water · " + lake.depth.toFixed(1) + " m deep");
  p.click("water"); frame(p, 1, 100);
  const bed = P.cast(grid, start.position, ray);
  assert.equal(p.el("probe-surface").textContent, "Ground · " + bed.bed.toFixed(1) + " m");
  assert.match(p.el("probe-detail").textContent, /Slope \d+° \w+ · \d+ m range/);
  assert.equal(mainGround(p).uniforms.uProbe, 1);
  aim(p, 0, 1.35 - pitch);
  assert.equal(p.el("probe-surface").textContent, "Beyond the survey");
  const images = map.ink.images;
  p.click("probe"); frame(p); assert.ok(p.el("probe-reading").hidden);
  assert.equal(mainGround(p).uniforms.uProbe, 0);
  assert.equal(p.gl.buffers.length, allocations); assert.equal(map.ink.images, images);
});

test("manual flight completes an ordered two-gate relay, times splits, and retains the faster retry", () => {
  const p = mount({ dpr: 2 }); frame(p);
  plot(p, [0, 60], [0, -15]);
  const station = p.el("station");
  station.value = "350"; station.emit("input");
  const initialBuffers = p.gl.buffers.length;
  p.click("relay-start"); frame(p);
  assert.equal(p.el("viewer").dataset.mode, "fly");
  assert.equal(p.document.activeElement, p.el("world"));
  assert.ok(!p.el("relay-hud").hidden); assert.equal(p.el("relay-gate").textContent, "Gate 1 of 2");
  assert.equal(p.el("relay-split").textContent, "Move to start");
  frame(p, 2, 1200); assert.equal(p.el("relay-clock").textContent, "0:00.0");
  const buffer = p.gl.buffers.at(-1);
  p.key("keydown", "KeyW"); frame(p, 20, 100);
  assert.equal(p.el("relay-gate").textContent, "Gate 2 of 2");
  assert.match(p.el("relay-split").textContent, /^Split 0:01\.6/);
  const checkpoint = p.gl.draws.findLast(d => d.kind === "gate" && !d.reflected);
  assert.equal(checkpoint.uniforms.uNext, 1);
  assert.equal(p.gl.buffers.length, initialBuffers + 1);
  frame(p, 17, 100); p.key("keyup", "KeyW");
  assert.equal(p.el("relay-gate").textContent, "Relay complete");
  assert.equal(p.el("relay-clock").textContent, "0:03.0");
  assert.match(p.el("relay-record").textContent, /Course best 0:03\.0 · 2 gates/);
  assert.ok(!p.el("relay-again").hidden && buffer.deleted);
  assert.equal(station.value, "350");
  p.click("relay-again"); frame(p);
  p.key("keydown", "ShiftLeft"); p.key("keydown", "KeyW"); frame(p, 20, 100);
  p.key("keyup", "KeyW"); p.key("keyup", "ShiftLeft");
  assert.equal(p.el("relay-clock").textContent, "0:01.3");
  assert.match(p.el("relay-split").textContent, /−1\.8 s/);
  const record = p.el("relay-record").textContent;
  p.click("relay-again"); frame(p);
  p.key("keydown", "KeyW"); frame(p, 40, 100); p.key("keyup", "KeyW");
  assert.equal(p.el("relay-record").textContent, record);
  assert.match(p.el("relay-guidance").textContent, /Course best 0:01\.3/);
  p.click("relay-end"); assert.ok(p.el("relay-hud").hidden); assert.equal(p.document.activeElement, p.el("world"));
  p.click("restore-route"); frame(p); assert.doesNotMatch(p.el("relay-record").textContent, /Course best/);
});

test("guide, focus, visibility and graphics recovery preserve an active relay without charging paused time", () => {
  const p = mount({ touch: true }); frame(p);
  plot(p, [-10, 60], [-10, -15]); p.click("relay-start"); p.click("probe"); frame(p);
  const forward = p.el("touch-flight").querySelectorAll("[data-key]").find(b => b.dataset.key === "KeyW");
  p.pointer(forward, "pointerdown", 8, 10, 10); frame(p, 8, 100);
  const time = p.el("relay-clock").textContent, pose = mainGround(p).uniforms.uEye;
  assert.equal(time, "0:00.8");
  p.click("guide-open"); frame(p, 3, 1000); p.click("guide-close"); frame(p, 1, 8000);
  assert.equal(p.el("relay-clock").textContent, time); assert.deepEqual(mainGround(p).uniforms.uEye, pose);
  p.window.emit("blur"); frame(p, 2, 3000); p.window.emit("focus"); frame(p, 1, 6000);
  assert.equal(p.el("relay-clock").textContent, time);
  p.document.hidden = true; p.document.emit("visibilitychange"); p.advance(1, 10000);
  p.document.hidden = false; p.document.emit("visibilitychange"); frame(p);
  assert.equal(p.el("relay-clock").textContent, time);
  p.el("world").emit("webglcontextlost"); assert.ok(p.el("relay-start").disabled && p.el("probe").disabled);
  assert.ok(p.el("relay-hud").hidden && p.el("probe-reading").hidden);
  assert.ok(p.gl.buffers.every(b => b.deleted));
  p.gl = new CommandGL({ highp: false }); p.el("world").emit("webglcontextrestored"); frame(p, 1, 30000);
  assert.equal(p.el("relay-clock").textContent, time); assert.deepEqual(mainGround(p).uniforms.uEye, pose);
  assert.ok(!p.el("relay-hud").hidden && !p.el("probe-reading").hidden);
  assert.deepEqual(p.gl.draws.filter(d => d.kind === "gate").map(d => d.reflected), [true, false]);
  p.el("lake-level").value = "5"; p.el("lake-level").emit("input"); p.gl.draws.length = 0; frame(p);
  assert.ok(p.el("relay-hud").hidden && !p.el("relay-start").disabled);
  assert.ok(p.gl.draws.every(d => d.kind !== "gate"));
  p.click("relay-start"); frame(p); assert.equal(mainGround(p).uniforms.uEye[1], 21);
  p.click("tour"); frame(p); assert.ok(p.el("relay-hud").hidden && !p.el("tour-play").hidden);
});

test("the relay and probe work without a map canvas and disable cleanly when WebGL is unavailable", () => {
  const p = mount({ no2d: true }); frame(p);
  p.click("probe"); p.click("relay-start"); frame(p);
  assert.ok(p.el("plot-route").disabled && !p.el("relay-hud").hidden);
  assert.ok(p.gl.draws.some(d => d.kind === "gate"));
  assert.ok(p.el("probe-surface").textContent);
  p.key("keydown", "KeyR", "r"); frame(p); assert.equal(p.el("viewer").dataset.mode, "orbit");
  assert.ok(p.el("relay-hud").hidden);
  const off = mount({ webgl: false });
  assert.ok(off.el("probe").disabled && off.el("relay-start").disabled);
  off.click("relay-start"); off.click("probe");
  assert.ok(off.el("relay-hud").hidden && off.el("probe-reading").hidden);
  assert.match(off.el("error-detail").textContent, /WebGL is unavailable/);
  off.click("guide-open"); assert.ok(off.el("guide").open);
});

test("a requested relay launches once on the latest pending preset and lake level", () => {
  const p = mount(); frame(p);
  p.el("lake-level").value = "8"; p.el("lake-level").emit("input");
  p.document.querySelectorAll("[data-preset]").find(b => b.dataset.preset === "caldera").emit("click");
  p.click("relay-start"); p.click("relay-start"); frame(p);
  const w = T.createWorld(T.DEFAULT_SEED, "caldera"), grid = T.buildGrid(w);
  const course = R.buildCourse(grid, Q.buildRoute(grid, Q.inletPath(w), 8));
  assert.equal(p.el("viewer").dataset.mode, "fly"); assert.equal(p.el("place-name").textContent, "Lantern Caldera");
  assert.deepEqual(mainGround(p).uniforms.uEye, course.launch.position);
  assert.equal(p.gl.draws.filter(d => d.kind === "gate").length, 2);
  assert.equal(p.el("relay-clock").textContent, "0:00.0");
  p.click("relay-start"); p.click("orbit"); frame(p);
  assert.ok(p.el("relay-hud").hidden); assert.equal(p.el("viewer").dataset.mode, "orbit");
});
