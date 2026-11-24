"use strict";
const M = require("../../js/math");
const T = require("../../js/terrain");

// An independent ray/triangle oracle for surveying the actual rendered bed.
function triangleRaycast(grid, near = 0, far = Infinity) {
  const points = Array.from(grid.heights, (h, i) => {
    const [x, z] = T.vertexPoint(grid, i);
    return [x, h, z];
  });
  const faces = [];
  T.visitTriangles(grid, (ia, ib, ic) => {
    const a = points[ia];
    faces.push([a, M.subtract(points[ib], a), M.subtract(points[ic], a)]);
  });
  return (eye, direction) => {
    const ray = M.normalize(direction);
    let nearest = Infinity;
    for (const [a, ab, ac] of faces) {
      const p = M.cross(ray, ac), det = M.dot(ab, p);
      if (Math.abs(det) < 1e-11) continue;
      const s = M.subtract(eye, a), q = M.cross(s, ab);
      const u = M.dot(s, p) / det, v = M.dot(ray, q) / det, t = M.dot(ac, q) / det;
      if (u >= -1e-12 && v >= -1e-12 && u + v <= 1 + 1e-12 && t >= near && t <= far) nearest = Math.min(nearest, t);
    }
    return nearest;
  };
}
module.exports = { triangleRaycast };
