(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath);
  if (node) module.exports = api;
  else root.FoundryPicking = api;
})(globalThis, function (M) {
  "use strict";

  // x and y are normalized device coordinates, with +y at the top of the view.
  function viewRay(view, x, y) {
    const direction = M.mul(view.out, -1);
    const offset = M.madd(M.madd(view.eye, view.right, x * view.half * view.aspect), view.up, y * view.half);
    return {origin: M.madd(offset, direction, view.near), direction, limit: view.far - view.near};
  }

  function pickMesh(mesh) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.vertices.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], mesh.vertices[i+k]);
        max[k] = Math.max(max[k], mesh.vertices[i+k]);
      }
    }
    return {...mesh, min, max};
  }

  function intersectsBounds(mesh, ray, limit) {
    let enter = 0, exit = limit;
    for (let k = 0; k < 3; k++) {
      const origin = ray.origin[k], direction = ray.direction[k];
      if (Math.abs(direction) < 1e-12) {
        if (origin < mesh.min[k] || origin > mesh.max[k]) return false;
      } else {
        const a = (mesh.min[k]-origin)/direction, b = (mesh.max[k]-origin)/direction;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (enter > exit) return false;
      }
    }
    return true;
  }

  // Two-sided Möller–Trumbore on the renderer's interleaved vertex buffer.
  // Work directly on the floats to avoid allocating vectors for each triangle.
  function triangleDistance(vertices, a, b, c, ray) {
    const ex = vertices[b]-vertices[a], ey = vertices[b+1]-vertices[a+1], ez = vertices[b+2]-vertices[a+2];
    const fx = vertices[c]-vertices[a], fy = vertices[c+1]-vertices[a+1], fz = vertices[c+2]-vertices[a+2];
    const [dx, dy, dz] = ray.direction;
    const px = dy*fz-dz*fy, py = dz*fx-dx*fz, pz = dx*fy-dy*fx;
    const det = ex*px+ey*py+ez*pz;
    if (Math.abs(det) < 1e-10) return Infinity;
    const ox = ray.origin[0]-vertices[a], oy = ray.origin[1]-vertices[a+1], oz = ray.origin[2]-vertices[a+2];
    const u = (ox*px+oy*py+oz*pz)/det;
    if (u < 0 || u > 1) return Infinity;
    const qx = oy*ez-oz*ey, qy = oz*ex-ox*ez, qz = ox*ey-oy*ex;
    const v = (dx*qx+dy*qy+dz*qz)/det;
    if (v < 0 || u+v > 1) return Infinity;
    const distance = (fx*qx+fy*qy+fz*qz)/det;
    return distance >= 0 ? distance : Infinity;
  }

  function nearestSection(meshes, ray) {
    let closest = ray.limit, selected = -1;
    for (const [index, mesh] of meshes.entries()) {
      if (!intersectsBounds(mesh, ray, closest)) continue;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const distance = triangleDistance(mesh.vertices, 9*mesh.indices[i], 9*mesh.indices[i+1], 9*mesh.indices[i+2], ray);
        if (distance < closest) {
          closest = distance;
          selected = index;
        }
      }
    }
    return selected;
  }
  return {viewRay, pickMesh, nearestSection};
});
