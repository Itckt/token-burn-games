"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math");
const T = require("../js/track");
const G = require("../js/mesh");
const C = require("../js/camera");
const {near, vector} = require("./numeric");

test("vector operations use a right-handed basis and preserve their inputs", () => {
  const a = Object.freeze([2, -3, 4]), b = Object.freeze([-5, 1, 3]);
  vector(M.add(a, b), [-3, -2, 7]);
  vector(M.sub(a, b), [7, -4, 1]);
  vector(M.madd(a, b, 0.5), [-0.5, -2.5, 5.5]);
  vector(M.lerp(a, b, 1), b);
  near(M.dot(a, b), -1);
  const n = M.cross(a, b);
  near(M.dot(n, a), 0);
  near(M.dot(n, b), 0);
  vector(M.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  near(M.length(M.unit(a)), 1);
  vector(M.unit([0, 0, 0], b), b);
  vector(M.unit([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(M.bounds([a, b]), {min: [-5, -3, 3], max: [2, 1, 4]});
  assert.deepEqual(M.bounds([]), {min: [0, 0, 0], max: [0, 0, 0]});
});

test("view and orthographic matrices map eyes, clipping planes, and composed transforms", () => {
  const eye = [4, 7, 12], target = [1, 2, -3], view = M.lookAt(eye, target);
  vector(M.transform(view, eye), [0, 0, 0]);
  vector(M.transform(view, target), [0, 0, -M.length(M.sub(target, eye))]);
  const projection = M.ortho(-4, 8, -3, 7, 1, 51);
  vector(M.transform(projection, [-4, -3, -1]), [-1, -1, -1]);
  vector(M.transform(projection, [8, 7, -51]), [1, 1, 1]);
  vector(M.transform(M.multiply(projection, view), target), M.transform(projection, M.transform(view, target)));
  vector(M.multiply(M.identity(), view), view);
  for (const [p, look, up] of [[[0, 4, 0], [0, 0, 0], [0, 1, 0]], [eye, eye, [0, 0, 1]]]) {
    const parallel = M.lookAt(p, look, up);
    assert.ok(parallel.every(Number.isFinite));
    vector(M.transform(parallel, p), [0, 0, 0]);
  }
});

test("angular integration rotates a stripe by a quarter turn and keeps a unit quaternion", () => {
  let q = [0, 0, 0, 1];
  for (let i = 0; i < 360; i++) q = M.advanceRotation(q, [0, Math.PI / 2, 0], 1 / 360);
  near(Math.hypot(...q), 1, 1e-12);
  const model = M.modelMatrix([4, 3, 2], 2, q);
  vector(M.transform(model, [1, 0, 0]), [4, 3, 0], 6e-6);
  vector(M.transform(model, [0, 0, 0]), [4, 3, 2]);
});

const types = ["launch", ...T.LIBRARY.map(p => p.id), "rise", "finish"];
const start = {p: [-1, 7, 3], yaw: 0.71};
for (const type of types) {
  test(type + " has continuous distances, rigid frames, and a renderable solid mesh", () => {
    const s = T.piece(type, start);
    assert.equal(s.type, type);
    assert.ok(s.length > 0);
    vector(s.samples[0].p, start.p);
    vector(s.samples.at(-1).p, s.end.p);
    const dir = [Math.cos(s.end.yaw), 0, Math.sin(s.end.yaw)];
    vector(s.samples.at(-1).t, dir);
    let prev = -1;
    for (const f of [...s.samples, T.atDistance(s, s.length * 0.457)]) {
      vector(M.cross(f.t, f.n), f.b);
      for (const v of [f.t, f.n, f.b]) near(M.length(v), 1);
      near(M.dot(f.t, f.n), 0);
    }
    for (const f of s.samples) {
      assert.ok(f.s > prev);
      prev = f.s;
    }
    vector(T.atDistance(s, -1).p, start.p);
    vector(T.atDistance(s, s.length + 1).p, s.end.p);
    for (const miniature of [false, true]) {
      const mesh = G.sectionMesh(s, miniature);
      assert.ok(mesh.vertices instanceof Float32Array);
      assert.ok(mesh.indices instanceof Uint16Array);
      assert.equal(mesh.vertices.length % 9, 0);
      assert.equal(mesh.indices.length % 3, 0);
      assert.ok(mesh.indices.length > 100);
      const count = mesh.vertices.length / 9;
      assert.ok(mesh.indices.every(i => i < count));
      assert.ok(mesh.vertices.every(Number.isFinite));
      for (let i = 0; i < mesh.vertices.length; i += 9) {
        near(Math.hypot(...mesh.vertices.subarray(i + 3, i + 6)), 1, 2e-6);
        assert.ok(mesh.vertices.subarray(i + 6, i + 9).every(c => c >= 0 && c <= 1));
      }
      vector(mesh.vertices.subarray(0, 3), T.point(s.samples[0], 0, T.PROFILE[0][1], T.PROFILE[0][0]));
    }
  });
}

test("sphere triangles face outward and the procedural ground has upward normals", () => {
  const mesh = G.sphere(16, 12), v = mesh.vertices;
  assert.equal(mesh.indices.length / 3, 2 * 16 * 11);
  for (let i = 0; i < v.length; i += 9) {
    near(Math.hypot(...v.subarray(i, i + 3)), 1);
    vector(v.subarray(i + 3, i + 6), v.subarray(i, i + 3));
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = Array.from(mesh.indices.subarray(i, i + 3), index => v.subarray(index * 9, index * 9 + 3));
    assert.ok(M.dot(M.cross(M.sub(b, a), M.sub(c, a)), a) > 0);
  }
  const ground = G.ground();
  assert.equal(ground.indices.length, 6);
  for (let i = 0; i < ground.vertices.length; i += 9) {
    assert.equal(ground.vertices[i + 1], 0);
    vector(ground.vertices.subarray(i + 3, i + 6), [0, 1, 0]);
  }
  const oversized = new G.Builder();
  oversized.vertices.length = 65536 * 9;
  assert.throws(() => oversized.finish(), RangeError);
});

test("quarter turns mirror each other, ramps respect the table, and loops invert", () => {
  const pose = {p: [0, 4, 0], yaw: 0};
  const left = T.piece("left", pose), right = T.piece("right", pose);
  left.samples.forEach((a, i) => {
    const b = right.samples[i];
    vector(a.p, [b.p[0], b.p[1], -b.p[2]]);
    vector(a.n, [b.n[0], b.n[1], -b.n[2]]);
  });
  near(right.end.yaw - left.end.yaw, Math.PI);
  const descent = T.piece("ramp", pose), ascent = T.piece("ramp", descent.end);
  near(descent.end.p[1], T.MIN_HEIGHT);
  assert.ok(ascent.end.p[1] > descent.end.p[1]);
  assert.ok(T.piece("rise", pose).end.p[1] > pose.p[1]);
  const loop = T.piece("loop", pose);
  const crown = loop.samples.reduce((a, b) => a.p[1] > b.p[1] ? a : b);
  assert.ok(crown.n[1] < -0.99 && crown.t[0] < -0.9);
  assert.ok(crown.p[1] - pose.p[1] > 5);
  near(loop.end.p[1], pose.p[1]);
  assert.ok(loop.end.p[2] - pose.p[2] > 2);
  assert.throws(() => T.piece("unknown", pose), RangeError);
  assert.throws(() => T.piece("constructor", pose), RangeError);
});

test("all preset seams meet at the same position and cross section", () => {
  for (const layout of Object.values(T.PRESETS)) {
    const c = T.build(layout);
    assert.equal(c.sections.length, layout.pieces.length + 2);
    near(c.length, c.sections.reduce((acc, s) => acc + s.length, 0));
    assert.equal(c.sections[0].type, "launch");
    assert.equal(c.sections.at(-1).type, "finish");
    for (let i = 1; i < c.sections.length; i++) {
      const a = c.sections[i - 1].samples.at(-1), b = c.sections[i].samples[0];
      for (const field of ["p", "n", "b", "t"]) vector(a[field], b[field]);
      for (const [z, y] of T.PROFILE) vector(T.point(a, 0, y, z), T.point(b, 0, y, z));
    }
  }
});

test("one visible split gate sits halfway between release and flag in track metres", () => {
  for (const layout of [...Object.values(T.PRESETS), {height: 6, pieces: ["left","rise","right","brake"]}]) {
    const c = T.build(layout), gates = c.sections.filter(s => s.split);
    assert.equal(gates.length, 1);
    const section = gates[0];
    const lead = c.sections.slice(0,c.sections.indexOf(section)).reduce((sum,s) => sum+s.length,0);
    const finishAt = c.length - c.sections.at(-1).length + c.finish.s;
    near(lead + c.split.s - c.launch.s, finishAt - lead - c.split.s);
    assert.equal(section.split, c.split);
    vector(T.atDistance(section,c.split.s).p, c.split.p);
    const withGate = G.sectionMesh(section), plain = G.sectionMesh({...section, split: null});
    assert.ok(withGate.indices.length > plain.indices.length);
    assert.ok(withGate.vertices.every(Number.isFinite));
  }
});

test("history restores whole layouts, isolates presets, and discards a branched redo", () => {
  const e = new T.Editor(T.PRESETS.empty);
  assert.equal(e.remove(), false);
  assert.equal(e.undo(), false);
  assert.equal(e.append("launch"), false);
  assert.equal(e.load("constructor"), false);
  e.append("rise");
  e.append("loop");
  e.load("hairpin");
  assert.deepEqual(e.layout, T.PRESETS.hairpin);
  assert.ok(e.undo());
  assert.deepEqual(e.layout.pieces, ["rise", "loop"]);
  assert.equal(e.layout.name, T.PRESETS.empty.name);
  assert.ok(e.redo());
  e.undo();
  e.remove();
  assert.equal(e.redo(), false);
  assert.deepEqual(e.layout.pieces, ["rise"]);
  assert.deepEqual(T.PRESETS.empty.pieces, []);
});

test("the piece limit and undo history stay bounded under repeated edits", () => {
  const e = new T.Editor(T.PRESETS.empty);
  for (let i = 0; i < T.LIMIT; i++) assert.ok(e.append("straight"));
  assert.equal(e.append("loop"), false);
  assert.equal(e.layout.pieces.length, T.LIMIT);
  for (let i = 0; i < 100; i++) { e.remove(); e.append("left"); }
  assert.equal(e.past.length, 80);
  for (let i = 0; i < 80; i++) assert.ok(e.undo());
  assert.equal(e.undo(), false);
  assert.equal(e.future.length, 80);
});

test("all camera presets fit wide and portrait stages, including a long edited track", () => {
  const layouts = [T.PRESETS.switchback, T.PRESETS.empty, {height: 4, pieces: Array(48).fill("straight")}];
  for (const layout of layouts) {
    const c = T.build(layout), camera = new C.Orbit();
    camera.setCourse(c);
    for (const [w, h] of [[1050, 675], [320, 390], [1650, 470]]) {
      camera.resize(w, h, true);
      for (const key of Object.keys(C.VIEWS)) {
        assert.ok(camera.preset(key));
        const view = camera.update(0, true);
        for (const p of C.cloud(c)) {
          const [x, y, z] = M.transform(view.vp, p);
          assert.ok(Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(z) < 1, key + " clips the course");
        }
        near(M.dot(view.out, view.up), 0);
        near(M.dot(view.out, view.right), 0);
      }
    }
  }
});

test("orbit eases to its target, clamps poles and zoom, and finds the nearest preset angle", () => {
  const cam = new C.Orbit();
  cam.setCourse(T.build(T.PRESETS.switchback));
  cam.resize(800, 600, true);
  cam.orbit(3000, 9000);
  assert.ok(cam.wantPitch < Math.PI / 2);
  cam.zoom(1e9);
  near(cam.wantHalf, cam.fitHalf * 3.8);
  cam.zoom(1e-12);
  near(cam.wantHalf, cam.fitHalf * 0.25);
  const oldYaw = cam.yaw;
  cam.update(0.01);
  assert.ok(cam.yaw < oldYaw && cam.yaw > cam.wantYaw);
  cam.orbit(0, -9000);
  assert.ok(cam.wantPitch > 0);
  const prior = cam.wantYaw;
  assert.ok(cam.preset("front"));
  assert.ok(Math.abs(cam.wantYaw - prior) <= Math.PI);
  assert.equal(cam.preset("constructor"), false);
  for (let i = 0; i < 180; i++) cam.update(1 / 60);
  assert.equal(cam.moving(), false);
  near(cam.yaw, cam.wantYaw);
  near(cam.half, cam.fitHalf);
});

test("the initial view shows the full track hardware at a readable scale clear of the controls", () => {
  const course = T.build(T.PRESETS.switchback), camera = new C.Orbit();
  camera.setCourse(course);
  const points = [];
  for (const section of course.sections) {
    const v = G.sectionMesh(section).vertices;
    for (let i = 0; i < v.length; i += 9) points.push(v.subarray(i, i + 3));
  }
  for (const [width, height] of [[1108, 672], [360, 480]]) {
    camera.resize(width, height, true);
    const vp = camera.update(0).vp;
    const b = M.bounds(points.map(p => M.transform(vp, p)));
    assert.ok(b.min[0] > -1 && b.max[0] < 1);
    assert.ok((b.max[0] - b.min[0]) / 2 > 0.75);
    assert.ok((1 - b.max[1]) * height / 2 > 95, "space for the course heading");
    assert.ok((1 + b.min[1]) * height / 2 > 65, "space for the transport bar");
  }
});
