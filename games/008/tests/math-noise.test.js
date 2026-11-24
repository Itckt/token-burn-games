"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math");
const N = require("../js/noise");

function close(a, b, tolerance = 1e-6) {
  assert.ok(Math.abs(a - b) <= tolerance, a + " should be within " + tolerance + " of " + b);
}
function transform(matrix, vector) {
  return [0, 1, 2, 3].map(row => vector.reduce((sum, v, col) => sum + matrix[4 * col + row] * v, 0));
}

test("scalar interpolation clamps endpoints and wraps negative and complete periods", () => {
  assert.equal(M.clamp(-3, -2, 2), -2);
  assert.equal(M.clamp(3, -2, 2), 2);
  assert.equal(M.wrap(-0.5, 24), 23.5);
  assert.equal(M.wrap(72, 24), 0);
  assert.equal(M.lerp(-8, 4, 0.25), -5);
  assert.deepEqual([-8, 0, 0.5, 1, 5].map(v => M.smoothstep(0, 1, v)), [0, 0, 0.5, 1, 1]);
  assert.deepEqual(M.mixColor([0, 1, 0], [1, 0, 1], 0.25), [0.25, 0.75, 0.25]);
});

test("vector operations form an orthonormal camera basis, including at both poles", () => {
  assert.deepEqual(M.normalize([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(M.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(M.subtract([1, 2, 3], [3, 2, 1]), [-2, 0, 2]);
  for (const yaw of [-3, 0, 1.3, Math.PI]) {
    for (const pitch of [-Math.PI / 2, -1.48, 0, 0.7, Math.PI / 2]) {
      const f = M.direction(yaw, pitch);
      const { forward, right, up } = M.basis(f);
      for (const axis of [f, forward, right, up]) close(Math.hypot(...axis), 1);
      close(M.dot(forward, right), 0);
      close(M.dot(forward, up), 0);
      close(M.dot(up, right), 0);
      close(M.dot(M.cross(right, up), forward), -1);
    }
  }
});

test("perspective maps near and far planes and the horizontal field angle to clip space", () => {
  const matrix = M.perspective(Math.PI / 2, 2, 1, 501);
  for (const [z, depth] of [[-1, -1], [-501, 1]]) {
    const p = transform(matrix, [0, 0, z, 1]);
    close(p[2] / p[3], depth);
  }
  const rightEdge = transform(matrix, [14, 7, -7, 1]);
  close(rightEdge[0] / rightEdge[3], 1);
  close(rightEdge[1] / rightEdge[3], 1);
  for (const args of [[0, 1, 1, 2], [Math.PI, 1, 1, 2], [1, 0, 1, 2], [1, 1, -1, 2], [1, 1, 2, 2]]) {
    assert.throws(() => M.perspective(...args), RangeError);
  }
});

test("view and projection compose in WebGL column order for an off-axis camera", () => {
  const eye = [30, 12, -17], axes = M.basis(M.direction(1.1, -0.24));
  const view = M.view(eye, axes), projection = M.perspective(0.95, 1.7, 0.3, 1200);
  transform(view, [...eye, 1]).slice(0, 3).forEach(v => close(v, 0, 2e-6));
  const subject = [...eye.map((v, i) => v + axes.forward[i] * 70 + axes.right[i] * 10), 1];
  const cameraSpace = transform(view, subject);
  [10, 0, -70, 1].forEach((v, i) => close(cameraSpace[i], v, 1e-5));
  const composed = transform(M.multiply(projection, view), subject);
  transform(projection, cameraSpace).forEach((v, i) => close(v, composed[i], 1e-5));
});

test("text seeds handle Unicode and the random stream is repeatable, independent and bounded", () => {
  const seed = N.seedNumber("九龍塘🌲");
  assert.equal(seed, N.seedNumber("九龍塘🌲"));
  assert.notEqual(seed, N.seedNumber("九龍塘🌙"));
  const a = N.random(seed), b = N.random(seed), other = N.random(seed + 1);
  const values = Array.from({ length: 2000 }, () => a());
  assert.deepEqual(values, Array.from({ length: values.length }, () => b()));
  assert.notDeepEqual(values.slice(0, 8), Array.from({ length: 8 }, () => other()));
  assert.ok(values.every(v => v >= 0 && v < 1));
  assert.ok(Math.min(...values) < 0.01 && Math.max(...values) > 0.99);
});

test("gradient noise is continuous in value and slope across signed lattice boundaries", () => {
  const sample = N.gradientNoise(239), e = 1e-4;
  for (let i = -4; i <= 4; i++) {
    for (let j = -3; j <= 3; j++) {
      assert.equal(Math.abs(sample(i, j)), 0);
      for (const slice of [s => sample(s, j + 0.37), s => sample(j - 0.18, s)]) {
        const left = slice(i - e), middle = slice(i), right = slice(i + e);
        close(left, right, 0.0004);
        close((middle - left) / e, (right - middle) / e, 0.003);
      }
    }
  }
});

test("rotated octaves add deterministic detail without changing a constant field", () => {
  const a = N.gradientNoise(123), b = N.gradientNoise(124);
  let min = 1, max = -1, detail = 0, variation = 0;
  for (let i = 0; i < 650; i++) {
    const x = i * 0.137 - 48, y = i * 0.073 + 0.25;
    const value = N.fractal(a, x, y);
    close(N.fractal(a, x, y, 1), a(x, y));
    assert.equal(value, N.fractal(a, x, y));
    close(N.fractal(() => -0.3, x, y, 7), -0.3);
    detail += Math.abs(value - a(x, y));
    variation += Math.abs(value - N.fractal(b, x, y));
    min = Math.min(min, value); max = Math.max(max, value);
  }
  assert.ok(min < -0.3 && min >= -1.1 && max > 0.3 && max <= 1.1);
  assert.ok(detail > 35 && variation > 60);
  assert.equal(N.fractal(a, -3, 7, 0), 0);
});
