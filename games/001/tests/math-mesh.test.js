'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/math.js');
const {Mesh, STRIDE, MAT, rgb, tint} = require('../src/mesh.js');

function near(actual, expected, tolerance = 1e-5) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < tolerance, `component ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}
function points(mesh) {
  const data = mesh.finish(), result = [];
  for (let i = 0; i < data.length; i += STRIDE) result.push(Array.from(data.subarray(i, i + 3)));
  return result;
}

test('vector arithmetic preserves its inputs, handles zero length, and uses a right-handed cross product', () => {
  const a = Object.freeze([1, 2, 3]), b = [-2, 4, 1];
  near(M.add(a, b), [-1, 6, 4]);
  near(M.sub(a, b), [3, -2, 2]);
  near(M.scale(a, 0.5), [0.5, 1, 1.5]);
  assert.equal(M.dot(a, b), 9);
  near(M.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  near(M.normalize([0, 0, 0]), [0, 0, 0]);
  near(M.normalize([0, -3, 4]), [0, -0.6, 0.8]);
});

test('compass yaw turns east and pitch raises the camera without rolling it', () => {
  near(M.direction(0), [0, 0, -1]);
  near(M.direction(Math.PI / 2), [1, 0, 0]);
  near(M.direction(0, Math.PI / 6), [0, 0.5, -Math.sqrt(0.75)]);
  for (const yaw of [-4.2, 0, 1.1, 10]) for (const pitch of [-1.39, 0, 1.39]) {
    const {forward, right, up} = M.basis(yaw, pitch);
    near([M.dot(forward, right), M.dot(forward, up), M.dot(right, up)], [0, 0, 0]);
    near([Math.hypot(...forward), Math.hypot(...right), Math.hypot(...up)], [1, 1, 1]);
    near(M.cross(right, forward), up);
    assert.equal(right[1], 0);
  }
});

test('view matrices put the eye at the origin, including when looking straight up', () => {
  const eye = [5, 2, -7];
  for (const target of [[5, 3, -7], [6, 2, -7], [-3, 5, 2]]) {
    const view = M.lookAt(eye, target);
    near(M.transform(view, eye), [0, 0, 0, 1]);
    near(M.transform(view, target), [0, 0, -Math.hypot(...M.sub(target, eye)), 1]);
  }
});

test('perspective maps frustum edges and both depth planes to clip space', () => {
  const p = M.perspective(Math.PI / 2, 2, 1, 20);
  near(M.transform(p, [-2, 1, -1]), [-1, 1, -1, 1]);
  near(M.transform(p, [40, -20, -20]), [20, -20, 20, 20]);
  for (const args of [[0, 1, 1, 2], [1, 0, 1, 2], [1, 1, 0, 2], [1, 1, 2, 1]]) {
    assert.throws(() => M.perspective(...args), RangeError);
  }
});

test('column-major matrix composition agrees with sequential transformations', () => {
  const view = M.lookAt([7, 2, 4], [1, 2, 0]);
  const projection = M.perspective(1, 1.5, 0.09, 465);
  for (const point of [[-5, 9, 12], [2, 4, 7], [1, 0, 0, 0]]) {
    near(M.transform(M.multiply(projection, view), point), M.transform(projection, M.transform(view, point)));
  }
  const shadow = M.orthographic(-10, 30, -4, 6, 1, 11);
  near(M.transform(shadow, [-10, -4, -1]), [-1, -1, -1, 1]);
  near(M.transform(shadow, [30, 6, -11]), [1, 1, 1, 1]);
});

test('angle wrapping is periodic and seeded random sequences are reproducible', () => {
  for (let i = -40; i < 40; i++) {
    const x = i / 3, a = M.wrapAngle(x);
    assert.ok(a >= -Math.PI && a < Math.PI);
    near([Math.sin(a), Math.cos(a)], [Math.sin(x), Math.cos(x)]);
  }
  const draw = seed => Array.from({length: 40}, M.random(seed));
  assert.deepEqual(draw(0), draw(0));
  assert.notDeepEqual(draw(0), draw(1));
  assert.ok(draw(407).every(n => n >= 0 && n < 1));
});

test('face triangulation respects the requested outward direction and vertex format', () => {
  const mesh = new Mesh();
  mesh.face([[0,0,0],[0,1,0],[1,1,0],[1,0,0]], '#80ff00', MAT.glass, [0,0,1]);
  assert.equal(mesh.vertexCount, 6);
  const data = mesh.finish();
  for (let i = 0; i < data.length; i += STRIDE) {
    near(data.subarray(i+3, i+6), [0,0,1]);
    near(data.subarray(i+6, i+9), [128/255,1,0]);
    assert.equal(data[i+9], MAT.glass);
  }
  assert.deepEqual(rgb('#204080'), [32/255,64/255,128/255]);
  assert.deepEqual(tint([0.1,0.5,1], 2), [0.2,1,1]);
});

test('boxes and roof frusta have outward faces and the specified extents', () => {
  const box = new Mesh();
  box.box(2, 4, -7, 6, 8, 4, '#123456');
  assert.equal(box.vertexCount, 36);
  const data = box.finish();
  for (let i = 0; i < data.length; i += STRIDE) {
    assert.ok(M.dot(M.sub(data.subarray(i, i+3), [2,4,-7]), data.subarray(i+3,i+6)) > 0);
  }
  const coords = points(box);
  near([0,1,2].map(k => Math.min(...coords.map(p => p[k]))), [-1,0,-9]);
  near([0,1,2].map(k => Math.max(...coords.map(p => p[k]))), [5,8,-5]);
  const roof = new Mesh();
  roof.frustum(0, 3, 0, 8, 10, 2, 4, 3, '#335544');
  assert.equal(roof.vertexCount, 36);
  assert.ok(points(roof).filter(p => p[1] === 6).every(p => Math.abs(p[0]) === 1 && Math.abs(p[2]) === 2));
});

test('beams follow arbitrary axes and a pointed end emits only real triangles', () => {
  const mesh = new Mesh(), a = [1,2,3], b = [3,5,7], axis = M.normalize(M.sub(b, a));
  mesh.beam(a, b, 1, 0.5, 8, '#654321');
  assert.equal(mesh.vertexCount, 84);
  for (const p of points(mesh)) {
    const t = M.dot(M.sub(p, a), axis), atStart = Math.abs(t) < 1e-5;
    near([t], [atStart ? 0 : Math.hypot(...M.sub(b, a))]);
    near([Math.hypot(...M.sub(p, atStart ? a : b))], [atStart ? 1 : 0.5]);
  }
  const cone = new Mesh();
  cone.beam(a, a, 1, 1, 8, '#aaaabb');
  assert.equal(cone.vertexCount, 0);
  cone.beam(a, b, 1, 0, 8, '#aaaabb');
  assert.equal(cone.vertexCount, (8 + 6) * 3);
  cone.face([[0,0,0],[1,1,1],[2,2,2]], '#ffffff');
  assert.equal(cone.vertexCount, 42);
});

test('seeded crowns close both poles, independently shade facets, and grow past the initial buffer', () => {
  const mesh = new Mesh(), rng = M.random(44);
  const emit = () => mesh.crown(2, 4, 6, 3, 2, 4, '#678b45', rng, MAT.leaf, 8);
  emit();
  assert.equal(mesh.vertexCount, 8 * 6 * 3);
  const first = mesh.finish(), pts = points(mesh);
  near([Math.min(...pts.map(p=>p[1])), Math.max(...pts.map(p=>p[1]))], [2.24,6]);
  const shades = new Set(pts.map((_, i) => first[i*STRIDE+6]));
  assert.ok(shades.size > 8);
  for (let i = 0; i < 64; i++) emit();
  assert.equal(mesh.finish().length, 65 * first.length);
  assert.deepEqual(mesh.finish().subarray(0,first.length), first);
});
