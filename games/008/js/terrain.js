(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./noise"));
  else root.FieldAtlas.terrain = factory(root.FieldAtlas.math, root.FieldAtlas.noise);
})(globalThis, function (M, N) {
  "use strict";

  const HALF = 264, WATER = 0, DEFAULT_SEED = "KT-0427";
  const PRESETS = {
    alpine: {
      name: "Alder Basin", region: "Alpine highlands", type: "Alpine lake", seedPrefix: "KT",
      lake: 1, relief: 1, snow: 79, trees: 1, mapTint: "#283e34",
      grass: [0.53, 0.60, 0.34], meadow: [0.75, 0.71, 0.42], bank: [0.72, 0.70, 0.52],
      rock: [0.49, 0.53, 0.47], stone: [0.64, 0.63, 0.52], snowColor: [0.90, 0.92, 0.85],
      pine: [0.13, 0.29, 0.21], needles: [0.32, 0.43, 0.25],
      deep: [0.13, 0.40, 0.38], shallow: [0.47, 0.65, 0.51], start: [32, 43, 144]
    },
    canyon: {
      name: "Ember Canyon", region: "Sandstone plateau", type: "Desert canyon", seedPrefix: "EC",
      lake: 0.55, relief: 0.85, snow: 1000, trees: 0.38, mapTint: "#493c2e",
      grass: [0.70, 0.44, 0.27], meadow: [0.84, 0.62, 0.36], bank: [0.87, 0.71, 0.48],
      rock: [0.68, 0.38, 0.26], stone: [0.83, 0.55, 0.36], snowColor: [0.91, 0.77, 0.55],
      pine: [0.25, 0.35, 0.23], needles: [0.45, 0.48, 0.29],
      deep: [0.21, 0.43, 0.39], shallow: [0.55, 0.61, 0.44], start: [40, 49, 141]
    },
    fjord: {
      name: "Frostmere", region: "Northern fjords", type: "Glacial fjord", seedPrefix: "FM",
      lake: 1.30, relief: 1.23, snow: 49, trees: 0.76, mapTint: "#2d3d43",
      grass: [0.42, 0.55, 0.46], meadow: [0.60, 0.65, 0.51], bank: [0.66, 0.70, 0.66],
      rock: [0.46, 0.52, 0.57], stone: [0.61, 0.66, 0.70], snowColor: [0.91, 0.95, 0.97],
      pine: [0.15, 0.27, 0.29], needles: [0.33, 0.43, 0.40],
      deep: [0.17, 0.37, 0.47], shallow: [0.44, 0.62, 0.67], start: [33, 46, 145]
    },
    caldera: {
      name: "Lantern Caldera", region: "Volcanic lake district", type: "Flooded crater", seedPrefix: "LC",
      snow: 1000, trees: 0.44, mapTint: "#3d403a",
      grass: [0.46, 0.53, 0.34], meadow: [0.71, 0.59, 0.35], bank: [0.38, 0.40, 0.38],
      rock: [0.34, 0.33, 0.36], stone: [0.64, 0.45, 0.35], snowColor: [0.89, 0.85, 0.79],
      pine: [0.17, 0.27, 0.20], needles: [0.38, 0.43, 0.26],
      deep: [0.10, 0.39, 0.43], shallow: [0.45, 0.71, 0.62], start: [29, 53, 158]
    }
  };
  const limitSeed = text => Array.from(text).slice(0, 48).join("");
  function cleanSeed(value) {
    return limitSeed(String(value ?? "").trim()).trimEnd() || DEFAULT_SEED;
  }
  function inSurvey(point) {
    return Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
      && Math.abs(point[0]) <= HALF && Math.abs(point[1]) <= HALF;
  }
  // Parameter interval along a horizontal line that lies inside the survey square.
  function surveyInterval(point, direction, near, far, bound = HALF) {
    for (let axis = 0; axis < 2; axis++) {
      if (direction[axis] === 0) {
        if (Math.abs(point[axis]) > bound) return null;
      } else {
        const a = (-bound - point[axis]) / direction[axis], b = (bound - point[axis]) / direction[axis];
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    return near <= far ? [near, far] : null;
  }
  // Each summit has its own footprint. Domain warping breaks up the otherwise radial slopes.
  const SUMMITS = [
    [-183, -185, 115, 97, 87], [-104, -159, 99, 82, 94], [-69, -213, 88, 85, 73],
    [13, -207, 98, 96, 66], [65, -205, 105, 81, 102], [112, -173, 103, 85, 83],
    [194, -127, 116, 101, 77], [-157, -41, 103, 100, 62], [145, -36, 95, 103, 52],
    [-165, 100, 99, 102, 55], [161, 125, 101, 100, 67], [-58, 213, 116, 85, 65]
  ];
  function calderaBed(noise, warp, rng, riverCenter) {
    const cx = -9 + (rng() - 0.5) * 17, cz = -26 + (rng() - 0.5) * 17;
    const rx = 111 + rng() * 14, rz = 125 + rng() * 16, phase = rng() * M.TAU;
    const coneX = cx + 41 + rng() * 8, coneZ = cz - 11 + rng() * 8;
    return (x, z) => {
      const broad = N.fractal(noise, x * 0.014, z * 0.014, 3);
      const fine = N.fractal(warp, x * 0.039, z * 0.039, 3);
      const dx = (x - cx + broad * 7) / rx, dz = (z - cz + fine * 8) / rz;
      const azimuth = Math.atan2(dz, dx);
      const radius = Math.hypot(dx, dz) + 0.047 * Math.sin(3 * azimuth + phase)
        + 0.032 * Math.sin(5 * azimuth - phase);
      const bed = -11 + 3 * broad + 1.5 * fine;
      const apron = 23 + 17 * broad + 6 * fine;
      // The inner scarp is steeper than the ash apron on the outer flank.
      const flank = (radius - 1) / (radius < 1 ? 0.21 : 0.36);
      const rim = (72 + 15 * Math.sin(3 * azimuth + phase) + 24 * broad) * Math.exp(-flank * flank);
      const breach = M.smoothstep(cz + 26, cz + 94, z)
        * (1 - M.smoothstep(11, 56, Math.abs(x - riverCenter(z))));
      const island = Math.max(0, 1 - Math.hypot(x - coneX, (z - coneZ) * 1.18) / 31);
      return M.lerp(M.lerp(bed, apron, M.smoothstep(0.77, 1.21, radius)) + rim, bed, breach)
        + 39 * island;
    };
  }
  function createWorld(seed = DEFAULT_SEED, id = "alpine") {
    if (!Object.hasOwn(PRESETS, id)) throw new RangeError("Unknown terrain preset");
    seed = cleanSeed(seed);
    const number = N.seedNumber(id + "/" + seed), rng = N.random(number);
    const noise = N.gradientNoise(number);
    const warp = N.gradientNoise(N.scramble(number ^ 0xb649));
    const style = PRESETS[id], phase = (rng() - 0.5) * 1.55, bend = (rng() - 0.5) * 14;
    function riverCenter(z) {
      return -9 + bend + 22 * Math.sin(z * 0.019 + phase) + 10 * Math.sin(z * 0.044 + 0.9 + phase);
    }
    if (id === "caldera") {
      return { id, seed, number, style, noise, riverCenter, heightAt: calderaBed(noise, warp, rng, riverCenter) };
    }
    const summits = SUMMITS.map(([x, z, rx, rz, h]) => [
      x + (rng() - 0.5) * 32, z + (rng() - 0.5) * 32, rx * (0.88 + rng() * 0.25),
      rz * (0.88 + rng() * 0.25), h * (0.90 + rng() * 0.26)
    ]);
    function heightAt(x, z) {
      const broad = N.fractal(noise, x * 0.012 + 0.6, z * 0.012 - 2, 4);
      const crags = N.fractal(warp, x * 0.036, z * 0.036, 3);
      const width = style.lake * (14 + 34 * Math.exp(-Math.pow((z - 23) / 79, 2))
        + 7 * Math.sin(z * 0.035 + phase));
      const shore = Math.abs(x - riverCenter(z)) - width - broad * 13 - crags * 3;
      const inland = M.smoothstep(-3, 64, shore);
      const px = x + broad * 24, pz = z + noise(x * 0.018 + 19, z * 0.015) * 13;
      let mountain = 0;
      for (const [cx, cz, rx, rz, h] of summits) {
        const dx = (px - cx) / rx, dz = (pz - cz) / rz;
        const distance = dx * dx + dz * dz;
        if (distance < 1) mountain = Math.max(mountain, (1 - Math.sqrt(distance)) * h);
      }
      const valleyEnd = M.smoothstep(122, 204, -z);
      let land = Math.max(shore, 0) * 0.22 + (broad * 21 + crags * 8) * inland;
      land += mountain * (0.43 + 0.57 * Math.max(inland, valleyEnd)) + valleyEnd * (24 + broad * 11);
      land += Math.min(0, shore) * 0.26 + 1.2 * crags;
      if (id === "canyon" && land > 6) {
        const steps = land / 8;
        land = M.lerp(land, (Math.floor(steps) + M.smoothstep(0.27, 0.61, steps % 1)) * 8, 0.83);
      }
      if (id === "fjord") land += 9 * inland * (1 - Math.abs(crags * 2.1));
      return land * style.relief;
    }
    return { id, seed, number, style, noise, riverCenter, heightAt };
  }

  function buildGrid(world, segments = 144) {
    if (!Number.isInteger(segments) || segments < 2 || segments > 512) throw new RangeError("Invalid grid resolution");
    const side = segments + 1, step = 2 * HALF / segments;
    const heights = new Float32Array(side * side), splits = new Uint8Array(segments * segments);
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        heights[z * side + x] = world.heightAt(x * step - HALF, z * step - HALF);
        if (x < segments && z < segments) splits[z * segments + x] = N.scramble(world.number + z * segments + x) & 1;
      }
    }
    return heightGrid(segments, heights, splits);
  }
  function heightRange(grid) {
    let low = Infinity, high = -Infinity;
    for (const height of grid.heights) {
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
    return { low, high };
  }
  function heightGrid(segments, heights, splits) {
    const side = segments + 1, step = 2 * HALF / segments;
    // Interpolate the same two triangles used by the renderer, including the alternate diagonal.
    function sample(x, z, measure) {
      const gx = M.clamp((x + HALF) / step, 0, segments), gz = M.clamp((z + HALF) / step, 0, segments);
      const ix = Math.min(Math.floor(gx), segments - 1), iz = Math.min(Math.floor(gz), segments - 1);
      const u = gx - ix, v = gz - iz, k = iz * side + ix;
      const a = heights[k], b = heights[k + 1], c = heights[k + side], d = heights[k + side + 1];
      const split = splits[iz * segments + ix];
      const farCorner = !split && u + v > 1;
      let dx = b - a, dz = c - a;
      if (farCorner || (split && u <= v)) dx = d - c;
      if (farCorner || (split && u > v)) dz = d - b;
      const height = farCorner ? d - dx * (1 - u) - dz * (1 - v) : a + dx * u + dz * v;
      if (!measure) return height;
      const face = 2 * (iz * segments + ix) + Number(split ? u <= v : farCorner);
      return { height, dx: dx / step, dz: dz / step, face };
    }
    const surfaceAt = (x, z) => sample(x, z, false);
    const facetAt = (x, z) => sample(x, z, true);
    function withHeights(next) {
      if (next.length !== heights.length) throw new RangeError("Height grid dimensions must match");
      return heightGrid(segments, next, splits);
    }
    return { segments, side, step, heights, splits, surfaceAt, facetAt, withHeights };
  }
  // A mesh face is planar. Its profile is exact when we visit every crossed cell edge and diagonal.
  function segmentCuts(grid, a, b) {
    const edges = [1], dx = b[0] - a[0], dz = b[1] - a[1], epsilon = 1e-10;
    for (let axis = 0; axis < 2; axis++) {
      const delta = b[axis] - a[axis];
      if (!delta) continue;
      const lo = (Math.min(a[axis], b[axis]) + HALF) / grid.step;
      const hi = (Math.max(a[axis], b[axis]) + HALF) / grid.step;
      for (let k = Math.floor(lo) + 1; k < hi; k++) {
        const t = (k * grid.step - HALF - a[axis]) / delta;
        if (t > epsilon && t < 1 - epsilon) edges.push(t);
      }
    }
    edges.sort((x, y) => x - y);
    const cuts = [];
    let start = 0;
    for (const end of edges) {
      if (end - start <= epsilon) continue;
      const mid = (end + start) / 2;
      const ix = M.clamp(Math.floor((a[0] + dx * mid + HALF) / grid.step), 0, grid.segments - 1);
      const iz = M.clamp(Math.floor((a[1] + dz * mid + HALF) / grid.step), 0, grid.segments - 1);
      const u = a[0] + HALF - ix * grid.step, v = a[1] + HALF - iz * grid.step;
      const split = grid.splits[iz * grid.segments + ix];
      const divisor = split ? dx - dz : dx + dz;
      if (divisor) {
        const t = (split ? v - u : grid.step - u - v) / divisor;
        if (t > start + epsilon && t < end - epsilon) cuts.push(t);
      }
      cuts.push(end);
      start = end;
    }
    return cuts;
  }

  function vertexPoint(grid, index) {
    const coordinate = n => n === grid.segments ? HALF : n * grid.step - HALF;
    return [coordinate(index % grid.side), coordinate(Math.floor(index / grid.side))];
  }
  // Upward winding, with each cell's chosen diagonal shared by both faces.
  function visitTriangles(grid, visit) {
    const { segments, side, splits } = grid;
    for (let z = 0; z < segments; z++) {
      for (let x = 0; x < segments; x++) {
        const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
        if (splits[z * segments + x]) { visit(a, d, b); visit(a, c, d); }
        else { visit(a, c, b); visit(b, c, d); }
      }
    }
  }
  function scatter(world, grid, attempts = 7700) {
    const rng = N.random(world.number ^ 0x37d25a1), trees = [], rocks = [];
    const { style, noise } = world;
    for (let i = 0; i < attempts; i++) {
      const x = (rng() * 2 - 1) * (HALF - 2), z = (rng() * 2 - 1) * (HALF - 2);
      const y = grid.surfaceAt(x, z);
      const slope = Math.hypot(grid.surfaceAt(x + 1, z) - y, grid.surfaceAt(x, z + 1) - y);
      const grove = noise(x * 0.026 + 5, z * 0.026) + 0.42 * noise(x * 0.072, z * 0.072);
      const coverage = (0.27 + M.smoothstep(-0.24, 0.48, grove) * 0.7) * style.trees;
      if (y > 0.9 && y < Math.min(style.snow - 4, 69) && slope < 0.96 && rng() < coverage) {
        const size = (2.5 + Math.pow(rng(), 0.9) * 5.3) * (world.id === "canyon" ? 0.56 : 1);
        trees.push({ x, y, z, height: size, width: size * (0.16 + rng() * 0.12),
          angle: rng() * M.TAU, tint: rng() });
      } else if (i % 4 === 0 && y > -0.65 && y < 78 && rng() < (Math.abs(y) < 3 ? 0.72 : 0.20)) {
        rocks.push({ x, y, z, size: 0.65 + rng() * 2.3, angle: rng() * M.TAU });
      }
    }
    return { trees, rocks };
  }
  return { HALF, WATER, DEFAULT_SEED, PRESETS, limitSeed, cleanSeed, inSurvey, surveyInterval,
    createWorld, buildGrid, heightRange, segmentCuts, vertexPoint, visitTriangles, scatter };
});
