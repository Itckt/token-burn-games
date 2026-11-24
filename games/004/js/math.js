(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HarbourMath = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, t) => a + (b - a) * t;
  function wrap(value, period) {
    const remainder = value % period;
    if (remainder === 0) return 0;
    if (remainder > 0) return remainder;
    const phase = remainder + period;
    // A tiny negative remainder can round up to the excluded endpoint.
    return phase === period ? period - period * (Number.EPSILON / 2) : phase;
  }
  function ease(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  // First occurrence strictly after the current time, including on a previous lap.
  function nextOccurrence(time, interval, origin = 0) {
    const lap = Math.floor((time - origin) / interval);
    const boundary = origin + interval * lap;
    return boundary > time ? boundary : origin + interval * (lap + 1);
  }
  const add = (a, b) => a.map((n, i) => n + b[i]);
  const subtract = (a, b) => a.map((n, i) => n - b[i]);
  const scale = (a, n) => a.map(v => v * n);
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  function normalize(vector) {
    const length = Math.hypot(...vector);
    return length > 1e-10 ? scale(vector, 1 / length) : vector.map(() => 0);
  }

  // Column-major matrices act on column vectors, just as they do in GLSL.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
    return out;
  }
  function transform(matrix, vector) {
    return [0, 1, 2, 3].map(row => vector.reduce((sum, n, col) => sum + matrix[col * 4 + row] * n, 0));
  }
  function perspective(fovy, aspect, near, far) {
    if (!(fovy > 0 && fovy < Math.PI && aspect > 0 && near > 0 && far > near)) {
      throw new RangeError('Invalid perspective frustum');
    }
    const f = 1 / Math.tan(fovy / 2);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0
    ]);
  }
  function cameraBasis(eye, target, upHint) {
    let forward = normalize(subtract(target, eye));
    if (!forward.some(component => component !== 0)) forward = [0, 0, -1];
    const guide = Math.abs(forward[1]) > 0.9999 ? [0, 0, 1] : [0, 1, 0];
    let across = cross(forward, upHint || guide);
    if (upHint && Math.hypot(...across) < 1e-6) across = cross(forward, guide);
    const right = normalize(across);
    return {forward, right, up: cross(right, forward)};
  }
  function viewMatrix(eye, basis) {
    const {right: r, up: u, forward: f} = basis;
    return new Float32Array([
      r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -dot(r, eye), -dot(u, eye), dot(f, eye), 1
    ]);
  }
  function closedSpline(points, phase) {
    const position = wrap(phase, 1) * points.length;
    const index = Math.floor(position);
    const t = position - index;
    const p = [-1, 0, 1, 2].map(offset => points[wrap(index + offset, points.length)]);
    return p[1].map((v, i) => 0.5 * (
      2 * v + (-p[0][i] + p[2][i]) * t +
      (2 * p[0][i] - 5 * v + 4 * p[2][i] - p[3][i]) * t * t +
      (-p[0][i] + 3 * v - 3 * p[2][i] + p[3][i]) * t * t * t
    ));
  }
  // Mulberry32 provides a repeatable stream, including for seed zero.
  function random(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), state | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  return {TAU, clamp, mix, wrap, ease, nextOccurrence, add, subtract, scale, dot, cross, normalize, multiply, transform,
    perspective, cameraBasis, viewMatrix, closedSpline, random};
});
