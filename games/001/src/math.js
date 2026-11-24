/* Classic scripts work from file://. The same functions are exported for Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Atlas = root.Atlas || {}).math = api;
})(globalThis, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const scale = (v, s) => v.map(n => n * s);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function normalize(v) {
    const length = Math.hypot(...v);
    return length > 1e-12 ? scale(v, 1 / length) : v.map(() => 0);
  }
  function wrapAngle(a) { return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; }
  function direction(yaw, pitch = 0) {
    return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }
  function basis(yaw, pitch) {
    const forward = direction(yaw, pitch), right = [Math.cos(yaw), 0, Math.sin(yaw)];
    return {forward, right, up: cross(right, forward)};
  }
  // Matrices use column-major storage, matching WebGL's uniformMatrix4fv.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
    return out;
  }
  function transform(m, p) {
    const w = p.length > 3 ? p[3] : 1;
    return [0, 1, 2, 3].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i] * w);
  }
  function perspective(fovy, aspect, near, far) {
    if (!(aspect > 0 && near > 0 && far > near && fovy > 0 && fovy < Math.PI)) throw new RangeError('Invalid viewing frustum');
    const f = 1 / Math.tan(fovy / 2), d = near - far;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / d, -1, 0, 0, 2 * near * far / d, 0]);
  }
  // Half the vertical span of the field camera at unit depth.
  function lensScale(zoom = 1) { return Math.tan(57*Math.PI/360)/zoom; }
  function orthographic(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  }
  function lookAt(eye, target, up = [0, 1, 0]) {
    const z = normalize(sub(eye, target));
    let x = normalize(cross(up, z));
    if (dot(x, x) < 0.5) x = normalize(cross(Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], z));
    const y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function random(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  return {TAU, clamp, mix, add, sub, scale, dot, cross, normalize, wrapAngle, direction, basis, multiply, transform, perspective, lensScale, orthographic, lookAt, random};
});
