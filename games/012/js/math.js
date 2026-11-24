(function (root) {
  "use strict";

  const TAU = 2 * Math.PI;
  const radians = degrees => degrees * Math.PI / 180;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const wrap = (value, period = TAU) => ((value % period) + period) % period;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  function normalize(vector) {
    const length = Math.hypot(...vector);
    return length > 0 ? scale(vector, 1 / length) : [0, 0, 0];
  }

  // Refine a bracketed sign change, including a root at either endpoint.
  function bisectZero(valueAt, a, b) {
    const first = valueAt(a);
    if (first === 0) return a;
    if (valueAt(b) === 0) return b;
    for (let i = 0; i < 52; i++) {
      const mid = a + (b - a) / 2;
      if (mid === a || mid === b) break;
      const value = valueAt(mid);
      if (value === 0) return mid;
      if ((value > 0) === (first > 0)) a = mid;
      else b = mid;
    }
    return a + (b - a) / 2;
  }

  // Column-major matrices multiply column vectors, as in GLSL.
  function multiply(a, b) {
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        result[4 * col + row] = a[row] * b[4 * col] + a[4 + row] * b[4 * col + 1]
          + a[8 + row] * b[4 * col + 2] + a[12 + row] * b[4 * col + 3];
      }
    }
    return result;
  }

  function perspective(fov, aspect, near, far) {
    if (![fov, aspect, near, far].every(Number.isFinite) || !(fov > 0 && fov < Math.PI && aspect > 0 && far > near && near > 0)) {
      throw new RangeError("Invalid perspective frustum");
    }
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0,
      (far + near) * range, -1, 0, 0, 2 * far * near * range, 0
    ]);
  }

  function orthographic(halfHeight, aspect, near, far) {
    if (![halfHeight, aspect, near, far].every(Number.isFinite) || !(halfHeight > 0 && aspect > 0 && far > near && near > 0)) {
      throw new RangeError("Invalid orthographic frustum");
    }
    const depth = far - near;
    return new Float32Array([
      1 / (halfHeight * aspect), 0, 0, 0, 0, 1 / halfHeight, 0, 0,
      0, 0, -2 / depth, 0, 0, 0, -(far + near) / depth, 1
    ]);
  }

  function lookAt(eye, center, up = [0, 1, 0]) {
    const back = normalize(subtract(eye, center));
    if (dot(back, back) === 0) throw new RangeError("Eye and target must differ");
    let right = normalize(cross(up, back));
    if (dot(right, right) === 0) right = normalize(cross([0, 0, 1], back));
    if (dot(right, right) === 0) right = normalize(cross([1, 0, 0], back));
    const vertical = cross(back, right);
    return new Float32Array([
      right[0], vertical[0], back[0], 0,
      right[1], vertical[1], back[1], 0,
      right[2], vertical[2], back[2], 0,
      -dot(right, eye), -dot(vertical, eye), -dot(back, eye), 1
    ]);
  }

  // The texture's prime meridian faces +Z. Tilt the spin axis about +Z.
  function bodyMatrix(center, radius, tilt = 0, spin = 0) {
    const c = Math.cos(spin), s = Math.sin(spin);
    const a = Math.cos(tilt), b = Math.sin(tilt);
    return new Float32Array([
      radius * a * c, radius * b * c, -radius * s, 0,
      -radius * b, radius * a, 0, 0,
      radius * a * s, radius * b * s, radius * c, 0,
      center[0], center[1], center[2], 1
    ]);
  }

  function transform(m, p, w = 1) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w,
      m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * w
    ];
  }

  function basisMatrix(center, x, y, z, radius = 1) {
    return new Float32Array([
      x[0]*radius, x[1]*radius, x[2]*radius, 0,
      y[0]*radius, y[1]*radius, y[2]*radius, 0,
      z[0]*radius, z[1]*radius, z[2]*radius, 0,
      ...center, 1
    ]);
  }

  function project(position, matrix, width, height) {
    const [x, y, z, w] = transform(matrix, position);
    if (w <= 0 || z < -w || z > w) return null;
    return { x: (x / w + 1) * width / 2, y: (1 - y / w) * height / 2, depth: w };
  }

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  const api = { TAU, radians, clamp, wrap, add, subtract, scale, dot, cross, normalize, bisectZero,
    multiply, perspective, orthographic, lookAt, bodyMatrix, basisMatrix, transform, project, randomGenerator };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.OrbitAtlas ||= {}).math = api;
})(globalThis);
