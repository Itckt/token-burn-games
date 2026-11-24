"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("./support/page");
const { CommandGL } = require("./support/gl");
const T = require("../js/terrain");
const S = require("../js/simulation");
const H = require("../js/hydrology");
const E = require("../js/erosion");
const Q = require("../js/survey");
const art = require("../js/cartography");

const world = T.createWorld(), fresh = T.buildGrid(world);
const metres = n => Math.round(n) + " m";
function frame(p, milliseconds = 0) {
  p.advance(1, milliseconds);
  assert.equal(p.el("scene-error").hidden, true, p.el("error-detail").textContent);
  assert.equal(p.frameCount(), 1);
}
function stage(p, level) {
  p.el("lake-level").value = String(level);
  p.el("lake-level").emit("input");
}
function wear(p, name) {
  const buttons = p.document.querySelectorAll("[data-wear]");
  buttons.find(button => button.dataset.wear === name).emit("click");
  for (const button of buttons) assert.equal(button.getAttribute("aria-pressed"), String(button.dataset.wear === name));
}
function pick(p, x, z) {
  const map = p.el("survey"), r = map.getBoundingClientRect();
  const f = art.mapFrame(map.width, map.height, null, true);
  const [px, py] = art.mapPoint(f, x, z);
  map.emit("click", { clientX: r.left + px * r.width / map.width, clientY: r.top + py * r.height / map.height });
}
function assertEye(p, expected) {
  const eye = p.gl.draws.findLast(d => d.kind === "land" && !d.reflected).uniforms.uEye;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(eye[i] - expected[i]) < 1e-7, "camera axis " + i);
}
function assertFlood(p, grid, level) {
  const { area, volume } = H.inundation(grid, level);
  const percent = area * 100 / (T.HALF * 2) ** 2;
  assert.equal(p.el("flood-area").textContent, (area / 10000).toFixed(2) + " ha");
  assert.equal(p.el("flood-volume").textContent, Math.round(volume).toLocaleString("en-GB") + " m³");
  assert.ok(Math.abs(p.el("flood-cover").value - percent) < 1e-8);
  assert.equal(p.el("flood-share").textContent, percent.toFixed(1) + "% of survey");
}

test("lake scrubbing coalesces within a frame and updates the flood mask, basin, section and lake uniforms together", () => {
  const p = mount();
  frame(p);
  const map = p.el("survey").ink, floodSheet = map.sheet, contours = floodSheet.ink.sheet;
  const originalSection = p.el("profile-water").getAttribute("d"), fills = floodSheet.ink.fills;
  const allocations = [p.gl.buffers.length, p.gl.textures.length];
  assertFlood(p, fresh, 0);
  assert.ok(p.el("lake-datum").disabled);
  stage(p, -5); stage(p, 4); stage(p, 8);
  assert.equal(p.el("level-readout").textContent, "+8 m");
  assert.equal(p.el("lake-level").getAttribute("aria-valuetext"), "8 metres above datum");
  frame(p);
  assert.equal(floodSheet.ink.fills, fills + 1);
  assert.strictEqual(map.sheet, floodSheet); assert.strictEqual(floodSheet.ink.sheet, contours);
  assertFlood(p, fresh, 8); assert.equal(p.gl.draws.at(-1).uniforms.uLevel, 8);
  assert.equal(p.el("route-wet").textContent, metres(Q.buildRoute(fresh, Q.inletPath(world), 8).submerged));
  assert.notEqual(p.el("profile-water").getAttribute("d"), originalSection);
  p.click("water"); stage(p, -6); frame(p);
  assert.equal(p.gl.draws.at(-1).kind, "sky");
  assert.equal(p.el("level-readout").textContent, "−6 m");
  assertFlood(p, fresh, -6);
  p.click("water"); p.click("lake-datum"); frame(p);
  assert.equal(p.el("profile-water").getAttribute("d"), originalSection);
  assert.equal(p.gl.draws.at(-1).uniforms.uLevel, 0);
  assert.ok(p.el("lake-datum").disabled); assertFlood(p, fresh, 0);
  assert.deepEqual([p.gl.buffers.length, p.gl.textures.length], allocations);
});

test("weathering preserves a paused custom transect, distance, unsubmitted seed and time, and Fresh reproduces its profile", () => {
  const p = mount();
  frame(p);
  const points = [[-112, -142], [107, -124]], fraction = 0.561;
  p.click("plot-route"); points.forEach(xz => pick(p, ...xz));
  p.el("station").value = "561"; p.el("station").emit("input");
  p.click("tour"); frame(p); p.click("tour-play");
  p.el("hour").value = "1140"; p.el("hour").emit("input");
  p.el("seed").value = "Pending seminar notes";
  const original = p.el("profile-ridge").getAttribute("d"), uploads = p.gl.buffers.length;
  wear(p, "talus"); wear(p, "worn"); frame(p);
  assert.equal(p.gl.buffers.length, uploads + 4);
  assert.equal(p.el("seed").value, "Pending seminar notes");
  assert.equal(p.el("route-name").textContent, "Plotted transect");
  assert.equal(p.el("viewer").dataset.mode, "tour"); assert.equal(p.el("tour-play").textContent, "Resume");
  assert.equal(p.el("clock").textContent, "19:00"); assert.equal(p.el("cycle").getAttribute("aria-checked"), "false");
  assert.equal(p.el("station").value, "561");
  const worn = E.weatherGrid(fresh, "worn"), route = Q.buildRoute(worn, points);
  assertFlood(p, worn, 0);
  assert.equal(p.el("route-ascent").textContent, metres(route.ascent));
  assert.notEqual(p.el("profile-ridge").getAttribute("d"), original);
  assertEye(p, Q.flightPose(route, route.length * fraction).position);
  wear(p, "fresh"); frame(p);
  assert.equal(p.el("profile-ridge").getAttribute("d"), original);
  const allocations = p.gl.buffers.length;
  wear(p, "fresh"); frame(p); assert.equal(p.gl.buffers.length, allocations);
});

test("a picked runoff path links the measured downhill drop, animated terrain line and flyover at different stages", () => {
  const p = mount({ dpr: 2 });
  frame(p);
  const source = [75, -150], first = H.traceRunoff(fresh, source, 0, S.FLIGHT_BOUND);
  const original = Q.buildRoute(fresh, first.points), allocations = p.gl.buffers.length;
  p.click("trace-runoff"); pick(p, 0, 0);
  assert.match(p.el("plot-hint").textContent, /higher ground/);
  assert.equal(p.el("route-name").textContent, "Inlet traverse");
  assert.equal(p.el("trace-runoff").getAttribute("aria-pressed"), "true");
  pick(p, ...source); frame(p);
  assert.equal(p.el("route-name").textContent, "Runoff to lake edge");
  assert.equal(p.document.activeElement, p.el("trace-runoff"));
  assert.equal(p.el("relief-label").textContent, "Drop");
  assert.equal(p.el("route-ascent").textContent, metres(original.high - original.low));
  assert.equal(p.el("route-length").textContent, metres(original.length));
  assert.equal(p.el("survey").dataset.view, "overview");
  assert.ok(p.gl.draws.some(d => d.kind === "runoff" && d.reflected));
  assert.equal(p.gl.buffers.length, allocations + 1);
  p.click("fly-route"); frame(p, 500); assertEye(p, Q.flightPose(original, 8.5).position);
  const rendered = p.gl.buffers.at(-1);
  stage(p, 8); frame(p);
  const high = Q.buildRoute(fresh, H.traceRunoff(fresh, source, 8, S.FLIGHT_BOUND).points, 8);
  assert.ok(rendered.deleted && !p.gl.buffers.at(-1).deleted);
  assert.equal(p.el("route-length").textContent, metres(high.length));
  assertEye(p, Q.flightPose(high, 8.5).position);
  assert.equal(p.el("tour-play").textContent, "Pause");
  p.gl.draws.length = 0;
  p.click("restore-route"); frame(p);
  assert.equal(p.el("route-name").textContent, "Inlet traverse");
  assert.equal(p.el("relief-label").textContent, "Ascent");
  assert.ok(p.gl.buffers.at(-1).deleted && p.gl.draws.every(d => d.kind !== "runoff"));
  assert.equal(p.el("tour-play").textContent, "Resume");
});

test("keyboard tracing can be cancelled and a shortened or flooded source leaves a usable paused tour", () => {
  const p = mount();
  frame(p);
  p.click("trace-runoff");
  assert.ok(p.key("keydown", "ArrowLeft", "ArrowLeft", { shiftKey: true }).defaultPrevented);
  p.key("keydown", "Escape", "Escape");
  assert.equal(p.document.activeElement, p.el("trace-runoff"));
  p.click("plot-route"); p.click("trace-runoff");
  assert.equal(p.el("plot-route").getAttribute("aria-pressed"), "false");
  p.key("keydown", "Enter", "Enter", { repeat: true });
  assert.equal(p.el("trace-runoff").getAttribute("aria-pressed"), "true");
  p.key("keydown", "Enter", "Enter"); frame(p);
  assert.equal(p.el("route-name").textContent, "Runoff to lake edge");
  p.click("fly-route"); frame(p, 400); p.click("tour-play");
  assert.equal(p.el("tour-play").textContent, "Resume");
  stage(p, 4); frame(p);
  assert.equal(p.el("tour-play").textContent, "Replay");
  assert.equal(p.el("station").value, "1000");
  stage(p, -6); frame(p);
  assert.equal(p.el("route-name").textContent, "Runoff to closed hollow");
  assert.equal(p.el("tour-play").textContent, "Resume");
  stage(p, 8); frame(p);
  assert.equal(p.el("route-name").textContent, "Inlet traverse");
  assert.equal(p.el("station").value, "0");
  assert.equal(p.el("tour-play").textContent, "Resume");
  assert.match(p.el("announcement").textContent, /source.*restored/i);
});

test("restoring a worn, raised lake rebuilds the runoff annotation and resumes the same flight", () => {
  const p = mount();
  frame(p);
  wear(p, "talus"); stage(p, 3); frame(p);
  p.click("trace-runoff"); pick(p, 75, -150);
  p.click("fly-route"); frame(p, 250);
  const expected = p.gl.draws.findLast(d => d.kind === "land" && !d.reflected).uniforms.uEye;
  const length = p.el("route-length").textContent;
  p.el("world").emit("webglcontextlost");
  for (const id of ["lake-level", "lake-datum", "trace-runoff"]) assert.ok(p.el(id).disabled);
  assert.ok(p.document.querySelectorAll("[data-wear]").every(b => b.disabled));
  assert.ok(p.gl.buffers.every(b => b.deleted));
  p.gl = new CommandGL({ reflections: false }); p.el("world").emit("webglcontextrestored"); frame(p, 5000);
  assertEye(p, expected); assert.equal(p.el("tour-play").textContent, "Pause");
  assert.equal(p.el("route-length").textContent, length);
  assert.equal(p.el("level-readout").textContent, "+3 m");
  assert.ok(!p.el("trace-runoff").disabled);
  assert.ok(p.gl.draws.some(d => d.kind === "runoff"));
  const water = p.gl.draws.findLast(d => d.kind === "water");
  assert.equal(water.uniforms.uHasMirror, 0);
  assert.equal(water.uniforms.uLevel, 3);
});

test("cancelling a pending world switch immediately after context recovery still uploads the chosen surface", () => {
  const p = mount();
  frame(p);
  const presets = p.document.querySelectorAll("[data-preset]");
  presets[1].emit("click"); p.el("world").emit("webglcontextlost");
  p.gl = new CommandGL(); p.el("world").emit("webglcontextrestored");
  presets[0].emit("click"); frame(p);
  assert.equal(p.el("place-name").textContent, world.style.name);
  assertEye(p, world.style.start);
  assert.equal(p.gl.buffers.filter(b => !b.deleted).length, 6);
  assert.equal(p.gl.draws.at(-1).kind, "water");
  p.el("world").emit("webglcontextrestored"); frame(p);
  assert.equal(p.gl.buffers.length, 6);
  assertEye(p, world.style.start);
});

test("basin measurements and weathering work without cartography, and WebGL failure leaves a readable guide", () => {
  const p = mount({ no2d: true });
  frame(p);
  assert.ok(p.el("trace-runoff").disabled);
  stage(p, 6); wear(p, "worn");
  p.document.querySelectorAll("[data-preset]")[1].emit("click"); frame(p);
  const canyon = T.createWorld(T.DEFAULT_SEED, "canyon"), g = E.weatherGrid(T.buildGrid(canyon), "worn");
  assertFlood(p, g, 6);
  assert.equal(p.el("route-name").textContent, "Inlet traverse");
  p.click("tour"); frame(p);
  assertEye(p, Q.flightPose(Q.buildRoute(g, Q.inletPath(canyon), 6), 0).position);
  const unavailable = mount({ webgl: false });
  for (const id of ["lake-level", "lake-datum", "trace-runoff"]) assert.ok(unavailable.el(id).disabled);
  assert.ok(unavailable.document.querySelectorAll("[data-wear]").every(b => b.disabled));
  assert.match(unavailable.el("error-detail").textContent, /WebGL is unavailable/);
  unavailable.click("guide-open"); assert.ok(unavailable.el("guide").open);
});
