"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { boot } = require("./page-harness.js");
const { slots, applyNet } = require("./papernet.js");
const { memoryStorage } = require("./helpers.js");
const cube = require("../js/cube.js");
const { formatMove } = require("../js/notation.js");

const solved = Object.fromEntries(Object.keys(slots).map(face => [face, Array(9).fill(face)]));
const slotButtons = page => page.get("checkpoint-slots").children;
const edgeButtons = page => page.get("cross-edges").children.map(item => item.children[0]);
function target(page, face) {
  const select = page.get("cross-face");
  select.value = face;
  select.emit("change");
}
function edit(page, id, value) {
  page.get(id).value = value;
  page.get(id).emit("input");
}
function verifyPosition(page, moves) {
  const net = applyNet(solved, moves);
  assert.equal(Number(page.text("turn-count")), moves.length);
  for (const button of page.get("cube-net").children) {
    assert.deepEqual(button.children.map(tile => tile.textContent), net[button.style.gridArea]);
  }
}
function verifyPreview(page, index, moves) {
  const net = applyNet(solved, moves);
  const preview = slotButtons(page)[index].children[1];
  assert.equal(preview.getAttribute("aria-hidden"), "true");
  assert.equal(preview.children.length, 6);
  for (const group of preview.children) {
    assert.deepEqual(group.children.map(tile => tile.style.backgroundColor),
      net[group.style.gridArea].map(face => cube.FACE[face].color));
  }
}

test("the cross coach can teach a whole cross one hint at a time through the WebGL fallback", () => {
  const page = boot({ gl: null, workers: false });
  assert.deepEqual(page.get("cross-face").children.map(o => o.value), cube.FACES);
  const tracked = edgeButtons(page)[0];
  tracked.click();
  assert.equal(page.get("tracked-piece").value, tracked.children[0].textContent);
  assert.equal(page.document.activeElement, page.get("cube-net"));
  page.click("prime");
  page.click("half"); // The coach plays the specified move even with a modifier selected.
  const moves = cube.STARTER.slice();
  let lastDistance = Infinity, hints = 0;
  while (page.text("cross-progress") !== "4 / 4 aligned") {
    page.click("cross-show");
    assert.ok(++hints <= 8);
    assert.equal(page.get("cross-play").hidden, false);
    assert.equal(page.document.activeElement, page.get("cross-play"));
    const distance = Number(page.text("cross-note").match(/(\d+) turns? to the cross/)[1]);
    assert.ok(lastDistance === Infinity || distance === lastDistance - 1);
    lastDistance = distance;
    const hint = page.text("cross-play").slice("Play ".length).replace("′", "'");
    assert.ok(cube.ALL_MOVES.includes(hint));
    verifyPosition(page, moves); // Revealing the move leaves the cube alone.
    page.click("cross-play");
    assert.equal(page.text("puzzle-state"), "Turning");
    assert.ok(page.get("cross-play").hidden && page.get("cross-show").disabled);
    page.settle();
    moves.push(hint);
    verifyPosition(page, moves);
    assert.equal(page.document.activeElement, page.get("cube-net"));
  }
  assert.equal(lastDistance, 1);
  assert.ok(page.get("cross-show").disabled);
  assert.ok(edgeButtons(page).every(b => b.classList.contains("aligned")));
  assert.match(page.text("cross-note"), /Cross complete/);
  assert.equal(page.text("puzzle-state"), "Mixed");
  assert.equal(page.workers.length, 0);
  page.click("undo");
  page.settle();
  assert.equal(page.get("cross-show").disabled, false);
  page.click("cross-show");
  assert.match(page.text("cross-note"), /1 turn to the cross/);
});

test("suggestions follow the selected cross and retire when the live cube, review or trial changes", () => {
  const p = boot({ gl: null });
  p.click("cross-show");
  target(p, "B");
  assert.ok(p.get("cross-play").hidden);
  assert.deepEqual(edgeButtons(p).map(b => b.children[0].textContent), cube.EDGES.filter(n => n.includes("B")));
  assert.equal(p.key("r", p.get("cross-face")).defaultPrevented, false);
  p.click("cross-show");
  p.click("algorithm-play");
  assert.ok(p.get("cross-play").hidden && p.get("cross-show").disabled);
  edit(p, "review-position", "2");
  assert.ok(p.get("cross-show").disabled);
  p.click("end-review");
  p.click("cross-show");
  p.key("u");
  p.settle();
  assert.ok(p.get("cross-play").hidden);
  p.click("cross-show");
  p.click("trial-start");
  assert.ok(p.get("cross-show").disabled && p.get("cross-play").disabled);
  assert.match(p.text("cross-note"), /trial ends/);
  p.get("cross-play").emit("click");
  assert.equal(p.text("trial-turns"), "0");
  assert.equal(p.intervals.size, 0);
  p.click("trial-end");
  p.click("reset-cube");
  for (const f of cube.FACES) {
    target(p, f);
    assert.equal(p.text("cross-progress"), "4 / 4 aligned");
    assert.ok(p.get("cross-show").disabled);
  }
  assert.deepEqual(p.moves(), []);
});

test("checkpoints capture a review boundary, retain their own preview, and restore history for undo and solving", () => {
  const store = memoryStorage(), p = boot({ gl: null, workers: false, storage: store });
  assert.equal(slotButtons(p).length, 3);
  assert.ok(p.get("checkpoint-restore").disabled && p.get("checkpoint-clear").disabled);
  edit(p, "algorithm-input", "R U2 L'");
  p.click("algorithm-play");
  edit(p, "review-position", "1");
  p.click("solve"); // Resume into the next turn, then save between boundaries.
  p.frame(0);
  p.frame(70);
  const saved = [...cube.STARTER, "R"];
  edit(p, "checkpoint-name", "  Before the cross  ");
  assert.equal(p.key("z", p.get("checkpoint-name")).defaultPrevented, false);
  p.click("checkpoint-save");
  assert.equal(slotButtons(p)[0].lastElementChild.textContent, "Before the cross");
  assert.equal(p.text("checkpoint-save"), "Replace slot");
  assert.match(p.text("checkpoint-status"), /saved on this device/);
  verifyPreview(p, 0, saved);
  p.settle();
  p.click("reset-cube");
  slotButtons(p)[1].click();
  p.click("checkpoint-save");
  verifyPreview(p, 1, []);
  assert.match(slotButtons(p)[1].getAttribute("aria-label"), /0 turns/);
  slotButtons(p)[0].click();
  assert.equal(p.get("checkpoint-name").value, "Before the cross");
  p.click("checkpoint-restore");
  assert.equal(p.document.activeElement, p.get("cube-net"));
  assert.deepEqual(p.moves(), saved.map(formatMove));
  assert.equal(p.text("sequence-label"), "Before the cross");
  assert.ok(p.get("review-bar").hidden);
  p.click("undo");
  p.settle();
  verifyPosition(p, cube.STARTER);
  p.click("solve");
  p.settle();
  assert.equal(p.text("puzzle-state"), "Solved");
  verifyPreview(p, 0, saved);
  const reopened = boot({ gl: null, storage: store });
  verifyPosition(reopened, cube.STARTER);
  reopened.click("checkpoint-restore");
  verifyPosition(reopened, saved);
  reopened.click("checkpoint-clear");
  assert.ok(reopened.get("checkpoint-restore").disabled);
  verifyPosition(reopened, saved);
  verifyPreview(reopened, 1, []);
  assert.equal(store.items.size, 1);
});

test("restore cancels partial actions, retires a pending solver worker and ignores its late response", () => {
  const p = boot({ gl: null });
  p.click("checkpoint-save");
  assert.match(p.text("checkpoint-status"), /session only/);
  p.click("solve");
  const worker = p.workers[0], ticket = worker.requests[0].ticket;
  p.click("checkpoint-restore");
  assert.ok(worker.terminated);
  assert.equal(p.urls.size, 0);
  worker.reply({ ticket, moves: cube.inverseSequence(cube.STARTER) });
  assert.equal(p.text("puzzle-state"), "Mixed");
  for (const action of ["algorithm-play", "scramble", "undo"]) {
    p.click(action);
    p.frame(0);
    p.frame(67);
    p.click("checkpoint-restore");
    p.settle();
    assert.ok(p.get("review-bar").hidden);
    assert.deepEqual(p.moves(), cube.STARTER.map(formatMove));
    verifyPosition(p, cube.STARTER);
  }
});

test("time trials lock checkpoint writes, restores and clears through inspection and the solving turn", () => {
  const store = memoryStorage(), p = boot({ gl: null, storage: store });
  p.click("checkpoint-save");
  const before = [...store.items.entries()];
  edit(p, "trial-code", "1-B");
  p.click("trial-start");
  const ids = ["checkpoint-save", "checkpoint-clear", "checkpoint-restore"];
  for (const id of ids) {
    assert.ok(p.get(id).disabled);
    p.get(id).emit("click");
  }
  assert.deepEqual(p.moves(), ["U′"]);
  assert.deepEqual([...store.items.entries()], before);
  p.key("u");
  p.frame(0);
  p.frame(80);
  for (const id of ids) assert.ok(p.get(id).disabled);
  p.frame(80);
  for (const id of ids) assert.equal(p.get(id).disabled, false);
  assert.equal(p.text("trial-best"), "0:00.16");
  p.click("checkpoint-restore");
  verifyPosition(p, cube.STARTER);
  assert.equal(p.text("trial-best"), "0:00.16");
});

test("storage updates refresh the affected thumbnail, preserve a typed name and accept clearing another tab", () => {
  const store = memoryStorage();
  const p = boot({ gl: null, storage: store }), other = boot({ gl: null, storage: store });
  edit(p, "checkpoint-name", "Unsaved name");
  slotButtons(other)[2].click();
  other.click("checkpoint-save");
  const [third] = store.items.keys();
  p.window.emit("storage", { key: third });
  verifyPreview(p, 2, cube.STARTER);
  assert.equal(p.get("checkpoint-name").value, "Unsaved name");
  slotButtons(other)[0].click();
  other.click("reset-cube");
  other.click("checkpoint-save");
  const first = [...store.items.keys()][1];
  p.window.emit("storage", { key: first });
  assert.equal(p.get("checkpoint-name").value, "Unsaved name");
  p.click("checkpoint-restore");
  verifyPosition(p, []);
  store.items.clear();
  p.window.emit("storage", { key: null });
  assert.ok(p.get("checkpoint-restore").disabled);
  assert.ok(slotButtons(p).every(button => button.lastElementChild.textContent === "Empty"));
});
