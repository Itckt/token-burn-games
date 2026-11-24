"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { application } = require("./fixtures.js");
const { project } = require("../js/math.js");
const { systemAt } = require("../js/physics.js");
const { moonInScene } = require("../js/lunar.js");
const { START_DAYS, dateAt } = require("../js/time.js");
const { sites, targets, observerAt, observe, degrees, chartPoint, dayPlan, dayWindow } = require("../js/sky.js");
const [kowloon, cape, dome] = sites;
const text = (page, id) => page.get(id).textContent;
const atlasTime = p => p.get("sim-date").getAttribute("datetime") + "T" + text(p, "sim-hour");
const eventButton = (p, kind) => p.get("sky-events").children.find(button => button.children[0].textContent === kind);
function change(p, id, value, event = "change") {
  const node = p.get(id);
  node.value = String(value);
  node.emit(event);
}
function setTime(p, value) {
  p.get("time-open").click();
  p.get("time-input").value = value;
  p.get("time-form").emit("submit");
}
function render(p, time) {
  const gl = p.get("space").gl;
  gl.draws.length = 0;
  assert.equal(p.frame(time), 1);
  return gl;
}

test("the file-style entry point opens a local preview lazily, isolates keyboard input and restores focus", () => {
  const p = application({ classic: true }), opener = p.get("sky-open");
  assert.equal(p.get("eyepiece").gl, undefined);
  p.frame(0);
  for (const key of ["?", "h"]) {
    assert.equal(p.key(key, { target: p.get("range-target") }).defaultPrevented, false);
    assert.equal(p.get("observatory-dialog").open || p.get("controls-dialog").open, false);
  }
  opener.focus(); opener.click();
  assert.ok(p.get("observatory-dialog").open && p.get("eyepiece").gl);
  assert.equal(p.doc.activeElement, p.get("sky-target"));
  assert.equal(p.get("sky-target").value, "moon");
  assert.equal(p.get("sky-target").children.length, targets.length);
  assert.equal(text(p, "sky-time"), "08:00 UTC+8");
  assert.match(text(p, "sky-visible"), /Moon below horizon/);
  assert.ok(p.get("sky-map").children.some(el => !el.hidden));
  for (const key of ["1", "r", "?", "t", " ", "."]) p.key(key);
  assert.equal(text(p, "profile-name"), "Earth");
  assert.equal(p.get("controls-dialog").open || p.get("time-dialog").open, false);
  change(p, "sky-minute", 23*60 + 10, "input");
  assert.equal(text(p, "sky-time"), "23:10 UTC+8");
  p.frame(2000);
  assert.equal(atlasTime(p), "2026-01-03T00:00");
  assert.equal(text(p, "sky-date"), "01 Jan 2026");
  p.key("Escape");
  assert.equal(p.doc.activeElement, opener);
  assert.equal(text(p, "status-text"), "Running");
  p.key("2"); p.key("h");
  assert.equal(p.get("sky-target").value, "venus");
  assert.equal(text(p, "sky-date"), "03 Jan 2026");
  assert.deepEqual(p.win.messages, []);
});

test("station and target controls update projected markers, horizon visibility, phase and angular units", () => {
  const p = application(); p.key("h");
  function expectSky(site, day) {
    const observer = observerAt(day, site);
    for (const body of targets) {
      const button = p.get("sky-map").children.find(el => el.getAttribute("data-name") === body.name);
      const view = observe(body.id, observer), point = chartPoint(view.altitude, view.azimuth);
      assert.equal(button.hidden, !point);
      if (point) {
        assert.ok(Math.abs(parseFloat(button.style.left) - (50 + 50*point.x)) < 1e-7);
        assert.ok(Math.abs(parseFloat(button.style.top) - (50 + 50*point.y)) < 1e-7);
      }
    }
  }
  expectSky(kowloon, START_DAYS);
  const sun = p.get("sky-map").children.find(el => el.getAttribute("data-name") === "Sun");
  assert.equal(sun.hidden, false);
  sun.click();
  assert.equal(p.get("sky-target").value, "sun");
  assert.equal(text(p, "sky-phase"), "Self-luminous");
  assert.equal(text(p, "sky-elongation"), "—");
  assert.match(text(p, "sky-size"), /′$/);
  change(p, "sky-site", cape.id);
  expectSky(cape, START_DAYS);
  assert.equal(text(p, "sky-time"), "02:00 UTC+2");
  assert.equal(text(p, "sky-light"), "Night");
  change(p, "sky-target", "venus");
  const venus = observe("venus", observerAt(START_DAYS, cape));
  assert.equal(text(p, "sky-size"), (degrees(venus.diameter)*3600).toFixed(1) + "″");
  assert.equal(text(p, "sky-phase"), (100*venus.illuminated).toFixed(1) + "%");
  assert.match(p.get("eyepiece").getAttribute("aria-label"), /Venus from Cape Town/);
  const firstPlanButton = p.get("sky-events").children[0];
  change(p, "sky-minute", 16*60, "input");
  assert.equal(p.get("sky-events").children[0], firstPlanButton);
  assert.match(p.get("altitude-fill").style.clipPath, /^polygon\(/);
  assert.ok(Math.abs(parseFloat(p.get("altitude-cursor").style.left) - 200/3) < 1e-6);
  assert.equal(p.get("sky-minute").getAttribute("aria-valuetext"), "16:00 UTC+2");
  p.get("sky-next").click(); assert.equal(text(p, "sky-date"), "02 Jan 2026");
  p.get("sky-prev").click(); assert.equal(text(p, "sky-date"), "01 Jan 2026");
  assert.equal(atlasTime(p), "2026-01-01T00:00");
});

test("applying a rise preserves the exact event instant, selected body, follow camera and signed playback speed", () => {
  const p = application();
  p.key("f"); p.key("]"); p.key("r"); p.key("h");
  const rise = dayPlan("moon", kowloon, dayWindow(START_DAYS, kowloon)).events.find(e => e.kind === "Rise");
  const button = eventButton(p, "Rise");
  button.click();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(text(p, "sky-alt"), "0°");
  assert.equal(atlasTime(p), "2026-01-01T00:00");
  p.get("sky-apply").click();
  assert.equal(p.get("observatory-dialog").open, false);
  assert.equal(atlasTime(p), dateAt(rise.day).toISOString().slice(0, 16));
  assert.equal(text(p, "status-text"), "Paused");
  assert.equal(text(p, "profile-name"), "Earth");
  assert.equal(text(p, "view-name"), "Following Earth");
  assert.equal(text(p, "speed-value"), "−3 d/s");
  // The rendered Moon moves detectably in the seconds between 15:40 and the actual rise.
  const gl = render(p, 100);
  const lunarDraw = gl.draws.filter(d => d.eyepiece === 0).at(-1);
  assert.deepEqual(lunarDraw.model, moonInScene(rise.day, systemAt(rise.day).earth).model);
  p.key("h"); assert.equal(text(p, "sky-alt"), "0°");
});

test("polar stations and local days with two upper crossings offer exactly the attainable events", () => {
  const p = application();
  p.key("h"); change(p, "sky-site", dome.id); change(p, "sky-target", "sun");
  assert.equal(p.get("sky-events").children.length, 1);
  assert.ok(eventButton(p, "Transit"));
  assert.match(text(p, "plan-note"), /Sun stays above/);
  change(p, "sky-target", "moon");
  assert.match(text(p, "plan-note"), /Moon stays below/);
  p.get("sky-close").click();
  setTime(p, "2026-01-16T12:00"); p.key("5"); p.key("h");
  change(p, "sky-site", kowloon.id);
  const transits = p.get("sky-events").children.filter(node => node.children[0].textContent === "Transit");
  assert.deepEqual(transits.map(node => node.children[1].textContent), ["00:03", "23:59"]);
  for (const button of transits) {
    button.click();
    assert.equal(text(p, "sky-time"), button.children[1].textContent + " UTC+8");
    assert.equal(p.get("sky-events").children.filter(b => b.getAttribute("aria-pressed") === "true").length, 1);
  }
});

test("calendar edges clip local day navigation and event jumps even when station time reaches year 10000", () => {
  const p = application({ offline: true });
  setTime(p, "0001-01-01T00:00"); p.key("h");
  const slider = p.get("sky-minute");
  assert.equal(slider.min, "480"); assert.equal(slider.max, "1439");
  assert.ok(p.get("sky-prev").disabled);
  assert.equal(p.get("hour-ticks").children[0].textContent, "08:00");
  p.get("sky-next").click(); assert.equal(slider.min, "0");
  p.get("sky-prev").click(); p.get("sky-apply").click();
  assert.equal(atlasTime(p), "0001-01-01T00:00");
  setTime(p, "9999-12-31T23:59"); p.key("h");
  assert.match(text(p, "sky-date"), /10000/);
  assert.ok(p.get("sky-next").disabled);
  assert.equal(slider.min, "0"); assert.equal(slider.max, "479");
  change(p, "sky-minute", 0, "input"); p.get("sky-apply").click();
  assert.equal(atlasTime(p), "9999-12-31T16:00");
  assert.equal(p.frames.size, 0);
});

test("the eyepiece can lose its own context, resize and recover without losing the preview", () => {
  const p = application();
  p.key("6"); p.key("h");
  const canvas = p.get("eyepiece");
  change(p, "sky-minute", 900, "input");
  p.resize("eyepiece-well", 228, 108);
  assert.deepEqual(canvas.gl.viewportSize, [228,108]);
  assert.ok(canvas.emit("webglcontextlost").defaultPrevented);
  assert.equal(canvas.hidden, true);
  assert.equal(p.get("eyepiece-error").hidden, false);
  assert.equal(p.get("graphics-error").hidden, true);
  change(p, "sky-target", "moon");
  const phase = text(p, "sky-phase");
  canvas.emit("webglcontextrestored");
  assert.equal(text(p, "sky-phase"), phase);
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.gl.draws.at(-1).eyepiece, 1);
  assert.equal(text(p, "sky-time"), "15:00 UTC+8");
  p.get("space").emit("webglcontextlost");
  eventButton(p, "Rise").click(); p.get("sky-apply").click();
  const when = atlasTime(p);
  p.get("space").emit("webglcontextrestored"); p.frame(9000);
  assert.equal(atlasTime(p), when);
  assert.equal(text(p, "status-text"), "Paused");
  const offline = application({ offline: true }); offline.key("h");
  assert.equal(offline.get("eyepiece-error").hidden, false);
  assert.match(text(offline, "sky-phase"), /%$/);
  eventButton(offline, "Transit").click(); offline.get("sky-apply").click();
  assert.equal(atlasTime(offline), "2026-01-01T14:42");
});

test("following Earth reveals a pickable Moon, hides its track with Orbits and keeps it out of other views", () => {
  const p = application(), canvas = p.get("space");
  const tag = p.get("map-labels").children.find(el => el.getAttribute("data-body") === "moon");
  p.frame(0); p.key(" "); p.key("f"); p.frame(2000);
  let gl = render(p, 4000);
  const tally = mode => gl.draws.filter(draw => draw.mode === mode).length;
  assert.equal(tally(gl.LINE_LOOP), 9); assert.equal(tally(gl.TRIANGLES), 11);
  assert.equal(tag.hidden, false);
  const lunar = moonInScene(START_DAYS, systemAt(START_DAYS).earth);
  const view = gl.draws.find(d => d.vp).vp;
  const point = project(lunar.position, view, 900, 450);
  const touch = { button: 0, pointerId: 7, clientX: point.x, clientY: point.y };
  canvas.emit("pointerdown", touch); canvas.emit("pointerup", touch);
  assert.ok(p.get("observatory-dialog").open);
  assert.equal(p.get("sky-target").value, "moon");
  p.key("Escape"); tag.click(); assert.ok(p.get("observatory-dialog").open);
  p.key("Escape"); p.key("o"); gl = render(p, 4200);
  assert.equal(tally(gl.LINE_LOOP), 0); assert.equal(tally(gl.TRIANGLES), 11);
  p.key("4"); gl = render(p, 4300);
  assert.ok(tag.hidden); assert.equal(tally(gl.TRIANGLES), 10);
  assert.equal(text(p, "view-name"), "Following Mars");
});

test("resizing invalidates old screen picks before the next animation frame", () => {
  const p = application(), canvas = p.get("space"), gl = render(p, 0);
  const pos = project(systemAt(START_DAYS).jupiter.position, gl.draws.find(d => d.vp).vp, 900, 450);
  const click = { button: 0, pointerId: 9, clientX: pos.x, clientY: pos.y };
  p.resize("stage", 720, 500);
  canvas.emit("pointerdown", click); canvas.emit("pointerup", click);
  assert.equal(text(p, "profile-name"), "Earth");
});
