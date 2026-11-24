(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./math"), require("./terrain"), require("./simulation"));
  } else {
    const a = root.FieldAtlas;
    a.probe = factory(a.math, a.terrain, a.sim);
  }
})(globalThis, function (M, T, S) {
  "use strict";

  function cast(grid, eye, direction, waterLevel = null) {
    const length = Math.hypot(...direction);
    if (!eye.every(Number.isFinite) || !Number.isFinite(length) || !length) return null;
    const ray = direction.map(v => v / length);
    const span = T.surveyInterval([eye[0], eye[2]], [ray[0], ray[2]], 0.35, 1200);
    if (!span) return null;
    const near = span[0];
    let far = span[1];
    const horizontal = (axis, t) => M.clamp(eye[axis] + t * ray[axis], -T.HALF, T.HALF);
    function reading(t, kind) {
      const x = horizontal(0, t), z = horizontal(2, t);
      const { height, dx, dz } = grid.facetAt(x, z);
      const gradient = Math.hypot(dx, dz);
      return { kind, x, z, distance: t, bed: height, depth: kind === "water" ? waterLevel - height : 0,
        slope: Math.atan(gradient) * 180 / Math.PI, aspect: gradient ? S.heading(Math.atan2(-dx, dz)).cardinal : null };
    }
    let lake = null;
    if (Number.isFinite(waterLevel) && ray[1] !== 0) {
      const t = (waterLevel - eye[1]) / ray[1];
      if (t >= near && t <= far && grid.surfaceAt(horizontal(0, t), horizontal(2, t)) < waterLevel) {
        lake = reading(t, "water");
        far = t;
      }
    }
    // Between two mesh cuts the ray and the bed are both linear. A narrow
    // ridge cannot hide between samples, even when the ray is nearly level.
    const a = [horizontal(0, near), horizontal(2, near)], b = [horizontal(0, far), horizontal(2, far)];
    const gap = t => eye[1] + t * ray[1] - grid.surfaceAt(horizontal(0, t), horizontal(2, t));
    let previous = near, before = gap(near);
    if (Math.abs(before) < 1e-9) return reading(near, "ground");
    for (const cut of T.segmentCuts(grid, a, b)) {
      const t = M.lerp(near, far, cut), after = gap(t);
      if (Math.abs(after) < 1e-9) return reading(t, "ground");
      if ((before > 0) !== (after > 0)) return reading(M.lerp(previous, t, before / (before - after)), "ground");
      previous = t;
      before = after;
    }
    return lake;
  }
  return { cast };
});
