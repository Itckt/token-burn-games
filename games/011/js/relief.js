(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const field = common ? require("./field.js") : root.Isobar.field;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const DEPTH_PER_HPA = 0.046, CONTOUR_HPA = 10;
  const EXTENT = 145, DETAIL = 13, STEP = 0.25;
  const peak = (field.PRESSURE_EXPONENT - 1) / field.PRESSURE_EXPONENT;
  const maxDerivative = field.PRESSURE_EXPONENT * Math.pow(peak, peak) * Math.exp(-peak) / field.PRESSURE_RADIUS;
  const axis = [-EXTENT];
  for (let coordinate = -DETAIL; coordinate <= DETAIL; coordinate += STEP) axis.push(coordinate);
  axis.push(EXTENT);
  const STOPS = [
    { pressure: 910, color: "#483876" }, { pressure: 940, color: "#79639e" },
    { pressure: 970, color: "#9a8cb0" }, { pressure: 990, color: "#6b98a4" },
    { pressure: field.AMBIENT_PRESSURE, color: "#31545e" }
  ];

  function mesh() {
    const side = axis.length;
    const positions = new Float32Array(side * side * 2);
    const indices = new Uint16Array((side - 1) ** 2 * 6);
    let cursor = 0;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const index = row * side + col;
        positions[2 * index] = axis[col];
        positions[2 * index + 1] = axis[row];
        if (row + 1 === side || col + 1 === side) continue;
        const below = index + side;
        indices.set([index, below, index + 1, index + 1, below, below + 1], cursor);
        cursor += 6;
      }
    }
    return { positions, indices };
  }

  function surface(state) {
    const central = storm.readings(state.strength, state.time).pressure, scale = storm.radialScale(state.strength);
    // Both Cartesian components of any mesh triangle's slope are bounded
    // by the largest radial derivative. Steeper sightlines cannot be hidden.
    const maxSlope = Math.SQRT2 * maxDerivative * DEPTH_PER_HPA * (field.AMBIENT_PRESSURE - central) / scale;
    return { central, scale, maxSlope };
  }

  function vertexHeight(model, x, z) {
    const pressure = field.pressureAt(Math.hypot(x, z) / model.scale, model.central);
    return (pressure - field.AMBIENT_PRESSURE) * DEPTH_PER_HPA;
  }

  function cell(coordinate) {
    if (coordinate < -DETAIL) return 0;
    if (coordinate >= DETAIL) return axis.length - 2;
    return 1 + Math.floor((coordinate + DETAIL) / STEP);
  }

  // Use the same diagonal and barycentric weights as the GPU mesh.
  function height(model, x, z) {
    const col = cell(x), row = cell(z);
    let x0 = axis[col], x1 = axis[col + 1], z0 = axis[row], z1 = axis[row + 1];
    let u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
    if (u + v > 1) {
      [x0, x1] = [x1, x0]; [z0, z1] = [z1, z0];
      u = 1 - u; v = 1 - v;
    }
    const base = vertexHeight(model, x0, z0);
    return base + u * (vertexHeight(model, x1, z0) - base) + v * (vertexHeight(model, x0, z1) - base);
  }

  function pick(model, frame, pixelX, pixelY, width, height) {
    const ray = math.viewRay(frame, pixelX, pixelY, width, height);
    if (!ray || ray[1] >= 0) return null;
    const [ex, ey, ez] = frame.eye;
    const near = Math.max(math.NEAR, -ey / ray[1]);
    const far = Math.min(math.FAR, (vertexHeight(model, 0, 0) - ey) / ray[1]);
    if (far < near) return null;
    const startX = cell(ex + near * ray[0]), endX = cell(ex + far * ray[0]);
    const startZ = cell(ez + near * ray[2]), endZ = cell(ez + far * ray[2]);
    let nearest = Infinity;

    function intersect(x, z, dx, dz, h, hx, hz) {
      const slopeX = (hx - h) / dx, slopeZ = (hz - h) / dz;
      const denominator = ray[1] - slopeX * ray[0] - slopeZ * ray[2];
      if (Math.abs(denominator) < 1e-12) return;
      const t = (h - ey + slopeX * (ex - x) + slopeZ * (ez - z)) / denominator;
      if (t < near - 1e-8 || t > far + 1e-8 || t >= nearest) return;
      const u = (ex + t * ray[0] - x) / dx, v = (ez + t * ray[2] - z) / dz;
      if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) nearest = t;
    }

    // A tap only visits cells within the ray's footprint between sea level
    // and the deepest possible point. A low camera can see the near rim first.
    for (let row = Math.min(startZ, endZ); row <= Math.max(startZ, endZ); row++) {
      for (let col = Math.min(startX, endX); col <= Math.max(startX, endX); col++) {
        const x = axis[col], z = axis[row], xx = axis[col + 1], zz = axis[row + 1];
        const east = vertexHeight(model, xx, z), south = vertexHeight(model, x, zz);
        intersect(x, z, xx - x, zz - z, vertexHeight(model, x, z), east, south);
        intersect(xx, zz, x - xx, z - zz, vertexHeight(model, xx, zz), south, east);
      }
    }
    return Number.isFinite(nearest) ? { x: ex + nearest * ray[0], z: ez + nearest * ray[2] } : null;
  }

  function visible(model, view, world, pixel, width, height) {
    if (!pixel.visible) return false;
    const run = Math.hypot(view.eye[0] - world[0], view.eye[2] - world[2]);
    if (view.eye[1] - world[1] > run * model.maxSlope) return true;
    const hit = pick(model, view, pixel.x, pixel.y, width, height);
    return Boolean(hit && Math.hypot(hit.x - world[0], hit.z - world[2]) < 0.001);
  }

  const api = { DEPTH_PER_HPA, CONTOUR_HPA, STOPS, mesh, surface, vertexHeight, height, pick, visible };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).relief = api;
})(globalThis);
