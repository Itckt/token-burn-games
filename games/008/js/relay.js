(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./terrain"), require("./survey"));
  else root.FieldAtlas.relay = factory(root.FieldAtlas.math, root.FieldAtlas.terrain, root.FieldAtlas.survey);
})(globalThis, function (M, T, Q) {
  "use strict";

  const RIM = 1.22;
  function buildCourse(grid, route) {
    if (route.length < Q.MIN_LEG - 1e-8) return null;
    const count = Math.min(8, Math.ceil(route.length / 60)), spacing = route.length / count;
    const radius = Math.min(8, spacing * 0.28), gates = [];
    for (let i = 1; i <= count; i++) {
      const distance = i === count ? route.length : i * spacing;
      const station = Q.stationAt(route, distance);
      const approach = Q.stationAt(route, distance - Math.min(5, spacing));
      const dx = station.x - approach.x, dz = station.z - approach.z;
      const yaw = dx || dz ? Math.atan2(dx, -dz) : Q.flightPose(route, distance).yaw;
      const nx = Math.sin(yaw), nz = -Math.cos(yaw);
      const rimRadius = radius * RIM;
      const span = T.surveyInterval([station.x, station.z], [-nz, nx], -rimRadius, rimRadius);
      const [a, b] = span.map(t => [station.x - nz * t, station.z + nx * t]);
      let highest = Math.max(route.waterLevel, grid.surfaceAt(...a));
      for (const cut of T.segmentCuts(grid, a, b)) {
        highest = Math.max(highest, grid.surfaceAt(M.lerp(a[0], b[0], cut), M.lerp(a[1], b[1], cut)));
      }
      const y = Math.max(station.altitude, highest + rimRadius + 2);
      gates.push({ center: [station.x, y, station.z], normal: [nx, nz], radius, rimRadius });
    }
    const start = route.samples[0], position = [start.x, start.altitude, start.z];
    const [dx, dy, dz] = M.subtract(gates[0].center, position);
    return { gates, launch: { position, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) } };
  }
  // Intersect the whole movement segment with the aperture. The interpolated
  // fraction also timestamps a finish between frames. Approach from either side.
  function crossing(gate, from, to) {
    const [x, y, z] = gate.center, [nx, nz] = gate.normal;
    const before = (from[0] - x) * nx + (from[2] - z) * nz;
    const after = (to[0] - x) * nx + (to[2] - z) * nz;
    if (before === 0 || after === before) return null;
    const t = before / (before - after);
    if (t < 0 || (t > 1 && Math.abs(after) > 1e-9)) return null;
    const fraction = Math.min(1, t);
    const side = -(M.lerp(from[0], to[0], fraction) - x) * nz + (M.lerp(from[2], to[2], fraction) - z) * nx;
    const up = M.lerp(from[1], to[1], fraction) - y;
    return Math.hypot(side, up) <= gate.radius + 1e-8 ? fraction : null;
  }
  function start(course) {
    return { course, elapsed: 0, splits: [], started: false, finished: false };
  }
  function advance(run, from, to, seconds) {
    if (run.finished || !Number.isFinite(seconds) || seconds <= 0) return;
    if (!run.started && from.every((v, i) => v === to[i])) return;
    run.started = true;
    const gates = run.course.gates;
    let lastFraction = -1;
    while (run.splits.length < gates.length) {
      const t = crossing(gates[run.splits.length], from, to);
      if (t === null || t <= lastFraction) break;
      run.splits.push(run.elapsed + t * seconds);
      lastFraction = t;
    }
    run.finished = run.splits.length === gates.length;
    run.elapsed = run.finished ? run.splits.at(-1) : run.elapsed + seconds;
  }
  function formatTime(seconds) {
    const tenths = Math.round(seconds * 10);
    return Math.floor(tenths / 600) + ":" + String(Math.floor(tenths / 10) % 60).padStart(2, "0") + "." + tenths % 10;
  }
  return { buildCourse, crossing, start, advance, formatTime };
});
