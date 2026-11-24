(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./terrain"));
  else root.FieldAtlas.survey = factory(root.FieldAtlas.math, root.FieldAtlas.terrain);
})(globalThis, function (M, T) {
  "use strict";

  const CLEARANCE = 16, MAX_GRADE = 0.52, FLIGHT_SPEED = 17, MIN_LEG = 5;
  function inletPath(world) {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, z = 152 - 328 * t;
      const bank = 42 * (1 - M.smoothstep(0, 0.27, t)) + 81 * M.smoothstep(0.57, 1, t);
      const cone = world.id === "caldera" ? 54 * Math.exp(-(((z + 42) / 46) ** 2)) : 0;
      points.push([world.riverCenter(z) + bank + cone, z]);
    }
    return points;
  }

  function buildRoute(grid, points, waterLevel = T.WATER) {
    if (!Number.isFinite(waterLevel)) throw new RangeError("Lake level must be finite");
    if (!Array.isArray(points) || !points.length) throw new RangeError("Route needs two distinct points");
    for (const p of points) {
      if (!T.inSurvey(p)) throw new RangeError("Route lies outside the survey");
    }
    const samples = [];
    let length = 0, ascent = 0, submerged = 0, low = Infinity, high = -Infinity;
    function record(x, z, distance) {
      const prev = samples.at(-1);
      // A sub-ulp leg at the end of a long course can round to the same station.
      if (prev && distance <= prev.distance) return;
      const height = grid.surfaceAt(x, z);
      if (prev) {
        const delta = height - prev.height, span = distance - prev.distance;
        ascent += Math.max(0, delta);
        if (height < waterLevel && prev.height < waterLevel) submerged += span;
        else if (Math.min(height, prev.height) < waterLevel) {
          submerged += span * (waterLevel - Math.min(height, prev.height)) / Math.abs(delta);
        }
      }
      low = Math.min(low, height);
      high = Math.max(high, height);
      samples.push({ x, z, height, distance, altitude: Math.max(waterLevel, height) + CLEARANCE });
    }
    record(points[0][0], points[0][1], 0);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!span) continue;
      for (const t of T.segmentCuts(grid, a, b)) {
        record(M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t), length + t * span);
      }
      length += span;
    }
    if (!length) throw new RangeError("Route needs two distinct points");
    // Propagate clearance in both directions so the camera climbs before a ridge and descends gradually.
    function clearRidge(here, adjacent) {
      const run = Math.abs(here.distance - adjacent.distance);
      here.altitude = Math.max(here.altitude, adjacent.altitude - MAX_GRADE * run);
    }
    for (let i = 1; i < samples.length; i++) clearRidge(samples[i], samples[i - 1]);
    for (let i = samples.length - 2; i >= 0; i--) clearRidge(samples[i], samples[i + 1]);
    return { samples, length, ascent, submerged, low, high, waterLevel };
  }

  function segmentAt(samples, distance) {
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid].distance <= distance) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function stationAt(route, distance) {
    const d = M.clamp(distance, 0, route.length), i = segmentAt(route.samples, d);
    const a = route.samples[i], b = route.samples[i + 1], t = (d - a.distance) / (b.distance - a.distance);
    return { distance: d, x: M.lerp(a.x, b.x, t), z: M.lerp(a.z, b.z, t),
      height: M.lerp(a.height, b.height, t), altitude: M.lerp(a.altitude, b.altitude, t) };
  }
  function flightPose(route, distance) {
    const eye = stationAt(route, distance);
    let back = stationAt(route, eye.distance - 7), ahead = stationAt(route, eye.distance + 16);
    if (Math.hypot(ahead.x - back.x, ahead.z - back.z) < 1e-8) {
      const i = segmentAt(route.samples, eye.distance);
      back = route.samples[i]; ahead = route.samples[i + 1];
    }
    const dx = ahead.x - back.x, dz = ahead.z - back.z;
    const pitch = Math.atan2(ahead.altitude - back.altitude, Math.hypot(dx, dz)) - 0.13;
    return { position: [eye.x, eye.altitude, eye.z], yaw: Math.atan2(dx, -dz), pitch };
  }
  return { inletPath, buildRoute, stationAt, flightPose, CLEARANCE, MAX_GRADE, FLIGHT_SPEED, MIN_LEG };
});
