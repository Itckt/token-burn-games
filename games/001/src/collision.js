(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Atlas.collision = factory();
})(globalThis, function () {
  'use strict';
  const RADIUS = 0.32;

  function insideBounds(x, z, bounds, r) {
    return x >= bounds.west + r && x <= bounds.east - r &&
      z >= bounds.north + r && z <= bounds.south - r;
  }
  function boxDistanceSq(x, z, box) {
    const dx = Math.max(0, Math.abs(x - box.x) - box.w / 2);
    const dz = Math.max(0, Math.abs(z - box.z) - box.d / 2);
    return dx * dx + dz * dz;
  }
  function canStand(x, z, world, r = RADIUS) {
    if (!(r >= 0) || !insideBounds(x, z, world.bounds, r)) return false;
    for (const c of world.colliders) {
      if (c.kind === 'circle') {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (r + c.r) ** 2) return false;
      } else {
        const d = boxDistanceSq(x, z, c);
        if (d < r * r || d === 0) return false;
      }
    }
    return true;
  }
  function segmentDistanceSq(x, z, ax, az, dx, dz, lengthSq) {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq));
    return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
  }
  // Sweep the player's disc for the entire leg, including the round clearance at corners.
  function canWalk(ax, az, bx, bz, world, r = RADIUS) {
    if (!(r >= 0) || !insideBounds(ax, az, world.bounds, r) || !insideBounds(bx, bz, world.bounds, r)) return false;
    const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
    if (lengthSq === 0) return canStand(ax, az, world, r);
    const left = Math.min(ax, bx) - r, right = Math.max(ax, bx) + r;
    const top = Math.min(az, bz) - r, bottom = Math.max(az, bz) + r;
    for (const c of world.colliders) {
      const hw = c.kind === 'circle' ? c.r : c.w / 2;
      const hd = c.kind === 'circle' ? c.r : c.d / 2;
      if (c.x + hw < left || c.x - hw > right || c.z + hd < top || c.z - hd > bottom) continue;
      if (c.kind === 'circle') {
        if (segmentDistanceSq(c.x, c.z, ax, az, dx, dz, lengthSq) < (r + c.r) ** 2) return false;
        continue;
      }
      // The two box axes and the segment normal are the three separating axes.
      if (Math.abs((ax + bx) / 2 - c.x) <= hw + Math.abs(dx) / 2 &&
          Math.abs((az + bz) / 2 - c.z) <= hd + Math.abs(dz) / 2 &&
          Math.abs(dx * (c.z - az) - dz * (c.x - ax)) <= hw * Math.abs(dz) + hd * Math.abs(dx)) return false;
      if (Math.min(boxDistanceSq(ax, az, c), boxDistanceSq(bx, bz, c)) < r * r) return false;
      for (const x of [c.x - hw, c.x + hw]) for (const z of [c.z - hd, c.z + hd]) {
        if (segmentDistanceSq(x, z, ax, az, dx, dz, lengthSq) < r * r) return false;
      }
    }
    return true;
  }
  return {RADIUS, canStand, canWalk};
});
