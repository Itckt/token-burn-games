(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./terrain"), require("./simulation"));
  else root.FieldAtlas.observatory = factory(root.FieldAtlas.math, root.FieldAtlas.terrain, root.FieldAtlas.sim);
})(globalThis, function (M, T, S) {
  "use strict";

  const DEGREE = Math.PI / 180;
  const MINUTES = 24 * 60;

  // An affine face has height a + b*d along a ray. Its apparent slope
  // (a - eyeHeight)/d + b is monotone between consecutive mesh crossings.
  function horizonAt(grid, eye, bearing) {
    const start = [eye[0], eye[2]];
    if (!T.inSurvey(start) || !Number.isFinite(eye[1]) || !Number.isFinite(bearing)) {
      throw new RangeError("A horizon reading needs a finite bearing and an eye inside the survey");
    }
    if (eye[1] < grid.surfaceAt(...start) - 1e-9) throw new RangeError("The observation station is below the terrain");
    const direction = [Math.sin(bearing), -Math.cos(bearing)].map(v => Math.abs(v) < 1e-14 ? 0 : v);
    const limit = T.surveyInterval(start, direction, 0, Infinity)[1];
    if (limit <= 0) return null;
    const end = start.map((v, i) => M.clamp(v + direction[i] * limit, -T.HALF, T.HALF));
    let slope = -Infinity, ridge = null;
    for (const t of T.segmentCuts(grid, start, end)) {
      const x = M.lerp(start[0], end[0], t), z = M.lerp(start[1], end[1], t);
      const height = grid.surfaceAt(x, z), distance = limit * t;
      const grade = (height - eye[1]) / distance;
      if (grade > slope) {
        slope = grade;
        ridge = { x, z, height, distance };
      }
    }
    ridge.angle = Math.atan(slope);
    return ridge;
  }
  function skyline(grid, eye) {
    return Array.from({ length: 360 }, (_, degrees) => horizonAt(grid, eye, degrees * DEGREE));
  }

  // On the clipped mesh, a summit is either a grid vertex or a cut along
  // the flight boundary. Prefer the most central candidate on a level top.
  function summit(grid, bound = S.FLIGHT_BOUND) {
    if (!(bound > 0 && bound <= T.HALF)) throw new RangeError("Invalid station boundary");
    let peak = null, radius = Infinity;
    function consider(x, z, height) {
      const r = x * x + z * z;
      if (!peak || height > peak[1] || (height === peak[1] && r < radius)) {
        peak = [x, height, z];
        radius = r;
      }
    }
    for (let i = 0; i < grid.heights.length; i++) {
      const [x, z] = T.vertexPoint(grid, i);
      if (Math.max(Math.abs(x), Math.abs(z)) <= bound) consider(x, z, grid.heights[i]);
    }
    const corners = [[-bound, -bound], [bound, -bound], [bound, bound], [-bound, bound]];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      for (const t of T.segmentCuts(grid, a, b)) {
        const x = M.lerp(a[0], b[0], t), z = M.lerp(a[1], b[1], t);
        consider(x, z, grid.surfaceAt(x, z));
      }
    }
    return peak;
  }

  // Store half-open runs of lit minutes. A notch can split the day into
  // several runs, even when both ends of a longer interval are in shadow.
  function sunWindows(grid, eye) {
    const windows = [];
    let minutes = 0;
    for (let minute = 0; minute < MINUTES; minute++) {
      const sun = S.sunDirection(minute / 60);
      if (sun[1] <= 1e-9) continue;
      const ridge = horizonAt(grid, eye, Math.atan2(sun[0], -sun[2]));
      if (ridge && Math.asin(sun[1]) <= ridge.angle + 1e-10) continue;
      const last = windows.at(-1);
      if (last && last.end === minute) last.end++;
      else windows.push({ start: minute, end: minute + 1 });
      minutes++;
    }
    return { windows, minutes };
  }

  // Fit the terrain box in light space. Nearer points along the sun vector
  // must write *smaller* depths, just like a normal WebGL depth pass.
  function lightProjection({ low, high }, sun) {
    const axes = M.basis(sun.map(v => -v)), halfY = (high - low) / 2;
    const centre = [0, low + halfY, 0];
    const extent = axis => T.HALF * (Math.abs(axis[0]) + Math.abs(axis[2])) + halfY * Math.abs(axis[1]) + 4;
    const matrix = M.view(centre, axes);
    const scale = [1 / extent(axes.right), 1 / extent(axes.up), -1 / extent(axes.forward)];
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 3; row++) matrix[col * 4 + row] *= scale[row];
    }
    return matrix;
  }
  return { DEGREE, MINUTES, horizonAt, skyline, sunWindows, summit, lightProjection };
});
