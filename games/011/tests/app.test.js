"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage } = require("./support/page");
const storm = require("../js/storm");
const math = require("../js/math");
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, a + " differs from " + b);
function input(page, value) {
  const slider = page.get("signal");
  slider.value = String(value);
  slider.fire("input");
}

test("the actual entry point renders its first frame, HUD and full-strength storm through the WebGL API", () => {
  const page = createPage({ actualGraphics: true });
  page.step();
  assert.equal(page.get("status-text").textContent, "Simulation running");
  assert.equal(page.get("graphics-message").hidden, true);
  assert.equal(page.get("signal-output").textContent, "05");
  assert.deepEqual(page.gl.draws.map(d => d.name), ["sea", "rain", "deck", "cloud"]);
  assert.equal(page.get("eye-marker").style.opacity, "1");
  assert.match(page.get("eye-marker").style.transform, /^translate\([\d.]+px,[\d.]+px\)$/);
  assert.ok(page.get("wind-chart").getContext("2d").calls > 50);
  assert.ok(page.get("compass").getContext("2d").calls > 10);
  page.get("pause").click(); input(page, 10); page.step();
  assert.equal(page.gl.draws.at(-1).count, storm.MAX_CLOUDS * 6);
  assert.equal(page.gl.draws.at(-3).count, storm.MAX_RAIN * 2);
  page.win.fire("pagehide", { persisted: false });
  assert.ok(page.gl.resources.every(resource => resource.deleted));
  assert.deepEqual(page.warnings, []);
});

test("slider, step buttons and arrow keys share the same bounded warning signal", () => {
  const page = createPage();
  input(page, 1);
  assert.equal(page.get("signal-down").disabled, true);
  assert.equal(page.get("signal").style["--fill"], "0%");
  page.get("signal-down").click(); page.get("signal-up").click();
  assert.equal(page.get("signal-output").textContent, "02");
  assert.equal(page.get("signal-down").disabled, false);
  for (let i = 0; i < 15; i++) page.key("ArrowUp");
  assert.equal(page.get("signal-up").disabled, true);
  assert.equal(page.get("signal").getAttribute("aria-valuetext"), "10 of 10, Extreme");
  assert.equal(page.get("signal").style["--fill"], "100%");
  page.key("ArrowDown"); assert.equal(page.get("level-name").textContent, "Violent");
  const native = page.key("ArrowDown", { target: page.get("signal") });
  assert.equal(native.defaultPrevented, false); assert.equal(page.get("signal").value, "9");
  page.key("ArrowDown", { ctrlKey: true }); assert.equal(page.get("signal").value, "9");
});

test("storm readings react to both strengthening and weakening and preserve model time", () => {
  const p = createPage();
  p.step(); input(p, 10); p.run(130);
  assert.ok(p.last().strength > 0.998);
  assert.ok(Number(p.get("wind-value").textContent) > 180);
  assert.ok(Number(p.get("rain-value").textContent) > 80);
  assert.ok(Number(p.get("pressure-value").textContent) < 925);
  const time = p.last().time;
  input(p, 1); p.run(150);
  assert.ok(p.last().strength < 0.001 && p.last().time > time);
  assert.ok(Number(p.get("wind-value").textContent) < 36);
  assert.ok(Number(p.get("rain-value").textContent) < 4);
  assert.ok(Number(p.get("pressure-value").textContent) > 1000);
});

test("pause stops requesting frames, supports a frozen signal preview and resumes without a jump", () => {
  const p = createPage(); p.run(12);
  const previous = p.last();
  p.key(" "); p.step();
  assert.equal(p.get("pause").getAttribute("aria-label"), "Resume simulation");
  assert.equal(p.get("status-text").textContent, "Simulation paused");
  assert.equal(p.frames.size, 0); assert.equal(p.last().phase, previous.phase);
  input(p, 8); p.step(50000);
  assert.equal(p.last().time, previous.time); close(p.last().strength, 7 / 9);
  const spaceOnButton = p.key(" ", { target: p.get("pause") });
  assert.equal(spaceOnButton.defaultPrevented, false);
  p.get("pause").click(); p.step(50000); close(p.last().time, previous.time);
  p.step(20); close(p.last().time, previous.time + 0.02);
});

test("the speed selector sets exact model time ratios and only one pressed button", () => {
  const p = createPage(); p.step();
  for (const speed of [0.5, 2, 1]) {
    p.data("speed", String(speed)).click();
    const time = p.last().time;
    p.run(60);
    close(p.last().time - time, speed);
    for (const button of p.doc.querySelectorAll("[data-speed]")) {
      assert.equal(button.getAttribute("aria-pressed"), String(Number(button.dataset.speed) === speed));
    }
  }
  assert.equal(p.get("model-time").textContent, "T+ 00:03");
});

test("layer switches independently update the rendered scene and eye annotation", () => {
  const p = createPage(); p.step();
  for (const name of ["clouds", "rain", "grid"]) {
    p.data("layer", name).click(); p.step(); assert.equal(p.last().layers[name], false);
  }
  assert.equal(p.get("eye-marker").style.opacity, "0");
  p.data("layer", "clouds").click(); p.step();
  assert.deepEqual(p.last().layers, { clouds: true, rain: false, grid: false });
  assert.equal(p.get("eye-marker").style.opacity, "1");
});

test("both camera presets ease into place and reset restores the default orbit", () => {
  const p = createPage(); p.step();
  const initial = p.last();
  p.data("view", "overhead").click(); p.run(5);
  assert.ok(p.last().back[1] > initial.back[1] && p.last().back[1] < 0.9999);
  p.run(100); assert.ok(p.last().back[1] > 0.9999);
  assert.equal(p.data("view", "overhead").getAttribute("aria-pressed"), "true");
  p.key("d"); p.run(12);
  assert.equal(p.data("view", "orbit").getAttribute("aria-pressed"), "true");
  p.get("reset-view").click(); p.run(110);
  close(p.last().distance, initial.distance);
  p.last().back.forEach((n, i) => close(n, initial.back[i]));
});

test("stationary pointer updates preserve the top-down preset until an actual drag begins", () => {
  const p = createPage({ reducedMotion: true }), canvas = p.get("storm-canvas");
  p.key("t"); p.run(120);
  const before = p.last(), event = { pointerId: 9, button: 0, clientX: 100, clientY: 110 };
  canvas.fire("pointerdown", event); canvas.fire("pointermove", event); p.step();
  assert.equal(p.data("view", "overhead").getAttribute("aria-pressed"), "true");
  assert.deepEqual(p.last().back, before.back);
  canvas.fire("pointermove", { ...event, clientX: 105 }); canvas.fire("pointerup", event);
  assert.equal(p.data("view", "orbit").getAttribute("aria-pressed"), "true");
});

test("drag and wheel orbit and zoom the camera and a cancelled drag cannot continue moving it", () => {
  const p = createPage(); p.step();
  const initial = p.last(), canvas = p.get("storm-canvas");
  canvas.fire("pointerdown", { pointerId: 7, button: 0, clientX: 200, clientY: 190 });
  canvas.fire("pointermove", { pointerId: 7, clientX: 240, clientY: 220 });
  canvas.fire("pointercancel", { pointerId: 7 });
  assert.equal(canvas.captured, 7);
  const wheel = canvas.fire("wheel", { deltaY: -3, deltaMode: 1 });
  p.run(100);
  assert.ok(wheel.defaultPrevented);
  assert.ok(p.last().distance < initial.distance && p.last().back[1] > initial.back[1]);
  const yaw = p.last().back[0];
  canvas.fire("pointermove", { pointerId: 7, clientX: -1000, clientY: -1000 });
  p.run(40); close(p.last().back[0], yaw);
});

test("two-finger pinching zooms around the eye and a released pointer returns to one-finger orbit", () => {
  const p = createPage(), c = p.get("storm-canvas");
  p.step(); const initial = p.last();
  c.fire("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
  c.fire("pointerdown", { button: 0, pointerId: 2, clientX: 60, clientY: 20 });
  c.fire("pointermove", { pointerId: 2, clientX: 85, clientY: 20 });
  p.run(100);
  close(p.last().distance, initial.distance * 2 / 3);
  assert.deepEqual(p.last().back, initial.back);
  c.fire("lostpointercapture", { pointerId: 2 });
  c.fire("pointermove", { pointerId: 1, clientX: 45, clientY: 40 });
  c.fire("pointerup", { pointerId: 1 }); p.run(60);
  assert.notDeepEqual(p.last().back, initial.back);
});

test("expanded view works with native fullscreen, a rejected request, or an unavailable API", async () => {
  for (const mode of ["native", "reject", false]) {
    const p = createPage({ fullscreen: mode }), viewport = p.get("viewport");
    await p.get("expand").click().done;
    assert.equal(p.get("expand").getAttribute("aria-pressed"), "true");
    if (mode === "native") assert.equal(p.doc.fullscreenElement, viewport);
    else assert.ok(viewport.classList.contains("is-expanded"));
    if (mode === false) p.key("Escape"); else await p.get("expand").click().done;
    assert.equal(p.get("expand").getAttribute("aria-pressed"), "false");
    assert.equal(p.doc.fullscreenElement, null); assert.ok(!viewport.classList.contains("is-expanded"));
  }
});

test("the expanded signal slider changes the same storm, including in a frozen view", async () => {
  for (const fullscreen of ["native", "reject", false]) {
    const page = createPage({ fullscreen, reducedMotion: true });
    const control = page.get("viewport-signal-control"), slider = page.get("viewport-signal");
    assert.equal(control.hidden, true);
    input(page, 2);
    await page.get("expand").click().done;
    assert.equal(control.hidden, false);
    assert.equal(slider.value, "2");
    slider.value = "10"; slider.fire("input"); page.step();
    assert.equal(page.last().strength, 1);
    assert.equal(page.last().time, 0);
    assert.equal(page.get("signal").value, "10");
    assert.equal(page.get("signal-up").disabled, true);
    assert.equal(slider.getAttribute("aria-valuetext"), "10 of 10, Extreme");
    assert.equal(page.get("viewport-signal-output").textContent, "10 / 10");
    page.key("ArrowDown");
    assert.equal(slider.value, "9");
    assert.equal(slider.style["--fill"], page.get("signal").style["--fill"]);
    assert.equal(page.get("viewport-signal-output").textContent, "09 / 10");
    assert.equal(page.key("ArrowLeft", { target: slider }).defaultPrevented, false);
  }
});

test("leaving expanded view after adjusting the signal returns keyboard focus to a visible control", async () => {
  for (const fullscreen of ["native", false]) {
    const page = createPage({ fullscreen }), slider = page.get("viewport-signal");
    await page.get("expand").click().done;
    slider.focus(); slider.value = "1"; slider.fire("input");
    if (fullscreen) await page.doc.exitFullscreen();
    else page.key("Escape", { target: slider });
    assert.equal(page.get("viewport-signal-control").hidden, true);
    assert.equal(page.doc.activeElement, page.get("expand"));
    assert.equal(page.get("signal").value, "1");
    assert.equal(page.get("signal-down").disabled, true);
    page.run(130); assert.ok(page.last().strength < 0.001 && page.last().time > 2);
  }
});

test("racing or rejected fullscreen exits reconcile the controls with the actual fullscreen element", async () => {
  const p = createPage({ fullscreen: "native" });
  await p.get("expand").click().done;
  p.doc.exitFullscreen = async () => { throw new Error("Exit rejected"); };
  await p.get("expand").click().done;
  assert.equal(p.get("expand").getAttribute("aria-pressed"), "true");
  p.doc.exitFullscreen = async () => { p.doc.fullscreenElement = null; throw new Error("Already exited"); };
  await p.get("expand").click().done;
  assert.equal(p.get("expand").getAttribute("aria-pressed"), "false");
  assert.equal(p.get("viewport-signal-control").hidden, true);
});

test("repeated expansion during a pending native entry cannot leave fallback fullscreen stuck after exit", async () => {
  const p = createPage({ fullscreen: "native" }), viewport = p.get("viewport"), button = p.get("expand");
  let settle, requests = 0;
  viewport.requestFullscreen = () => {
    if (++requests > 1) return Promise.reject(new Error("A fullscreen request is already pending"));
    return new Promise(resolve => { settle = resolve; });
  };
  const first = button.click(), second = button.click();
  p.doc.fullscreenElement = viewport; p.doc.fire("fullscreenchange"); settle();
  await Promise.all([first.done, second.done]);
  assert.equal(requests, 1);
  assert.equal(button.getAttribute("aria-pressed"), "true"); assert.equal(viewport.classList.contains("is-expanded"), false);
  await p.doc.exitFullscreen();
  assert.equal(button.getAttribute("aria-pressed"), "false"); assert.equal(p.get("viewport-signal-control").hidden, true);
});

test("on-screen help supports keyboard dismissal, restores focus and isolates its shortcuts", () => {
  const p = createPage(), help = p.get("help-dialog");
  p.get("help-open").click();
  assert.ok(help.open); assert.equal(p.doc.activeElement, p.get("help-close"));
  p.key("ArrowUp"); assert.equal(p.get("signal").value, "5");
  p.key("Escape"); assert.equal(help.open, false);
  assert.equal(p.doc.activeElement, p.get("help-open"));
  p.key("?"); assert.ok(help.open); p.get("help-close").click(); assert.equal(help.open, false);
});

test("reduced motion presents a still first view with functioning controls and explicit playback", () => {
  const p = createPage({ reducedMotion: true });
  p.run(10);
  assert.equal(p.log.rendered.length, 1); assert.equal(p.last().time, 0);
  assert.equal(p.get("status-text").textContent, "Simulation paused");
  input(p, 1); p.key("+"); p.run(100);
  close(p.last().distance, math.HOME.distance * 0.89, 0.0002);
  assert.equal(p.last().strength, 0); assert.equal(p.last().phase, 0);
  p.get("pause").click(); p.run(12); assert.ok(p.last().time > 0);
});

test("hidden pages, back-forward caching and long frame gaps cannot fast-forward the model", () => {
  const p = createPage(); p.run(5);
  const prior = p.last().time;
  p.doc.hidden = true; p.doc.fire("visibilitychange"); p.step(100000);
  assert.equal(p.frames.size, 0); assert.equal(p.last().time, prior);
  p.doc.hidden = false; p.doc.fire("visibilitychange"); p.step(1000);
  assert.equal(p.last().time, prior); p.step(10000); close(p.last().time, prior + 0.08);
  const resumed = p.last().time;
  p.win.fire("pagehide", { persisted: true }); p.step(10000);
  p.win.fire("pageshow"); p.step(5000); assert.equal(p.last().time, resumed);
  p.win.fire("pagehide", { persisted: false });
  assert.equal(p.log.disposed, 1); assert.equal(p.frames.size, 0);
  p.key("ArrowUp"); assert.equal(p.get("signal").value, "5");
});

test("resizing the stage and switching display density update drawing-buffer dimensions", () => {
  const p = createPage(), stage = p.get("stage");
  stage.clientWidth = 360; stage.clientHeight = 285;
  p.win.fire("resize"); assert.deepEqual(p.log.sizes.at(-1), [360, 285, 1]);
  p.win.devicePixelRatio = 2; p.step(); assert.deepEqual(p.log.sizes.at(-1), [360, 285, 2]);
  assert.ok(Number.isFinite(p.last().distance));
});

test("unavailable WebGL and driver initialization errors present visible, actionable messages", () => {
  for (const options of [{ noWebGL: true }, { actualGraphics: true, failure: "compile" }]) {
    const p = createPage(options);
    assert.equal(p.get("graphics-message").hidden, false);
    assert.match(p.get("graphics-title").textContent, /unavailable|could not start/);
    assert.match(p.get("graphics-detail").textContent, /WebGL and hardware acceleration/);
    assert.equal(p.get("status-text").textContent, "Graphics offline");
    assert.equal(p.get("pause").disabled, true); assert.equal(p.frames.size, 0);
    input(p, 10); assert.ok(Number(p.get("wind-value").textContent) > 180);
    p.get("help-open").click(); assert.ok(p.get("help-dialog").open);
  }
});

test("context restoration rebuilds graphics and preserves the user's signal, layers, speed and elapsed time", () => {
  const p = createPage(), canvas = p.get("storm-canvas");
  input(p, 8); p.data("speed", "2").click(); p.data("layer", "rain").click(); p.run(40);
  const before = p.last();
  assert.ok(canvas.fire("webglcontextlost").defaultPrevented);
  assert.equal(p.frames.size, 0); assert.equal(p.log.disposed, 1);
  assert.match(p.get("graphics-title").textContent, /interrupted/);
  p.step(30000); canvas.fire("webglcontextrestored"); p.step(20000);
  assert.equal(p.log.attempts, 2); assert.ok(p.get("graphics-message").hidden);
  assert.deepEqual(p.last(), before);
  p.step(20); close(p.last().time, before.time + 0.04);
});
