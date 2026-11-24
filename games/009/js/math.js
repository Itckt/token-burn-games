(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FoundryMath = api;
})(globalThis, function () {
  "use strict";
  const EPS = 1e-9;
  const TAU = Math.PI * 2;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = a => Math.hypot(a[0], a[1], a[2]);
  function unit(a, fallback = [0, 0, 0]) {
    const size = length(a);
    return size > EPS ? mul(a, 1 / size) : fallback.slice();
  }
  const lerp = (a, b, t) => madd(a, sub(b, a), t);
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const smooth = t => t * t * (3 - 2 * t);
  const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // Column-major matrices, column vectors, and a right-handed camera.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] +
          a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
      }
    }
    return out;
  }
  function lookAt(eye, target, up = [0, 1, 0]) {
    const z = unit(sub(eye, target), [0, 0, 1]);
    let x = cross(up, z);
    if (length(x) < EPS) x = cross([0, 0, 1], z);
    if (length(x) < EPS) x = cross([1, 0, 0], z);
    x = unit(x);
    const y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function ortho(left, right, bottom, top, near, far) {
    return new Float32Array([2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0, -(right + left) / (right - left),
      -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1]);
  }
  function transform(m, p) {
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [0, 1, 2].map(i => (m[i] * p[0] + m[i + 4] * p[1] + m[i + 8] * p[2] + m[i + 12]) / w);
  }
  // A unit quaternion carries each marble's painted stripe through rolling and impacts.
  function advanceRotation(q, omega, dt) {
    const [x, y, z, w] = q;
    const [a, b, c] = mul(omega, dt * 0.5);
    const next = [x + a*w + b*z - c*y, y + b*w + c*x - a*z,
      z + c*w + a*y - b*x, w - a*x - b*y - c*z];
    const norm = Math.hypot(...next);
    return next.map(n => n / norm);
  }
  function mixRotation(a, b, t) {
    // q and -q describe the same orientation. Follow the shorter arc.
    const sign = a.reduce((sum, v, i) => sum + v*b[i], 0) < 0 ? -1 : 1;
    const q = a.map((v, i) => v + (sign*b[i]-v)*t);
    const norm = Math.hypot(...q);
    return q.map(v => v / norm);
  }
  function modelMatrix(p, radius, q = [0, 0, 0, 1]) {
    const [x, y, z, w] = q;
    return new Float32Array([
      (1-2*y*y-2*z*z)*radius, (2*x*y+2*w*z)*radius, (2*x*z-2*w*y)*radius, 0,
      (2*x*y-2*w*z)*radius, (1-2*x*x-2*z*z)*radius, (2*y*z+2*w*x)*radius, 0,
      (2*x*z+2*w*y)*radius, (2*y*z-2*w*x)*radius, (1-2*x*x-2*y*y)*radius, 0,
      p[0], p[1], p[2], 1]);
  }
  function bounds(points) {
    if (!points.length) return {min: [0, 0, 0], max: [0, 0, 0]};
    const min = [...points[0]], max = [...points[0]];
    for (const point of points) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], point[k]);
      max[k] = Math.max(max[k], point[k]);
    }
    return {min, max};
  }
  return {EPS, TAU, add, sub, mul, madd, dot, cross, length, unit, lerp, clamp, smooth,
    identity, multiply, lookAt, ortho, transform, advanceRotation, mixRotation, modelMatrix, bounds};
});
