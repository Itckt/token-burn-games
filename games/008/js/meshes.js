(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./noise"), require("./terrain"));
  else root.FieldAtlas.meshes = factory(root.FieldAtlas.math, root.FieldAtlas.noise, root.FieldAtlas.terrain);
})(globalThis, function (M, N, T) {
  "use strict";

  // Interleaved position, normal and linear-palette RGB, in triangle-list order.
  const STRIDE = 9;
  function writer(triangles) {
    const data = new Float32Array(triangles * 3 * STRIDE);
    let offset = 0;
    function vertex(p, n, color) {
      data.set(p, offset);
      data.set(n, offset + 3);
      data.set(color, offset + 6);
      offset += STRIDE;
    }
    function face(a, b, c, color) {
      const normal = M.normalize(M.cross(M.subtract(b, a), M.subtract(c, a)));
      vertex(a, normal, color); vertex(b, normal, color); vertex(c, normal, color);
    }
    return { vertex, face, finish: () => data.subarray(0, offset) };
  }
  function surfaceColor(world, h, normalY, patch) {
    const s = world.style;
    const meadow = M.mixColor(s.grass, s.meadow, M.smoothstep(-0.43, 0.60, patch));
    const cliff = M.mixColor(s.rock, s.stone, M.clamp(0.46 + 0.49 * patch, 0, 1));
    const exposed = M.clamp((0.87 - normalY) * 3.6 + M.smoothstep(31, 81, h) * 0.88, 0, 1);
    let color = M.mixColor(meadow, cliff, exposed);
    color = M.mixColor(color, s.bank, (1 - M.smoothstep(0.6, 4.1, h)) * 0.92);
    if (world.id === "canyon") {
      const band = 0.93 + 0.075 * Math.sin(h * 0.89 + patch) + 0.035 * Math.sin(h * 2.3);
      color = color.map(v => v * band);
    } else if (world.id === "caldera") {
      const strata = 0.5 + 0.5 * Math.sin(h * 0.62 + patch * 1.9);
      color = M.mixColor(color, [0.68, 0.40, 0.28], exposed * strata * 0.37);
    } else {
      const snowline = s.snow + 21 * (0.72 - normalY) + patch * 8;
      color = M.mixColor(color, s.snowColor, M.smoothstep(snowline - 4, snowline + 4, h));
    }
    return color;
  }
  function land(world, grid) {
    const { segments, side, heights, step } = grid;
    const out = writer(segments * segments * 2), points = [], normals = [], patches = [];
    for (let iz = 0; iz < side; iz++) {
      for (let ix = 0; ix < side; ix++) {
        const k = iz * side + ix, x = ix * step - T.HALF, z = iz * step - T.HALF;
        const x0 = Math.max(0, ix - 1), x1 = Math.min(segments, ix + 1);
        const z0 = Math.max(0, iz - 1), z1 = Math.min(segments, iz + 1);
        const dx = (heights[iz * side + x1] - heights[iz * side + x0]) / ((x1 - x0) * step);
        const dz = (heights[z1 * side + ix] - heights[z0 * side + ix]) / ((z1 - z0) * step);
        points.push([x, heights[k], z]);
        normals.push(M.normalize([-dx, 1, -dz]));
        patches.push(world.noise(x * 0.035, z * 0.035) + 0.48 * world.noise(x * 0.091, z * 0.091));
      }
    }
    function triangle(i, j, k) {
      const a = points[i], b = points[j], c = points[k];
      const n = M.normalize(M.cross(M.subtract(b, a), M.subtract(c, a)));
      const color = surfaceColor(world, (a[1] + b[1] + c[1]) / 3, n[1], (patches[i] + patches[j] + patches[k]) / 3);
      for (const index of [i, j, k]) out.vertex(points[index], M.mixColor(n, normals[index], 0.42), color);
    }
    T.visitTriangles(grid, triangle);
    return out.finish();
  }
  function ringPoint(x, y, z, radius, angle) {
    return [x + radius * Math.cos(angle), y, z + radius * Math.sin(angle)];
  }
  function forest(world, trees) {
    const sides = 5, out = writer(trees.length * sides * 4);
    for (const tree of trees) {
      const { x, y, z, height: h, width: w, angle, tint } = tree;
      const base = M.mixColor(world.style.pine, world.style.needles, tint * 0.79);
      let layer = 0;
      for (const [bottom, top, radius] of [[-0.065, 0.68, 0.16], [0.20, 0.72, 1], [0.40, 0.87, 0.79], [0.59, 1, 0.58]]) {
        const shade = 0.80 + layer * 0.085;
        const col = layer === 0 ? [0.26, 0.23, 0.15] : base.map(c => c * shade);
        const tip = [x + 0.065 * w * layer, y + h * top, z + 0.035 * w * layer];
        for (let i = 0; i < sides; i++) {
          const a = angle + i * M.TAU / sides + layer * 0.37;
          const b = a + M.TAU / sides;
          out.face(ringPoint(x, y + h * bottom, z, w * radius, a), tip,
            ringPoint(x, y + h * bottom, z, w * radius, b), col);
        }
        layer++;
      }
    }
    return out.finish();
  }
  function stones(world, rocks) {
    const sides = 6, out = writer(rocks.length * sides * 3);
    for (const { x, y, z, size: r, angle } of rocks) {
      const lower = [], upper = [], peak = [x + 0.17 * r, y + 0.76 * r, z - 0.10 * r];
      for (let i = 0; i < sides; i++) {
        const a = angle + M.TAU * i / sides, radius = r * (0.85 + 0.15 * Math.sin(a * 3));
        lower.push(ringPoint(x, y - 0.38 * r, z, radius, a));
        upper.push(ringPoint(x, y + r * (0.33 + 0.14 * Math.cos(a * 2)), z, radius * 0.83, a + 0.11));
      }
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        out.face(lower[i], upper[i], lower[j], world.style.rock);
        out.face(lower[j], upper[i], upper[j], world.style.rock);
        out.face(upper[i], peak, upper[j], world.style.stone);
      }
    }
    return out.finish();
  }
  function horizon(world) {
    const count = 205, out = writer(count * 6 * 2);
    for (let layer = 0; layer < 2; layer++) {
      const rows = [[], [], [], []];
      for (let i = 0; i < count; i++) {
        const a = M.TAU * i / count, x = Math.sin(a), z = Math.cos(a);
        const broad = world.noise(x * 3.0 + 15 * layer, z * 3.0 + 8);
        const ridge = Math.abs(world.noise(x * 9.6 + 71, z * 9.6 + layer * 13));
        const detail = world.noise(x * 25 + layer, z * 25 - 18);
        const h = (layer ? 136 : 67) + broad * (layer ? 83 : 54) + ridge * 42 + detail * 13;
        const r = (layer ? 630 : 407) + 18 * broad;
        [ [r - 110, -24], [r - 72, h * 0.42], [r - 28, h * 0.75 + detail * 8], [r, h] ]
          .forEach(([radius, height], k) => rows[k].push([x * radius, height, z * radius]));
      }
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < count; i++) {
          const j = (i + 1) % count;
          const color = M.mixColor([0.39, 0.49, 0.47], [0.65, 0.68, 0.62], layer * 0.35 + k * 0.15);
          out.face(rows[k][i], rows[k + 1][i], rows[k][j], color);
          out.face(rows[k][j], rows[k + 1][i], rows[k + 1][j], color);
        }
      }
    }
    return out.finish();
  }
  // Red holds bed height from -16 to +4 m. Blue extends it to +12 m for high water.
  // Green is canopy occlusion. Filtered channels still decode linearly across the join.
  function landscapeTexture(grid, trees, size = 256) {
    const data = new Uint8Array(size * size * 4);
    const unit = 2 * T.HALF / size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = (j * size + i) * 4;
        const h = grid.surfaceAt((i + 0.5) * unit - T.HALF, (j + 0.5) * unit - T.HALF);
        data[k] = Math.round(M.clamp((h + 16) / 20, 0, 1) * 255);
        data[k + 2] = Math.round(M.clamp((h - 4) / 8, 0, 1) * 255);
        data[k + 3] = 255;
      }
    }
    for (const tree of trees) {
      const cx = (tree.x + T.HALF) / unit - 0.5, cz = (tree.z + T.HALF) / unit - 0.5;
      const radius = Math.max(1.3, tree.width * 1.7 / unit);
      for (let z = Math.max(0, Math.floor(cz - radius)); z <= Math.min(size - 1, cz + radius); z++) {
        for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(size - 1, cx + radius); x++) {
          const depth = 1 - Math.hypot(x - cx, z - cz) / radius;
          const k = (z * size + x) * 4 + 1;
          data[k] = Math.max(data[k], Math.round(240 * Math.max(0, depth)));
        }
      }
    }
    return { data, size };
  }
  function water() {
    const r = T.HALF, y = T.WATER;
    return new Float32Array([-r,y,-r, -r,y,r, r,y,-r, r,y,-r, -r,y,r, r,y,r]);
  }
  function passageBuoys({ points, waterLevel }) {
    // Mark every turn so steering directly between buoys stays on the surveyed leg.
    const marks = [], sides = 8;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 28);
      for (let j = 1; j <= count; j++) {
        marks.push([M.lerp(a[0], b[0], j / count), M.lerp(a[1], b[1], j / count)]);
      }
    }
    const rings = [[-0.24, 0.46], [0.27, 0.64], [0.55, 0.32], [1.04, 0.18],
      [1.43, 0.18], [1.72, 0.26], [2.06, 0.26], [2.34, 0]];
    const out = writer(marks.length * sides * (2 * (rings.length - 1) - 1));
    const ivory = [0.97, 0.91, 0.70], dark = [0.23, 0.32, 0.29];
    for (let i = 0; i < marks.length; i++) {
      const [x, z] = marks[i];
      const paint = i === marks.length - 1 ? [0.27, 0.70, 0.56] : [0.86, 0.52, 0.19];
      const colors = [dark, paint, paint, ivory, dark, ivory, paint];
      const rows = rings.map(([y, r]) => Array.from({ length: sides }, (_, j) =>
        ringPoint(x, waterLevel + y, z, r, j * M.TAU / sides)));
      for (let k = 0; k < rows.length - 1; k++) {
        const lower = rows[k], upper = rows[k + 1];
        for (let j = 0; j < sides; j++) {
          const n = (j + 1) % sides;
          out.face(lower[j], upper[j], lower[n], colors[k]);
          if (rings[k + 1][1]) out.face(lower[n], upper[j], upper[n], colors[k]);
        }
      }
    }
    return out.finish();
  }
  // Two-sided annuli share a buffer. The last attributes identify the gate,
  // angle around its face and distance from its inner edge.
  function relayGates(gates) {
    const sides = 64, data = new Float32Array(gates.length * sides * 6 * 6);
    let offset = 0;
    gates.forEach(({ center, normal, radius, rimRadius }, index) => {
      function vertex(i, outer) {
        const turn = i / sides, angle = turn * M.TAU, r = outer ? rimRadius : radius;
        const across = r * Math.cos(angle);
        data.set([center[0] - normal[1] * across, center[1] + r * Math.sin(angle),
          center[2] + normal[0] * across, index, turn, outer], offset);
        offset += 6;
      }
      for (let i = 0; i < sides; i++) {
        vertex(i, 0); vertex(i, 1); vertex(i + 1, 0);
        vertex(i + 1, 0); vertex(i, 1); vertex(i + 1, 1);
      }
    });
    return data;
  }
  // Three ground-sampled rails keep the centre of a survey trace attached to
  // sharp ridges. The last two attributes are distance downstream and side.
  function runoffRibbon(grid, points) {
    const stations = [];
    let distance = 0;
    if (points.length) stations.push([...points[0], 0]);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.ceil(span / Math.min(2, grid.step / 2));
      for (let j = 1; j <= steps; j++) {
        const t = j / steps;
        stations.push([M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t), distance + span * t]);
      }
      distance += span;
    }
    if (stations.length < 2) return new Float32Array(0);
    const mesh = new Float32Array((stations.length - 1) * 12 * 5);
    let previous, offset = 0;
    for (let i = 0; i < stations.length; i++) {
      const [x, z, along] = stations[i], before = stations[Math.max(i - 1, 0)];
      const after = stations[Math.min(i + 1, stations.length - 1)];
      let dx = after[0] - before[0], dz = after[1] - before[1];
      if (!dx && !dz) { dx = x - before[0]; dz = z - before[1]; }
      const span = Math.hypot(dx, dz), acrossX = -dz / span * 0.9, acrossZ = dx / span * 0.9;
      const rail = [-1, 0, 1].map(side => {
        const px = M.clamp(x + side * acrossX, -T.HALF, T.HALF);
        const pz = M.clamp(z + side * acrossZ, -T.HALF, T.HALF);
        return [px, grid.surfaceAt(px, pz) + 0.22, pz, along, side];
      });
      if (previous) {
        for (let j = 0; j < 2; j++) {
          for (const v of [previous[j], previous[j + 1], rail[j], rail[j], previous[j + 1], rail[j + 1]]) {
            mesh.set(v, offset); offset += 5;
          }
        }
      }
      previous = rail;
    }
    return mesh;
  }
  // Each drop is one slender billboard. Its unit-cube position is animated by the vertex shader.
  function rainField(count = 1400) {
    const rng = N.random(0x72e35a19), data = new Float32Array(count * 6 * 5);
    const corners = [[-1, 0], [1, 0], [-1, 1], [-1, 1], [1, 0], [1, 1]];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const x = rng(), y = rng(), z = rng();
      for (const [side, end] of corners) {
        data.set([x, y, z, side, end], offset);
        offset += 5;
      }
    }
    return data;
  }
  return { STRIDE, land, forest, stones, horizon, water, landscapeTexture, rainField, runoffRibbon, relayGates, passageBuoys };
});
