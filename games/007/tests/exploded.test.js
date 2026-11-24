"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../js/math.js");
const cube = require("../js/cube.js");
const { close, vectorClose } = require("./helpers.js");
const { boot } = require("./page-harness.js");
const RecordingGL = require("./webgl-stub.js");

test("spacing holds the silhouette fixed and commutes with each of the 18 layer turns", () => {
  const pieces = cube.apply(cube.create(), cube.STARTER);
  let previousGap = -Infinity;
  for (const spread of [0, 0.2, 0.7, 1]) {
    const layout = math.pieceLayout(spread);
    close(layout.spacing + layout.scale / 2, 1.5);
    assert.ok(layout.spacing - layout.scale > previousGap);
    previousGap = layout.spacing - layout.scale;
    for (const move of cube.ALL_MOVES) {
      const { axis, side, quarter } = cube.describe(move);
      const rotation = math.rotation(axis, quarter * Math.PI / 2);
      const after = cube.turn(cube.clone(pieces), move);
      pieces.forEach((p, i) => {
        const before = math.model(p.basis, p.pos, layout);
        const turned = p.pos[axis] === side ? math.multiply(rotation, before) : before;
        vectorClose(math.model(after[i].basis, after[i].pos, layout), turned);
      });
    }
  }
});

test("expanded picking resolves every outward cell, empty gaps and the nearest interior plastic side", () => {
  for (const spread of [0.15, 0.65, 1]) {
    const layout = math.pieceLayout(spread), { spacing } = layout;
    for (const face of cube.FACES) {
      const [right, up, normal] = cube.FRAMES[face], direction = normal.map(n => -2 * n);
      for (const row of [-1, 0, 1]) for (const col of [-1, 0, 1]) {
        const slot = normal.map((n, i) => (n + col * right[i] + row * up[i]) || 0);
        const origin = normal.map((n, i) => 5 * n + spacing * (col * right[i] + row * up[i]));
        const hit = math.hitPieces(origin, direction, layout);
        assert.deepEqual(hit.slot, slot);
        assert.equal(hit.face, face);
        assert.ok(hit.exterior);
      }
      const gap = normal.map((n, i) => 5 * n + spacing * 0.5 * right[i]);
      assert.equal(math.hitPieces(gap, direction, layout), null);
    }
  }
  const layout = math.pieceLayout(1);
  const hit = math.hitPieces([-0.30, layout.spacing, 4], [0.4, 0, -1], layout);
  assert.equal(hit.face, "L");
  assert.deepEqual(hit.slot, [1, 1, 1]);
  assert.equal(hit.exterior, false);
  assert.equal(cube.pieceAtSurface(cube.turn(cube.create(), "R"), hit), "DFR");
});

test("reversing an inspection transition and resetting the camera preserve continuous, bounded motion", () => {
  const a = new math.Orbit(), b = new math.Orbit();
  a.setExploded(true);
  b.setExploded(true);
  a.step(64);
  b.step(16);
  b.step(48);
  close(a.spread, b.spread);
  assert.ok(a.spread > 0 && a.spread < 1);
  a.reset();
  assert.equal(a.goal.spread, 1);
  const halfway = a.spread;
  a.setExploded(false);
  close(a.spread, halfway);
  a.step(16);
  assert.ok(a.spread < halfway);
  for (let i = 0; i < 80; i++) a.step(16);
  assert.equal(a.step(16), false);
  close(a.spread, 0);
  a.setExploded(true, true);
  assert.equal(a.step(16), false);
  close(a.spread, 1);
});

function clickAt(page, point, modifiers = {}) {
  const rect = page.canvas.getBoundingClientRect();
  const camera = new math.Orbit().frame(rect.width / rect.height);
  const [x, y, , w] = math.transform(camera.vp, [...point, 1]);
  const event = { button: 0, pointerId: 22, clientX: rect.left + (1 + x / w) * rect.width / 2,
    clientY: rect.top + (1 - y / w) * rect.height / 2, ...modifiers };
  page.canvas.emit("pointerdown", event);
  page.canvas.emit("pointerup", event);
}

test("the viewport opens real gaps, tracks through a gap and turns an outward face with the existing buffers", () => {
  const p = boot(), gl = p.getGL(), buffers = gl.buffers.slice();
  p.click("reset-cube");
  p.settle();
  p.click("explode-view");
  p.frame(0);
  p.frame(30);
  const mid = gl.draws[1].model[0];
  assert.ok(mid < 1 && mid > math.pieceLayout(1).scale);
  p.settle();
  assert.equal(p.text("turn-count"), "00");
  assert.equal(p.get("explode-view").getAttribute("aria-pressed"), "true");
  const layout = math.pieceLayout(1);
  const pieces = cube.create();
  pieces.forEach((piece, i) => vectorClose(gl.draws[i + 1].model, math.model(piece.basis, piece.pos, layout)));
  // From the home camera this ray passes between two top-row pieces and
  // encounters the plastic right side of UF. It must not turn R.
  clickAt(p, [0.56, 1.18, 1.5]);
  assert.equal(p.frames.size, 0);
  clickAt(p, [0.56, 1.18, 1.5], { altKey: true });
  p.settle();
  assert.equal(p.get("tracked-piece").value, "UF");
  clickAt(p, [0, 0, 1.5], { shiftKey: true });
  p.settle();
  assert.deepEqual(p.moves(), ["F′"]);
  cube.turn(pieces, "F'");
  pieces.forEach((piece, i) => vectorClose(gl.draws[i + 1].model, math.model(piece.basis, piece.pos, layout)));
  assert.equal(gl.draws.length, 27);
  assert.equal(gl.buffers.length, buffers.length);
  buffers.forEach((buffer, i) => assert.equal(buffer, gl.buffers[i]));
  assert.equal(gl.textures[0].uploads, 1);
  p.key("Home", p.canvas);
  p.settle();
  close(Math.hypot(...gl.draws[1].model.slice(0, 3)), layout.scale);
  p.click("explode-view");
  p.settle();
  close(Math.hypot(...gl.draws[1].model.slice(0, 3)), 1);
  assert.equal(p.frames.size, 0);
});

test("reduced motion changes the layout in one frame and graphics restoration keeps the chosen view", () => {
  const p = boot();
  p.window.matchMedia = query => ({ matches: query === "(prefers-reduced-motion: reduce)" });
  p.settle();
  p.click("explode-view");
  assert.equal(p.settle(), 1);
  p.canvas.emit("webglcontextlost");
  assert.ok(p.get("explode-view").disabled);
  p.click("nav-simulator");
  assert.equal(p.document.activeElement, p.get("cube-net"));
  p.key("r", p.get("cube-net"));
  p.settle();
  const restored = new RecordingGL();
  p.setGL(restored);
  p.canvas.emit("webglcontextrestored");
  p.settle();
  assert.equal(p.get("explode-view").disabled, false);
  assert.equal(p.get("explode-view").getAttribute("aria-pressed"), "true");
  const pieces = cube.apply(cube.create(), [...cube.STARTER, "R"]);
  pieces.forEach((piece, i) => vectorClose(restored.draws[i + 1].model, math.model(piece.basis, piece.pos, math.pieceLayout(1))));
  assert.equal(p.text("turn-count"), "09");
  p.click("nav-simulator");
  assert.equal(p.document.activeElement, p.canvas);
});
