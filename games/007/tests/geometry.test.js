"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../js/math.js");
const mesh = require("../js/mesh.js");
const cube = require("../js/cube.js");
const { close, vectorClose } = require("./helpers.js");

function projected(vp, point) {
  const [x, y, z, w] = math.transform(vp, [...point, 1]);
  return [x / w, y / w, z / w];
}

test("vectors and column-major rigid transforms preserve orientation and order", () => {
  vectorClose(math.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  close(math.dot([1, 2, -3], [4, 1, 2]), 0);
  vectorClose(math.unit([3, 4, 0]), [0.6, 0.8, 0]);
  assert.deepEqual(math.unit([0, 0, 0]), [0, 0, 0]);
  const model = math.model([1,0,0, 0,1,0, 0,0,1], [2, 3, 4]);
  const point = [1, 0, 0, 1], normal = [1, 0, 0, 0];
  vectorClose(math.transform(model, point), [3, 3, 4, 1]);
  vectorClose(math.transform(model, normal), normal);
  const rot = math.rotation(2, Math.PI / 2);
  vectorClose(math.transform(math.multiply(rot, model), point), [-3, 3, 4, 1]);
  vectorClose(math.transform(math.multiply(model, rot), point), [2, 4, 4, 1]);
});

test("continuous layer rotation ends at the exact cubie transform on all 18 turns", () => {
  const start = cube.apply(cube.create(), cube.STARTER);
  for (const move of cube.ALL_MOVES) {
    const after = cube.turn(cube.clone(start), move);
    const { axis, side, quarter } = cube.describe(move);
    const rotation = math.rotation(axis, quarter * Math.PI / 2);
    start.forEach((piece, i) => {
      const before = math.model(piece.basis, piece.pos);
      const expected = piece.pos[axis] === side ? math.multiply(rotation, before) : before;
      vectorClose(math.model(after[i].basis, after[i].pos), expected);
    });
  }
});

test("lookAt centers the target, maps the eye to the origin and uses WebGL depth", () => {
  const view = math.lookAt([4, 5, 6], [0, 0, 0]);
  vectorClose(math.transform(view, [4, 5, 6, 1]), [0, 0, 0, 1]);
  vectorClose(math.transform(view, [0, 0, 0, 1]), [0, 0, -Math.sqrt(77), 1]);
  const projection = math.perspective(Math.PI / 2, 2, 1, 20);
  vectorClose(projected(projection, [2, 1, -1]), [1, 1, -1]);
  close(projected(projection, [0, 0, -20])[2], 1);
});

test("the home camera frames every corner in tall, square and wide viewports", () => {
  const orbit = new math.Orbit();
  for (const aspect of [0.45, 1, 1.8, 3.2]) {
    const { vp } = orbit.frame(aspect);
    const screen = [];
    for (const x of [-1.504, 1.504]) for (const y of [-1.504, 1.504]) for (const z of [-1.504, 1.504]) {
      const p = projected(vp, [x, y, z]);
      assert.ok(p.every(n => Math.abs(n) < 1));
      screen.push(p);
    }
    const axis = aspect < 1 ? 0 : 1;
    const extent = screen.map(p => p[axis]);
    assert.ok(Math.max(...extent) - Math.min(...extent) > 1.4);
  }
});

test("ray intersection handles all six sides, parallel rays, interior starts and misses", () => {
  for (const face of cube.FACES) {
    const n = cube.FACE[face].normal;
    assert.equal(math.hitFace(n.map(v => v * 7), n.map(v => -v)), face);
    assert.equal(math.hitFace([0, 0, 0], n), face);
    assert.equal(math.hitFace(n.map(v => v * 7), n), null);
  }
  assert.equal(math.hitFace([2, 0, 5], [0, 0, -1]), null);
  assert.equal(math.hitFace([3, 0, 4], [-1, 0, -0.01]), null);
  assert.equal(math.hitFace([0, 0, 0], [0, 0, 0]), null);
});

test("camera picking inverts projection at visible face centers from above and below", () => {
  const orbit = new math.Orbit(), seen = new Set();
  for (const yaw of [0.6, 2.3, -1, -2.3]) for (const pitch of [0.58, -0.7]) {
    orbit.yaw = yaw;
    orbit.pitch = pitch;
    for (const aspect of [0.6, 1.8]) {
      const { eye, vp } = orbit.frame(aspect);
      for (const f of cube.FACES) {
        const n = cube.FACE[f].normal;
        if (math.dot(eye, n) <= 1.504) continue;
        const [x, y] = projected(vp, n.map(v => v * 1.503));
        assert.equal(orbit.pick(x, y, aspect), f);
        seen.add(f);
      }
      assert.equal(orbit.pick(1, 1, aspect), null);
    }
  }
  assert.equal(seen.size, 6);
});

test("orbit easing is frame-rate independent, bounded at the poles, and takes the short way home", () => {
  const a = new math.Orbit(), b = new math.Orbit();
  const yaw = a.yaw;
  a.drag(3000, 9000);
  b.drag(3000, 9000);
  assert.ok(a.goal.pitch < Math.PI / 2);
  a.zoom(999999);
  b.zoom(999999);
  assert.equal(a.goal.distance, 15);
  a.step(32);
  b.step(12);
  b.step(20);
  for (const key of ["pitch", "yaw", "distance"]) close(a[key], b[key]);
  assert.notEqual(a.yaw, a.goal.yaw);
  for (let i = 0; i < 100; i++) a.step(16);
  a.reset();
  assert.ok(Math.abs(a.goal.yaw - a.yaw) <= Math.PI);
  close(Math.sin(a.goal.yaw), Math.sin(yaw));
  a.drag(0, -9000);
  a.zoomBy(0.000001);
  assert.ok(a.goal.pitch > -Math.PI / 2);
  assert.equal(a.goal.distance, 6.7);
  for (let i = 0; i < 120; i++) a.step(16);
  assert.equal(a.step(16), false);
});

function checkSurface(part) {
  const { vertices, indices } = part;
  assert.equal(vertices.length % mesh.STRIDE, 0);
  assert.equal(indices.length % 3, 0);
  assert.ok(vertices.every(Number.isFinite));
  for (let offset = 0; offset < vertices.length; offset += mesh.STRIDE) {
    close(Math.hypot(...vertices.slice(offset + 3, offset + 6)), 1);
    assert.ok(vertices.slice(offset + 6, offset + 10).every(n => n >= 0 && n <= 1));
  }
  for (let i = 0; i < indices.length; i += 3) {
    const corners = indices.slice(i, i + 3);
    assert.ok(corners.every(index => Number.isInteger(index) && index >= 0 && index < vertices.length / mesh.STRIDE));
    const [a, b, c] = corners.map(index => vertices.slice(index * mesh.STRIDE, index * mesh.STRIDE + 3));
    const normal = vertices.slice(corners[0] * mesh.STRIDE + 3, corners[0] * mesh.STRIDE + 6);
    const winding = math.cross(math.subtract(b, a), math.subtract(c, a));
    assert.ok(math.dot(winding, normal) > 1e-9, "triangle must face its outward normal");
  }
}

test("beveled bodies and every sticker use finite, outward-facing triangles and unit normals", () => {
  const body = mesh.roundedBox();
  checkSurface(body);
  for (let i = 0; i < body.vertices.length; i += mesh.STRIDE) {
    assert.ok(body.vertices.slice(i, i + 3).every(x => Math.abs(x) <= mesh.HALF + 1e-8));
  }
  for (const f of cube.FACES) {
    const tile = mesh.sticker(f);
    checkSurface(tile);
    for (let i = 0; i < tile.vertices.length; i += mesh.STRIDE) {
      assert.ok(math.dot(tile.vertices.slice(i, i + 3), cube.FACE[f].normal) > mesh.HALF);
    }
    vectorClose(tile.vertices.slice(6, 9), mesh.rgb(cube.FACE[f].color));
  }
  checkSurface(mesh.sticker("U", true));
});

test("packed geometry has one contiguous indexed range per piece, with its own stickers", () => {
  const pieces = cube.create(), data = mesh.cubeMeshes(pieces), body = mesh.roundedBox();
  assert.ok(data.vertices instanceof Float32Array);
  assert.ok(data.indices instanceof Uint16Array);
  assert.ok(data.vertices.length / mesh.STRIDE < 65536);
  let first = 0, firstVertex = 0;
  pieces.forEach((p, i) => {
    const parts = [body, ...p.faces.map(f => mesh.sticker(f, f === "U" && p.faces.length === 1))];
    const count = parts.reduce((a, part) => a + part.indices.length, 0);
    const vertices = parts.reduce((a, part) => a + part.vertices.length / mesh.STRIDE, 0);
    assert.deepEqual(data.ranges[i], { first, count });
    const indices = data.indices.subarray(first, first + count);
    assert.equal(Math.min(...indices), firstVertex);
    assert.equal(Math.max(...indices), firstVertex + vertices - 1);
    first += count;
    firstVertex += vertices;
  });
  assert.equal(first, data.indices.length);
  assert.equal(firstVertex, data.vertices.length / mesh.STRIDE);
});
