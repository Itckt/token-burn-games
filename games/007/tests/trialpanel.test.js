"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./page-harness.js");
const cube = require("../js/cube.js");
const { formatMove } = require("../js/notation.js");
const { challenge } = require("../js/trials.js");
const { memoryStorage: storage } = require("./helpers.js");

function enterCode(page, text) {
  const field = page.get("trial-code");
  field.value = text;
  field.emit("input");
  return field;
}
function hide(page, hidden) {
  page.document.hidden = hidden;
  page.document.emit("visibilitychange");
}

test("the trial field validates without replacing the cube, respects typing and picks today's Hong Kong code", () => {
  const page = boot({ gl: null, epoch: Date.parse("2026-12-31T15:59:59.500Z") });
  const input = enterCode(page, "0-bad");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(page.get("trial-start").disabled);
  assert.match(page.text("trial-status"), /1–20/);
  for (const key of ["r", "s", "z", " "]) assert.equal(page.key(key, input).defaultPrevented, false);
  page.key("Enter", input);
  assert.deepEqual(page.moves(), cube.STARTER.map(formatMove));
  page.click("trial-daily");
  assert.equal(input.value, "12-20261231");
  page.frame(500);
  page.click("trial-daily");
  assert.equal(input.value, "12-20270101");
  assert.equal(input.getAttribute("aria-invalid"), "false");
  assert.equal(page.text("trial-status"), "12 scramble turns.");
  page.click("solve");
  assert.ok(page.get("trial-start").disabled);
  page.key("Enter", input);
  assert.equal(page.text("puzzle-state"), "Planning");
  page.click("reset-cube");
  page.key("Enter", input);
  assert.deepEqual(page.moves(), challenge(input.value).moves.map(formatMove));
  assert.equal(page.document.activeElement, page.get("cube-net"));
});

test("a trial runs through the net without WebGL, records the solving commit once, and reloads the personal best", () => {
  const store = storage(), page = boot({ gl: null, storage: store });
  page.settle();
  page.get("speed").value = "4";
  page.get("speed").emit("input");
  const input = enterCode(page, " 1-b ");
  page.click("trial-start");
  assert.equal(input.value, "1-B");
  assert.deepEqual(page.moves(), ["U′"]);
  assert.equal(page.text("trial-stage-code"), "1-B");
  assert.equal(page.text("speed-value"), "Trial pace");
  assert.equal(page.get("trial-stage").hidden, false);
  for (const id of ["scramble", "solve", "undo", "algorithm-play", "trial-code", "trial-daily", "speed"]) {
    assert.ok(page.get(id).disabled, id);
  }
  for (const key of ["s", "z", " "]) page.key(key, page.canvas);
  page.settle();
  page.frame(30000);
  assert.equal(page.intervals.size, 0);
  assert.equal(page.text("trial-time"), "0:00.00");
  assert.deepEqual(page.moves(), ["U′"]);
  page.get("cube-net").children.find(b => b.style.gridArea === "U").click();
  page.key("f", page.canvas); // Buffered after the turn that will solve.
  assert.equal(page.intervals.size, 1);
  page.frame(0);
  page.frame(80);
  assert.equal(page.text("trial-time"), "0:00.08");
  assert.equal(page.text("trial-turns"), "0");
  assert.equal(store.items.size, 0);
  page.frame(80);
  assert.equal(page.text("puzzle-state"), "Solved");
  assert.equal(page.text("trial-time"), "0:00.16");
  assert.equal(page.text("trial-stage-time"), "0:00.16");
  assert.equal(page.text("trial-turns"), "1");
  assert.deepEqual(page.moves(), ["U′", "U"]);
  assert.equal(page.text("trial-best"), "0:00.16");
  assert.equal(page.text("trial-best-turns"), "1 turn");
  assert.equal(store.items.size, 1);
  assert.equal(page.text("speed-value"), "2×");
  assert.equal(page.intervals.size, 0);
  page.frame(70000);
  assert.equal(page.text("trial-time"), "0:00.16");
  assert.equal(page.text("trial-start"), "Retry trial");
  page.click("trial-start");
  assert.deepEqual(page.moves(), ["U′"]);
  assert.equal(page.text("trial-turns"), "0");
  assert.equal(page.text("trial-time"), "0:00.00");
  const next = boot({ gl: null, storage: store });
  assert.equal(next.text("trial-best"), "—");
  enterCode(next, "1-b");
  assert.equal(next.text("trial-best"), "0:00.16");
  assert.equal(next.text("trial-time"), "0:00.00");
});

test("elapsed time includes hidden tabs and thinking time while the idle renderer sleeps", () => {
  const page = boot();
  enterCode(page, "1-b");
  page.click("trial-start");
  assert.equal(page.document.activeElement, page.canvas);
  page.key("l");
  page.frame(0);
  page.frame(80);
  page.frame(80);
  assert.equal(page.text("trial-turns"), "1");
  const drawn = page.getGL().frames;
  assert.equal(page.frames.size, 0);
  page.frame(5400);
  assert.equal(page.text("trial-time"), "0:05.56");
  assert.equal(page.getGL().frames, drawn);
  hide(page, true);
  assert.equal(page.intervals.size, 0);
  page.frame(60000);
  hide(page, false);
  assert.equal(page.intervals.size, 1);
  assert.equal(page.text("trial-time"), "1:05.56");
  page.key("l", page.canvas, { shiftKey: true });
  page.key("u");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Solved");
  assert.equal(page.text("trial-turns"), "3");
  assert.match(page.text("trial-best"), /^1:/);
  assert.equal(page.intervals.size, 0);
});

test("ending or resetting a partial trial discards pending turns and assisted solves never earn a best", () => {
  const store = storage(), page = boot({ gl: null, workers: false, storage: store });
  page.click("trial-start");
  page.key("u");
  page.key("b");
  page.frame(0);
  for (const ms of [80, 80, 50]) page.frame(ms);
  assert.equal(page.text("trial-turns"), "1");
  page.click("trial-end");
  assert.equal(page.get("trial-stage").hidden, true);
  assert.equal(page.intervals.size, 0);
  assert.equal(page.document.activeElement, page.get("trial-start"));
  page.settle();
  assert.deepEqual(page.moves(), [...challenge("3-HKBU").moves, "U"].map(formatMove));
  page.click("solve");
  page.settle();
  assert.equal(page.text("net-score"), "54 / 54 matched");
  assert.equal(page.text("trial-best"), "—");
  page.click("trial-start");
  page.key("r");
  page.frame(0);
  page.frame(80);
  page.click("reset-cube");
  page.settle();
  assert.equal(page.intervals.size, 0);
  assert.equal(page.get("trial-end").hidden, true);
  assert.equal(page.get("undo").disabled, true);
  assert.deepEqual(page.moves(), []);
  assert.equal(store.items.size, 0);
  assert.equal(page.text("trial-status"), "3 scramble turns.");
});

test("one half turn can solve a half-turn trial and counts once at the fixed animation boundary", () => {
  const page = boot({ gl: null });
  enterCode(page, "1-A");
  page.click("trial-start");
  page.key("2");
  page.key("f", page.canvas, { shiftKey: true });
  for (const ms of [0, 80, 80, 39]) page.frame(ms);
  assert.equal(page.text("trial-turns"), "0");
  page.frame(1);
  assert.equal(page.text("trial-turns"), "1");
  assert.equal(page.text("trial-time"), "0:00.20");
  assert.deepEqual(page.moves(), ["F2", "F2"]);
  assert.equal(page.text("puzzle-state"), "Solved");
});

test("a file origin that throws on localStorage access still supports timing, finishing and retry", () => {
  const page = boot({ gl: null, get storage() { throw Error("restricted file origin"); } });
  enterCode(page, "1-hkbu"); // D′
  page.click("trial-start");
  page.get("face-grid").children[cube.FACES.indexOf("D")].click();
  page.settle();
  assert.equal(page.text("trial-turns"), "1");
  const best = page.text("trial-time");
  assert.equal(page.text("trial-best"), best);
  page.click("trial-start");
  assert.equal(page.text("trial-time"), "0:00.00");
  assert.equal(page.text("trial-best"), best);
});
