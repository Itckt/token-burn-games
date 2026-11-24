(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, randomGenerator } = common ? require("./math.js") : root.OrbitAtlas.math;
  const { pointOnOrbit, eccentricAnomaly, anomalyAt } = common ? require("./physics.js") : root.OrbitAtlas.physics;
  const { APSIDES, SWEEP_FRACTION } = common ? require("./observations.js") : root.OrbitAtlas.observations;

  function sphere(slices = 72, stacks = 36) {
    if (!Number.isInteger(slices) || !Number.isInteger(stacks) || slices < 3 || stacks < 2
      || (slices + 1) * (stacks + 1) > 65535) throw new RangeError("Unsupported sphere resolution");
    const vertices = [], indices = [];
    for (let j = 0; j <= stacks; j++) {
      const v = j / stacks, lat = (v - 0.5) * Math.PI;
      for (let i = 0; i <= slices; i++) {
        const u = i / slices, lon = (u - 0.5) * TAU;
        // For a unit sphere the position is also the normal.
        vertices.push(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), u, v);
        if (i === slices || j === stacks) continue;
        const a = j * (slices + 1) + i, b = a + slices + 1;
        if (j > 0) indices.push(a, a + 1, b);
        if (j < stacks - 1) indices.push(a + 1, b + 1, b);
      }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), stride: 5 };
  }

  function ring(inner = 1.27, outer = 2.28, segments = 144) {
    if (!(inner > 0 && outer > inner && Number.isFinite(outer) && Number.isInteger(segments) && segments >= 3 && segments < 32767)) {
      throw new RangeError("Unsupported ring dimensions");
    }
    const vertices = [], indices = [];
    for (let i = 0; i <= segments; i++) {
      const angle = TAU * i / segments;
      for (const [r, band] of [[inner, 0], [outer, 1]]) {
        vertices.push(r * Math.sin(angle), 0, r * Math.cos(angle), band, i / segments);
      }
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), stride: 5 };
  }

  function orbitPath(orbit, axis = orbit.a, steps = 320) {
    if (!Number.isFinite(axis) || axis <= 0 || !Number.isInteger(steps) || steps < 3) throw new RangeError("Invalid orbit path dimensions");
    const vertices = new Float32Array(steps * 3);
    for (let i = 0; i < steps; i++) vertices.set(pointOnOrbit(orbit, TAU * i / steps, axis), i * 3);
    return vertices; // LINE_LOOP closes the path without a duplicate endpoint.
  }

  const TRAIL_MARKS = 6, TRAIL_STEPS = TRAIL_MARKS * 12;
  const TRAIL_FLOATS = (TRAIL_STEPS + 1 + TRAIL_MARKS) * 5;
  // A continuous arc followed by six points in the same buffer. Age runs
  // from the current position (0) to the start of the lookback window (1).
  function writeMotionTrail(vertices, orbit, axis, day, duration) {
    if (vertices.length !== TRAIL_FLOATS || !Number.isFinite(axis) || axis <= 0
      || !(duration > 0 && Number.isFinite(duration))) {
      throw new RangeError("Invalid motion trail");
    }
    for (let i = 0; i <= TRAIL_STEPS; i++) {
      const age = i / TRAIL_STEPS;
      const point = pointOnOrbit(orbit, anomalyAt(orbit, day - age * duration), axis);
      const offset = i * 5;
      vertices.set(point, offset);
      vertices[offset + 3] = age;
      vertices[offset + 4] = 0;
      if (i > 0 && i % (TRAIL_STEPS / TRAIL_MARKS) === 0) {
        const mark = (TRAIL_STEPS + i * TRAIL_MARKS / TRAIL_STEPS) * 5;
        vertices.set(point, mark);
        vertices[mark + 3] = age;
        vertices[mark + 4] = 1;
      }
    }
    return vertices;
  }

  // The first and last vertices are the focus. The arc samples equal steps
  // of mean anomaly, hence equal times, on either side of the chosen apsis.
  function apsisSector(orbit, axis, kind, steps = 48) {
    if (!Number.isFinite(axis) || axis <= 0 || !Object.hasOwn(APSIDES, kind) || !Number.isInteger(steps) || steps < 2) {
      throw new RangeError("Unsupported swept sector");
    }
    const vertices = new Float32Array(3 * (steps + 3));
    for (let i = 0; i <= steps; i++) {
      const mean = APSIDES[kind] + (i / steps - 0.5) * TAU * SWEEP_FRACTION;
      const point = pointOnOrbit(orbit, eccentricAnomaly(mean, orbit.e), axis);
      vertices.set(point, (i + 1) * 3);
    }
    return vertices;
  }

  function stars(count = 16500, seed = 824) {
    const random = randomGenerator(seed), data = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) {
      const y = random() * 2 - 1, angle = random() * TAU, r = Math.sqrt(1 - y * y);
      data.set([r * Math.cos(angle), y, r * Math.sin(angle), Math.pow(random(), 2.4), random()], i * 5);
    }
    return data;
  }

  function asteroidBelt(count = 2100, seed = 521) {
    const random = randomGenerator(seed), data = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) {
      const angle = random() * TAU, r = 13.65 + (random() + random()) * 0.96;
      data.set([Math.cos(angle) * r, (random() + random() - 1) * 0.5,
        Math.sin(angle) * r, random(), random()], i * 5);
    }
    return data;
  }

  const api = { sphere, ring, orbitPath, apsisSector, stars, asteroidBelt,
    TRAIL_MARKS, TRAIL_STEPS, TRAIL_FLOATS, writeMotionTrail };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).geometry = api;
})(globalThis);
