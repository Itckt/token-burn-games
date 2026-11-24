"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { parse, formatMove, PRESETS } = require("../js/notation.js");
const { boot } = require("./page-harness.js");
const RecordingGL = require("./webgl-stub.js");

function edit(page, text) {
  const input = page.get("algorithm-input");
  input.value = text;
  input.emit("input");
}
function seek(page, completed) {
  const slider = page.get("review-position");
  slider.value = String(completed);
  slider.emit("input");
}
function checkNet(page, moves) {
  const net = cube.facelets(cube.apply(cube.create(), moves));
  const buttons = page.get("cube-net").children;
  assert.deepEqual(buttons.map(b => b.style.gridArea), ["U", "L", "F", "R", "B", "D"]);
  let matches = 0;
  for (const button of buttons) {
    const face = button.style.gridArea, cells = net[face];
    assert.deepEqual(button.children.map(tile => tile.textContent), cells);
    for (const [i, tile] of button.children.entries()) {
      assert.equal(tile.style.getPropertyValue("--face"), cube.FACE[cells[i]].color);
      if (cells[i] === face) matches++;
    }
    assert.ok(button.getAttribute("aria-label").includes(cells.slice(6).join(" ")));
  }
  assert.equal(page.text("net-score"), matches + " / 54 matched");
}

test("the editor validates without changing the puzzle, respects typing, and loads and inverts every preset", () => {
  const page = boot({ gl: null }), input = page.get("algorithm-input");
  assert.equal(page.text("algorithm-feedback"), "4 turns");
  for (const key of ["r", "s", "z", " "]) assert.equal(page.key(key, input).defaultPrevented, false);
  for (const bad of ["", "R U (B X)2", "(RU)99999"]) {
    edit(page, bad);
    assert.ok(page.get("algorithm-play").disabled && page.get("algorithm-invert").disabled);
    assert.equal(input.getAttribute("aria-invalid"), String(bad !== ""));
    page.click("algorithm-play");
    assert.deepEqual(page.moves(), cube.STARTER.map(formatMove));
    if (bad.includes("X")) assert.match(page.text("algorithm-feedback"), /Character 8/);
  }
  const examples = page.get("algorithm-presets").children;
  assert.deepEqual(examples.map(b => b.textContent), PRESETS.map(p => p.name));
  examples.forEach((button, i) => {
    button.click();
    const moves = parse(PRESETS[i].text);
    assert.equal(input.value, PRESETS[i].text);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(page.text("algorithm-feedback"), moves.length + " turns");
    page.click("algorithm-invert");
    assert.deepEqual(parse(input.value), cube.inverseSequence(moves));
    page.click("algorithm-invert");
    assert.deepEqual(parse(input.value), moves);
  });
  assert.equal(page.text("turn-count"), "08");
});

test("editor playback, both step controls, scrubbing and Keep position share the same cube and history", () => {
  const page = boot({ gl: null, workers: false });
  const planned = ["R", "U'", "R", "U'", "F2"];
  edit(page, "(RU′)2 F2");
  page.click("algorithm-play");
  assert.equal(page.text("timeline-title"), "Algorithm steps");
  assert.equal(page.text("puzzle-state"), "Playing");
  assert.equal(page.get("review-bar").hidden, false);
  assert.deepEqual(page.moves(), planned.map(formatMove));
  edit(page, "L2");
  assert.ok(page.get("algorithm-play").disabled);
  assert.ok(page.get("cube-net").children.every(button => button.disabled));
  seek(page, 2);
  assert.equal(page.text("solve-label"), "Resume");
  checkNet(page, [...cube.STARTER, ...planned.slice(0, 2)]);
  assert.equal(page.get("review-position").getAttribute("aria-valuetext"), "2 of 5 turns complete");
  page.click("solve");
  page.frame();
  page.frame(75);
  page.click("solve");
  page.click("back-step");
  assert.equal(page.text("sequence-label"), "2 / 5"); // Return from a fractional turn to its start.
  page.click("back-step");
  assert.equal(page.text("sequence-label"), "1 / 5");
  page.click("step");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Paused");
  assert.equal(page.text("sequence-label"), "2 / 5");
  page.click("end-review");
  assert.ok(page.get("review-bar").hidden);
  const kept = [...cube.STARTER, ...planned.slice(0, 2)];
  assert.deepEqual(page.moves(), kept.map(formatMove));
  page.click("algorithm-play");
  page.settle();
  checkNet(page, [...kept, "L2"]);
  assert.deepEqual(page.moves(), ["L2"]);
  page.click("solve");
  page.settle();
  assert.equal(page.text("puzzle-state"), "Solved");
  checkNet(page, []);
});

test("a finished solution can be reviewed back to its starting mix and replayed without duplicating moves", () => {
  const page = boot({ workers: false, gl: null });
  page.click("solve");
  page.settle();
  const route = page.moves(), count = page.text("turn-count");
  assert.equal(page.get("replay").hidden, false);
  page.click("replay");
  assert.equal(page.text("puzzle-state"), "Solving");
  assert.equal(page.text("turn-count"), "08");
  checkNet(page, cube.STARTER);
  page.settle();
  assert.deepEqual(page.moves(), route);
  assert.equal(page.text("turn-count"), count);
  assert.equal(page.text("net-score"), "54 / 54 matched");
  seek(page, 0);
  assert.ok(page.get("back-step").disabled);
  assert.equal(page.text("puzzle-state"), "Paused");
  page.click("reset-cube");
  page.settle();
  assert.ok(page.get("review-bar").hidden && page.get("replay").hidden);
  assert.deepEqual(page.moves(), []);
  assert.equal(page.frames.size, 0);
});

test("the unfolded net works without WebGL, honors Prime and Shift, and changes only on completed turns", () => {
  const page = boot({ gl: null });
  assert.equal(page.get("net-shortcut").getAttribute("href"), "#cube-net");
  checkNet(page, cube.STARTER);
  page.click("reset-cube");
  const face = key => page.get("cube-net").children.find(button => button.style.gridArea === key);
  face("B").click({ shiftKey: true });
  page.frame();
  page.frame(40);
  checkNet(page, []);
  page.settle();
  checkNet(page, ["B'"]);
  page.click("prime");
  assert.match(face("D").getAttribute("aria-label"), /counterclockwise/);
  face("D").click();
  page.settle();
  assert.deepEqual(page.moves(), ["B′", "D′"]);
  checkNet(page, ["B'", "D'"]);
  page.click("undo");
  page.settle();
  checkNet(page, ["B'"]);
});

test("the WebGL fallback link is keyboard reachable in expanded view and opens the playable net", () => {
  const page = boot({ gl: null });
  page.click("expand-view");
  page.key("Tab", page.canvas, { shiftKey: true });
  assert.equal(page.document.activeElement, page.get("net-shortcut"));
  page.click("net-shortcut");
  assert.equal(page.get("expand-view").getAttribute("aria-pressed"), "false");
  assert.equal(page.document.activeElement, page.get("cube-net"));
  page.key("r", page.document.activeElement);
  page.settle();
  checkNet(page, [...cube.STARTER, "R"]);
});

test("lettering redraws a sleeping viewport and survives context loss and restoration", () => {
  const page = boot();
  page.settle();
  assert.equal(page.getGL().programs[0].uniforms.uLetters, 0);
  const count = page.text("turn-count");
  page.click("sticker-letters");
  assert.equal(page.settle(), 1);
  assert.equal(page.getGL().programs[0].uniforms.uLetters, 1);
  assert.equal(page.get("sticker-letters").getAttribute("aria-pressed"), "true");
  page.canvas.emit("webglcontextlost");
  assert.ok(page.get("sticker-letters").disabled);
  const restored = new RecordingGL();
  page.setGL(restored);
  page.canvas.emit("webglcontextrestored");
  page.settle();
  assert.equal(restored.programs[0].uniforms.uLetters, 1);
  assert.equal(restored.textures[0].uploads, 1);
  page.click("sticker-letters");
  page.settle();
  assert.equal(restored.programs[0].uniforms.uLetters, 0);
  assert.equal(page.text("turn-count"), count);
});

test("missing worker reply envelopes and message decoding errors recover from the committed history", () => {
  for (const failure of [null, undefined, {}, { ticket: "invalid" }, "decode"]) {
    const page = boot({ gl: null });
    page.click("solve");
    const worker = page.workers[0];
    if (failure === "decode") worker.messageError();
    else worker.reply(failure);
    assert.equal(page.text("puzzle-state"), "Solving");
    assert.deepEqual(page.moves(), cube.inverseSequence(cube.STARTER).map(formatMove));
    page.settle();
    assert.equal(page.text("puzzle-state"), "Solved");
  }
});

test("editor effects follow the draft across presets, errors and inversion without touching the current mix", () => {
  const page = boot({ gl: null }), counts = () =>
    ["effect-corners", "effect-edges", "effect-repeats"].map(id => page.text(id));
  assert.deepEqual(counts(), ["4", "3", "6×"]);
  page.get("algorithm-presets").children.find(b => b.textContent === "Three corners").click();
  assert.deepEqual(counts(), ["3", "0", "3×"]);
  edit(page, "[R:(U F)2]");
  const before = counts();
  page.click("algorithm-invert");
  assert.deepEqual(counts(), before);
  for (const text of ["[R,]", ""]) {
    edit(page, text);
    assert.deepEqual(counts(), ["—", "—", "—"]);
    assert.ok(page.get("algorithm-play").disabled);
  }
  assert.deepEqual(page.moves(), cube.STARTER.map(formatMove));
  edit(page, "[R,U]2");
  page.click("algorithm-play");
  assert.deepEqual(page.moves(), parse("[R,U]2").map(formatMove));
  edit(page, "R U");
  assert.deepEqual(counts(), ["6", "7", "105×"]);
  page.settle();
  checkNet(page, [...cube.STARTER, ...parse("[R,U]2")]);
});

function selectPiece(page, name) {
  const select = page.get("tracked-piece");
  select.value = name;
  select.emit("change");
}
function checkTracker(page, moves, name) {
  const pieces = cube.apply(cube.create(), moves), info = cube.inspectPiece(pieces, name);
  const marked = [];
  for (const face of page.get("cube-net").children) {
    for (const [i, sticker] of face.children.entries()) {
      if (sticker.classList.contains("tracked")) marked.push(face.style.gridArea + i);
    }
  }
  const cells = info ? info.stickers.map(s => s.face + s.index) : [];
  assert.deepEqual(marked.sort(), cells.sort());
  assert.equal(page.get("piece-location").hidden, !info);
  if (!info) assert.equal(page.text("piece-location"), "");
  if (info) {
    assert.ok(page.text("piece-location").includes(name + " at " + info.slot));
    for (const s of info.stickers) {
      assert.ok(page.text("piece-location").includes(s.home + " faces " + s.face));
      const face = page.get("cube-net").children.find(b => b.style.gridArea === s.face);
      assert.ok(face.getAttribute("aria-label").includes("Tracked " + name));
    }
  }
  if (page.get("render-error").hidden) {
    const draws = page.getGL().draws.slice(1);
    assert.deepEqual(draws.map(d => d.focus), pieces.map(p => info ? (p === info.piece ? 1 : -1) : 0));
  }
}

test("one physical piece stays highlighted across animation, backward review, branches and reset", () => {
  const page = boot();
  page.settle();
  const options = page.get("tracked-piece").children.flatMap(group => group.children.map(item => item.value));
  assert.deepEqual(options, [...cube.CORNERS, ...cube.EDGES]);
  const gl = page.getGL(), buffers = gl.buffers.slice();
  selectPiece(page, "URF");
  assert.equal(page.settle(), 1);
  checkTracker(page, cube.STARTER, "URF");
  page.click("reset-cube");
  edit(page, "R U F2");
  page.click("algorithm-play");
  page.frame(0);
  page.frame(60);
  checkTracker(page, [], "URF"); // The net is still at the last full turn.
  page.settle();
  checkTracker(page, ["R", "U", "F2"], "URF");
  seek(page, 1);
  page.settle();
  checkTracker(page, ["R"], "URF");
  selectPiece(page, "FR");
  page.click("end-review");
  page.key("b");
  page.settle();
  checkTracker(page, ["R", "B"], "FR");
  page.click("reset-cube");
  page.settle();
  checkTracker(page, [], "FR");
  selectPiece(page, "");
  page.settle();
  checkTracker(page, [], "");
  assert.equal(gl.draws.length, 27);
  assert.equal(gl.buffers.length, buffers.length);
  buffers.forEach((buffer, i) => assert.equal(gl.buffers[i], buffer));
});

test("selection works on the net alone and follows the same edge when the graphics context returns", () => {
  const page = boot({ gl: null });
  selectPiece(page, "BL");
  assert.equal(page.key("r", page.get("tracked-piece")).defaultPrevented, false);
  page.key("b", page.get("cube-net"), { shiftKey: true });
  page.settle();
  const moves = [...cube.STARTER, "B'"];
  checkTracker(page, moves, "BL");
  const gl = new RecordingGL();
  page.setGL(gl);
  page.canvas.emit("webglcontextrestored");
  page.click("sticker-letters");
  page.settle();
  checkTracker(page, moves, "BL");
  assert.equal(gl.programs[0].uniforms.uLetters, 1);
  assert.equal(gl.textures[0].uploads, 1);
  page.canvas.emit("webglcontextlost");
  selectPiece(page, "");
  page.settle();
  checkTracker(page, moves, "");
});
