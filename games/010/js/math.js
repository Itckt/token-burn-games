/* Column-major matrices, right-handed coordinates, +Y up. */
(function () {
  'use strict';

  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const scale = (v, k) => v.map(n => n * k);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function unit(v) {
    const length = Math.hypot(...v);
    return length > 1e-10 ? scale(v, 1 / length) : [0, 0, 0];
  }

  function identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col*4 + row] = a[row]*b[col*4] + a[4+row]*b[col*4+1]
          + a[8+row]*b[col*4+2] + a[12+row]*b[col*4+3];
      }
    }
    return out;
  }

  function transform4(m, x, y, z, w) {
    return [m[0]*x + m[4]*y + m[8]*z + m[12]*w,
      m[1]*x + m[5]*y + m[9]*z + m[13]*w,
      m[2]*x + m[6]*y + m[10]*z + m[14]*w,
      m[3]*x + m[7]*y + m[11]*z + m[15]*w];
  }

  function translation(x, y, z) {
    const m = identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  function rotation(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 'x') return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
    if (axis === 'y') return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  }

  function lookAt(eye, target, up = [0, 1, 0]) {
    const back = unit(sub(eye, target));
    if (!Math.hypot(...back)) throw new RangeError('The eye and target must differ');
    let right = unit(cross(up, back));
    if (!Math.hypot(...right)) right = unit(cross(Math.abs(back[2]) < .9 ? [0,0,1] : [1,0,0], back));
    const top = cross(back, right);
    return new Float32Array([right[0],top[0],back[0],0, right[1],top[1],back[1],0,
      right[2],top[2],back[2],0, -dot(right,eye),-dot(top,eye),-dot(back,eye),1]);
  }

  function ortho(left, right, bottom, top, near, far) {
    if (right <= left || top <= bottom || far <= near) throw new RangeError('Empty projection volume');
    return new Float32Array([2/(right-left),0,0,0, 0,2/(top-bottom),0,0, 0,0,-2/(far-near),0,
      -(right+left)/(right-left), -(top+bottom)/(top-bottom), -(far+near)/(far-near),1]);
  }

  function perspective(fovY, aspect, near, far) {
    if (![fovY,aspect,near,far].every(Number.isFinite) || fovY<=0 || fovY>=Math.PI ||
        aspect<=0 || near<=0 || far<=near) throw new RangeError('Invalid perspective frustum');
    const f=1/Math.tan(fovY/2), range=near-far;
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/range,-1,
      0,0,2*far*near/range,0]);
  }

  function project(point, matrix, width, height) {
    const [x, y, z, w] = transform4(matrix, ...point, 1);
    return {x: (x/w + 1)*width/2, y: (1-y/w)*height/2, depth: z/w};
  }

  const api = {add, sub, scale, dot, cross, unit, clamp, identity, multiply, transform4,
    translation, rotation, lookAt, ortho, perspective, project};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.PocketPlaces ||= {}).math = api;
})();
