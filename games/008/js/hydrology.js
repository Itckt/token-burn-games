(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./terrain"));
  else root.FieldAtlas.hydrology = factory(root.FieldAtlas.math, root.FieldAtlas.terrain);
})(globalThis, function (M, T) {
  "use strict";

  const MIN_LEVEL = -6, MAX_LEVEL = 8;

  // Clip each planar face against the lake. Depth varies linearly, so its
  // integral on each clipped triangle is area times the mean corner depth.
  // Optional painters receive vertices [grid X, grid Z, water depth in metres].
  function inundation(grid, level, wetFace, shoreEdge, includeLevel = false) {
    if (!Number.isFinite(level)) throw new RangeError("Lake level must be finite");
    const { heights, step, side } = grid, faceArea = step * step / 2;
    let area = 0, volume = 0;
    const point = (i, depth) => [i % side, Math.floor(i / side), depth];
    const inside = depth => includeLevel ? depth >= 0 : depth > 0;
    T.visitTriangles(grid, (a, b, c) => {
      const da = level - heights[a], db = level - heights[b], dc = level - heights[c];
      if (!inside(da) && !inside(db) && !inside(dc)) return;
      if (inside(da) && inside(db) && inside(dc)) {
        area += faceArea;
        volume += faceArea * (da + db + dc) / 3;
        if (wetFace) wetFace([point(a, da), point(b, db), point(c, dc)]);
        return;
      }
      const corners = [point(a, da), point(b, db), point(c, dc)], polygon = [], shore = [];
      for (let i = 0; i < 3; i++) {
        const p = corners[i], q = corners[(i + 1) % 3];
        if (inside(p[2])) polygon.push(p);
        if (inside(p[2]) === inside(q[2])) continue;
        const t = p[2] / (p[2] - q[2]);
        const crossing = [M.lerp(p[0], q[0], t), M.lerp(p[1], q[1], t), 0];
        polygon.push(crossing);
        shore.push(crossing);
      }
      const p = polygon[0];
      for (let i = 1; i + 1 < polygon.length; i++) {
        const q = polygon[i], r = polygon[i + 1];
        const patch = faceArea * Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
        area += patch;
        volume += patch * (p[2] + q[2] + r[2]) / 3;
      }
      if (wetFace) wetFace(polygon);
      if (shoreEdge && (shore[0][0] !== shore[1][0] || shore[0][1] !== shore[1][1])) shoreEdge(shore[0], shore[1]);
    });
    return { area, volume };
  }

  // Use actual mesh edges. An unused cell diagonal can pass through a ridge.
  function neighbours(grid, vertex) {
    const x = vertex % grid.side, z = Math.floor(vertex / grid.side), adjacent = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((!dx && !dz) || nx < 0 || nz < 0 || nx >= grid.side || nz >= grid.side) continue;
        if (dx && dz) {
          const cell = Math.min(z, nz) * grid.segments + Math.min(x, nx);
          if (Boolean(grid.splits[cell]) !== (dx === dz)) continue;
        }
        adjacent.push(nz * grid.side + nx);
      }
    }
    return adjacent;
  }
  function traceRunoff(grid, source, level = T.WATER, bound = T.HALF) {
    if (!T.inSurvey(source) || !Number.isFinite(level) || !Number.isFinite(bound) || bound <= 0 || bound > T.HALF) {
      throw new RangeError("Invalid runoff source or level");
    }
    const { heights, side, segments, step } = grid;
    const margin = Math.ceil((T.HALF - bound) / step);
    if (2 * margin > segments) throw new RangeError("No terrain vertices inside the tracing area");
    const snap = v => M.clamp(Math.round((v + T.HALF) / step), margin, segments - margin);
    const position = i => T.vertexPoint(grid, i);
    const atEdge = p => Math.max(Math.abs(p[0]), Math.abs(p[1])) >= bound;
    let current = snap(source[1]) * side + snap(source[0]);
    const points = [position(current)];

    // On a level terrace, search by number of mesh edges to a drop or the
    // survey rim. A closed depression ends the trace at its first low point.
    function drainageLeg(start) {
      const queue = [start], parent = new Map([[start, -1]]);
      for (let head = 0; head < queue.length; head++) {
        const v = queue[head], bed = heights[v];
        let end = -1, steepest = 0;
        if (atEdge(position(v))) end = v;
        else {
          for (const n of neighbours(grid, v)) {
            const span = Math.abs(n - v);
            const fall = (bed - heights[n]) / (span === 1 || span === side ? 1 : Math.SQRT2);
            if (fall > steepest) { steepest = fall; end = n; }
            if (heights[n] === bed && !parent.has(n)) { parent.set(n, v); queue.push(n); }
          }
          if (end !== -1) parent.set(end, v);
        }
        if (end !== -1) {
          const leg = [];
          for (let i = end; i !== start; i = parent.get(i)) leg.push(i);
          return leg.reverse();
        }
      }
      return [];
    }
    if (heights[current] <= level) return { points, outlet: "lake" };
    if (atEdge(points[0])) return { points, outlet: "edge" };
    for (;;) {
      const leg = drainageLeg(current);
      if (!leg.length) return { points, outlet: "hollow" };
      for (const next of leg) {
        const a = points.at(-1), b = position(next);
        let fraction = 1, outlet = null;
        for (let axis = 0; axis < 2; axis++) {
          if (Math.abs(b[axis]) >= bound) {
            fraction = Math.min(fraction, (Math.sign(b[axis]) * bound - a[axis]) / (b[axis] - a[axis]));
            outlet = "edge";
          }
        }
        if (heights[next] <= level) {
          const wet = (heights[current] - level) / (heights[current] - heights[next]);
          if (wet <= fraction) { fraction = wet; outlet = "lake"; }
        }
        const end = [M.lerp(a[0], b[0], fraction), M.lerp(a[1], b[1], fraction)];
        if (end[0] !== a[0] || end[1] !== a[1]) points.push(end);
        if (outlet) return { points, outlet };
        current = next;
      }
    }
  }
  return { MIN_LEVEL, MAX_LEVEL, inundation, traceRunoff };
});
