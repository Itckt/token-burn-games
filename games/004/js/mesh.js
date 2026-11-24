(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.HarbourMesh = factory(root.HarbourMath);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const STRIDE = 12;
  const solid = color => ({tile: -1, color});
  const light = color => ({tile: -2, color});
  const wall = (tile, color = [1, 1, 1]) => ({tile, color});
  const plainUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  function wallUV(width, height, offset = 0) {
    return [[offset, 0], [offset + width, 0], [offset + width, height], [offset, height]];
  }
  function horizontalRing(x, y, z, radius, sides = 12) {
    return Array.from({length: sides}, (_, i) => {
      const a = M.TAU * i / sides;
      return [x + radius * Math.cos(a), y, z - radius * Math.sin(a)];
    });
  }
  class Mesh {
    constructor() {
      this.chunks = [];
      this.vertices = [];
      this.indices = [];
    }
    flush() {
      if (!this.indices.length) return;
      this.chunks.push({vertices: new Float32Array(this.vertices), indices: new Uint16Array(this.indices)});
      this.vertices = [];
      this.indices = [];
    }
    face(points, material, uv = plainUV) {
      if (this.vertices.length / STRIDE + points.length > 65535) this.flush();
      const start = this.vertices.length / STRIDE;
      const normal = M.normalize(M.cross(M.subtract(points[1], points[0]), M.subtract(points[2], points[0])));
      for (let i = 0; i < points.length; i++) {
        const texCoord = typeof material.uv === 'function' ? material.uv(points[i]) : material.uv || uv[i];
        this.vertices.push(...points[i], ...normal, ...texCoord, material.tile, ...material.color);
      }
      for (let i = 1; i + 1 < points.length; i++) this.indices.push(start, start + i, start + i + 1);
    }
    box(x, y, z, width, height, depth, material, roof = material, offset = 0) {
      const l = x - width / 2, r = x + width / 2, b = z - depth / 2, f = z + depth / 2, t = y + height;
      this.face([[l,y,f], [r,y,f], [r,t,f], [l,t,f]], material, wallUV(width, height, offset));
      this.face([[r,y,b], [l,y,b], [l,t,b], [r,t,b]], material, wallUV(width, height, offset));
      this.face([[r,y,f], [r,y,b], [r,t,b], [r,t,f]], material, wallUV(depth, height, offset + 3));
      this.face([[l,y,b], [l,y,f], [l,t,f], [l,t,b]], material, wallUV(depth, height, offset + 3));
      this.face([[l,t,f], [r,t,f], [r,t,b], [l,t,b]], roof, wallUV(width, depth));
      this.face([[l,y,b], [r,y,b], [r,y,f], [l,y,f]], roof);
    }
    boxInFrame(toWorld, x, y, z, width, height, depth, material) {
      const ring = level => [[-1,1], [1,1], [1,-1], [-1,-1]].map(([a,b]) =>
        toWorld(x + a * width / 2, level, z + b * depth / 2));
      this.rings(ring(y), ring(y + height), material);
    }
    // A ring pair also describes tapered crowns, water tanks and pointed ferry hulls.
    rings(lower, upper, material, cap = material) {
      for (let i = 0; i < lower.length; i++) {
        const j = (i + 1) % lower.length;
        this.face([lower[i], lower[j], upper[j], upper[i]], material,
          wallUV(Math.hypot(...M.subtract(lower[j], lower[i])), Math.hypot(...M.subtract(upper[i], lower[i]))));
      }
      const uv = upper.map(p => [p[0], p[2]]);
      this.face(upper, cap, uv);
      const bottom = [...lower].reverse();
      this.face(bottom, cap, bottom.map(p => [p[0], p[2]]));
    }
    beam(a, b, radius, material, sides = 4) {
      const axis = M.normalize(M.subtract(b, a));
      const u = M.normalize(M.cross(axis, Math.abs(axis[1]) > 0.9 ? [1,0,0] : [0,1,0]));
      const v = M.cross(axis, u);
      const offsets = Array.from({length: sides}, (_, i) => {
        const angle = M.TAU * i / sides;
        return M.add(M.scale(u, radius * Math.cos(angle)), M.scale(v, radius * Math.sin(angle)));
      });
      this.rings(offsets.map(o => M.add(a, o)), offsets.map(o => M.add(b, o)), material);
    }
    finish() {
      this.flush();
      return this.chunks;
    }
  }
  return {Mesh, STRIDE, solid, light, wall, horizontalRing};
});
