'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math.js');

function close(actual, expected, tolerance = 1e-5) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < tolerance,
    'component ' + i + ' was ' + actual[i] + ', expected ' + value));
}

test('vectors preserve their inputs and form a right-handed basis', () => {
  const a = Object.freeze([3, 4, 0]), b = Object.freeze([1, -2, 2]);
  close(M.add(a, b), [4, 2, 2]);
  close(M.sub(a, b), [2, 6, -2]);
  close(M.mul(b, -2), [-2, 4, -4]);
  assert.equal(M.dot(a, b), -5);
  close(M.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(M.dot(M.cross(a, b), a), 0);
  assert.equal(M.dot(M.cross(a, b), b), 0);
  close(M.unit(a), [0.6, 0.8, 0]);
  close(M.unit([0, 0, 0]), [0, 0, 0]);
});

test('smoothstep clamps at both ends and interpolation preserves endpoints', () => {
  assert.deepEqual([-7, 2, 3, 4, 50].map(x => M.smooth(2, 4, x)), [0, 0, 0.5, 1, 1]);
  assert.equal(M.lerp(-2, 6, 0.25), 0);
  assert.equal(M.clamp(20, -1, 4), 4);
  assert.equal(M.clamp(-8, -1, 4), -1);
});

test('column-major composition transforms points in right-to-left order', () => {
  const move = M.translation(2, 3, 4), turn = M.rotateY(Math.PI / 2);
  close(M.transform(M.multiply(move, turn), [0, 0, 1]), [3, 3, 4, 1]);
  close(M.transform(M.multiply(turn, move), [0, 0, 1]), [5, 3, -2, 1]);
  close(M.transform(move, [2, 3, 4], 0), [2, 3, 4, 0]);
  close(M.transform(M.rotateZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0, 1]);
  close(M.multiply(M.identity(), turn), turn);
  close(M.multiply(move, M.identity()), move);
});

test('lookAt puts the eye at the origin and the target on the negative Z axis', () => {
  for (const eye of [[3, 5, 7], [0, 8, 0], [0, -8, 0]]) {
    const view = M.lookAt(eye, [0, 0, 0]);
    close(M.transform(view, eye), [0, 0, 0, 1]);
    close(M.transform(view, [0, 0, 0]), [0, 0, -Math.hypot(...eye), 1]);
    const axes = [0, 1, 2].map(i => [view[i], view[4+i], view[8+i]]);
    close(M.cross(axes[0], axes[1]), axes[2]);
    axes.forEach(axis => close([Math.hypot(...axis)], [1]));
  }
  assert.throws(() => M.lookAt([1, 2, 3], [1, 2, 3]), RangeError);
});

test('orthographic projection agrees with pixels, clip depth and screen Y', () => {
  const vp = M.ortho(-4, 4, -2, 2, 1, 11);
  close(M.project(vp, [-4, 2, -1], 800, 400), [0, 0, -1]);
  close(M.project(vp, [4, -2, -11], 800, 400), [800, 400, 1]);
  close(M.project(vp, [0, 0, -6], 800, 400), [400, 200, 0]);
  for (const bounds of [[1,1,-1,1,1,10],[-1,1,3,3,1,10],[-1,1,-1,1,2,2]]) {
    assert.throws(() => M.ortho(...bounds), RangeError);
  }
});

test('normal matrix keeps normals perpendicular under rotation and uneven scale', () => {
  const model = M.multiply(M.translation(3, -2, 4), M.multiply(M.rotateY(0.8), M.scale(2, 3, 0.25)));
  const normal = M.normalMatrix(model);
  const n = [0, 1, 2].map(i => normal[i] + normal[i+3] + normal[i+6]);
  for (const tangent of [[1,-1,0], [0,1,-1]]) {
    close([M.dot(n, M.transform(model, tangent, 0).slice(0, 3))], [0]);
  }
  close(M.normalMatrix(M.scale(-2, 3, 4)), [-0.5,0,0, 0,1/3,0, 0,0,0.25]);
  assert.throws(() => M.normalMatrix(M.scale(1, 0, 1)), RangeError);
});

test('damping is monotone and independent of frame subdivision', () => {
  const once = M.damp(-2, 7, 4, 0.8);
  for (const frames of [8, 48, 115]) {
    let value = -2;
    for (let i = 0; i < frames; i++) {
      const next = M.damp(value, 7, 4, 0.8 / frames);
      assert.ok(next >= value && next < 7);
      value = next;
    }
    close([value], [once], 1e-10);
  }
  assert.equal(M.damp(1, 3, 4, -2), 1);
});

test('seeded geometry randomness is repeatable, bounded and seed-dependent', () => {
  const samples = seed => Array.from({length: 128}, M.random(seed));
  assert.deepEqual(samples(91), samples(91));
  assert.notDeepEqual(samples(91), samples(92));
  assert.ok(samples(0).every(x => x >= 0 && x < 1));
});
