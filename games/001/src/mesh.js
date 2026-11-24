(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.Atlas.mesh = factory(root.Atlas.math);
})(globalThis, function (M) {
  'use strict';
  const STRIDE = 10;
  const MAT = Object.freeze({stone: 0, paving: 1, brick: 2, glass: 3, light: 4, grass: 5, cloud: 6, distant: 7, leaf: 8, timber: 9, water: 10});
  const colors = new Map();
  function rgb(value) {
    if (typeof value !== 'string') return value;
    if (!colors.has(value)) {
      colors.set(value, [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
    }
    return colors.get(value);
  }
  const tint = (color, gain) => rgb(color).map(v => M.clamp(v * gain, 0, 1));
  class Mesh {
    constructor() {
      this.data = new Float32Array(STRIDE * 8192);
      this.used = 0;
    }
    vertex(p, n, color, material) {
      if (this.used + STRIDE > this.data.length) {
        const next = new Float32Array(this.data.length * 2);
        next.set(this.data);
        this.data = next;
      }
      const i = this.used, d = this.data;
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
      d[i + 3] = n[0]; d[i + 4] = n[1]; d[i + 5] = n[2];
      d[i + 6] = color[0]; d[i + 7] = color[1]; d[i + 8] = color[2]; d[i + 9] = material;
      this.used += STRIDE;
    }
    face(points, color, material = MAT.stone, outward) {
      const c = rgb(color);
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[0];
        let b = points[i], end = points[i + 1];
        let n = M.normalize(M.cross(M.sub(b, a), M.sub(end, a)));
        if (M.dot(n, n) < 0.5) continue;
        if (outward && M.dot(n, outward) < 0) {
          [b, end] = [end, b];
          n = M.scale(n, -1);
        }
        this.vertex(a, n, c, material);
        this.vertex(b, n, c, material);
        this.vertex(end, n, c, material);
      }
    }
    box(x, y, z, w, h, d, color, mat = MAT.stone) {
      const a = x - w / 2, b = x + w / 2, l = z - d / 2, r = z + d / 2, t = y + h / 2, s = y - h / 2;
      this.face([[a,s,r],[b,s,r],[b,t,r],[a,t,r]], color, mat);
      this.face([[b,s,l],[a,s,l],[a,t,l],[b,t,l]], color, mat);
      this.face([[b,s,r],[b,s,l],[b,t,l],[b,t,r]], color, mat);
      this.face([[a,s,l],[a,s,r],[a,t,r],[a,t,l]], color, mat);
      this.face([[a,t,r],[b,t,r],[b,t,l],[a,t,l]], color, mat);
      this.face([[a,s,l],[b,s,l],[b,s,r],[a,s,r]], color, mat);
    }
    // A rectangular truncated pyramid, also used for the two slopes of hipped roofs.
    frustum(x, y, z, w0, d0, w1, d1, h, color, mat = MAT.stone) {
      function ring(w, d, level) {
        return [[x-w/2,level,z+d/2],[x+w/2,level,z+d/2],[x+w/2,level,z-d/2],[x-w/2,level,z-d/2]];
      }
      const low = ring(w0, d0, y), high = ring(w1, d1, y + h);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        this.face([low[i], low[j], high[j], high[i]], color, mat);
      }
      this.face(high, color, mat);
      this.face(low.reverse(), color, mat);
    }
    // Oriented solid with polygonal cross-section. Equal radii give a cylinder.
    beam(a, b, r0, r1, sides, color, mat = MAT.stone, phase = 0) {
      const axis = M.normalize(M.sub(b, a));
      if (!M.dot(axis, axis)) return;
      const ref = Math.abs(axis[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      const u = M.normalize(M.cross(ref, axis)), v = M.cross(axis, u);
      const low = [], high = [], dirs = [];
      for (let i = 0; i < sides; i++) {
        const angle = i * M.TAU / sides + phase;
        const radial = M.add(M.scale(u, Math.cos(angle)), M.scale(v, Math.sin(angle)));
        dirs.push(radial);
        low.push(M.add(a, M.scale(radial, r0)));
        high.push(M.add(b, M.scale(radial, r1)));
      }
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.face([low[i], low[j], high[j], high[i]], color, mat, dirs[i]);
      }
      this.face(low, color, mat, M.scale(axis, -1));
      this.face(high, color, mat, axis);
    }
    // Staggered rings give each crown, shrub and cloud a different faceted silhouette.
    crown(x, y, z, rx, ry, rz, color, rng, mat = MAT.leaf, sides = 8) {
      const rings = [], phase = rng() * M.TAU;
      const top = [x + (rng()-.5)*rx*.18, y + ry, z];
      const bottom = [x, y - ry * .88, z];
      const levels = [[-.56,.78],[.02,1],[.62,.71]];
      for (let k = 0; k < levels.length; k++) {
        rings.push(Array.from({length: sides}, (_, i) => {
          const angle = (i + .42 * (k % 2) + (rng()-.5)*.22) * M.TAU / sides + phase;
          const radius = levels[k][1] * (.9 + .19*rng());
          return [x + Math.cos(angle)*rx*radius, y+(levels[k][0]+(rng()-.5)*.17)*ry, z+Math.sin(angle)*rz*radius];
        }));
      }
      const center = [x, y, z], variation = mat === MAT.cloud ? .025 : .085;
      const triangle = (a, b, c) => this.face([a,b,c], tint(color, 1+(rng()-.5)*variation), mat, M.sub(a,center));
      for (let i = 0; i < sides; i++) {
        const j = (i+1) % sides;
        triangle(rings[0][i], bottom, rings[0][j]);
        for (let k = 1; k < rings.length; k++) {
          triangle(rings[k-1][i], rings[k-1][j], rings[k][i]);
          triangle(rings[k][i], rings[k-1][j], rings[k][j]);
        }
        triangle(rings[2][i], rings[2][j], top);
      }
    }
    finish() { return this.data.slice(0, this.used); }
    get vertexCount() { return this.used / STRIDE; }
  }
  return {STRIDE, MAT, Mesh, rgb, tint};
});
