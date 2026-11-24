(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).math = api;
})(globalThis, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function normalize(v) {
    const length = Math.hypot(...v);
    return length > 1e-12 ? v.map(n => n / length) : [0, 0, 0];
  }
  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  // Column-major matrices multiply column vectors, matching WebGL uniforms.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
    return out;
  }
  function translation(x, y, z) { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scaling(x, y, z) { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function rotationX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
  function rotationY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
  function rotationZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
  function transformPoint(m, p) {
    const [x, y, z] = p, w = m[3]*x + m[7]*y + m[11]*z + m[15];
    return [(m[0]*x + m[4]*y + m[8]*z + m[12])/w, (m[1]*x + m[5]*y + m[9]*z + m[13])/w, (m[2]*x + m[6]*y + m[10]*z + m[14])/w];
  }
  function lookAt(eye, target, up = [0, 1, 0]) {
    const z = normalize(sub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function ortho(left, right, bottom, top, near, far) {
    return new Float32Array([2/(right-left),0,0,0, 0,2/(top-bottom),0,0, 0,0,-2/(far-near),0, -(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1]);
  }
  function inverse(m) {
    const rows = Array.from({length: 4}, (_, i) => Array.from({length: 8}, (_, j) => j < 4 ? m[j*4+i] : Number(j-4 === i)));
    for (let c=0; c<4; c++) {
      let pivot=c;
      for (let r=c+1; r<4; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot=r;
      if (Math.abs(rows[pivot][c]) < 1e-12) return null;
      [rows[c], rows[pivot]]=[rows[pivot], rows[c]];
      const divisor=rows[c][c];
      for (let j=0; j<8; j++) rows[c][j]/=divisor;
      for (let r=0; r<4; r++) if (r !== c) {
        const factor=rows[r][c];
        for (let j=0; j<8; j++) rows[r][j]-=factor*rows[c][j];
      }
    }
    return new Float32Array(Array.from({length:16}, (_, i) => rows[i%4][4+Math.floor(i/4)]));
  }
  function groundPoint(inverseView, nx, ny, height = 0) {
    const a=transformPoint(inverseView,[nx,ny,-1]), b=transformPoint(inverseView,[nx,ny,1]);
    if (Math.abs(b[1]-a[1]) < 1e-9) return null;
    const t=(height-a[1])/(b[1]-a[1]);
    return [lerp(a[0],b[0],t),height,lerp(a[2],b[2],t)];
  }
  function seeded(seed) {
    let state=seed>>>0;
    function next() {
      state=(state+0x6D2B79F5)>>>0;
      let n=Math.imul(state^(state>>>15),state|1);
      n^=n+Math.imul(n^(n>>>7),n|61);
      return ((n^(n>>>14))>>>0)/4294967296;
    }
    next.state = () => state;
    return next;
  }
  return {TAU,clamp,lerp,dot,sub,cross,normalize,identity,multiply,translation,scaling,rotationX,rotationY,rotationZ,transformPoint,lookAt,ortho,inverse,groundPoint,seeded};
});
