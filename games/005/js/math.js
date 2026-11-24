/* Column-major matrices, matching WebGL's column-vector convention. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CupMath = api;
})(globalThis, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map(v => v * s);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  function unit(v) {
    const n = Math.hypot(...v);
    return n > 1e-10 ? mul(v, 1 / n) : v.map(() => 0);
  }
  function identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col*4+row] += a[k*4+row] * b[col*4+k];
      }
    }
    return out;
  }
  function transform(m, p, w = 1) {
    return [0,1,2,3].map(i => m[i]*p[0] + m[4+i]*p[1] + m[8+i]*p[2] + m[12+i]*w);
  }
  function translation(x, y, z) {
    const m = identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }
  function scale(x, y, z) {
    const m = identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  }
  function rotateY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  }
  function rotateZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  }
  function lookAt(eye, target, up = [0,1,0]) {
    const z = unit(sub(eye, target));
    if (dot(z,z) === 0) throw new RangeError('Camera position must differ from its target');
    let x = unit(cross(up, z));
    if (dot(x,x) === 0) x = unit(cross(Math.abs(z[0]) > 0.9 ? [0,0,1] : [1,0,0], z));
    const y = cross(z,x);
    return new Float32Array([
      x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -dot(x,eye),-dot(y,eye),-dot(z,eye),1
    ]);
  }
  function ortho(l, r, b, t, n, f) {
    if (l === r || t === b || n === f) throw new RangeError('Empty viewing volume');
    return new Float32Array([2/(r-l),0,0,0, 0,2/(t-b),0,0, 0,0,-2/(f-n),0,
      -(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]);
  }
  // Column cross products give the inverse transpose of the linear transform.
  function normalMatrix(m) {
    const a = [m[0],m[1],m[2]], b = [m[4],m[5],m[6]], c = [m[8],m[9],m[10]];
    const bc = cross(b,c), det = dot(a,bc);
    if (Math.abs(det) < 1e-10) throw new RangeError('Singular model transform');
    return new Float32Array([...bc, ...cross(c,a), ...cross(a,b)].map(v => v / det));
  }
  function project(vp, point, width, height) {
    const p = transform(vp, point);
    return [(p[0]/p[3]+1)*width/2, (1-p[1]/p[3])*height/2, p[2]/p[3]];
  }
  // Exponential damping has the same response across different frame rates.
  const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * Math.max(0, dt)));
  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }
  return {TAU, clamp, lerp, smooth, add, sub, mul, dot, cross, unit, identity, multiply,
    transform, translation, scale, rotateY, rotateZ, lookAt, ortho, normalMatrix, project, damp, random};
});
