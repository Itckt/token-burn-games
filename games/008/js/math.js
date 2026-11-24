(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.FieldAtlas ||= {}).math = factory();
})(globalThis, function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (v, period) => ((v % period) + period) % period;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  function normalize(v) {
    const length = Math.hypot(...v);
    return length > 1e-12 ? v.map(x => x / length) : [0, 0, 0];
  }
  function smoothstep(a, b, value) {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mixColor(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  function direction(yaw, pitch) {
    const horizontal = Math.cos(pitch);
    return [Math.sin(yaw) * horizontal, Math.sin(pitch), -Math.cos(yaw) * horizontal];
  }
  function basis(forward) {
    const f = normalize(forward);
    const reference = Math.abs(f[1]) > 0.99999 ? [0, 0, 1] : [0, 1, 0];
    const right = normalize(cross(f, reference));
    return { forward: f, right, up: cross(right, f) };
  }
  // Column-major matrices act on column vectors, matching WebGL uniforms.
  function view(eye, axes) {
    const { right: r, up: u, forward: f } = axes;
    return new Float32Array([
      r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -dot(r, eye), -dot(u, eye), dot(f, eye), 1
    ]);
  }
  function perspective(fov, aspect, near, far) {
    if (!(fov > 0 && fov < Math.PI && aspect > 0 && far > near && near > 0)) {
      throw new RangeError("Invalid perspective frustum");
    }
    const scale = 1 / Math.tan(fov / 2);
    return new Float32Array([
      scale / aspect, 0, 0, 0, 0, scale, 0, 0, 0, 0,
      (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0
    ]);
  }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      }
    }
    return out;
  }
  return { TAU, clamp, lerp, wrap, dot, subtract, cross, normalize, smoothstep, mixColor,
    direction, basis, view, perspective, multiply };
});
