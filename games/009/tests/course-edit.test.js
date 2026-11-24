"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/track");
const B = require("../js/blueprint");
const {near} = require("./numeric");

test("profile distances include both bays, assign joins consistently, and capture a loop crown", () => {
  const layouts = [...Object.values(T.PRESETS), {height: 4, pieces: Array(T.LIMIT).fill("rise")}];
  for (const layout of layouts) {
    const course = T.build(layout);
    let distance = 0, peak = 0;
    for (const [i, section] of course.sections.entries()) {
      near(section.startDistance, distance);
      assert.equal(T.sectionIndexAt(course.sections, distance), i);
      assert.equal(T.sectionIndexAt(course.sections, distance + section.length - 1e-7), i);
      distance += section.length;
      for (const sample of section.samples) peak = Math.max(peak, sample.p[1]);
    }
    near(peak, course.peak);
    near(distance, course.length);
    assert.equal(T.sectionIndexAt(course.sections, -1), 0);
    assert.equal(T.sectionIndexAt(course.sections, course.length + 1), course.sections.length - 1);
    assert.equal(T.sectionIndexAt(course.sections, NaN), -1);
  }
  near(T.build({height: 4, pieces: ["loop"]}).peak, 9.5);
  assert.equal(T.sectionIndexAt([], 3), -1);
});

test("middle insert, move and delete each undo in one edit and round-trip in existing blueprints", () => {
  const layout = {name: "Studio switch", height: 6.5, pieces: ["ramp", "brake", "right"]};
  const editor = new T.Editor(layout);
  const history = [editor.layout];
  function edit(operation, pieces) {
    assert.ok(operation);
    assert.deepEqual(editor.layout.pieces, pieces);
    assert.deepEqual(B.decode(B.encode(editor.layout)), editor.layout);
    const course = T.build(editor.layout);
    for (let i = 1; i < course.sections.length; i++) {
      assert.deepEqual(course.sections[i - 1].end.p, course.sections[i].samples[0].p);
    }
    history.push(editor.layout);
  }
  edit(editor.insert(1, "rise"), ["ramp", "rise", "brake", "right"]);
  edit(editor.move(3, 1), ["ramp", "right", "rise", "brake"]);
  edit(editor.move(0, 3), ["right", "rise", "brake", "ramp"]);
  edit(editor.remove(1), ["right", "brake", "ramp"]);
  edit(editor.append("drive"), ["right", "brake", "ramp", "drive"]);
  edit(editor.remove(), ["right", "brake", "ramp"]);
  for (const previous of history.slice(0, -1).reverse()) {
    assert.ok(editor.undo());
    assert.deepEqual(editor.layout, previous);
  }
  for (const next of history.slice(1)) {
    assert.ok(editor.redo());
    assert.deepEqual(editor.layout, next);
  }
  assert.deepEqual(layout.pieces, ["ramp", "brake", "right"]);
});

test("invalid and identical edits preserve redo, and full tracks can still be reordered", () => {
  const editor = new T.Editor({name: "Limit", height: 4, pieces: Array(T.LIMIT - 1).fill("left")});
  editor.insert(0, "rise");
  assert.equal(editor.insert(0, "brake"), false);
  assert.ok(editor.move(0, T.LIMIT - 1));
  editor.undo();
  const current = editor.layout;
  for (const index of [-1, 0.5, "1", NaN, Infinity, T.LIMIT + 1]) {
    assert.equal(editor.move(index, 1), false);
    assert.equal(editor.move(1, index), false);
    assert.equal(editor.remove(index), false);
  }
  assert.equal(editor.move(1, 2), false);
  assert.equal(editor.move(0, 0), false);
  assert.equal(editor.layout, current);
  assert.ok(editor.redo());
  assert.equal(editor.layout.pieces.at(-1), "rise");
  assert.ok(editor.remove(0));
  for (const index of [T.LIMIT, -1, 1.5, "2"]) assert.equal(editor.insert(index, "ramp"), false);
  for (const type of ["finish", "constructor", undefined]) assert.equal(editor.insert(0, type), false);
  assert.ok(editor.insert(0, "loop"));
  assert.equal(editor.layout.pieces.length, T.LIMIT);
});
