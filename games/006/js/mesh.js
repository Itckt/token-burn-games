(function () {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const M = node ? require('./math.js') : Nightline.math;
  const STRIDE = 17;
  const PART = Object.freeze({ STRAP: -6, SALOON_SIGN: -5, GUARD_LAMP: -4, WIPER: 1, WINDSCREEN: 2, RIDER: 3 });
  const STRAP_RAIL = Object.freeze({ x: 1.32, y: 2.94 });
  const rgb = hex => [((hex >>> 16) & 255) / 255, ((hex >>> 8) & 255) / 255, (hex & 255) / 255];

  function paint(color, texture = 0, emission = 0, options = {}) {
    return { color: typeof color === 'number' ? rgb(color) : color, texture, emission,
      alpha: options.alpha ?? 1, slide: options.slide || 0, scale: options.scale || null };
  }

  class Mesh {
    constructor(maxSpan = Infinity) { this.vertices = []; this.indices = []; this.maxSpan = maxSpan; this.part = 0; }

    vertex(point, normal, uv, m) {
      if (m.uvRect) {
        const [left, top, width, height] = m.uvRect;
        uv = [left + uv[0] * width, top + uv[1] * height];
      }
      // Track vertices use slot 15 for centreline offset, hanging grips for hinge Z.
      this.vertices.push(...point, ...normal, ...m.color, m.alpha, ...uv, m.texture, m.emission, m.slide, m.hingeZ ?? 0, m.part ?? this.part);
    }

    quad(a, b, c, d, m, normals) {
      const base = this.vertices.length / STRIDE;
      const w = M.subtract(b, a), h = M.subtract(d, a);
      const n = normals ? null : M.normalize(M.cross(w, h));
      const u = m.scale ? Math.hypot(...w) / m.scale[0] : 1;
      const v = m.scale ? Math.hypot(...h) / m.scale[1] : 1;
      // Split long faces before bending so rails, sleepers and wall fittings follow the same curve.
      if (Math.abs(w[2]) > this.maxSpan || Math.abs(h[2]) > this.maxSpan) {
        const cols = Math.max(1, Math.ceil(Math.abs(w[2]) / this.maxSpan));
        const rows = Math.max(1, Math.ceil(Math.abs(h[2]) / this.maxSpan));
        function sample(p, q, r, s, x, y) {
          return p.map((start, k) => (1-y)*((1-x)*start+x*q[k]) + y*((1-x)*s[k]+x*r[k]));
        }
        for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
          const x = i / cols, y = j / rows;
          const normal = normals ? M.normalize(sample(...normals, x, y)) : n;
          this.vertex(sample(a, b, c, d, x, y), normal, [u*x, v*(1-y)], m);
          if (i < cols && j < rows) {
            const k = base + j*(cols+1) + i;
            this.indices.push(k, k+1, k+cols+2, k, k+cols+2, k+cols+1);
          }
        }
        return;
      }
      this.vertex(a, normals ? normals[0] : n, [0, v], m);
      this.vertex(b, normals ? normals[1] : n, [u, v], m);
      this.vertex(c, normals ? normals[2] : n, [u, 0], m);
      this.vertex(d, normals ? normals[3] : n, [0, 0], m);
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    box(x0, y0, z0, x1, y1, z1, m) {
      const a = [x0, y0, z0], b = [x1, y0, z0], c = [x1, y1, z0], d = [x0, y1, z0];
      const e = [x0, y0, z1], f = [x1, y0, z1], g = [x1, y1, z1], h = [x0, y1, z1];
      this.quad(e, f, g, h, m); this.quad(b, a, d, c, m);
      this.quad(a, e, h, d, m); this.quad(f, b, c, g, m);
      this.quad(h, g, c, d, m); this.quad(a, b, f, e, m);
    }

    tube(a, b, radius, m, sides = 8) {
      const axis = M.normalize(M.subtract(b, a));
      const u = M.normalize(M.cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const v = M.cross(axis, u);
      const ring = Array.from({ length: sides }, (_, i) => {
        const angle = 2 * Math.PI * i / sides;
        return u.map((value, k) => value * Math.cos(angle) + v[k] * Math.sin(angle));
      });
      const point = (end, n) => end.map((value, k) => value + radius * n[k]);
      for (let i = 0; i < sides; i++) {
        const n = ring[i], next = ring[(i + 1) % sides];
        this.quad(point(a, n), point(a, next), point(b, next), point(b, n), m, [n, next, next, n]);
      }
    }

    finish(warp) {
      const count = this.vertices.length / STRIDE;
      if (count > 65536) throw new RangeError('Mesh exceeds the 16-bit index budget');
      const vertices = new Float32Array(this.vertices);
      if (warp) for (let i = 0; i < vertices.length; i += STRIDE) warp(vertices, i);
      return { vertices, indices: new Uint16Array(this.indices) };
    }
  }

  const api = { STRIDE, PART, STRAP_RAIL, rgb, paint, Mesh };
  if (node) module.exports = api;
  else Nightline.mesh = api;
})();
