"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const E = require("../js/erosion");
const H = require("../js/hydrology");
const Q = require("../js/survey");
const S = require("../js/simulation");
const G = require("../js/meshes");

const half = T.HALF, fieldArea = (2 * half) ** 2;
const gridOf = (segments, heightAt) => T.buildGrid({ number: 17, heightAt }, segments);
function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + " differs from " + expected);
}

// Integrate the bed independently. The endpoints of a cell's diagonal each
// contribute to both faces, and the other two corners contribute to one.
function bedVolume(g) {
  let sum = 0;
  for (let z = 0; z < g.segments; z++) {
    for (let x = 0; x < g.segments; x++) {
      const k = z * g.side + x, a = g.heights[k], b = g.heights[k + 1];
      const c = g.heights[k + g.side], d = g.heights[k + g.side + 1];
      sum += a + b + c + d + (g.splits[z * g.segments + x] ? a + d : b + c);
    }
  }
  return sum * g.step ** 2 / 6;
}

test("weathering conserves triangulated bed volume at summits, pits, edges and corners", () => {
  const g = gridOf(16, (x, z) => x === 0 && z === 0 ? 190 : x === -half ? 85 : z === half ? -42 : 0);
  const original = g.heights.slice(), initialVolume = bedVolume(g);
  const talus = E.weatherGrid(g, "talus"), worn = E.weatherGrid(g, "worn");
  for (const changed of [talus, worn]) {
    near(bedVolume(changed), initialVolume, 0.05);
    assert.strictEqual(changed.splits, g.splits);
    assert.ok(changed.heights.every(h => Number.isFinite(h) && h >= -42 && h <= 190));
    assert.ok(changed.surfaceAt(0, 0) < 190 && changed.surfaceAt(-half, 0) < 85);
    assert.ok(changed.surfaceAt(0, half) > -42);
    assert.equal(changed.surfaceAt(0, 0), changed.heights[8 * g.side + 8]);
  }
  assert.ok(worn.surfaceAt(0, 0) < talus.surfaceAt(0, 0));
  assert.deepEqual(g.heights, original);
  assert.strictEqual(E.weatherGrid(g, "fresh"), g);
  assert.deepEqual(E.weatherGrid(g, "talus").heights, talus.heights);
  for (const value of ["toString", "__proto__", null]) assert.throws(() => E.weatherGrid(g, value), RangeError);
});

test("flat beds and slopes below the angle of repose remain stationary on either diagonal", () => {
  for (const split of [0, 1]) {
    const g = gridOf(8, (x, z) => 0.08 * x + 0.10 * z - 16);
    g.splits.fill(split);
    for (const setting of ["talus", "worn"]) assert.deepEqual(E.weatherGrid(g, setting).heights, g.heights);
  }
  const flat = gridOf(2, () => -4);
  assert.deepEqual(E.weatherGrid(flat, "worn").heights, flat.heights);
  assert.throws(() => flat.withHeights(new Float32Array(3)), RangeError);
});

test("seeded weathered surfaces replay and supply the render mesh, scatter, collision and route", () => {
  for (const preset of Object.keys(T.PRESETS)) {
    const w = T.createWorld("Canteen-Relay", preset);
    const g = E.weatherGrid(T.buildGrid(w, 48), "worn");
    const replay = E.weatherGrid(T.buildGrid(T.createWorld(w.seed, preset), 48), "worn");
    assert.deepEqual(g.heights, replay.heights);
    const trees = T.scatter(w, g, 540).trees;
    assert.ok(trees.length > 0);
    for (const tree of trees) near(tree.y, g.surfaceAt(tree.x, tree.z));
    const mesh = G.land(w, g);
    for (let i = 0; i < mesh.length; i += G.STRIDE * 107) near(mesh[i + 1], g.surfaceAt(mesh[i], mesh[i + 2]), 2e-5);
    const r = Q.buildRoute(g, Q.inletPath(w), 6);
    for (let d = 0; d < r.length; d += 0.8) {
      const s = Q.stationAt(r, d);
      near(s.height, g.surfaceAt(s.x, s.z));
      assert.ok(s.altitude >= Math.max(6, s.height) + Q.CLEARANCE - 1e-7);
    }
  }
});

test("lake footprint and storage match an analytic wedge including dry and fully submerged limits", () => {
  const g = gridOf(8, x => x / 22);
  for (const split of [0, 1]) {
    g.splits.fill(split);
    for (const level of [-15, -12, -6, -1.75, 0, 3, 8, 12, 17]) {
      const wet = H.inundation(g, level);
      const fraction = Math.max(0, Math.min(1, (level + 12) / 24));
      near(wet.area, fieldArea * fraction);
      near(wet.volume, fieldArea * (level > 12 ? level : fraction * Math.max(0, level + 12) / 2));
    }
  }
  for (const level of [Infinity, -Infinity, NaN]) assert.throws(() => H.inundation(g, level), RangeError);
});

test("a flat at lake level is dry, and a flood above it covers the whole sheet without a spurious shore", () => {
  const g = gridOf(4, () => 2);
  let fills = 0;
  const fill = polygon => { fills++; assert.ok(polygon.every(p => p[2] > 0)); };
  const edge = () => assert.fail("unexpected shoreline");
  for (const level of [-4, 2]) assert.deepEqual(H.inundation(g, level, fill, edge), { area: 0, volume: 0 });
  assert.equal(fills, 0);
  assert.deepEqual(H.inundation(g, 5, fill, edge), { area: fieldArea, volume: 3 * fieldArea });
  assert.equal(fills, 2 * g.segments ** 2);
});

test("a single flooded hollow uses the actual cell diagonals for its footprint, volume and drawn shoreline", () => {
  const g = gridOf(2, (x, z) => x === 0 && z === 0 ? -2 : 2);
  for (const incident of [4, 8]) {
    g.splits.set(incident === 8 ? [1, 0, 0, 1] : [0, 1, 1, 0]);
    let filledArea = 0, edges = 0;
    const wet = H.inundation(g, 0, polygon => {
      let twice = 0;
      polygon.forEach(([x, z, depth], i) => {
        const next = polygon[(i + 1) % polygon.length];
        twice += x * next[1] - next[0] * z;
        near(-depth, g.surfaceAt(x * g.step - half, z * g.step - half));
      });
      filledArea += Math.abs(twice) * g.step ** 2 / 2;
    }, (a, b) => {
      edges++;
      assert.notDeepEqual(a, b);
      for (const [x, z] of [a, b]) near(g.surfaceAt(x * g.step - half, z * g.step - half), 0);
    });
    near(wet.area, incident * g.step ** 2 / 8); near(filledArea, wet.area);
    near(wet.volume, wet.area * 2 / 3); assert.equal(edges, incident);
  }
});

test("shorelines through exact vertices emit no zero-length edges and storage increases by flooded area", () => {
  const g = gridOf(7, (x, z) => (x - z) / 25);
  H.inundation(g, 0, undefined, (a, b) => assert.notDeepEqual(a, b));
  const delta = 0.001, level = 2.7;
  const difference = (H.inundation(g, level + delta).volume - H.inundation(g, level - delta).volume) / (2 * delta);
  near(difference, H.inundation(g, level).area, 0.01);
});

test("runoff uses connected diagonals and interpolates the first wet crossing without cutting through a ridge", () => {
  const g = gridOf(4, (x, z) => x === 0 && z === 0 ? 3 : x === 132 && z === 132 ? -1 : 20);
  g.splits.fill(0);
  assert.deepEqual(H.traceRunoff(g, [12, -12], 1), { points: [[0, 0]], outlet: "hollow" });
  g.splits[2 * g.segments + 2] = 1;
  assert.deepEqual(H.traceRunoff(g, [12, -12], 1), { points: [[0, 0], [66, 66]], outlet: "lake" });
  assert.deepEqual(H.traceRunoff(g, [132, 132], 1), { points: [[132, 132]], outlet: "lake" });
  assert.equal(H.traceRunoff(g, [0, 0], 3).points.length, 1);
});

test("a cardinal neighbour with the steeper grade beats a diagonal with the larger raw drop", () => {
  const g = gridOf(4, (x, z) => x === 0 && z === 0 ? 10 : x === 132 && z === 0 ? 0 : x === 132 && z === 132 ? -2 : 30);
  g.splits.fill(1);
  assert.deepEqual(H.traceRunoff(g, [0, 0], 5), { points: [[0, 0], [66, 0]], outlet: "lake" });
});

test("a level terrace drains through its connected outlet and terminates in a sealed hollow", () => {
  const g = gridOf(8, (x, z) => z === 0 && x >= -132 && x <= 66 ? 5 : x === 132 && z === 0 ? 1 : 10);
  const path = H.traceRunoff(g, [-132, 0], 3);
  assert.deepEqual(path, { points: [[-132, 0], [-66, 0], [0, 0], [66, 0], [99, 0]], outlet: "lake" });
  g.heights[4 * g.side + 6] = 10;
  assert.deepEqual(H.traceRunoff(g, [-132, 0], 3), { points: [[-132, 0]], outlet: "hollow" });
  const flat = gridOf(20, () => 1);
  const toRim = H.traceRunoff(flat, [0, 0], 0);
  assert.equal(toRim.outlet, "edge");
  assert.equal(toRim.points.length, 11);
  assert.equal(Math.max(...toRim.points.at(-1).map(Math.abs)), half);
});

test("runoff stops at the first of the survey boundary and waterline, including an exact tie", () => {
  const g = gridOf(8, x => -x / 4), bound = 210;
  for (const [level, end, outlet] of [[-80, 210, "edge"], [-50, 200, "lake"], [-52.5, 210, "lake"]]) {
    const route = H.traceRunoff(g, [0, 0], level, bound);
    assert.deepEqual(route.points.at(-1), [end, 0]);
    assert.equal(route.outlet, outlet);
  }
  assert.deepEqual(H.traceRunoff(g, [half, half], -100), { points: [[half, half]], outlet: "edge" });
  for (const args of [[[NaN, 0]], [[0]], [[0, 300]], [Array(2)], [null], [[0, 0], NaN], [[0, 0], 0, 0]]) {
    assert.throws(() => H.traceRunoff(g, ...args), RangeError);
  }
});

test("natural runoff traces replay and stay on descending terrain across all three biomes", () => {
  for (const preset of Object.keys(T.PRESETS)) {
    const grid = T.buildGrid(T.createWorld("Kowloon-Tong", preset), 43);
    for (const level of [H.MIN_LEVEL, 0, H.MAX_LEVEL]) {
      for (const source of [[-100, -160], [69, 112], [240, -18], [-half, half], [0, 0]]) {
        const trace = H.traceRunoff(grid, source, level, S.FLIGHT_BOUND);
        assert.deepEqual(H.traceRunoff(grid, source, level, S.FLIGHT_BOUND), trace);
        assert.ok(trace.points.length <= grid.heights.length + 1);
        assert.equal(new Set(trace.points.map(p => p.join("/"))).size, trace.points.length);
        let prev, lastHeight = Infinity;
        for (const p of trace.points) {
          assert.ok(p.every(v => Math.abs(v) <= S.FLIGHT_BOUND + 1e-7));
          const h = grid.surfaceAt(...p);
          assert.ok(h <= lastHeight + 1e-7);
          if (prev) near(grid.surfaceAt((prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2), (h + lastHeight) / 2);
          prev = p; lastHeight = h;
        }
        if (trace.outlet === "lake" && trace.points.length > 1) near(lastHeight, level);
      }
    }
  }
});

test("packed bed colour decodes submerged and newly flooded banks after linear texture filtering", () => {
  const texture = G.landscapeTexture({ surfaceAt: x => x / 12 }, [], 32);
  const at = x => -16 + (20 * texture.data[x * 4] + 8 * texture.data[x * 4 + 2]) / 255;
  const trueBed = x => Math.max(-16, Math.min(12, ((x + 0.5) * 2 * half / 32 - half) / 12));
  for (let x = 0; x < 31; x++) {
    near(at(x), trueBed(x), 0.04);
    near((at(x) + at(x + 1)) / 2, (trueBed(x) + trueBed(x + 1)) / 2, 0.04);
  }
});

test("runoff ribbon rails follow the bed through turns, repeated stops, a reversal and the world edge", () => {
  const g = gridOf(22, (x, z) => Math.abs(x) / 6 + z / 20);
  const path = [[0, 0], [0, 0], [8, 0], [0, 0], [half, 40]], mesh = G.runoffRibbon(g, path);
  assert.ok(mesh.length > 0 && mesh.length % (3 * 5) === 0 && mesh.every(Number.isFinite));
  const marks = new Set();
  for (let i = 0; i < mesh.length; i += 5) {
    const [x, y, z, distance, side] = mesh.subarray(i, i + 5);
    assert.ok(Math.abs(x) <= half && Math.abs(z) <= half && distance >= 0);
    near(y - 0.22, g.surfaceAt(x, z), 1e-5);
    assert.ok([-1, 0, 1].includes(side));
    if (side === 0) marks.add(distance);
  }
  near(Math.max(...marks), 16 + Math.hypot(half, 40), 2e-5);
  for (const p of [[], [[1, 2]], [[1, 2], [1, 2]]]) assert.equal(G.runoffRibbon(g, p).length, 0);
  assert.ok(G.runoffRibbon(g, [[0, 0], [1e-310, 0]]).every(Number.isFinite));
});
