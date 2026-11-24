"use strict";

var TwistMath = (function () {
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const subtract = (a, b) => a.map((v, i) => v - b[i]);
  function unit(v) {
    const length = Math.hypot(...v);
    return length ? v.map(n => n / length) : [0, 0, 0];
  }

  // Matrices are column-major and multiply column vectors, matching GLSL.
  function multiply(a, b) {
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        result[col * 4 + row] = sum;
      }
    }
    return result;
  }

  function transform(m, v) {
    return [0, 1, 2, 3].map(i => m[i] * v[0] + m[i + 4] * v[1] + m[i + 8] * v[2] + m[i + 12] * v[3]);
  }

  // Keep the outside faces at ±1.5 as space opens between the pieces.
  function pieceLayout(spread) {
    const scale = 1 - 0.36 * clamp(spread, 0, 1);
    return { scale, spacing: (3 - scale) / 2 };
  }
  const compact = pieceLayout(0);
  const lattice = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x || y || z) lattice.push(Object.freeze([x, y, z]));
      }
    }
  }
  Object.freeze(lattice);

  function model(basis, position, { scale, spacing } = compact) {
    return new Float32Array([
      basis[0] * scale, basis[1] * scale, basis[2] * scale, 0,
      basis[3] * scale, basis[4] * scale, basis[5] * scale, 0,
      basis[6] * scale, basis[7] * scale, basis[8] * scale, 0,
      position[0] * spacing, position[1] * spacing, position[2] * spacing, 1
    ]);
  }

  function rotation(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 0) return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
    if (axis === 1) return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  }

  function perspective(fov, aspect, near, far) {
    const scale = 1 / Math.tan(fov / 2);
    return new Float32Array([scale / aspect,0,0,0, 0,scale,0,0,
      0,0,(far + near) / (near - far),-1, 0,0,2 * far * near / (near - far),0]);
  }

  function lookAt(eye, target, up = [0, 1, 0]) {
    const z = unit(subtract(eye, target));
    const x = unit(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -dot(x, eye),-dot(y, eye),-dot(z, eye),1]);
  }

  // Slab intersection returns the first surface reached by a world-space ray.
  const positive = ["R", "U", "F"], negative = ["L", "D", "B"];
  function hitSurface(origin, direction, half = 1.5) {
    let near = -Infinity, far = Infinity, entry = null, exit = null;
    for (let axis = 0; axis < 3; axis++) {
      const o = origin[axis], d = direction[axis];
      if (Math.abs(d) < 1e-10) {
        if (Math.abs(o) > half) return null;
        continue;
      }
      const a = (-half - o) / d, b = (half - o) / d;
      if (Math.min(a, b) > near) { near = Math.min(a, b); entry = d > 0 ? negative[axis] : positive[axis]; }
      if (Math.max(a, b) < far) { far = Math.max(a, b); exit = d > 0 ? positive[axis] : negative[axis]; }
      if (near > far) return null;
    }
    if (far < 0) return null;
    const face = near >= 0 ? entry : exit, distance = near >= 0 ? near : far;
    return face ? { face, point: origin.map((o, i) => o + distance * direction[i]) } : null;
  }
  const hitFace = (origin, direction, half) => hitSurface(origin, direction, half)?.face ?? null;

  function hitPieces(origin, direction, layout) {
    if (layout.scale === 1) return hitSurface(origin, direction);
    let nearest = null, distance = Infinity;
    for (const slot of lattice) {
      const center = slot.map(n => n * layout.spacing);
      const hit = hitSurface(subtract(origin, center), direction, layout.scale / 2);
      if (!hit) continue;
      const point = hit.point.map((n, i) => n + center[i]);
      const alongRay = dot(subtract(point, origin), direction);
      if (alongRay >= distance) continue;
      distance = alongRay;
      // An exposed plastic side occludes pieces behind it, but only an
      // outward face can be turned. Either side identifies a piece to track.
      const exterior = slot.some((n, i) => n && (n > 0 ? positive : negative)[i] === hit.face);
      nearest = { face: hit.face, point, slot, exterior };
    }
    return nearest;
  }

  const HOME = { yaw: 0.63, pitch: 0.48, distance: 9.65 };
  class Orbit {
    constructor() {
      Object.assign(this, HOME);
      this.spread = 0;
      this.goal = { ...HOME, spread: 0 };
      this.target = [0, -0.13, 0];
    }
    drag(dx, dy) {
      this.goal.yaw -= dx * 0.008;
      this.goal.pitch = clamp(this.goal.pitch + dy * 0.008, -1.48, 1.48);
    }
    zoom(delta) {
      this.zoomBy(Math.exp(delta * 0.0011));
    }
    zoomBy(factor) {
      this.goal.distance = clamp(this.goal.distance * factor, 6.7, 15);
    }
    setExploded(expanded, immediate = false) {
      this.goal.spread = expanded ? 1 : 0;
      if (immediate) this.spread = this.goal.spread;
    }
    reset() {
      // Take the short arc back, even after several revolutions.
      const offset = Math.atan2(Math.sin(HOME.yaw - this.yaw), Math.cos(HOME.yaw - this.yaw));
      Object.assign(this.goal, HOME, { yaw: this.yaw + offset });
    }
    step(milliseconds) {
      const blend = 1 - Math.exp(-Math.max(0, milliseconds) / 55);
      let changed = false;
      for (const key of ["yaw", "pitch", "distance", "spread"]) {
        const delta = this.goal[key] - this[key];
        if (!delta) continue;
        this[key] = Math.abs(delta) < 0.00004 ? this.goal[key] : this[key] + delta * blend;
        changed = true;
      }
      return changed;
    }
    frame(aspect) {
      const flat = Math.cos(this.pitch) * this.distance;
      const eye = [flat * Math.sin(this.yaw), Math.sin(this.pitch) * this.distance + this.target[1],
        flat * Math.cos(this.yaw)];
      const view = lookAt(eye, this.target);
      // Fit the cube to the narrower dimension for portrait viewports.
      const fov = 2 * Math.atan(Math.tan(0.285) / Math.min(aspect, 1));
      const vp = multiply(perspective(fov, aspect, 0.15, 60), view);
      return { eye, view, vp, fov, aspect, layout: pieceLayout(this.spread) };
    }
    hit(nx, ny, aspect) {
      const { eye, view, fov, layout } = this.frame(aspect);
      const scale = Math.tan(fov / 2);
      const dir = [0, 1, 2].map(i => -view[i * 4 + 2] +
        nx * aspect * scale * view[i * 4] + ny * scale * view[i * 4 + 1]);
      return hitPieces(eye, dir, layout);
    }
    pick(nx, ny, aspect) {
      const hit = this.hit(nx, ny, aspect);
      return hit && hit.exterior !== false ? hit.face : null;
    }
  }

  return { clamp, dot, cross, subtract, unit, multiply, transform, lattice, pieceLayout, model, rotation,
    perspective, lookAt, hitSurface, hitFace, hitPieces, Orbit };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TwistMath;
