(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./math"), require("./terrain"), require("./hydrology"));
  } else {
    const a = root.FieldAtlas;
    a.waterways = factory(a.math, a.terrain, a.hydrology);
  }
})(globalThis, function (M, T, H) {
  "use strict";
  const DRAFT = 1.5, EPSILON = 1e-8;
  const BANDS = [
    { depth: 0, color: "#c4ac76" }, { depth: DRAFT, color: "#79bcad" },
    { depth: 4, color: "#43868e" }, { depth: 8, color: "#305771" }
  ];
  function afloat(grid, point, level) {
    return level - grid.surfaceAt(...point) >= DRAFT - EPSILON;
  }
  // A linear leg can first run aground inside a face, even with deep water
  // at both ends. Interpolate the first draft crossing between mesh cuts.
  function clearFraction(grid, a, b, level) {
    const ceiling = level - DRAFT;
    let last = 0, before = grid.surfaceAt(...a);
    if (before > ceiling + EPSILON) return 0;
    for (const t of T.segmentCuts(grid, a, b)) {
      const after = grid.surfaceAt(M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t));
      if (after > ceiling + EPSILON) {
        return M.lerp(last, t, M.clamp((ceiling - before) / (after - before), 0, 1));
      }
      last = t;
      before = after;
    }
    return 1;
  }
  // Intersect a convex depth polygon with the camera's survey square.
  function insideBounds(polygon, bound) {
    for (const axis of [0, 1]) {
      for (const sign of [-1, 1]) {
        if (polygon.every(p => sign * p[axis] <= bound)) continue;
        const clipped = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          const da = bound - sign * a[axis], db = bound - sign * b[axis];
          if (da >= 0) clipped.push(a);
          if ((da >= 0) !== (db >= 0)) {
            const t = da / (da - db);
            clipped.push([M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t)]);
          }
        }
        polygon = clipped;
      }
    }
    return polygon;
  }
  function nearestLaunch(grid, point, level, bound = T.HALF) {
    const start = point.map(v => M.clamp(v, -bound, bound));
    if (afloat(grid, start, level)) return start;
    let best = null, bestDistance = Infinity;
    H.inundation(grid, level - DRAFT, face => {
      const polygon = insideBounds(face.map(([x, z]) => [x * grid.step - T.HALF, z * grid.step - T.HALF]), bound);
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
        const t = length2 ? M.clamp(((start[0] - a[0]) * dx + (start[1] - a[1]) * dz) / length2, 0, 1) : 0;
        const x = a[0] + t * dx, z = a[1] + t * dz;
        const distance = (x - start[0]) ** 2 + (z - start[1]) ** 2;
        if (distance < bestDistance) { best = [x, z]; bestDistance = distance; }
      }
    }, null, true);
    return best && best.map(v => M.clamp(v, -bound, bound));
  }

  // Each navigable part of a face is convex. Two such faces communicate
  // through the portion of their common edge inside the draft and map limits.
  function opening(grid, i, j, ceiling, bound) {
    const a = T.vertexPoint(grid, i), b = T.vertexPoint(grid, j);
    const delta = [b[0] - a[0], b[1] - a[1]];
    const da = ceiling - grid.heights[i], db = ceiling - grid.heights[j];
    const near = da < 0 ? da / (da - db) : 0, far = db < 0 ? da / (da - db) : 1;
    const span = T.surveyInterval(a, delta, near, far, bound);
    if (!span) return null;
    const t = (span[0] + span[1]) / 2;
    return [M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t)];
  }
  function faceLinks(grid, ceiling, bound) {
    const links = new Array(grid.segments ** 2 * 2), edges = new Map();
    let face = -1;
    function edge(i, j) {
      if (Math.min(grid.heights[i], grid.heights[j]) > ceiling) return;
      const key = Math.min(i, j) * grid.heights.length + Math.max(i, j);
      const other = edges.get(key);
      if (other === undefined) { edges.set(key, face); return; }
      edges.delete(key);
      const point = opening(grid, i, j, ceiling, bound);
      if (!point) return;
      (links[face] ||= []).push({ face: other, point });
      (links[other] ||= []).push({ face, point });
    }
    T.visitTriangles(grid, (a, b, c) => {
      face++;
      if (Math.min(grid.heights[a], grid.heights[b], grid.heights[c]) <= ceiling) {
        edge(a, b); edge(b, c); edge(c, a);
      }
    });
    return links;
  }
  function findPassage(grid, a, b, level, bound = T.HALF) {
    if (!Number.isFinite(level) || !(bound > 0 && bound <= T.HALF) || ![a, b].every(T.inSurvey)) {
      throw new RangeError("Invalid passage endpoints or lake level");
    }
    if ([a, b].some(p => p.some(v => Math.abs(v) > bound) || !afloat(grid, p, level))) return null;
    if (a[0] === b[0] && a[1] === b[1]) return null;
    if (clearFraction(grid, a, b, level) === 1) return [a, b];
    const start = grid.facetAt(...a).face, end = grid.facetAt(...b).face;
    const links = faceLinks(grid, level - DRAFT, bound);
    const parent = new Int32Array(links.length).fill(-1), via = [], queue = [start];
    parent[start] = start;
    for (let head = 0; head < queue.length && parent[end] < 0; head++) {
      const here = queue[head];
      for (const link of links[here] || []) {
        if (parent[link.face] >= 0) continue;
        parent[link.face] = here;
        via[link.face] = link.point;
        queue.push(link.face);
      }
    }
    if (parent[end] < 0) return null;
    const corridor = [b];
    for (let f = end; f !== start; f = parent[f]) corridor.push(via[f]);
    corridor.reverse();
    // Skip mesh edges that the skiff can cross on one straight heading.
    const path = [a];
    for (let i = 1; i < corridor.length; i++) {
      if (clearFraction(grid, path.at(-1), corridor[i], level) < 1) path.push(corridor[i - 1]);
    }
    path.push(b);
    return path;
  }
  return { DRAFT, BANDS, afloat, clearFraction, nearestLaunch, findPassage };
});
