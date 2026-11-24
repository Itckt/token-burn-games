'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math.js');

function near(actual, expected, epsilon = 1e-5) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) <= epsilon, `component ${i}: ${value} vs ${expected[i]}`));
}

test('vector operations preserve inputs and follow a right-handed coordinate system', () => {
  const a = Object.freeze([2, -1, 3]), b = Object.freeze([4, 5, -2]);
  assert.deepEqual(M.add(a, b), [6, 4, 1]);
  assert.deepEqual(M.subtract(a, b), [-2, -6, 5]);
  assert.deepEqual(M.scale(a, 2), [4, -2, 6]);
  assert.equal(M.dot(a, b), -3);
  const cross = M.cross(a, b);
  assert.deepEqual(cross, [-13, 16, 14]);
  assert.equal(M.dot(cross, a), 0);
  assert.equal(M.dot(cross, b), 0);
  near(M.normalize([3, 4, 0]), [0.6, 0.8, 0]);
  near(M.normalize([0, 0, 0]), [0, 0, 0]);
});

test('wrapping, clamping and interpolation include the endpoints', () => {
  assert.equal(M.wrap(-1, 120), 119);
  assert.equal(M.wrap(240, 120), 0);
  assert.equal(M.wrap(120.25, 120), 0.25);
  assert.equal(M.clamp(-2, -1, 4), -1);
  assert.equal(M.clamp(12, -1, 4), 4);
  assert.equal(M.mix(12, -4, 0.25), 8);
});

test('perspective maps all four frustum edges and both clipping planes to NDC', () => {
  const projection = M.perspective(Math.PI / 2, 2, 1, 50);
  function ndc(point) {
    const clip = M.transform(projection, [...point, 1]);
    return clip.slice(0, 3).map(v => v / clip[3]);
  }
  near(ndc([2, 1, -1]), [1, 1, -1]);
  near(ndc([-100, -50, -50]), [-1, -1, 1]);
  for (const args of [[0, 1, 1, 2], [Math.PI, 1, 1, 2], [1, 0, 1, 2], [1, 1, 0, 2], [1, 1, 2, 2]]) {
    assert.throws(() => M.perspective(...args), RangeError);
  }
});

test('camera bases stay orthonormal for horizontal, sloped and vertical views', () => {
  const eye = [13, 7, -18];
  for (const dir of [[0, 0, -1], [-6, 1.7, 2], [0, 1, 0], [0, -1, 0]]) {
    const basis = M.cameraBasis(eye, M.add(eye, dir));
    for (const v of Object.values(basis)) near([Math.hypot(...v)], [1]);
    near([M.dot(basis.right,basis.up), M.dot(basis.forward,basis.right), M.dot(basis.forward,basis.up)], [0, 0, 0]);
    near(M.cross(basis.forward, basis.up), basis.right);
    const view = M.viewMatrix(eye, basis);
    near(M.transform(view, [...eye,1]), [0,0,0,1]);
    near(M.transform(view, [...M.add(eye, dir),1]), [0,0,-Math.hypot(...dir),1]);
  }
});

test('column-major composition applies view before projection', () => {
  const eye = [-5,8,80], aim = [4,17,-44], point = [-23,41,-73,1];
  const view = M.viewMatrix(eye, M.cameraBasis(eye, aim));
  const proj = M.perspective(0.91, 1.6, 0.5, 950);
  near(M.transform(M.multiply(proj, view), point), M.transform(proj, M.transform(view, point)), 2e-5);
  const center = M.transform(M.multiply(proj, view), [...aim, 1]);
  near([center[0] / center[3], center[1] / center[3]], [0,0]);
});

test('camera up hints orient overhead views and degenerate aim or parallel hints still give a usable basis', () => {
  const eye = [3, 8, 5];
  const nadir = M.cameraBasis(eye, [3, 0, 5], [0, 0, -1]);
  near(nadir.up, [0, 0, -1]); near(nadir.right, [1, 0, 0]);
  for (const basis of [M.cameraBasis(eye, eye), M.cameraBasis(eye, [3,0,5], [0,1,0])]) {
    for (const axis of Object.values(basis)) near([Math.hypot(...axis)], [1]);
    near(M.cross(basis.forward, basis.up), basis.right);
  }
});

test('closed Catmull–Rom passes through each knot with continuous velocity across the seam', () => {
  const points = [[0,1],[3,4],[1,7],[-5,3]];
  points.forEach((p, i) => near(M.closedSpline(points, i/points.length), p));
  near(M.closedSpline(points, -0.18), M.closedSpline(points, 2.82));
  const step = 0.000001;
  for (let i = 0; i < points.length; i++) {
    const t = i/points.length;
    const left = M.scale(M.subtract(M.closedSpline(points,t), M.closedSpline(points,t-step)), 1/step);
    const right = M.scale(M.subtract(M.closedSpline(points,t+step), M.closedSpline(points,t)), 1/step);
    near(left, right, 0.001);
  }
});

test('the 32-bit generator is reproducible, bounded and accepts seed zero', () => {
  const sample = seed => {
    const rng = M.random(seed);
    return Array.from({length: 512}, () => rng());
  };
  const zero = sample(0);
  assert.deepEqual(zero, sample(0x100000000));
  assert.deepEqual(sample(-1), sample(0xffffffff));
  assert.notDeepEqual(zero, sample(1));
  assert.ok(zero.every(v => v >= 0 && v < 1));
  assert.equal(new Set(zero.map(v => Math.floor(v * 16))).size, 16);
});
