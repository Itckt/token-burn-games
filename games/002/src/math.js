(() => {
  "use strict";
  const EPS = 1e-8;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function unit(v) {
    const n = Math.hypot(...v);
    return n > EPS ? v.map(x => x / n) : v.map(() => 0);
  }
  function angleMix(a, b, t) {
    return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  }
  function model(x = 0, y = 0, z = 0, yaw = 0, sx = 1, sy = 1, sz = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return new Float32Array([c*sx,0,-s*sx,0, 0,sy,0,0, s*sz,0,c*sz,0, x,y,z,1]);
  }
  // Column-major matrices multiply column vectors, in the same order as GLSL.
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        out[j*4+i] = a[i]*b[j*4] + a[4+i]*b[j*4+1] + a[8+i]*b[j*4+2] + a[12+i]*b[j*4+3];
      }
    }
    return out;
  }
  function ortho(left, right, bottom, top, near, far) {
    const w = right-left, h = top-bottom, d = far-near;
    return new Float32Array([2/w,0,0,0, 0,2/h,0,0, 0,0,-2/d,0, -(right+left)/w,-(top+bottom)/h,-(far+near)/d,1]);
  }
  function lookAt(eye, target, up = [0, 1, 0]) {
    const z = unit(eye.map((v, i) => v - target[i]));
    const x = unit(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
  }
  function inverse(m) {
    const rows = Array.from({length:4}, (_, r) =>
      Array.from({length:8}, (_, c) => c < 4 ? m[c*4+r] : Number(c-4 === r)));
    for (let c=0; c<4; c++) {
      let pivot=c;
      for (let r=c+1; r<4; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot=r;
      if (Math.abs(rows[pivot][c]) < EPS) return null;
      [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
      const divisor=rows[c][c];
      for (let k=0; k<8; k++) rows[c][k] /= divisor;
      for (let r=0; r<4; r++) {
        if (r === c) continue;
        const f=rows[r][c];
        for (let k=0; k<8; k++) rows[r][k] -= f*rows[c][k];
      }
    }
    return new Float32Array(Array.from({length:16}, (_, i) => rows[i%4][4+(i>>2)]));
  }
  function project(m, x, y, z) {
    const w=m[3]*x+m[7]*y+m[11]*z+m[15];
    return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,
      (m[1]*x+m[5]*y+m[9]*z+m[13])/w, (m[2]*x+m[6]*y+m[10]*z+m[14])/w];
  }
  function groundPoint(inv, ndcX, ndcY, height = 0) {
    const a=project(inv,ndcX,ndcY,-1), b=project(inv,ndcX,ndcY,1);
    if (Math.abs(b[1]-a[1]) < EPS) return null;
    const t=(height-a[1])/(b[1]-a[1]);
    return [mix(a[0],b[0],t), height, mix(a[2],b[2],t)];
  }
  // Both sweep functions return the first hit on a finite segment, including t=0.
  function segmentBox(x, z, dx, dz, box, pad = 0) {
    let low=0, high=1;
    for (const [start, delta, min, max] of [[x,dx,box.x-box.w/2-pad,box.x+box.w/2+pad],
      [z,dz,box.z-box.d/2-pad,box.z+box.d/2+pad]]) {
      if (delta === 0) {
        if (start < min || start > max) return Infinity;
      } else {
        const a=(min-start)/delta, b=(max-start)/delta;
        low=Math.max(low, Math.min(a,b));
        high=Math.min(high, Math.max(a,b));
        if (low > high) return Infinity;
      }
    }
    return low;
  }
  function segmentCircle(x, z, dx, dz, cx, cz, radius, start = 0) {
    if (!Number.isFinite(start) || start > 1) return Infinity;
    start=Math.max(0,start);
    const px=x+dx*start-cx, pz=z+dz*start-cz, c=px*px+pz*pz-radius*radius;
    if (c <= 0) return start;
    const a=dx*dx+dz*dz, b=px*dx+pz*dz, disc=b*b-a*c;
    if (a === 0 || b >= 0 || disc < 0) return Infinity;
    // This form of the entry root also resolves very short sweeps at the match horn.
    const t=start+c/(-b+Math.sqrt(disc));
    return t >= start && t <= 1 ? t : Infinity;
  }
  function rng(seed) {
    let state=seed>>>0;
    return () => {
      state=(state+0x6D2B79F5)>>>0;
      let x=Math.imul(state^(state>>>15),1|state);
      x=(x+Math.imul(x^(x>>>7),61|x))^x;
      return ((x^(x>>>14))>>>0)/4294967296;
    };
  }
  const api={EPS,clamp,mix,dot,cross,unit,angleMix,model,multiply,ortho,lookAt,inverse,project,groundPoint,segmentBox,segmentCircle,rng};
  if (typeof module === "object" && module.exports) module.exports=api;
  else (globalThis.Slipwake ||= {}).math=api;
})();
