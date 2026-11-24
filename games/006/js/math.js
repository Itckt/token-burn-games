(function () {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mod = (value, period) => ((value % period) + period) % period;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function normalize(v) {
    const length = Math.hypot(...v);
    return length > 0 ? v.map(n => n / length) : [0, 0, 0];
  }

  function perspective(fov, aspect, near, far) {
    if (![fov, aspect, near, far].every(Number.isFinite) ||
        !(fov > 0 && fov < Math.PI && aspect > 0 && near > 0 && far > near)) {
      throw new RangeError('Invalid viewing frustum');
    }
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, 2 * far * near / (near - far), 0
    ]);
  }

  function lookAt(eye, target, up) {
    const z = normalize(subtract(eye, target));
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  // Column-major matrices, acting on column vectors as in GLSL.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
    return out;
  }

  function seeded(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), state | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  const api = { clamp, mod, dot, subtract, cross, normalize, perspective, lookAt, multiply, seeded };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (globalThis.Nightline ||= {}).math = api;
})();
