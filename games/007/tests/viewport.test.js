"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../js/math.js");
const cube = require("../js/cube.js");
const { boot } = require("./page-harness.js");
const { close, vectorClose } = require("./helpers.js");

function pointer(page, type, id, x, y, extra = {}) {
  return page.canvas.emit(type, { button: 0, pointerId: id, clientX: x, clientY: y, ...extra });
}
function screenPoint(page, position) {
  const rect = page.canvas.getBoundingClientRect(), camera = new math.Orbit().frame(rect.width / rect.height);
  const [x, y, , w] = math.transform(camera.vp, [...position, 1]);
  return [rect.left + (1 + x / w) * rect.width / 2, rect.top + (1 - y / w) * rect.height / 2];
}
const faceCenter = (page, face) => screenPoint(page, cube.FACE[face].normal.map(v => 1.503 * v));
const eye = page => page.getGL().programs[0].uniforms.uEye;
const distance = page => Math.hypot(...math.subtract(eye(page), [0, -0.13, 0]));

test("mouse clicks pick the visible geometric face, accept small hand jitter, and honor Shift", () => {
  const page = boot();
  page.click("reset-cube");
  page.settle();
  for (const face of ["F", "U", "R"]) {
    const [x, y] = faceCenter(page, face);
    pointer(page, "pointerdown", 1, x, y);
    assert.equal(page.canvas.captured, 1);
    pointer(page, "pointermove", 1, x + 2, y + 1);
    pointer(page, "pointerup", 1, x + 2, y + 1, { shiftKey: face === "U" });
    page.settle();
  }
  assert.deepEqual(page.moves(), ["F", "U′", "R"]);
});

test("a drag orbits smoothly without twisting, even when ending at the press point", () => {
  const page = boot();
  page.settle();
  const before = eye(page).slice(), [x, y] = faceCenter(page, "F");
  pointer(page, "pointerdown", 7, x, y);
  for (let i = 1; i <= 7; i++) pointer(page, "pointermove", 7, x + i, y);
  pointer(page, "pointermove", 7, x + 93, y + 28);
  assert.ok(page.canvas.classList.contains("dragging"));
  vectorClose(eye(page), before);
  page.frame();
  page.frame(16);
  const moving = eye(page).slice();
  assert.notDeepEqual(moving, before);
  page.settle();
  assert.notDeepEqual(eye(page), moving);
  pointer(page, "pointermove", 7, x, y);
  pointer(page, "pointerup", 7, x, y);
  page.settle();
  assert.equal(page.canvas.classList.contains("dragging"), false);
  assert.equal(page.text("turn-count"), "08");
  vectorClose(eye(page), before);
});

test("Alt-click selects and clears the actual corner without turning the cube or picking through an animation", () => {
  const page = boot();
  page.click("reset-cube");
  page.key("r");
  page.settle();
  function altClick(point) {
    const [x, y] = screenPoint(page, point);
    pointer(page, "pointerdown", 8, x, y, { altKey: true });
    pointer(page, "pointerup", 8, x, y, { altKey: true });
  }
  altClick([1, 1, 1.503]);
  page.settle();
  assert.equal(page.get("tracked-piece").value, "DFR");
  assert.equal(page.text("view-name"), "DFR at URF");
  assert.equal(page.getGL().draws.filter(d => d.focus === 1).length, 1);
  altClick([0, 0, 1.503]); // A center has no trackable edge or corner.
  assert.equal(page.get("tracked-piece").value, "DFR");
  altClick([1, 1, 1.503]);
  page.settle();
  assert.equal(page.get("tracked-piece").value, "");
  assert.deepEqual(page.moves(), ["R"]);
  page.key("u");
  page.frame(0);
  page.frame(70);
  altClick([-1, 1, 1.503]);
  page.settle();
  assert.equal(page.get("tracked-piece").value, "");
  assert.deepEqual(page.moves(), ["R", "U"]);
});

test("Half applies to picked faces, keys and the net, and switches cleanly between reverse and half turns", () => {
  const page = boot();
  page.click("reset-cube");
  page.click("prime");
  page.key("2", page.canvas);
  assert.equal(page.get("half").getAttribute("aria-pressed"), "true");
  assert.equal(page.get("prime").getAttribute("aria-pressed"), "false");
  assert.deepEqual(page.get("face-grid").children.map(b => b.textContent), cube.FACES.map(f => f + "2"));
  const [x, y] = faceCenter(page, "F");
  pointer(page, "pointerdown", 1, x, y);
  pointer(page, "pointerup", 1, x, y, { shiftKey: true });
  page.key("l");
  const down = page.get("cube-net").children.find(b => b.style.gridArea === "D");
  assert.match(down.getAttribute("aria-label"), /half turn/);
  down.click();
  page.click("prime");
  assert.equal(page.get("half").getAttribute("aria-pressed"), "false");
  page.get("face-grid").children[0].click();
  page.settle();
  assert.deepEqual(page.moves(), ["F2", "L2", "D2", "U′"]);
  page.click("half");
  page.click("half");
  assert.equal(page.key("2", page.get("trial-code")).defaultPrevented, false);
  page.key("2", page.canvas, { repeat: true });
  assert.equal(page.get("half").getAttribute("aria-pressed"), "false");
  assert.equal(page.get("prime").getAttribute("aria-pressed"), "false");
});

test("a two-finger pinch zooms and neither release produces a phantom turn", () => {
  const page = boot();
  page.settle();
  const start = distance(page), [x, y] = faceCenter(page, "F");
  pointer(page, "pointerdown", 1, x - 50, y);
  pointer(page, "pointerdown", 2, x + 50, y);
  pointer(page, "pointermove", 2, x + 80, y);
  pointer(page, "pointerup", 2, x + 80, y);
  pointer(page, "lostpointercapture", 2, x + 80, y);
  pointer(page, "pointerup", 1, x - 50, y);
  page.settle();
  close(distance(page), start / 1.3);
  assert.equal(page.text("turn-count"), "08");
  assert.equal(page.canvas.classList.contains("dragging"), false);
});

test("misses, right clicks, canceled touches, lost capture and focus loss leave the puzzle alone", () => {
  const page = boot();
  page.settle();
  const [x, y] = faceCenter(page, "F");
  for (const reason of ["pointercancel", "lostpointercapture", "blur"]) {
    pointer(page, "pointerdown", 1, x, y);
    page.canvas.emit(reason, { pointerId: 1 });
    pointer(page, "pointerup", 1, x, y);
  }
  pointer(page, "pointerdown", 5, x, y, { button: 2 });
  pointer(page, "pointerup", 5, x, y, { button: 2 });
  for (const [cx, cy] of [[42, 85], [-10, 90]]) {
    pointer(page, "pointerdown", 1, cx, cy);
    pointer(page, "pointerup", 1, cx, cy);
  }
  // A release can be far from the press even if no intermediate move was delivered.
  pointer(page, "pointerdown", 1, x - 20, y);
  pointer(page, "pointerup", 1, x, y);
  page.settle();
  assert.equal(page.text("turn-count"), "08");
});

test("wheel units, keyboard camera controls and Home work through the actual canvas bindings", () => {
  const page = boot();
  page.settle();
  const original = eye(page).slice(), home = distance(page);
  const event = page.canvas.emit("wheel", { deltaMode: 1, deltaY: -3 });
  assert.ok(event.defaultPrevented);
  page.settle();
  close(distance(page), home * Math.exp(-48 * 0.0011));
  page.canvas.emit("wheel", { deltaMode: 2, deltaY: 1 });
  page.settle();
  assert.ok(distance(page) > home);
  for (const k of ["ArrowRight", "ArrowUp", "+"]) assert.ok(page.key(k, page.canvas).defaultPrevented);
  page.settle();
  assert.notDeepEqual(eye(page), original);
  page.key("Home", page.canvas);
  page.settle();
  vectorClose(eye(page), original);
  page.key("ArrowLeft", page.canvas, { ctrlKey: true });
  assert.equal(page.frames.size, 0);
  page.key("ArrowDown", page.canvas);
  page.key("-", page.canvas);
  page.settle();
  assert.ok(distance(page) > home);
  page.click("reset-view");
  page.settle();
  vectorClose(eye(page), original);
  assert.equal(page.text("turn-count"), "08");
});
