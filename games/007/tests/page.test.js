"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cube = require("../js/cube.js");
const solver = require("../js/solver.js");
const math = require("../js/math.js");
const RecordingGL = require("./webgl-stub.js");
const { boot, root, html, scripts } = require("./page-harness.js");
const { vectorClose } = require("./helpers.js");

test("the file entry point loads every local script once, in dependency order, with no network assets", () => {
  const local = fs.readdirSync(path.join(root, "js")).map(file => "js/" + file);
  assert.deepEqual([...scripts].sort(), local.sort());
  assert.equal(scripts.at(-1), "js/app.js");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, references] of html.matchAll(/\b(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of references.split(/\s+/)) assert.ok(ids.includes(id), id);
  }
  for (const tag of html.match(/<script\b[^>]*>/g)) {
    assert.match(tag, /\bdefer\b/);
    assert.doesNotMatch(tag, /type=['"]module/);
  }
  for (const [, reference] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (reference.startsWith("#")) { assert.ok(ids.includes(reference.slice(1)), reference); continue; }
    if (reference.startsWith("data:")) continue;
    assert.match(reference, /^(?:js\/[a-z]+\.js|styles\.css)$/);
    assert.ok(fs.statSync(path.join(root, reference)).isFile());
  }
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(css, /@import\b|url\(\s*['"]?(?:https?:|\/\/)/i);
  for (const script of scripts) {
    const source = fs.readFileSync(path.join(root, script), "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/);
    for (const [, ref] of source.matchAll(/require\("([^"]+)"\)/g)) {
      assert.match(ref, /^\.\/[a-z]+\.js$/);
      assert.ok(local.includes("js/" + ref.slice(2)));
    }
  }
});

test("startup draws the mixed cube, builds six labeled controls and then stops requesting frames", () => {
  const page = boot();
  assert.equal(page.settle(), 1);
  assert.equal(page.frames.size, 0);
  assert.equal(page.text("puzzle-state"), "Mixed");
  assert.equal(page.text("turn-count"), "08");
  assert.equal(page.text("last-turn"), "U′");
  assert.deepEqual(page.moves(), cube.STARTER.map(m => m.replace("'", "′")));
  assert.equal(page.get("guide-faces").children.length, 6);
  assert.deepEqual(page.get("face-grid").children.map(b => b.textContent), cube.FACES);
  for (const [i, b] of page.get("face-grid").children.entries()) {
    assert.match(b.getAttribute("aria-label"), /clockwise/);
    assert.equal(b.style.getPropertyValue("--face"), cube.FACE[cube.FACES[i]].color);
  }
  assert.equal(page.get("render-error").hidden, true);
  assert.equal(page.getGL().draws.length, 27);
  assert.deepEqual(page.getGL().rect, [0, 0, 1200, 630]);
  assert.equal(page.workers.length, 0);
  page.canvas.clientWidth = 625;
  page.window.emit("resize");
  page.settle();
  assert.deepEqual(page.getGL().rect, [0, 0, 938, 630]);
});

test("face buttons, Prime, Shift, undo, speed and reset update both the puzzle and its readouts", () => {
  const page = boot();
  page.click("reset-cube");
  assert.equal(page.text("puzzle-state"), "Solved");
  assert.ok(page.get("solve").disabled && page.get("undo").disabled);
  assert.deepEqual(page.moves(), []);
  page.get("face-grid").children[1].click();
  assert.equal(page.text("puzzle-state"), "Turning");
  assert.equal(page.text("turn-count"), "00");
  page.key("f", page.canvas, { shiftKey: true });
  page.settle();
  assert.deepEqual(page.moves(), ["R", "F′"]);
  page.click("prime");
  assert.equal(page.get("prime").getAttribute("aria-pressed"), "true");
  assert.equal(page.get("face-grid").children[0].textContent, "U′");
  page.get("face-grid").children[0].click();
  page.settle();
  assert.equal(page.text("last-turn"), "U′");
  page.key("z");
  page.settle();
  assert.deepEqual(page.moves(), ["R", "F′"]);
  page.get("speed").value = "4";
  page.get("speed").emit("input");
  assert.equal(page.text("speed-value"), "2×");
  assert.equal(page.get("speed").style.getPropertyValue("--fill"), "100%");
  assert.equal(page.get("speed").getAttribute("aria-valuetext"), "2 times");
  page.click("reset-cube");
  page.settle();
  assert.equal(page.text("turn-count"), "00");
  assert.equal(page.text("last-turn"), "—");
  assert.match(page.get("sequence").textContent, /scramble to start/);
  assert.match(page.text("announcement"), /Solved/);
});

test("scramble animates, locks competing commands and can be canceled midway with reset", () => {
  const page = boot();
  page.key("s");
  assert.equal(page.text("puzzle-state"), "Scrambling");
  assert.equal(page.moves().length, 20);
  assert.ok(page.get("scramble").disabled && page.get("solve").disabled);
  assert.ok(page.get("face-grid").children.every(b => b.disabled));
  page.key("u");
  page.key(" ");
  page.frame();
  page.frame(75);
  page.frame(75);
  assert.ok(Number(page.text("turn-count")) >= 1);
  page.click("reset-cube");
  page.settle();
  assert.deepEqual(page.moves(), []);
  assert.equal(page.text("puzzle-state"), "Solved");
  page.click("scramble");
  const planned = page.moves();
  page.settle();
  assert.deepEqual(page.moves(), planned);
  assert.equal(page.text("sequence-label"), "Scramble");
  assert.equal(page.text("turn-count"), "20");
  assert.equal(page.text("puzzle-state"), "Mixed");
  assert.equal(page.get("solve").disabled, false);
});

test("automatic solution playback pauses mid-layer, advances exactly one step and finishes solved", () => {
  const page = boot();
  page.key(" ");
  assert.equal(page.text("puzzle-state"), "Planning");
  const worker = page.workers[0], { ticket, state } = worker.requests[0];
  assert.deepEqual(state, cube.coordinates(cube.apply(cube.create(), cube.STARTER)));
  const moves = solver.solve(state), length = cube.simplify(moves).length;
  worker.reply({ ticket, moves });
  assert.equal(page.text("solve-label"), "Pause");
  assert.equal(page.text("timeline-title"), "Solution steps");
  assert.equal(page.text("sequence-label"), "0 / " + length);
  page.frame();
  page.frame(60);
  page.click("solve");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Paused");
  assert.equal(page.get("step").hidden, false);
  const partial = page.getGL().draws.map(d => d.model);
  page.frame(4000);
  assert.deepEqual(page.getGL().draws.map(d => d.model), partial);
  page.click("step");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Paused");
  assert.equal(page.text("sequence-label"), "1 / " + length);
  assert.equal(page.text("turn-count"), "09");
  const current = page.get("sequence").children.filter(token => token.getAttribute("aria-current") === "step");
  assert.equal(current.length, 1);
  assert.equal(current[0].textContent, page.moves()[1]);
  page.key(" ");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Solved");
  assert.equal(page.text("sequence-label"), length + " / " + length);
  assert.equal(Number(page.text("turn-count")), 8 + length);
  assert.ok(page.get("step").hidden && page.get("solve").disabled);
  page.click("undo");
  page.settle();
  page.click("solve");
  assert.equal(page.workers.length, 1);
  assert.equal(worker.requests.length, 2);
});

test("reset retires a pending worker and late or duplicate replies cannot change the new puzzle", () => {
  const page = boot();
  page.click("solve");
  const old = page.workers[0], oldTicket = old.requests[0].ticket;
  page.click("reset-cube");
  assert.ok(old.terminated);
  assert.equal(page.urls.size, 0);
  page.key("l");
  page.settle();
  page.click("solve");
  const current = page.workers[1], ticket = current.requests[0].ticket;
  old.reply({ ticket: oldTicket, moves: ["R"] });
  current.reply({ ticket: oldTicket, moves: ["R"] });
  assert.equal(page.text("puzzle-state"), "Planning");
  current.reply({ ticket, moves: ["L'"] });
  current.reply({ ticket, moves: ["U"] });
  page.settle();
  assert.equal(page.text("puzzle-state"), "Solved");
  assert.deepEqual(page.moves(), ["L′"]);
});

test("blocked workers, asynchronous worker errors, and invalid replies all recover with legal animated turns", () => {
  for (const failure of ["blocked", "error", "bad route", "worker reply error"]) {
    const page = boot({ workers: failure !== "blocked", gl: null });
    page.click("solve");
    const worker = page.workers[0];
    if (failure === "error") worker.fail();
    if (failure === "bad route") worker.reply({ ticket: worker.requests[0].ticket, moves: ["D"] });
    if (failure === "worker reply error") worker.reply({ ticket: worker.requests[0].ticket, error: "failed" });
    assert.equal(page.text("puzzle-state"), "Solving");
    page.settle();
    assert.equal(page.text("puzzle-state"), "Solved");
    assert.equal(page.moves().length, cube.STARTER.length);
  }
});

test("the guide, expanded view and keyboard shortcuts respect focus and modifier keys", () => {
  const page = boot();
  page.click("guide-open");
  assert.ok(page.get("guide").open);
  page.key("r");
  page.key(" ");
  assert.equal(page.text("puzzle-state"), "Mixed");
  page.click("guide-close");
  assert.equal(page.get("guide").open, false);
  page.click("nav-simulator");
  assert.equal(page.document.activeElement, page.canvas);
  page.click("expand-view");
  assert.equal(page.get("expand-view").getAttribute("aria-pressed"), "true");
  assert.ok(page.document.body.classList.contains("expanded-view"));
  assert.ok(page.key("Tab", page.canvas, { shiftKey: true }).defaultPrevented);
  assert.equal(page.document.activeElement, page.get("expand-view"));
  page.key("Escape");
  assert.equal(page.get("expand-icon").getAttribute("href"), "#i-expand");
  assert.equal(page.document.body.classList.contains("expanded-view"), false);
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "repeat"]) page.key("r", page.canvas, { [modifier]: true });
  page.key("f", page.get("speed"));
  assert.equal(page.key(" ", page.get("prime")).defaultPrevented, false);
  page.settle();
  assert.equal(page.text("turn-count"), "08");
});

test("unavailable WebGL has an actionable message; context restoration draws the retained puzzle", () => {
  const page = boot({ gl: null });
  page.settle();
  assert.equal(page.get("render-error").hidden, false);
  assert.match(page.text("render-error-text"), /WebGL/);
  assert.match(page.text("render-error-text"), /hardware acceleration/);
  const lost = page.canvas.emit("webglcontextlost");
  assert.ok(lost.defaultPrevented);
  page.click("reset-cube");
  page.key("r");
  page.settle();
  assert.equal(page.text("turn-count"), "01");
  const gl = new RecordingGL();
  page.setGL(gl);
  page.canvas.emit("webglcontextrestored");
  page.settle();
  assert.ok(page.get("render-error").hidden);
  const pieces = cube.turn(cube.create(), "R");
  gl.draws.slice(1).forEach(({ model }, i) => vectorClose(model, math.model(pieces[i].basis, pieces[i].pos)));
  page.canvas.emit("webglcontextlost");
  assert.equal(page.get("render-error").hidden, false);
  assert.match(page.text("render-error-text"), /reconnect/);
});

test("hiding the page suspends the animation clock and reopening it resumes at the same turn", () => {
  const page = boot();
  page.click("scramble");
  page.frame();
  page.frame(40);
  page.document.hidden = true;
  page.document.emit("visibilitychange");
  assert.equal(page.frames.size, 0);
  page.frame(360000);
  page.document.hidden = false;
  page.document.emit("visibilitychange");
  page.frame();
  assert.equal(page.text("turn-count"), "00");
  page.settle();
  assert.equal(page.text("turn-count"), "20");
});
