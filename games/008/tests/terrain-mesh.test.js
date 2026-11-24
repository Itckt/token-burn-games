"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const G = require("../js/meshes");
const M = require("../js/math");
const S = require("../js/simulation");

function close(actual, expected, tol = 2e-5) {
  assert.ok(Math.abs(actual - expected) <= tol, actual + " differs from " + expected);
}
const world = T.createWorld();
const grid = T.buildGrid(world, 40);

test("world seeds trim, preserve case and whole Unicode characters, and default when blank", () => {
  assert.equal(T.cleanSeed("   "), T.DEFAULT_SEED);
  assert.equal(T.cleanSeed(null), T.DEFAULT_SEED);
  assert.equal(T.cleanSeed("   Ridge 09   "), "Ridge 09");
  assert.equal(T.cleanSeed("山🌲".repeat(31)), "山🌲".repeat(24));
  const boundarySpace = "山".repeat(47) + " 島";
  assert.equal(T.cleanSeed(boundarySpace), "山".repeat(47));
  assert.equal(T.cleanSeed(T.cleanSeed(boundarySpace)), T.cleanSeed(boundarySpace));
  assert.equal(T.createWorld("  Ridge 09 ").number, T.createWorld("Ridge 09").number);
  assert.notEqual(T.createWorld("RIDGE 09").number, T.createWorld("Ridge 09").number);
  for (const id of ["", "unknown", "constructor", "__proto__"]) assert.throws(() => T.createWorld("ridge", id), RangeError);
});

test("all presets give distinct relief, dry ground and submerged channels", () => {
  const samples = [];
  for (const id of Object.keys(T.PRESETS)) {
    const w = T.createWorld("Midnight-Minibus", id);
    const g = T.buildGrid(w, 39);
    assert.ok(g.heights.every(Number.isFinite));
    assert.ok(Math.min(...g.heights) < -4);
    assert.ok(Math.max(...g.heights) > 60);
    const wet = g.heights.filter(h => h < T.WATER).length;
    assert.ok(wet > 20 && wet < g.heights.length / 2);
    assert.ok(w.heightAt(w.riverCenter(20), 20) < T.WATER);
    samples.push(g.heights);
  }
  for (let i = 1; i < samples.length; i++) assert.notDeepEqual(samples[i], samples[i - 1]);
});

test("seed and preset replay the grid, split choices, scatter and generated mesh", () => {
  const first = T.createWorld("  九龍塘 "), next = T.createWorld("九龍塘");
  const a = T.buildGrid(first, 18), b = T.buildGrid(next, 18);
  assert.deepEqual(a.heights, b.heights);
  assert.deepEqual(a.splits, b.splits);
  const items = T.scatter(first, a, 220);
  assert.deepEqual(items, T.scatter(next, b, 220));
  assert.deepEqual(G.land(first, a), G.land(next, b));
  assert.deepEqual(G.forest(first, items.trees), G.forest(next, T.scatter(next, b, 220).trees));
  const other = T.buildGrid(T.createWorld("another valley"), 18);
  assert.notDeepEqual(a.heights, other.heights);
  assert.notDeepEqual(a.splits, other.splits);
});

test("grid sampling includes every corner and clamps queries at the survey boundary", () => {
  assert.equal(grid.heights.length, (grid.segments + 1) ** 2);
  assert.equal(grid.splits.length, grid.segments ** 2);
  for (const resolution of [0, 1, 2.5, 513, NaN]) assert.throws(() => T.buildGrid(world, resolution), RangeError);
  for (let z = 0; z < grid.side; z++) {
    for (let x = 0; x < grid.side; x++) {
      const wx = x * grid.step - T.HALF, wz = z * grid.step - T.HALF;
      close(grid.surfaceAt(wx, wz), world.heightAt(wx, wz));
      close(grid.surfaceAt(wx, wz), grid.heights[z * grid.side + x]);
    }
  }
  for (const z of [-T.HALF, 17, T.HALF]) {
    close(grid.surfaceAt(-1e4, z), grid.surfaceAt(-T.HALF, z));
    close(grid.surfaceAt(1e4, z), grid.surfaceAt(T.HALF, z));
  }
  close(grid.surfaceAt(1e4, -1e4), grid.heights[grid.segments]);
});

test("collision sampling and rendered triangles agree on both diagonals and shared edges", () => {
  const mesh = G.land(world, grid);
  assert.equal(mesh.length, grid.segments ** 2 * 6 * G.STRIDE);
  assert.deepEqual([...new Set(grid.splits)].sort(), [0, 1]);
  for (let i = 0; i < mesh.length; i += 3 * G.STRIDE) {
    const vertices = [0, 1, 2].map(j => mesh.subarray(i + j * G.STRIDE, i + j * G.STRIDE + 3));
    const [a, b, c] = vertices;
    const normal = M.cross(M.subtract(b, a), M.subtract(c, a));
    assert.ok(normal[1] > 0);
    for (const weights of [[0.17, 0.54, 0.29], [0.4, 0, 0.6]]) {
      const p = [0, 1, 2].map(axis => vertices.reduce((s, v, index) => s + weights[index] * v[axis], 0));
      close(grid.surfaceAt(p[0], p[2]), p[1], 4e-5);
    }
    for (let j = 0; j < 3; j++) {
      const n = mesh.subarray(i + j * G.STRIDE + 3, i + j * G.STRIDE + 6);
      const col = mesh.subarray(i + j * G.STRIDE + 6, i + (j + 1) * G.STRIDE);
      assert.ok(n[1] > 0 && Math.hypot(...n) > 0.7 && Math.hypot(...n) < 1.00001);
      assert.ok(col.every(v => v > 0 && v <= 1));
    }
  }
});

test("trees respect ground, slope, shoreline and snowline in each biome", () => {
  for (const id of Object.keys(T.PRESETS)) {
    const w = T.createWorld("433", id), g = T.buildGrid(w, 64);
    const { trees, rocks } = T.scatter(w, g, 1900);
    assert.ok(trees.length > 10 && rocks.length > 5);
    for (const t of trees) {
      assert.ok(t.y > 0.9 && t.y < Math.min(w.style.snow - 4, 69));
      assert.ok(Math.abs(t.x) < T.HALF && Math.abs(t.z) < T.HALF);
      close(g.surfaceAt(t.x, t.z), t.y);
      assert.ok(Math.hypot(g.surfaceAt(t.x + 1, t.z) - t.y, g.surfaceAt(t.x, t.z + 1) - t.y) < 0.96);
      assert.ok(t.height > 1 && t.width > 0 && t.width < t.height / 3);
    }
    for (const r of rocks) {
      close(r.y, g.surfaceAt(r.x, r.z));
      assert.ok(r.y > -0.65 && r.y < 78 && r.size >= 0.65);
    }
    assert.deepEqual(T.scatter(w, g, 0), { trees: [], rocks: [] });
  }
});

test("batched trees and rocks have outward-facing, nondegenerate, lit faces", () => {
  const x = 7, y = 3, z = -13;
  const tree = { x, y, z, height: 6, width: 1.2, angle: 1.7, tint: 0.4 };
  const meshes = [G.forest(world, [tree]), G.stones(world, [{ x, y, z, size: 2, angle: 1.3 }])];
  meshes.forEach((data, index) => {
    assert.equal(data.length, (index === 0 ? 20 : 18) * 3 * G.STRIDE);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < data.length; i += 3 * G.STRIDE) {
      const [a, b, c] = [0, 9, 18].map(j => data.slice(i + j, i + j + 3));
      const n = data.slice(i + 3, i + 6);
      const oriented = M.normalize(M.cross(M.subtract(b, a), M.subtract(c, a)));
      close(M.dot(oriented, n), 1);
      const radial = [(a[0] + b[0] + c[0]) / 3 - x, 0, (a[2] + b[2] + c[2]) / 3 - z];
      assert.ok(M.dot(radial, n) > 0);
      minY = Math.min(minY, a[1], b[1], c[1]);
      maxY = Math.max(maxY, a[1], b[1], c[1]);
      assert.ok(data.slice(i + 6, i + 9).every(v => v > 0 && v <= 1));
    }
    assert.ok(minY < y);
    close(maxY, index === 0 ? y + tree.height : y + 1.52);
  });
  assert.equal(G.forest(world, []).length, 0);
  assert.equal(G.stones(world, []).length, 0);
});

test("horizon rings close their seams and the water plane covers the entire field", () => {
  const data = G.horizon(world), triangle = 3 * G.STRIDE, ring = 205 * 2 * triangle;
  assert.equal(data.length, ring * 3 * 2);
  assert.ok(data.every(Number.isFinite));
  for (let i = 0; i < data.length; i += ring) {
    const first = data.slice(i, i + 3), seam = i + ring - triangle;
    assert.deepEqual(data.slice(seam, seam + 3), first);
    assert.ok(Math.hypot(first[0], first[2]) > T.HALF);
  }
  const water = G.water();
  assert.equal(water.length, 18);
  let area = 0;
  for (let i = 0; i < 18; i += 9) {
    const [a, b, c] = [0, 3, 6].map(offset => water.slice(i + offset, i + offset + 3));
    for (const v of [a, b, c]) assert.deepEqual([Math.abs(v[0]), v[1], Math.abs(v[2])], [T.HALF, T.WATER, T.HALF]);
    area += M.cross(M.subtract(b, a), M.subtract(c, a))[1] / 2;
  }
  assert.equal(area, (2 * T.HALF) ** 2);
});

test("bathymetry samples texel centres, clamps depths and keeps canopy shadows in a separate channel", () => {
  const flatSlope = { surfaceAt: x => x / 8 };
  const size = 24, unit = 2 * T.HALF / size;
  const trees = [{ x: 0.5 * unit, z: 0.5 * unit, width: 3 }, { x: -T.HALF, z: T.HALF, width: 4 }];
  const base = G.landscapeTexture(flatSlope, [], size);
  const texture = G.landscapeTexture(flatSlope, trees, size);
  assert.equal(texture.size, size);
  assert.equal(texture.data.length, size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = 4 * (z * size + x), h = flatSlope.surfaceAt((x + 0.5) * unit - T.HALF);
      assert.equal(texture.data[i], Math.round(M.clamp((h + 16) / 20, 0, 1) * 255));
      assert.equal(base.data[i], texture.data[i]);
      assert.equal(base.data[i + 1], 0);
      assert.equal(texture.data[i + 3], 255);
    }
  }
  assert.equal(texture.data[(12 * size + 12) * 4 + 1], 240);
  assert.ok(texture.data[(23 * size) * 4 + 1] > 0);
  assert.equal(texture.data[(23 * size + 23) * 4 + 1], 0);
});

test("each starting camera frames sky, a shoreline and a body of water", () => {
  for (const id of Object.keys(T.PRESETS)) {
    const w = T.createWorld(T.DEFAULT_SEED, id), g = T.buildGrid(w, 96);
    const c = S.homeCamera(w.style), axes = M.basis(M.direction(c.yaw, c.pitch));
    const counts = { water: 0, land: 0, sky: 0 };
    assert.ok(c.position[1] > g.surfaceAt(c.position[0], c.position[2]) + 2);
    // Cast a coarse grid of view rays against the same triangles used for collision.
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 25; col++) {
        const u = ((col + 0.5) / 25 * 2 - 1) * Math.tan(S.FOV / 2) * 1.8;
        const v = (1 - (row + 0.5) / 15 * 2) * Math.tan(S.FOV / 2);
        const dir = axes.forward.map((f, i) => f + u * axes.right[i] + v * axes.up[i]);
        let hit = "sky";
        for (let t = 1; t < 780; t += 2) {
          const x = c.position[0] + dir[0] * t, z = c.position[2] + dir[2] * t;
          if (Math.abs(x) > T.HALF || Math.abs(z) > T.HALF) break;
          const h = g.surfaceAt(x, z);
          if (c.position[1] + dir[1] * t <= Math.max(T.WATER, h)) {
            hit = h < T.WATER ? "water" : "land";
            break;
          }
        }
        counts[hit]++;
      }
    }
    assert.ok(counts.water >= 18 && counts.sky >= 17 && counts.land >= 90, id + " " + JSON.stringify(counts));
  }
});
