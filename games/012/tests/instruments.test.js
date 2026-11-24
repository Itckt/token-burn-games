"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { application } = require("./fixtures.js");
const { bodies } = require("../js/catalog.js");
const { systemAt, orbits } = require("../js/physics.js");
const { START_DAYS, dateAt } = require("../js/time.js");
const { apsisDay, signalRange } = require("../js/observations.js");
const { lightTimeText } = require("../js/instruments.js");
const { OrbitCamera, screenBodies } = require("../js/camera.js");

const text = (page, id) => page.get(id).textContent;
const pressed = (page, id) => page.get(id).getAttribute("aria-pressed") === "true";
const shownTime = page => page.get("sim-date").getAttribute("datetime") + "T" + text(page, "sim-hour");
function setTime(page, value) {
  page.get("time-open").click();
  page.get("time-input").value = value;
  assert.ok(page.get("time-form").emit("submit").defaultPrevented);
}
function chooseReceiver(page, id) {
  const select = page.get("range-target");
  select.value = id;
  select.emit("change");
}
function sourceTag(page, id) {
  return page.get("map-labels").children.find(tag => tag.getAttribute("data-body") === id);
}
function render(page, time) {
  const gl = page.get("space").gl;
  gl.draws.length = 0;
  assert.equal(page.frame(time), 1);
  return gl;
}

test("time navigator isolates typing, preserves the draft and focus, and pauses at the submitted UTC minute", () => {
  const page = application(), input = page.get("time-input");
  page.frame(0);
  page.get("time-open").focus();
  page.key("t");
  assert.equal(page.doc.activeElement, input);
  assert.equal(input.value, "2026-01-01T00:00");
  page.frame(1000);
  assert.equal(input.value, "2026-01-01T00:00");
  for (const key of ["r", "v", "4", ".", "?"]) page.key(key, { target: input });
  assert.equal(text(page, "status-text"), "Running");
  assert.equal(text(page, "profile-name"), "Earth");
  assert.equal(page.get("controls-dialog").open, false);
  input.value = "2100-02-29T12:00";
  page.get("time-form").emit("submit");
  assert.ok(page.get("time-dialog").open);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(page.get("time-error").hidden, false);
  assert.equal(shownTime(page), "2026-01-02T00:00");
  input.value = "2000-01-01T12:00";
  page.get("time-form").emit("submit");
  assert.equal(shownTime(page), input.value);
  assert.equal(page.get("time-dialog").open, false);
  assert.equal(page.doc.activeElement, page.get("time-open"));
  assert.equal(text(page, "status-text"), "Paused");
  page.frame(9000);
  assert.equal(shownTime(page), input.value);
  page.get("time-open").click();
  assert.equal(page.get("time-error").hidden, true);
  input.value = "2030-04-11T17:20";
  page.key("Escape", { target: input });
  assert.equal(shownTime(page), "2000-01-01T12:00");
});

test("day buttons and shortcuts cross leap days, keep UTC time of day and retain camera and speed", () => {
  const page = application();
  page.key("]"); page.key("f");
  setTime(page, "2024-02-28T15:04");
  page.key(".");
  assert.equal(shownTime(page), "2024-02-29T15:04");
  page.get("time-open").click(); page.get("step-ahead").click();
  assert.equal(shownTime(page), "2024-03-01T15:04");
  assert.equal(page.get("time-dialog").open, false);
  page.get("time-open").click(); page.get("step-back").click();
  page.key(",");
  assert.equal(shownTime(page), "2024-02-28T15:04");
  assert.equal(text(page, "speed-value"), "3 d/s");
  assert.equal(text(page, "view-name"), "Following Earth");
  assert.equal(text(page, "status-text"), "Paused");
});

test("signed playback reverses without unpausing, ignores key repeat and excludes time in a hidden tab", () => {
  const page = application();
  page.get("reverse").click();
  assert.ok(pressed(page, "reverse"));
  assert.equal(text(page, "speed-value"), "−1 d/s");
  assert.equal(text(page, "status-text"), "Rewinding");
  page.key("r", { repeat: true });
  page.frame(0); page.frame(1000);
  assert.equal(shownTime(page), "2025-12-31T00:00");
  page.doc.hidden = true; page.doc.emit("visibilitychange");
  assert.equal(page.frame(50000), 0);
  page.doc.hidden = false; page.doc.emit("visibilitychange");
  page.frame(60000); page.frame(61000);
  assert.equal(shownTime(page), "2025-12-30T00:00");
  page.key(" "); page.key("r"); page.key("]");
  assert.equal(text(page, "speed-value"), "3 d/s");
  assert.equal(text(page, "status-text"), "Paused");
  assert.equal(pressed(page, "reverse"), false);
  page.key(" "); page.frame(62000); page.frame(63000);
  assert.equal(shownTime(page), "2026-01-02T00:00");
});

test("calendar-limit forecasts disable, playback stops, and reversing moves back into the calendar", () => {
  const page = application();
  setTime(page, "9999-12-31T23:59");
  assert.equal(page.get("visit-perihelion").disabled, true);
  assert.equal(page.get("visit-aphelion").disabled, true);
  assert.equal(text(page, "aphelion-date"), "Outside calendar");
  page.key(" "); page.frame(0); page.frame(1000);
  assert.equal(text(page, "status-text"), "Paused");
  assert.equal(shownTime(page), "9999-12-31T23:59");
  page.key("r");
  assert.equal(page.get("visit-perihelion").disabled, false);
  page.get("visit-perihelion").click();
  assert.ok(shownTime(page) < "9999-12-31T23:59");
  setTime(page, "0001-01-01T00:00"); page.key(",");
  assert.equal(shownTime(page), "0001-01-01T00:00");
  assert.equal(page.get("visit-aphelion").disabled, true);
});

test("apsis buttons visit exact extrema, update repeated forecasts, and follow the playback direction", () => {
  const page = application(), orbit = orbits.mercury;
  page.key("1"); page.key("f");
  let day = START_DAYS;
  function visit(kind, sign) {
    day = apsisDay(orbit, day, kind, sign);
    page.get("visit-" + kind).click();
    assert.equal(shownTime(page), dateAt(day).toISOString().slice(0, 16));
    const distance = orbit.a * (1 + (kind === "perihelion" ? -1 : 1) * orbit.e);
    assert.equal(text(page, "distance"), distance.toFixed(3) + " AU");
    assert.equal(text(page, "view-name"), "Following Mercury");
    assert.equal(text(page, "status-text"), "Paused");
    return parseFloat(text(page, "study-speed"));
  }
  const fast = visit("perihelion", 1);
  visit("perihelion", 1);
  const slow = visit("aphelion", 1);
  assert.ok(fast > slow);
  page.key("r");
  assert.equal(text(page, "perihelion-label"), "Previous perihelion");
  visit("perihelion", -1);
  assert.match(text(page, "sweep-duration"), /7\.33 days/);
  sourceTag(page, "sun").click();
  assert.ok(page.get("study-data").hidden && !page.get("study-empty").hidden);
  assert.ok(page.get("toggle-sweeps").disabled && page.get("sweep-key").hidden);
  page.key("2");
  assert.equal(page.get("study-data").hidden, false);
  assert.equal(page.get("toggle-sweeps").disabled, false);
});

test("framing a planet exposes its sectors, transfers on selection and hands off to normal camera controls", () => {
  const page = application();
  page.get("frame-orbit").click();
  assert.equal(text(page, "view-name"), "Earth orbit");
  assert.ok(pressed(page, "frame-orbit"));
  assert.equal(page.doc.activeElement, page.get("space"));
  page.key("1");
  assert.equal(text(page, "view-name"), "Mercury orbit");
  page.key("f");
  assert.equal(text(page, "view-name"), "Following Mercury");
  assert.equal(pressed(page, "frame-orbit"), false);
  page.key("v");
  assert.equal(text(page, "view-name"), "Mercury orbit");
  assert.equal(pressed(page, "follow"), false);
  page.get("expand").click(); page.key("Escape");
  assert.equal(text(page, "view-name"), "Mercury orbit");
  page.key("Escape");
  assert.equal(text(page, "view-name"), "System overview");
  page.key("v"); sourceTag(page, "sun").click();
  assert.equal(text(page, "view-name"), "System overview");
  assert.ok(page.get("frame-orbit").disabled);
});

test("ranging reads the live AU baseline, exchanges endpoints and draws their display-space link", () => {
  const page = application(), receiver = page.get("range-target");
  assert.equal(receiver.children.length, bodies.length);
  const disabled = () => receiver.children.filter(option => option.disabled).map(option => option.value);
  function expectRange(day, from, to) {
    const states = systemAt(day), range = signalRange(states[from], states[to]);
    assert.equal(text(page, "range-distance"), range.au.toFixed(3) + " AU");
    assert.equal(text(page, "range-delay"), lightTimeText(range.lightSeconds));
    assert.equal(Number(text(page, "range-rate").split(" ")[0].replace("−", "-")), Number(range.rateKmS.toFixed(2)));
    assert.deepEqual(disabled(), [from]);
    assert.equal(receiver.value, to);
  }
  expectRange(START_DAYS, "earth", "mars");
  const firstDelay = text(page, "range-delay");
  page.frame(0);
  page.frame(4000);
  expectRange(START_DAYS + 4, "earth", "mars");
  assert.notEqual(text(page, "range-delay"), firstDelay);
  page.key("4");
  assert.equal(text(page, "range-from"), "Mars");
  expectRange(START_DAYS + 4, "mars", "earth");
  chooseReceiver(page, "sun");
  for (const key of ["r", "v", "t", "6", ",", "."]) page.key(key, { target: receiver });
  expectRange(START_DAYS + 4, "mars", "sun");
  assert.equal(page.get("time-dialog").open, false);
  assert.equal(text(page, "view-name"), "System overview");
  page.get("toggle-link").click(); page.key(" ");
  const gl = render(page, 4100);
  const link = gl.draws.find(draw => draw.mode === gl.LINES);
  assert.ok(link && link.blend && link.depth && !link.write);
  const states = systemAt(START_DAYS + 4);
  assert.deepEqual(link.prog.values.get("uFrom"), states.mars.position);
  assert.deepEqual(link.prog.values.get("uTo"), states.sun.position);
  assert.ok(sourceTag(page, "sun").classList.contains("link-end"));
  sourceTag(page, "sun").click();
  expectRange(START_DAYS + 4, "sun", "mars");
  page.get("toggle-link").click(); render(page, 4200);
  assert.ok(!gl.draws.some(draw => draw.mode === gl.LINES));
  assert.equal(sourceTag(page, "mars").classList.contains("link-end"), false);
});

test("sector and signal layers are independent of tracks and survive a context interruption", () => {
  const page = application(), canvas = page.get("space");
  page.key("7"); page.key("v"); page.key("o"); page.key("l"); page.key("r");
  setTime(page, "2028-02-29T10:30");
  chooseReceiver(page, "neptune");
  page.key("m"); page.key("m", { repeat: true });
  let gl = render(page, 0);
  const count = mode => gl.draws.filter(draw => draw.mode === mode).length;
  assert.equal(count(gl.LINE_LOOP), 0);
  assert.equal(count(gl.TRIANGLE_FAN), 2);
  assert.equal(count(gl.LINE_STRIP), 2);
  page.get("toggle-sweeps").click();
  render(page, 500);
  assert.equal(count(gl.TRIANGLE_FAN), 0);
  assert.equal(count(gl.LINES), 1);
  assert.ok(page.get("sweep-key").hidden);
  canvas.emit("webglcontextlost");
  assert.equal(page.frames.size, 0);
  assert.ok(page.get("toggle-link").disabled && page.get("frame-orbit").disabled);
  const delay = text(page, "range-delay");
  canvas.emit("webglcontextrestored");
  gl = render(page, 90000);
  assert.equal(shownTime(page), "2028-02-29T10:30");
  assert.equal(text(page, "status-text"), "Paused");
  assert.equal(text(page, "view-name"), "Uranus orbit");
  assert.equal(text(page, "range-delay"), delay);
  assert.ok(pressed(page, "reverse") && pressed(page, "toggle-link"));
  assert.equal(count(gl.LINES), 1);
  assert.equal(count(gl.TRIANGLE_FAN), 0);
  page.key("s"); page.key("s", { repeat: true }); render(page, 90100);
  assert.equal(count(gl.TRIANGLE_FAN), 2);
});

test("pausing between readout refreshes immediately displays the final UTC minute", () => {
  const page = application();
  page.frame(0); page.frame(1000); page.frame(1050);
  page.get("play").click();
  assert.equal(shownTime(page), "2026-01-02T01:12");
  page.frame(9000);
  assert.equal(shownTime(page), "2026-01-02T01:12");
});

test("offline profiles can seek, forecast and measure while map controls stay unavailable", () => {
  const page = application({ offline: true });
  setTime(page, "2000-01-01T12:00");
  page.key("5");
  chooseReceiver(page, "neptune");
  const states = systemAt(0);
  assert.equal(text(page, "range-delay"), lightTimeText(signalRange(states.jupiter, states.neptune).lightSeconds));
  page.get("visit-aphelion").click();
  assert.equal(shownTime(page), dateAt(apsisDay(orbits.jupiter, 0, "aphelion")).toISOString().slice(0, 16));
  assert.equal(text(page, "status-text"), "View offline");
  assert.ok(page.get("toggle-sweeps").disabled && page.get("toggle-link").disabled && page.get("reverse").disabled);
  assert.equal(page.frames.size, 0);
});

test("interrupted drags and releases without an intermediate move cannot select a stale map target", () => {
  const page = application(), canvas = page.get("space"), states = systemAt(START_DAYS);
  page.frame(0);
  const view = new OrbitCamera(2).step(0, states, 2);
  const target = screenBodies(bodies, states, view, 900, 450).find(body => body.id === "jupiter");
  const up = { button: 0, pointerId: 8, clientX: target.x, clientY: target.y };
  canvas.emit("pointerdown", { ...up, clientX: target.x - 20 });
  canvas.emit("pointerup", up);
  assert.equal(text(page, "profile-name"), "Earth");
  for (const interrupt of ["visibilitychange", "webglcontextlost"]) {
    canvas.emit("pointerdown", up);
    if (interrupt === "visibilitychange") {
      page.doc.hidden = true; page.doc.emit(interrupt);
      page.doc.hidden = false; page.doc.emit(interrupt);
    } else {
      canvas.emit(interrupt); canvas.emit("webglcontextrestored");
    }
    assert.equal(canvas.classList.contains("dragging"), false);
    page.frame(1000);
    canvas.emit("pointerup", up);
    assert.equal(text(page, "profile-name"), "Earth");
  }
});
