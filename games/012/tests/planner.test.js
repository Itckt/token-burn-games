"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { application, MemoryStorage } = require("./fixtures");
const { START_DAYS, MAX_DAYS, dateAt, formatUTC } = require("../js/time");
const { encounterWindow, encounterPlan, rangeAt } = require("../js/encounters");
const { FieldLog } = require("../js/fieldlog");

const text = (page, id) => page.get(id).textContent;
const pressed = (page, id) => page.get(id).getAttribute("aria-pressed") === "true";
function choose(page, id, value, type = "change") {
  const node = page.get(id);
  node.value = value;
  node.emit(type);
}
function jump(page, iso) {
  page.key("t");
  page.get("time-input").value = iso;
  page.get("time-form").emit("submit");
}
function drawnTrails(page, time) {
  const gl = page.get("space").gl;
  gl.draws.length = 0;
  page.frame(time);
  return gl.draws.filter(draw => draw.tint);
}
const stamp = page => page.get("encounter-time").getAttribute("datetime");

test("the planner previews a frozen window while the main clock runs and closes without changing the atlas", () => {
  const p = application();
  p.frame(0);
  p.get("encounter-open").focus();
  p.get("encounter-open").click();
  assert.equal(p.doc.activeElement, p.get("encounter-from"));
  assert.equal(p.get("encounter-from").value, "earth");
  assert.equal(p.get("encounter-to").value, "mars");
  assert.equal(text(p, "encounter-time"), formatUTC(START_DAYS));
  assert.deepEqual(p.get("encounter-to").children.filter(o => o.disabled).map(o => o.value), ["earth"]);
  const span = encounterWindow("earth", "mars", START_DAYS, 1);
  choose(p, "encounter-cursor", "500", "input");
  const middle = span.start + (span.end - span.start) / 2;
  assert.equal(stamp(p), dateAt(middle).toISOString());
  assert.equal(text(p, "encounter-range"), rangeAt("earth", "mars", middle).au.toFixed(3) + " AU");
  assert.ok(Math.abs(parseFloat(p.get("encounter-guide").style.left) - 50) < 1e-8);
  assert.match(p.get("encounter-fill").style.clipPath, /^polygon\(/);
  assert.match(p.get("encounter-cursor").getAttribute("aria-valuetext"), /UTC.*AU/);
  p.frame(3000);
  assert.equal(p.get("sim-date").getAttribute("datetime"), "2026-01-04");
  assert.equal(stamp(p), dateAt(middle).toISOString());
  choose(p, "encounter-from", "mars");
  assert.equal(p.get("encounter-to").value, "earth");
  choose(p, "encounter-to", "saturn");
  p.key("2"); p.key("f"); p.key("p"); p.key("r"); p.key(" ");
  assert.equal(text(p, "profile-name"), "Earth");
  assert.equal(p.get("range-target").value, "mars");
  assert.equal(text(p, "view-name"), "System overview");
  p.key("Escape");
  assert.equal(p.doc.activeElement, p.get("encounter-open"));
  assert.equal(text(p, "status-text"), "Running");
  p.key("e");
  assert.equal(stamp(p), dateAt(START_DAYS + 3).toISOString());
  assert.equal(p.get("encounter-from").value, "earth");
  assert.equal(p.get("encounter-to").value, "mars");
});

test("visiting a turning point applies the exact instant and ordered pair while retaining playback and camera settings", () => {
  const p = application();
  p.key("p"); p.key("]"); p.key("r");
  p.key("e");
  assert.equal(p.get("encounter-cursor").value, "1000");
  choose(p, "encounter-from", "mercury");
  choose(p, "encounter-to", "venus");
  const span = encounterWindow("mercury", "venus", START_DAYS, -1);
  const event = encounterPlan("mercury", "venus", span).events[0];
  const button = p.get("encounter-events").children[0];
  button.click();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(stamp(p), dateAt(event.day).toISOString());
  assert.equal(text(p, "encounter-rate"), "0.00 km/s");
  p.get("encounter-apply").click();
  assert.equal(p.get("encounter-dialog").open, false);
  assert.equal(text(p, "status-text"), "Paused");
  assert.equal(text(p, "speed-value"), "−3 d/s");
  assert.equal(text(p, "profile-name"), "Mercury");
  assert.equal(p.get("range-target").value, "venus");
  assert.equal(text(p, "view-name"), "Mercury + Venus");
  assert.equal(text(p, "range-distance"), event.au.toFixed(3) + " AU");
  p.key("e");
  assert.equal(stamp(p), dateAt(event.day).toISOString());
});

test("earlier and later windows meet at their shared date and clip cleanly at both calendar limits", () => {
  const p = application({ offline: true });
  p.key("e");
  const first = encounterWindow("earth", "mars", START_DAYS, 1);
  p.get("encounter-next").click();
  assert.equal(stamp(p), dateAt(first.end).toISOString());
  assert.equal(p.get("encounter-cursor").value, "0");
  p.get("encounter-prev").click();
  assert.equal(stamp(p), dateAt(first.end).toISOString());
  assert.equal(p.get("encounter-cursor").value, "1000");
  choose(p, "encounter-cursor", "0", "input");
  assert.equal(stamp(p), dateAt(START_DAYS).toISOString());
  p.key("Escape");
  jump(p, "9999-12-31T23:59");
  p.key("e");
  assert.ok(p.get("encounter-next").disabled);
  assert.equal(text(p, "window-start"), "23:59:00 UTC");
  assert.equal(text(p, "window-end"), "23:59:59 UTC");
  assert.equal(p.get("encounter-empty").hidden, false);
  assert.equal(p.get("encounter-events").children.length, 0);
  choose(p, "encounter-cursor", "1000", "input");
  assert.equal(stamp(p), dateAt(MAX_DAYS).toISOString());
  p.get("encounter-apply").click();
  p.key("e");
  assert.ok(p.get("encounter-next").disabled && !p.get("encounter-prev").disabled);
  assert.equal(p.get("encounter-cursor").value, "1000");
  p.key("Escape");
  jump(p, "0001-01-01T00:00");
  p.key("e");
  assert.ok(p.get("encounter-prev").disabled && !p.get("encounter-next").disabled);
  assert.ok(!p.get("encounter-fill").style.clipPath.includes("NaN"));
  assert.equal(p.frames.size, 0);
});

test("pair view follows changes at either end, preserves swapped endpoints, and hands off to follow or orbit study", () => {
  const p = application();
  p.get("frame-pair").click();
  assert.ok(pressed(p, "frame-pair"));
  assert.equal(p.doc.activeElement, p.get("space"));
  p.key("p", { repeat: true });
  choose(p, "range-target", "neptune");
  assert.equal(text(p, "view-name"), "Earth + Neptune");
  p.key("8");
  assert.equal(text(p, "view-name"), "Neptune + Earth");
  assert.equal(p.get("range-target").value, "earth");
  p.get("expand").click(); p.key("Escape");
  assert.ok(pressed(p, "frame-pair"));
  p.key("f"); assert.equal(text(p, "view-name"), "Following Neptune");
  assert.equal(pressed(p, "frame-pair"), false);
  p.key("p"); p.key("v"); assert.equal(text(p, "view-name"), "Neptune orbit");
  p.key("p"); p.key("Escape"); assert.equal(text(p, "view-name"), "System overview");
  choose(p, "range-target", "sun");
  p.key("p"); assert.equal(text(p, "view-name"), "Neptune + Sun");
  p.key("0"); assert.equal(text(p, "view-name"), "System overview");
});

test("trail spacing, Sun-only endpoints and the calendar floor use the same window as the plotted dots", () => {
  const p = application();
  choose(p, "trail-span", "30");
  p.key("o"); p.key("s"); p.key(" ");
  assert.equal(drawnTrails(p, 0).length, 4);
  assert.equal(text(p, "trail-spacing"), "5 d per dot");
  assert.equal(p.get("trail-key").hidden, false);
  choose(p, "range-target", "sun");
  assert.ok(p.get("trail-to").hidden && !p.get("trail-from").hidden);
  assert.equal(drawnTrails(p, 100).length, 2);
  jump(p, "0001-01-01T12:00");
  assert.equal(text(p, "trail-spacing"), "2 h per dot");
  jump(p, "0001-01-01T00:01");
  assert.equal(text(p, "trail-spacing"), "10 s per dot");
  jump(p, "0001-01-01T00:00");
  assert.equal(text(p, "trail-spacing"), "Calendar start");
  assert.equal(drawnTrails(p, 200).length, 0);
  choose(p, "trail-span", "off");
  assert.ok(p.get("trail-key").hidden);
});

test("pair mode and trails resume after context loss, including a planner visit while the map is offline", () => {
  const p = application(), canvas = p.get("space");
  p.key("p");
  choose(p, "trail-span", "quarter");
  assert.equal(drawnTrails(p, 0).length, 4);
  p.get("expand").click(); canvas.emit("webglcontextlost");
  assert.equal(p.frames.size, 0);
  assert.ok(p.get("frame-pair").disabled && p.get("trail-span").disabled && p.get("trail-key").hidden);
  p.key("e");
  choose(p, "encounter-from", "uranus"); choose(p, "encounter-to", "neptune");
  p.get("encounter-events").children[0].click();
  const visited = stamp(p);
  p.get("encounter-apply").click();
  assert.equal(text(p, "profile-name"), "Uranus");
  assert.equal(text(p, "status-text"), "View offline");
  canvas.emit("webglcontextrestored");
  assert.equal(drawnTrails(p, 80000).length, 4);
  assert.equal(text(p, "status-text"), "Paused");
  assert.equal(text(p, "view-name"), "Uranus + Neptune");
  assert.ok(pressed(p, "frame-pair") && !p.get("frame-pair").disabled);
  assert.equal(p.get("trail-span").value, "quarter");
  assert.equal(p.get("trail-key").hidden, false);
  p.key("e"); assert.equal(stamp(p), visited);
});

test("named and unnamed notes restore the exact preview and pair across reloads, then remove just the chosen note", () => {
  const storage = new MemoryStorage(), p = application({ storage, offline: true });
  p.key("e");
  choose(p, "encounter-from", "venus");
  choose(p, "encounter-to", "neptune");
  p.get("encounter-events").children[0].click();
  const event = encounterPlan("venus", "neptune", encounterWindow("venus", "neptune", START_DAYS, 1)).events[0];
  p.get("note-name").value = "  After the studio crit  ";
  p.get("note-form").emit("submit");
  assert.equal(new FieldLog(storage).entries[0].day, event.day);
  p.get("note-name").value = "<evening & sky>";
  p.get("note-form").emit("submit");
  assert.equal(text(p, "note-count"), "1");
  choose(p, "encounter-cursor", "0", "input");
  p.get("note-form").emit("submit");
  assert.equal(text(p, "note-count"), "2");
  const reopened = application({ storage, classic: true, offline: true });
  reopened.key("e");
  const [recall] = reopened.get("note-list").children[0].children;
  assert.equal(recall.children[0].textContent, "<evening & sky>");
  assert.equal(recall.children[0].children.length, 0);
  recall.click();
  assert.equal(stamp(reopened), dateAt(event.day).toISOString());
  assert.equal(reopened.get("encounter-from").value, "venus");
  assert.equal(reopened.get("encounter-to").value, "neptune");
  assert.equal(text(reopened, "profile-name"), "Earth");
  reopened.get("encounter-apply").click();
  assert.equal(text(reopened, "profile-name"), "Venus");
  assert.equal(reopened.get("range-target").value, "neptune");
  reopened.key("e");
  reopened.get("note-list").children[0].children[1].click();
  assert.equal(text(reopened, "note-count"), "1");
  assert.equal(reopened.doc.activeElement, reopened.get("note-name"));
  assert.equal(new FieldLog(storage).entries[0].name, "Venus / Neptune");
  p.win.emit("storage");
  assert.equal(text(p, "note-count"), "1");
});

test("a denied or unavailable file storage area still allows saving, recalling and removing session observations", () => {
  for (const options of [{ denyStorage: true }, {}]) {
    const p = application({ offline: true, ...options });
    p.key("e");
    choose(p, "encounter-cursor", "213", "input");
    const instant = stamp(p);
    p.get("note-form").emit("submit");
    assert.match(text(p, "note-status"), /in memory for this session/);
    choose(p, "encounter-cursor", "700", "input");
    p.get("note-list").children[0].children[0].click();
    assert.equal(stamp(p), instant);
    p.key("Escape"); p.key("e");
    assert.equal(text(p, "note-count"), "1");
    p.get("note-list").children[0].children[1].click();
    assert.equal(text(p, "note-count"), "0");
  }
});

test("stale label buttons disappear immediately on resize or seek and held shortcuts cannot reopen a dismissed modal", () => {
  const p = application(), tags = p.get("map-labels").children;
  p.frame(0);
  assert.ok(tags.some(tag => !tag.hidden));
  p.resize("stage", 530, 440);
  assert.ok(tags.every(tag => tag.hidden) && p.get("selection-marker").hidden);
  p.frame(200);
  assert.ok(tags.some(tag => !tag.hidden));
  p.key(".");
  assert.ok(tags.every(tag => tag.hidden) && p.get("selection-marker").hidden);
  for (const [shortcut, dialog] of [["t", "time-dialog"], ["h", "observatory-dialog"], ["e", "encounter-dialog"]]) {
    p.key(shortcut); p.key("Escape"); p.key(shortcut, { repeat: true });
    assert.equal(p.get(dialog).open, false);
    p.key(shortcut, { target: p.get("trail-span") });
    assert.equal(p.get(dialog).open, false);
  }
});

test("closing a planner opened from a map control restores usable focus if WebGL was lost in the meantime", () => {
  const p = application(), follow = p.get("follow");
  follow.focus();
  p.key("e", { target: follow });
  p.get("space").emit("webglcontextlost");
  assert.ok(follow.disabled);
  p.key("Escape");
  assert.equal(p.doc.activeElement, p.get("encounter-open"));
});
