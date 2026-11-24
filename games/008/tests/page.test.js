"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mount, root, html, scripts } = require("./support/page");
const { CommandGL } = require("./support/gl");
const T = require("../js/terrain");
const S = require("../js/simulation");
const Q = require("../js/survey");
const art = require("../js/cartography");

function eye(page) {
  return page.gl.draws.findLast(d => !d.reflected && d.kind === "land").uniforms.uEye;
}
function assertPosition(actual, expected) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-8, "camera axis " + i));
}
function ready(page) {
  page.advance();
  assert.equal(page.el("scene-error").hidden, true, page.el("error-detail").textContent);
  assert.equal(page.el("loading").hidden, true);
  assert.equal(page.frameCount(), 1);
}

test("the file entry point references every runtime script, stylesheet, symbol and control locally", () => {
  const files = fs.readdirSync(path.join(root, "js")).filter(s => s.endsWith(".js")).map(s => "js/" + s);
  assert.deepEqual(scripts.slice().sort(), files.sort());
  assert.equal(scripts.at(-1), "js/app.js");
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    assert.match(tag, /\bdefer\b/);
    assert.doesNotMatch(tag, /type="module"|\basync\b/);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, ref] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (ref.startsWith("#")) assert.ok(ids.includes(ref.slice(1)), ref);
    else if (!ref.startsWith("data:")) {
      assert.match(ref, /^[\w./-]+$/);
      assert.ok(fs.statSync(path.join(root, ref)).isFile());
    }
  }
  for (const [, id] of html.matchAll(/\b(?:for|aria-labelledby)="([^"]+)"/g)) assert.ok(ids.includes(id), id);
  assert.match(html, /<noscript>[^<]+JavaScript/);
  assert.match(html, /id="scene-error"[^>]*role="alert"/);
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|importScripts|WebSocket|XMLHttpRequest|EventSource)\s*\(|\bimport\s*(?:\(|\{)/);
    for (const [, id] of source.matchAll(/byId\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  }
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.doesNotMatch(css, /@import\b|url\(\s*['"]?(?:https?:|\/\/)/);
});

test("the full default scene starts through index.html with lit geometry, illustrated presets and a live map", () => {
  const p = mount();
  ready(p);
  assert.equal(p.el("place-name").textContent, "Alder Basin");
  assert.equal(p.el("clock").textContent, "16:30");
  assert.equal(p.el("map-x").textContent, "+032");
  assert.equal(p.el("map-alt").textContent, "43 m");
  assert.equal(p.el("viewer").dataset.mode, "orbit");
  assertPosition(eye(p), T.PRESETS.alpine.start);
  const commands = p.gl.draws.filter(d => d.pass === "main");
  assert.equal(commands[0].count, 144 ** 2 * 6);
  assert.ok(commands[2].count > 1000 * 60);
  assert.equal(commands.at(-1).kind, "water");
  assert.equal(commands.at(-1).uniforms.uDay, S.lighting(S.START_HOUR).day);
  for (const button of p.document.querySelectorAll("[data-preset]")) {
    assert.equal(button.getAttribute("aria-pressed"), String(button.dataset.preset === "alpine"));
    const ink = button.querySelector("canvas").ink;
    assert.ok(ink.fills > 50); assert.equal(ink.depth, 0);
  }
  const map = p.el("survey").ink;
  const defaultGrid = T.buildGrid(T.createWorld());
  const contourCount = Math.floor(Math.max(...defaultGrid.heights) / 2) - Math.ceil(Math.min(...defaultGrid.heights) / 2) + 1;
  assert.equal(map.images, 1);
  const flood = map.sheet.ink;
  assert.equal(flood.sheet.ink.strokes, contourCount);
  assert.equal(flood.images, 1); assert.equal(flood.strokes, 1); assert.equal(flood.fills, 1);
  assert.ok(map.marker[0] > 0 && map.marker[0] < p.el("survey").width);
  assert.ok(map.marker[1] > 0 && map.marker[1] < p.el("survey").height);
  assert.equal(map.depth, 0);
  p.advance(15);
  assert.equal(map.images, 1);
  assert.equal(p.frameCount(), 1);
});

test("preset, typed seed, repeated generation and dice all use the same world-generation path", () => {
  const p = mount();
  ready(p);
  const seed = p.el("seed");
  seed.value = "  After-class Ferry  ";
  const buttons = p.document.querySelectorAll("[data-preset]");
  buttons[1].emit("click");
  buttons[2].emit("click");
  assert.equal(p.frameCount(), 1);
  assert.equal(p.el("scene").getAttribute("aria-busy"), "true");
  ready(p);
  assert.equal(p.el("place-name").textContent, "Frostmere");
  assert.equal(p.el("region-name").textContent, T.PRESETS.fjord.region);
  assertPosition(eye(p), T.PRESETS.fjord.start);
  assert.equal(p.el("scene").getAttribute("aria-busy"), "false");
  assert.equal(seed.value, "After-class Ferry");
  assert.ok(p.el("announcement").textContent.includes(seed.value));
  assert.equal(buttons.filter(b => b.getAttribute("aria-pressed") === "true").length, 1);
  p.click("trees"); p.click("fly");
  const allocations = p.gl.buffers.length;
  assert.equal(p.el("seed-form").emit("submit").defaultPrevented, true);
  ready(p);
  assert.equal(p.gl.buffers.length, allocations);
  assert.equal(p.el("orbit").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("trees").getAttribute("aria-checked"), "false");
  seed.value = "    ";
  p.el("seed-form").emit("submit");
  ready(p);
  assert.equal(seed.value, T.DEFAULT_SEED);
  p.click("dice");
  ready(p);
  assert.match(seed.value, /^FM-\d{6}$/);
  assert.ok(p.el("announcement").textContent.includes(seed.value));
  assert.equal(p.gl.buffers.filter(b => !b.deleted).length, 6);
});

test("time scrubbing holds the chosen minute, the switch resumes through midnight, and layers reach the draw loop", () => {
  const p = mount();
  ready(p);
  p.el("hour").value = "1439";
  p.el("hour").emit("input");
  assert.equal(p.el("hour").getAttribute("aria-valuetext"), "23:59");
  assert.equal(p.el("cycle").getAttribute("aria-checked"), "false");
  assert.equal(p.el("light-icon").getAttribute("href"), "#i-moon");
  p.advance(4, 1000);
  assert.equal(p.el("clock").textContent, "23:59");
  p.click("cycle");
  p.advance(1, 1000);
  assert.equal(p.el("clock").textContent, "00:01");
  p.click("water"); p.click("trees");
  p.gl.draws.length = 0;
  p.advance();
  assert.deepEqual(p.gl.draws.map(d => d.kind), ["land", "land", "land", "sky"]);
  assert.equal(p.gl.draws[0].uniforms.uDay, 0);
  assert.equal(p.gl.draws[0].uniforms.uForest, 0);
  p.click("water"); p.click("trees");
  p.advance();
  assert.equal(p.gl.draws.at(-1).kind, "water");
  assert.equal(p.el("water").getAttribute("aria-checked"), "true");
});

test("keyboard flight updates coordinates, respects form focus and supports reset and non-repeating mode shortcuts", () => {
  const p = mount();
  ready(p);
  p.el("seed").focus();
  assert.equal(p.key("keydown", "KeyF", "f").defaultPrevented, false);
  assert.equal(p.key("keydown", "ArrowRight").defaultPrevented, false);
  assert.equal(p.el("viewer").dataset.mode, "orbit");
  p.click("fly");
  assert.equal(p.document.activeElement, p.el("world"));
  assert.match(p.el("camera-hint").textContent, /WASD/);
  const initial = eye(p);
  assert.equal(p.key("keydown", "KeyW", "w").defaultPrevented, true);
  p.advance(45);
  assert.ok(eye(p)[2] < initial[2] - 10);
  assert.notEqual(p.el("map-z").textContent, "+144");
  p.key("keyup", "KeyW", "w");
  p.key("keydown", "KeyF", "f", { repeat: true });
  assert.equal(p.el("viewer").dataset.mode, "fly");
  p.key("keydown", "KeyF", "f");
  assert.equal(p.el("viewer").dataset.mode, "orbit");
  p.key("keydown", "KeyF", "f", { ctrlKey: true });
  assert.equal(p.el("viewer").dataset.mode, "orbit");
  p.key("keydown", "KeyR", "r");
  p.advance();
  assertPosition(eye(p), T.PRESETS.alpine.start);
  p.el("water").focus();
  assert.equal(p.key("keydown", "Space", " ").defaultPrevented, false);
});

test("drag, wheel, two-finger pinch and held touch buttons control the same camera", () => {
  const p = mount({ touch: true });
  ready(p);
  const canvas = p.el("world"), focus = S.homeCamera(T.PRESETS.alpine).focus;
  const distance = () => Math.hypot(...eye(p).map((v, i) => v - focus[i]));
  const homeDistance = distance(), initialNeedle = p.el("compass-needle").getAttribute("transform");
  p.pointer(canvas, "pointerdown", 1, 100, 100);
  p.pointer(canvas, "pointermove", 1, 150, 103);
  p.advance(14);
  assert.notEqual(p.el("compass-needle").getAttribute("transform"), initialNeedle);
  p.pointer(canvas, "pointerdown", 2, 250, 103);
  p.pointer(canvas, "pointermove", 2, 380, 103);
  p.advance(20);
  assert.ok(distance() < homeDistance * 0.6);
  p.pointer(canvas, "pointercancel", 2, 380, 103);
  p.pointer(canvas, "lostpointercapture", 1, 150, 103);
  assert.equal(canvas.classList.contains("dragging"), false);
  const closeDistance = distance();
  assert.ok(canvas.emit("wheel", { deltaMode: 1, deltaY: 20 }).defaultPrevented);
  p.advance(16);
  assert.ok(distance() > closeDistance + 10);
  p.click("fly");
  assert.equal(p.el("touch-flight").hidden, false);
  assert.equal(canvas.emit("wheel", { deltaMode: 0, deltaY: 80 }).defaultPrevented, false);
  const pad = p.el("touch-flight").querySelectorAll("[data-key]");
  const forward = pad.find(b => b.dataset.key === "KeyW"), climb = pad.find(b => b.dataset.key === "KeyE");
  const start = eye(p);
  p.pointer(forward, "pointerdown", 4, 0, 0); p.pointer(climb, "pointerdown", 5, 0, 0);
  p.advance(25);
  assert.ok(eye(p)[1] > start[1] + 2 && eye(p)[2] < start[2] - 2);
  p.pointer(forward, "lostpointercapture", 4, 0, 0);
  p.pointer(climb, "pointerup", 5, 0, 0);
  p.advance(70);
  const stopped = eye(p);
  p.advance(30);
  assert.ok(Math.hypot(...eye(p).map((v, i) => v - stopped[i])) < 0.002);
  p.click("orbit");
  assert.equal(p.el("touch-flight").hidden, true);
});

test("the guide suppresses flight shortcuts, and native and in-page fullscreen controls stay in sync", async () => {
  for (const fullscreen of [true, false]) {
    const p = mount({ fullscreen });
    ready(p);
    p.key("keydown", "Slash", "?");
    assert.equal(p.el("guide").open, true);
    p.key("keydown", "KeyF", "f");
    assert.equal(p.el("viewer").dataset.mode, "orbit");
    p.key("keydown", "Escape", "Escape");
    assert.equal(p.el("guide").open, false);
    await p.click("fullscreen").settled;
    assert.equal(p.el("fullscreen").getAttribute("aria-label"), "Exit fullscreen");
    assert.equal(p.el("viewer").classList.contains("expanded"), !fullscreen);
    if (fullscreen) await p.click("fullscreen").settled;
    else p.key("keydown", "Escape", "Escape");
    assert.equal(p.el("fullscreen").getAttribute("aria-pressed"), "false");
    assert.equal(p.document.body.classList.contains("expanded-view"), false);
    p.click("guide-open"); p.click("guide-close");
    assert.equal(p.el("guide").open, false);
  }
});

test("hidden tabs release input and resume without a clock jump or duplicate animation loop", () => {
  const p = mount({ hidden: true });
  assert.equal(p.frameCount(), 0);
  p.document.hidden = false;
  p.document.emit("visibilitychange"); p.document.emit("visibilitychange");
  ready(p);
  p.click("fly"); p.key("keydown", "KeyW");
  const start = eye(p);
  p.document.hidden = true; p.document.emit("visibilitychange");
  assert.equal(p.frameCount(), 0);
  p.advance(1, 600000);
  p.document.hidden = false; p.document.emit("visibilitychange");
  p.advance(10);
  assert.equal(p.el("clock").textContent, "16:30");
  assert.deepEqual(eye(p), start);
  p.key("keydown", "KeyD"); p.window.emit("blur");
  p.advance(10);
  assert.deepEqual(eye(p), start);
  assert.equal(p.frameCount(), 1);
});

test("graphics failure shows a readable fallback while the field guide remains usable", () => {
  for (const options of [{ webgl: false, no2d: true }, { failCompile: true }]) {
    const p = mount(options);
    assert.equal(p.el("scene-error").hidden, false);
    assert.equal(p.el("loading").hidden, true);
    assert.equal(p.el("error-title").textContent, "3D view unavailable");
    assert.match(p.el("error-detail").textContent, options.failCompile ? /shader.*compile/ : /WebGL.*acceleration/);
    assert.equal(p.el("generate").disabled, true);
    assert.equal(p.frameCount(), 0);
    p.click("guide-open");
    assert.ok(p.el("guide").open);
  }
});

test("context restoration rebuilds GPU resources and resumes the same flight, clock and layers", () => {
  const p = mount();
  ready(p);
  p.click("fly"); p.click("trees");
  p.el("hour").value = "271"; p.el("hour").emit("input");
  p.key("keydown", "KeyW"); p.advance(20);
  const pose = eye(p);
  assert.equal(p.el("world").emit("webglcontextlost").defaultPrevented, true);
  assert.equal(p.el("error-title").textContent, "Graphics paused");
  assert.equal(p.frameCount(), 0);
  p.advance(1, 5000);
  p.gl = new CommandGL();
  p.el("world").emit("webglcontextrestored");
  ready(p);
  assert.deepEqual(eye(p), pose);
  assert.equal(p.gl.programs.length, 3);
  assert.equal(p.gl.buffers.length, 6);
  assert.equal(p.el("viewer").dataset.mode, "fly");
  assert.equal(p.el("clock").textContent, "04:31");
  assert.equal(p.el("trees").getAttribute("aria-checked"), "false");
  assert.equal(p.el("generate").disabled, false);
});

test("the renderer caps high-DPI buffers and adapts resolution under a sustained low frame rate", () => {
  const p = mount({ dpr: 3 });
  ready(p);
  p.sizes.world = [3200, 1800];
  p.window.emit("resize");
  const canvas = p.el("world"), width = canvas.width, uploads = p.gl.buffers.length;
  assert.ok(width * canvas.height <= 1440000 + width);
  p.advance(35, 50);
  assert.ok(canvas.width < width);
  assert.equal(p.el("fps").textContent, "20 fps");
  assert.equal(p.gl.buffers.length, uploads);
  assert.equal(p.frameCount(), 1);
});

test("weather buttons fade in real time at a held hour and retain the selection when the world changes", () => {
  const p = mount();
  ready(p);
  const options = p.document.querySelectorAll("[data-weather]");
  function select(name) {
    options.find(button => button.dataset.weather === name).emit("click");
    for (const button of options) assert.equal(button.getAttribute("aria-pressed"), String(button.dataset.weather === name));
  }
  p.el("hour").value = "0"; p.el("hour").emit("input");
  select("squall");
  p.gl.draws.length = 0;
  p.advance(1, 1200);
  const first = p.gl.draws.at(-1);
  assert.equal(first.kind, "rain");
  assert.ok(Math.abs(first.uniforms.uRain - 0.5) < 1e-8);
  assert.equal(p.gl.draws[0].uniforms.uDay, 0);
  assert.deepEqual(p.gl.draws[0].uniforms.uWeather, [0.28, 0.5]);
  select("mist");
  p.advance(1, 3000);
  assert.equal(p.gl.draws.at(-1).kind, "water");
  assert.deepEqual(p.gl.draws.at(-1).uniforms.uWeather, [1, 0]);
  p.document.querySelectorAll("[data-preset]")[1].emit("click");
  ready(p);
  assert.deepEqual(p.gl.draws.at(-1).uniforms.uWeather, [1, 0]);
  assert.equal(p.el("clock").textContent, "00:00");
  select("clear"); p.advance(1, 2400);
  assert.deepEqual(p.gl.draws.at(-1).uniforms.uWeather, [0, 0]);
});

test("plotting on an offset high-DPI map measures the actual terrain and links the cursor to a flyover", () => {
  const p = mount({ dpr: 2 });
  ready(p);
  const map = p.el("survey"), station = p.el("station");
  const width = 346, height = 247, left = 83, top = 127;
  map.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height });
  p.window.emit("resize");
  const frame = art.mapFrame(width, height, null, true);
  function clickTerrain(x, z) {
    const [px, py] = art.mapPoint(frame, x, z);
    map.emit("click", { clientX: left + px, clientY: top + py });
  }
  const initialProfile = p.el("profile-ridge").getAttribute("d");
  p.click("plot-route");
  assert.equal(p.document.activeElement, map);
  assert.ok(station.disabled && p.el("fly-route").disabled);
  map.emit("click", { clientX: left + 1, clientY: top + 1 });
  assert.match(p.el("plot-hint").textContent, /Mark A/);
  clickTerrain(-88, 83);
  assert.match(p.el("plot-hint").textContent, /Mark B/);
  clickTerrain(-89, 85);
  assert.match(p.el("plot-hint").textContent, /at least 5 m/);
  clickTerrain(95, -104);
  p.advance(1, 0);
  assert.equal(p.el("route-name").textContent, "Plotted transect");
  assert.equal(p.el("plot-route").getAttribute("aria-pressed"), "false");
  assert.ok(!station.disabled && !p.el("restore-route").hidden);
  const grid = T.buildGrid(T.createWorld()), route = Q.buildRoute(grid, [[-88, 83], [95, -104]]);
  const metres = n => Math.round(n) + " m";
  assert.equal(p.el("route-length").textContent, metres(route.length));
  assert.equal(p.el("route-wet").textContent, metres(route.submerged));
  assert.equal(p.el("route-ascent").textContent, metres(route.ascent));
  assert.notEqual(p.el("profile-ridge").getAttribute("d"), initialProfile);
  for (const id of ["profile-ridge", "profile-ground", "profile-water"]) {
    const path = p.el(id).getAttribute("d");
    assert.match(path, /^M/); assert.doesNotMatch(path, /NaN|Infinity|undefined/);
  }
  station.value = "483"; station.emit("input");
  assert.equal(station.getAttribute("aria-valuetext"), p.el("station-readout").textContent);
  assert.equal(Number(p.el("profile-cursor").getAttribute("x1")), 309.12);
  const distance = 0.483 * route.length;
  assert.equal(p.el("station-readout").textContent, metres(distance) + " along · " + metres(Q.stationAt(route, distance).height) + " elevation");
  p.click("fly-route"); p.advance(1, 0);
  assert.equal(p.el("viewer").dataset.mode, "tour");
  assertPosition(eye(p), Q.flightPose(route, distance).position);
  p.click("restore-route"); p.advance(1, 0);
  assert.equal(p.el("tour-play").textContent, "Resume");
  assert.equal(p.el("profile-ridge").getAttribute("d"), initialProfile);
  assert.equal(p.el("restore-route").hidden, true);
});

test("keyboard plotting supports fine steps, cancellation, exact minimum length and new-world reset", () => {
  const p = mount();
  ready(p);
  const key = (code, extras) => p.key("keydown", code, code, extras);
  const initial = p.el("profile-ridge").getAttribute("d");
  p.click("plot-route"); key("Enter"); key("ArrowLeft");
  assert.ok(key("Escape").defaultPrevented);
  assert.equal(p.el("profile-ridge").getAttribute("d"), initial);
  assert.equal(p.el("plot-route").getAttribute("aria-pressed"), "false");
  p.click("plot-route");
  assert.equal(key("Enter", { repeat: true }).defaultPrevented, true);
  assert.match(p.el("plot-hint").textContent, /Mark A/);
  key("Enter");
  for (let i = 0; i < 5; i++) assert.ok(key("ArrowRight", { shiftKey: true }).defaultPrevented);
  key("Enter"); p.advance(1, 0);
  assert.equal(p.el("route-length").textContent, "5 m");
  assertPosition(eye(p), T.PRESETS.alpine.start);
  const plotted = p.el("profile-ridge").getAttribute("d");
  p.el("seed-form").emit("submit"); ready(p);
  assert.equal(p.el("profile-ridge").getAttribute("d"), plotted);
  p.el("seed").value = "Harbour Steps";
  p.el("seed-form").emit("submit"); ready(p);
  assert.equal(p.el("route-name").textContent, "Inlet traverse");
  assert.notEqual(p.el("profile-ridge").getAttribute("d"), plotted);
  assert.equal(p.el("station").value, "0");
});

test("a tour pauses, scrubs, reaches its last station, replays and hands the exact pose to Fly", () => {
  const p = mount(), world = T.createWorld();
  const route = Q.buildRoute(T.buildGrid(world), Q.inletPath(world));
  ready(p);
  p.click("tour"); p.advance(12, 50);
  assertPosition(eye(p), Q.flightPose(route, 0.6 * Q.FLIGHT_SPEED).position);
  const before = eye(p);
  assert.ok(p.key("keydown", "Space", " ").defaultPrevented);
  p.key("keydown", "Space", " ", { repeat: true });
  p.advance(10, 50);
  assert.deepEqual(eye(p), before);
  assert.equal(p.el("tour-play").textContent, "Resume");
  const station = p.el("station");
  station.value = "1000"; station.emit("input"); p.advance();
  assert.equal(p.el("tour-play").textContent, "Replay");
  assertPosition(eye(p), Q.flightPose(route, route.length).position);
  station.value = "999"; station.emit("input"); p.advance();
  assert.equal(p.el("tour-play").textContent, "Resume");
  p.click("tour-play"); p.advance(8, 50);
  assert.equal(p.el("tour-play").textContent, "Replay");
  assert.equal(station.value, "1000");
  assert.equal(p.el("tour-progress").value, 1);
  assert.match(p.el("live-label").textContent, /Tour paused/);
  p.click("tour-play"); p.advance(1, 0);
  assertPosition(eye(p), Q.flightPose(route, 0).position);
  p.advance(3, 50);
  p.click("guide-open");
  const held = eye(p);
  p.advance(6, 50);
  assert.deepEqual(eye(p), held);
  p.click("guide-close"); p.el("world").focus();
  p.advance(1, 50);
  const pose = eye(p), facing = p.gl.draws.findLast(d => !d.reflected && d.kind === "sky").uniforms.uForward;
  p.key("keydown", "KeyF", "f"); p.advance(1, 0);
  assert.equal(p.el("viewer").dataset.mode, "fly");
  assert.equal(p.el("tour-progress").hidden, true);
  assert.deepEqual(eye(p), pose);
  assert.deepEqual(p.gl.draws.findLast(d => !d.reflected && d.kind === "sky").uniforms.uForward, facing);
  p.key("keydown", "KeyR", "r"); p.advance(1, 100);
  assert.equal(station.value, "0");
  assertPosition(eye(p), T.PRESETS.alpine.start);
});

test("a squall and an in-progress tour survive a hidden tab and a lost graphics context", () => {
  const p = mount();
  ready(p);
  p.click("tour");
  p.document.querySelectorAll("[data-weather]")[2].emit("click");
  p.advance(25, 100);
  const pose = eye(p);
  p.document.hidden = true; p.document.emit("visibilitychange"); p.advance(1, 900000);
  p.document.hidden = false; p.document.emit("visibilitychange"); p.advance();
  assert.deepEqual(eye(p), pose);
  p.el("world").emit("webglcontextlost");
  for (const id of ["tour", "tour-play", "station", "plot-route", "fly-route"]) assert.ok(p.el(id).disabled);
  p.advance(1, 1200);
  p.gl = new CommandGL({ reflections: false });
  p.el("world").emit("webglcontextrestored"); ready(p);
  assert.deepEqual(eye(p), pose);
  assert.equal(p.gl.draws.at(-1).kind, "rain");
  assert.equal(p.gl.draws.at(-1).uniforms.uRain, 1);
  assert.equal(p.el("tour").getAttribute("aria-pressed"), "true");
  assert.equal(p.el("tour-play").textContent, "Pause");
  p.advance(3, 50); assert.notDeepEqual(eye(p), pose);
  assert.equal(p.frameCount(), 1);
});

test("focus loss stops a moving manual camera while ordinary key release still coasts", () => {
  const p = mount();
  ready(p); p.click("fly");
  for (const interrupt of ["blur", "guide", "hidden", "edit"]) {
    p.el("world").focus();
    p.key("keydown", "KeyW"); p.advance(20);
    p.key("keyup", "KeyW");
    const moving = eye(p); p.advance();
    assert.notDeepEqual(eye(p), moving);
    const stopped = eye(p);
    if (interrupt === "blur") p.window.emit("blur");
    if (interrupt === "guide") p.click("guide-open");
    if (interrupt === "edit") p.el("seed").focus();
    if (interrupt === "hidden") {
      p.document.hidden = true; p.document.emit("visibilitychange");
      p.document.hidden = false; p.document.emit("visibilitychange");
    }
    p.advance(8);
    assert.deepEqual(eye(p), stopped);
    if (interrupt === "guide") p.click("guide-close");
  }
});

test("without 2D canvas the measured profile and tour still work, and WebGL failure disables scene controls", () => {
  for (const options of [{ no2d: true }, { noSheet: true }]) {
    const p = mount(options);
    ready(p);
    assert.equal(p.el("plot-route").disabled, true);
    assert.equal(p.el("fly-route").disabled, false);
    assert.ok(p.el("profile-ridge").getAttribute("d"));
    p.click("fly-route"); p.advance(3);
    assert.equal(p.el("viewer").dataset.mode, "tour");
  }
  const unavailable = mount({ webgl: false });
  for (const id of ["tour", "plot-route", "fly-route", "station"]) assert.ok(unavailable.el(id).disabled);
  assert.ok(unavailable.document.querySelectorAll("[data-weather]").every(b => b.disabled));
});

test("the seed field accepts 48 non-BMP characters without interrupting text composition", () => {
  const p = mount();
  ready(p);
  const seed = p.el("seed"), text = "🌲".repeat(48);
  assert.ok(Number(seed.getAttribute("maxlength")) >= text.length);
  seed.value = text + "a"; seed.emit("input", { isComposing: true });
  assert.equal(seed.value, text + "a");
  seed.emit("compositionend");
  assert.equal(seed.value, text);
  seed.value = "HK".repeat(30); seed.emit("input");
  assert.equal(seed.value, "HK".repeat(24));
  seed.value = text; p.el("seed-form").emit("submit"); ready(p);
  assert.ok(p.el("announcement").textContent.includes(text));
  const uploads = p.gl.buffers.length;
  p.el("seed-form").emit("submit"); ready(p);
  assert.equal(p.gl.buffers.length, uploads);
});

test("resizing the map away and back between frames redraws the cleared backing bitmap", () => {
  const p = mount();
  ready(p);
  const map = p.el("survey"), previous = map.ink.images;
  p.sizes.survey = [120, 600]; p.window.emit("resize");
  p.sizes.survey = [300, 140]; p.window.emit("resize");
  assert.deepEqual([map.width, map.height], [300, 140]);
  p.advance();
  assert.equal(map.ink.images, previous + 1);
});

test("profile inspection frames the entire route and camera tracking can be restored independently", () => {
  const p = mount();
  ready(p);
  const map = p.el("survey"), scope = p.el("map-scope"), station = p.el("station");
  assert.equal(map.dataset.view, "follow");
  const tracking = map.ink.sheetRect.slice();
  p.click("map-scope");
  assert.equal(scope.textContent, "Follow camera");
  const overview = map.ink.sheetRect.slice();
  assert.ok(overview[0] >= 0 && overview[1] >= 0 && overview[0] + overview[2] <= map.width &&
    overview[1] + overview[3] <= map.height);
  p.click("plot-route"); p.key("keydown", "Escape", "Escape");
  assert.equal(map.dataset.view, "overview");
  p.click("map-scope"); assert.deepEqual(map.ink.sheetRect, tracking);
  station.value = "1000"; station.emit("input");
  assert.deepEqual(map.ink.sheetRect, overview);
  assert.equal(map.dataset.view, "overview");
  p.click("map-scope"); assert.equal(scope.textContent, "Full map");
  assert.deepEqual(map.ink.sheetRect, tracking);
  assert.equal(station.value, "1000");
});

test("restoring graphics completes a world request interrupted during upload", () => {
  const p = mount();
  ready(p);
  p.el("seed").value = "Evening Crossing";
  p.document.querySelectorAll("[data-preset]")[1].emit("click");
  p.gl.createBuffer = () => null;
  p.advance();
  assert.equal(p.el("scene-error").hidden, false);
  assert.match(p.el("error-detail").textContent, /allocate a geometry buffer/);
  assert.ok(p.gl.buffers.every(b => b.deleted));
  p.el("world").emit("webglcontextlost");
  p.gl = new CommandGL();
  p.el("world").emit("webglcontextrestored"); ready(p);
  assert.equal(p.el("place-name").textContent, "Ember Canyon");
  assert.match(p.el("announcement").textContent, /Evening Crossing/);
  assertPosition(eye(p), T.PRESETS.canyon.start);
  assert.equal(p.gl.buffers.length, 6);
});
