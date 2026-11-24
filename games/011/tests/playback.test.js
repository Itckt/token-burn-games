"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage } = require("./support/page");
const cycle = require("../js/lifecycle");
const storm = require("../js/storm");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " differs from " + b);

function slide(p, id, value) {
  const control = p.get(id);
  control.value = String(value); control.fire("input");
}
function checkPose(p, seconds) {
  const pose = cycle.at(seconds), last = p.last();
  assert.equal(last.signal, pose.signal);
  for (const key of ["time", "phase", "strength", "rainTravel"]) close(last[key], pose[key]);
}

test("chapter buttons and scrubbing sample the same seeded scene and update both signal sliders and telemetry", () => {
  const p = createPage({ reducedMotion: true });
  p.step();
  assert.equal(p.get("cycle-exit").hidden, true);
  assert.ok(p.get("cycle-curve").getContext("2d").calls > 100);
  for (const [index, stage] of cycle.STAGES.entries()) {
    p.data("stage", String(index)).click(); p.step();
    checkPose(p, stage.start);
    assert.equal(p.get("cycle-stage").textContent, stage.name);
    assert.equal(p.data("stage", String(index)).getAttribute("aria-current"), "step");
    assert.equal(p.get("signal").value, String(stage.from));
    assert.equal(p.get("viewport-signal").value, String(stage.from));
    assert.equal(p.get("rain-value").textContent, cycle.readingsAt(stage.start).rain.toFixed(1));
    assert.equal(p.get("cycle-exit").hidden, false);
    assert.equal(p.frames.size, 0);
  }
  slide(p, "cycle-time", 22.3); p.step();
  checkPose(p, 22.3); const first = p.last();
  assert.match(p.get("cycle-time").getAttribute("aria-valuetext"), /22\.3 seconds, Deepening/);
  slide(p, "cycle-time", 59.3); p.step();
  slide(p, "cycle-time", 22.3); p.step(8000);
  assert.deepEqual(p.last(), first);
  assert.equal(p.get("model-time").textContent, "T+ 00:22");
  assert.equal(p.key("ArrowRight", { target: p.get("cycle-time") }).defaultPrevented, false);
});

test("life cycle playback honours speed, pause and visibility, stops exactly at the end and replays from zero", () => {
  const p = createPage({ reducedMotion: true });
  p.get("cycle-play").click(); p.step(5000);
  assert.equal(p.get("cycle-play-label").textContent, "Pause life cycle");
  p.data("speed", "2").click(); p.run(50, 20);
  checkPose(p, 2);
  p.get("cycle-play").click(); p.step(30000);
  assert.equal(p.frames.size, 0); checkPose(p, 2);
  p.key(" "); p.step(30000); p.step(20); checkPose(p, 2.04);
  p.doc.hidden = true; p.doc.fire("visibilitychange"); p.step(8000);
  p.doc.hidden = false; p.doc.fire("visibilitychange"); p.step(9000); checkPose(p, 2.04);
  slide(p, "cycle-time", 59.8); p.step();
  assert.equal(p.get("cycle-play-label").textContent, "Resume life cycle");
  p.get("cycle-play").click(); p.step(); p.run(3, 75);
  checkPose(p, 60);
  assert.equal(p.frames.size, 0);
  assert.equal(p.get("cycle-time").value, "60.0");
  assert.equal(p.get("cycle-position").textContent, "01:00 / 01:00");
  assert.equal(p.get("cycle-play-label").textContent, "Replay life cycle");
  assert.equal(p.get("wind-value").textContent, cycle.readingsAt(60).wind.toFixed(0));
  p.key(" "); p.step(9000); checkPose(p, 0);
  assert.equal(p.get("signal").value, "1"); assert.equal(p.last().speed, 2);
});

test("manual control takes over from the current pose, including an edit to the same rounded signal", () => {
  const p = createPage();
  slide(p, "cycle-time", 26.1); p.step();
  const paused = p.last();
  assert.notEqual(paused.strength, storm.normalized(paused.signal));
  slide(p, "viewport-signal", paused.signal); p.step();
  assert.equal(p.get("cycle-stage").textContent, "Manual control");
  close(p.last().time, paused.time); close(p.last().phase, paused.phase);
  close(p.last().strength, storm.normalized(paused.signal));
  assert.equal(p.frames.size, 0);
  slide(p, "cycle-time", 22.6); p.get("cycle-play").click(); p.run(10);
  const playing = p.last();
  p.get("cycle-exit").click();
  assert.equal(p.get("cycle-exit").hidden, true);
  assert.equal(p.doc.activeElement, p.get("cycle-play"));
  p.step(20);
  const expected = { ...playing, playing: true };
  storm.advance(expected, 0.02);
  for (const key of ["phase", "time", "strength", "rainTravel"]) close(p.last()[key], expected[key]);
  assert.equal(p.get("cycle-play-label").textContent, "Play life cycle");
});

test("context restoration picks up the same radar, probe and life cycle frame and releases both sets of resources", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true }), canvas = p.get("storm-canvas");
  slide(p, "cycle-time", 35.5); p.key("v"); p.key("p"); p.data("probe", "band").click();
  p.step();
  const first = p.last(), location = p.get("probe-location").textContent;
  const rain = p.get("probe-rain").textContent, firstTexture = p.gl.draws.at(-1).texture;
  canvas.fire("webglcontextlost"); p.step(7000);
  assert.equal(p.get("probe-marker").hidden, true); assert.equal(p.frames.size, 0);
  assert.ok(p.gl.resources.every(r => r.deleted));
  canvas.fire("webglcontextrestored"); p.step(30000);
  assert.deepEqual(p.last(), first);
  assert.equal(p.gl.draws.at(-1).name, "radar");
  assert.notEqual(p.gl.draws.at(-1).texture, firstTexture);
  assert.equal(p.get("probe-location").textContent, location);
  assert.equal(p.get("probe-rain").textContent, rain);
  assert.equal(p.get("probe-marker").hidden, false);
  assert.equal(p.get("cycle-stage").textContent, "Peak");
  p.win.fire("pagehide", { persisted: false }); assert.ok(p.gl.resources.every(r => r.deleted));
});

test("the static instrument readouts and stage inspection work when WebGL is unavailable", () => {
  const p = createPage({ noWebGL: true });
  assert.equal(p.get("graphics-message").hidden, false);
  assert.equal(p.get("cycle-play").disabled, true);
  assert.equal(p.data("imagery", "radar").disabled, true);
  p.key("p"); p.data("probe", "eye").click();
  p.data("stage", "2").click();
  assert.equal(p.get("probe-location").textContent, "Eye · 0.0 km");
  assert.equal(p.get("probe-pressure").textContent, cycle.readingsAt(34).pressure.toFixed(0));
  assert.equal(p.get("signal-output").textContent, "10");
  assert.equal(p.get("model-time").textContent, "T+ 00:34");
  assert.equal(p.get("status-text").textContent, "Graphics offline");
  assert.equal(p.frames.size, 0);
});
