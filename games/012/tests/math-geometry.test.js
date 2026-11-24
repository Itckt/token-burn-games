"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math.js");
const G = require("../js/geometry.js");
const { planets } = require("../js/catalog.js");
const { orbits, pointOnOrbit } = require("../js/physics.js");

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + " differs from " + expected);
}
function vectorNear(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => near(n, expected[i], tolerance));
}
const vertex = (mesh, i) => Array.from(mesh.vertices.slice(i * mesh.stride, i * mesh.stride + 3));

test("vector operations obey orthogonality, orientation and scaling", () => {
  const a = [1, -2, 3], b = [4, 1, 0];
  vectorNear(M.subtract(M.add(a, b), b), a);
  assert.equal(M.dot(a, b), 2);
  vectorNear(M.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  near(M.dot(M.cross(a, b), a), 0);
  near(M.dot(M.cross(a, b), b), 0);
  near(Math.hypot(...M.normalize(a)), 1);
  vectorNear(M.normalize([0, 0, 0]), [0, 0, 0]);
  vectorNear(M.scale(a, -2), [-2, 4, -6]);
});

test("positive wrapping handles earlier dates and multiple revolutions", () => {
  near(M.wrap(-0.1), M.TAU - 0.1);
  near(M.wrap(-13, 4), 3);
  near(M.wrap(720, 360), 0);
  near(M.radians(180), Math.PI);
  assert.equal(M.clamp(12, 1, 4), 4);
});

test("model matrices rotate about the tilted pole, then translate", () => {
  const m = M.bodyMatrix([4, 2, -3], 2, Math.PI / 2, Math.PI / 2);
  vectorNear(M.transform(m, [0, 1, 0]), [2, 2, -3, 1]);
  vectorNear(M.transform(m, [0, 0, 1]), [4, 4, -3, 1]);
  vectorNear(M.transform(m, [1, 0, 0], 0), [0, 0, -2, 0]);
});

test("column-major multiplication composes transformations in GLSL order", () => {
  const a = M.bodyMatrix([2, -4, 7], 3, 0.3, 0.4);
  const b = M.bodyMatrix([-2, 1, 2], 0.8, -0.5, 0.15);
  const input = [2, -1, 0.5];
  vectorNear(M.transform(M.multiply(a, b), input), M.transform(a, M.transform(b, input)), 2e-6);
});

test("view matrices center the subject and support a collinear up vector", () => {
  for (const eye of [[2, 3, 4], [0, 3, 0], [0, 0, 2]]) {
    const matrix = M.lookAt(eye, [0, 0, 0], eye);
    vectorNear(M.transform(matrix, eye), [0, 0, 0, 1]);
    vectorNear(M.transform(matrix, [0, 0, 0]), [0, 0, -Math.hypot(...eye), 1]);
  }
  assert.throws(() => M.lookAt([0, 0, 0], [0, 0, 0]), RangeError);
});

test("perspective preserves aspect, maps depth planes and clips behind the eye", () => {
  const m = M.perspective(Math.PI / 2, 2, 1, 9);
  near(m[5] / m[0], 2);
  near(M.transform(m, [0, 0, -1])[2], -1);
  near(M.transform(m, [0, 0, -9])[2], 9);
  assert.deepEqual(M.project([0, 0, -4], m, 800, 400), { x: 400, y: 200, depth: 4 });
  near(M.project([2, 1, -4], m, 800, 400).x, 500);
  near(M.project([2, 1, -4], m, 800, 400).y, 150);
  for (const z of [-12, -0.5, 0, 2]) assert.equal(M.project([0, 0, z], m, 10, 10), null);
  for (const args of [[0,1,1,9],[1,0,1,9],[1,2,0,9],[1,2,9,1],[1,1,1,Infinity]]) assert.throws(() => M.perspective(...args));
});

test("orthographic eyepiece projection preserves apparent size at all depths and clips both planes", () => {
  const m = M.orthographic(2, 3, 1, 9);
  vectorNear(M.transform(m, [6,2,-1]), [1,1,-1,1]);
  vectorNear(M.transform(m, [6,2,-9]), [1,1,1,1]);
  for (const z of [0, -10]) assert.equal(M.project([0,0,z], m, 600, 200), null);
  for (const args of [[0,1,1,9],[1,0,1,9],[1,2,0,9],[1,2,9,1],[1,Infinity,1,9]]) {
    assert.throws(() => M.orthographic(...args), RangeError);
  }
});

test("every sphere triangle has valid indices, positive area and outward winding", () => {
  for (const [slices, stacks] of [[3,2], [16,9], [72,36]]) {
    const mesh = G.sphere(slices, stacks);
    assert.equal(mesh.vertices.length, (slices + 1) * (stacks + 1) * mesh.stride);
    assert.equal(mesh.indices.length, 6 * slices * (stacks - 1));
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = Array.from(mesh.indices.slice(i, i + 3), k => vertex(mesh, k));
      const normal = M.cross(M.subtract(b, a), M.subtract(c, a));
      assert.ok(M.dot(normal, a) > 0);
    }
  }
});

test("unit normals meet at the UV seam and the prime meridian faces forward", () => {
  const mesh = G.sphere(24, 12);
  for (let row = 0; row <= 12; row++) {
    const first = 25 * row, last = first + 24;
    vectorNear(vertex(mesh, first), vertex(mesh, last));
    assert.equal(mesh.vertices[first * 5 + 3], 0);
    assert.equal(mesh.vertices[last * 5 + 3], 1);
    for (let col = 0; col < 25; col++) near(Math.hypot(...vertex(mesh, first + col)), 1);
  }
  vectorNear(vertex(mesh, 25 * 6 + 12), [0, 0, 1]);
});

test("ring mesh is planar, closes and leaves the globe clear", () => {
  const mesh = G.ring(1.27, 2.28, 36);
  assert.equal(mesh.indices.length, 36 * 6);
  for (let i = 0; i < 74; i++) {
    const p = vertex(mesh, i);
    near(p[1], 0);
    near(Math.hypot(...p), i % 2 ? 2.28 : 1.27);
    assert.equal(mesh.vertices[i * 5 + 3], i % 2);
  }
  vectorNear(vertex(mesh, 0), vertex(mesh, 72));
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a,b,c] = Array.from(mesh.indices.slice(i,i+3), k => vertex(mesh, k));
    assert.ok(M.cross(M.subtract(b, a), M.subtract(c, a))[1] > 0);
  }
});

test("invalid meshes fail before overflowing a WebGL 1 index buffer", () => {
  for (const args of [[2,8],[3,1],[256,256],[3.5,6]]) assert.throws(() => G.sphere(...args), RangeError);
  for (const args of [[-1,2,20],[2,1,20],[1,2,1],[1,2,32768],[1,Infinity,32]]) assert.throws(() => G.ring(...args), RangeError);
  assert.throws(() => G.orbitPath(orbits.earth, 2, 2), RangeError);
  for (const axis of [0, -1, NaN, Infinity]) assert.throws(() => G.orbitPath(orbits.earth, axis), RangeError);
  assert.deepEqual(G.orbitPath(orbits.earth), G.orbitPath(orbits.earth, orbits.earth.a));
});

test("orbit lines sample the same inclined, focused ellipse as the planet", () => {
  for (const p of planets) {
    const path = G.orbitPath(orbits[p.id], p.track, 80);
    assert.equal(path.length, 240);
    for (let k = 0; k < 80; k++) vectorNear(path.slice(k * 3, k * 3 + 3),
      pointOnOrbit(orbits[p.id], M.TAU * k / 80, p.track), 2e-6);
    assert.notDeepEqual(path.slice(0,3), path.slice(-3));
  }
});

test("seeded sky directions cover the sphere with bounded brightness and color", () => {
  const a = G.stars(800, 99), b = G.stars(800, 99);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, G.stars(800, 100));
  let averageY = 0;
  for (let i = 0; i < a.length; i += 5) {
    near(Math.hypot(...a.slice(i, i + 3)), 1);
    averageY += a[i + 1] / 800;
    assert.ok(a[i + 3] >= 0 && a[i + 3] <= 1 && a[i + 4] >= 0 && a[i + 4] <= 1);
  }
  assert.ok(Math.abs(averageY) < 0.08);
});

test("illustrative asteroids stay in a thin belt between Mars and Jupiter", () => {
  const a = G.asteroidBelt(500, 7);
  assert.deepEqual(a, G.asteroidBelt(500, 7));
  for (let i = 0; i < a.length; i += 5) {
    const radius = Math.hypot(a[i], a[i + 2]);
    assert.ok(radius > 13.6 && radius < 15.6 && Math.abs(a[i + 1]) < 0.51);
  }
});
