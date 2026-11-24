"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const H = require("../js/hydrology");
const W = require("../js/waterways");
const S = require("../js/simulation");
const N = require("../js/noise");
const G = require("../js/meshes");
const Q = require("../js/survey");

const bed = (heightAt, n = 8) => T.buildGrid({ heightAt, number: 42 }, n);
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) <= eps, a + " differs from " + b);
function checkPath(grid, path, level, bound = T.HALF) {
  assert.ok(path.length >= 2);
  for (const p of path) assert.ok(p.every(v => Math.abs(v) <= bound + 1e-9));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    assert.notDeepEqual(a, b);
    for (let j = 0; j <= 90; j++) {
      const h = grid.surfaceAt(a[0] + (b[0] - a[0]) * j / 90, a[1] + (b[1] - a[1]) * j / 90);
      assert.ok(level - h >= W.DRAFT - 1e-7, "clearance along a navigable leg");
    }
  }
  assert.ok(Q.buildRoute(grid, path, level).high <= level - W.DRAFT + 1e-7);
}
test("a sounding exactly on a band belongs to its deeper class, including an entire horizontal terrace", () => {
  const grid = bed(() => -W.DRAFT);
  assert.deepEqual(W.BANDS.map(b => b.depth), [0, W.DRAFT, 4, 8]);
  assert.equal(H.inundation(grid, -W.DRAFT).area, 0);
  const closed = H.inundation(grid, -W.DRAFT, null, null, true);
  close(closed.area, (T.HALF * 2) ** 2);
  assert.equal(closed.volume, 0);
  assert.ok(W.afloat(grid, [31, -78], 0));
  assert.equal(W.afloat(grid, [31, -78], -0.001), false);
});

test("nearest launch projects onto a draft contour and respects clipped borders, dry basins and level ground", () => {
  const slope = bed((x, z) => (x + z) / 8);
  const p = W.nearestLaunch(slope, [30, 18], W.DRAFT, 100);
  close(p[0], 6); close(p[1], -6);
  assert.deepEqual(W.nearestLaunch(slope, [-80, -20], 0, 100), [-80, -20]);
  const strip = bed(x => -x);
  const edge = W.nearestLaunch(strip, [220, 261], -259 + W.DRAFT, 260);
  close(edge[0], 259); close(edge[1], 260);
  assert.equal(W.nearestLaunch(strip, [220, 260], -262 + W.DRAFT, 260), null);
  assert.deepEqual(W.nearestLaunch(bed(() => 0), [0, 0], W.DRAFT), [0, 0]);
  assert.equal(W.nearestLaunch(bed(() => 0), [0, 0], 1), null);
});

test("a movement segment stops at the first shoal between deep endpoints in either direction", () => {
  const grid = bed(x => x === 0 ? 4 : -4);
  const a = [-132, 0], b = [132, 0], t = W.clearFraction(grid, a, b, 0);
  const x = -66 + 66 * (4 - W.DRAFT) / 8;
  close(a[0] + (b[0] - a[0]) * t, x);
  close(W.clearFraction(grid, b, a, 0), t);
  close(W.clearFraction(grid, [x, 0], b, 0), 0);
  assert.equal(W.clearFraction(grid, [x, 0], a, 0), 1);
  assert.equal(W.clearFraction(grid, a, a, 0), 1);
  assert.equal(W.clearFraction(grid, [0, 0], a, 0), 0);
});

test("the seeded diagonal determines whether two pools meet at a saddle", () => {
  const a = [-132, -132], b = [0, 0];
  const grid = bed((x, z) => (x === a[0] && z === a[1]) || (x === 0 && z === 0) ? -5 : 5, 4);
  grid.splits.fill(0);
  assert.equal(W.findPassage(grid, a, b, 0), null);
  grid.splits[grid.segments + 1] = 1;
  assert.deepEqual(W.findPassage(grid, a, b, 0), [a, b]);
  assert.equal(W.findPassage(grid, a, a, 0), null);
  assert.equal(W.findPassage(grid, [20, -132], b, 0), null);
  assert.throws(() => W.findPassage(grid, a, [NaN, 0], 0), RangeError);
});

test("routing can use the edge of the survey only when a deep opening lies within the navigation bounds", () => {
  const grid = bed((x, z) => x !== 0 ? -6 : z === T.HALF ? -1.55 : 10);
  const a = [-132, 0], b = [132, 0];
  const alongRim = W.findPassage(grid, a, b, 0);
  checkPath(grid, alongRim, 0);
  assert.ok(alongRim.length > 2);
  assert.equal(W.findPassage(grid, a, b, 0, S.FLIGHT_BOUND), null);
  assert.deepEqual(W.findPassage(grid, a, b, 12, S.FLIGHT_BOUND), [a, b]);
});

test("passage connectivity agrees with an independent wet-vertex flood fill on seeded triangulations", () => {
  const rng = N.random(8014);
  for (let trial = 0; trial < 45; trial++) {
    const grid = bed(() => rng() < 0.46 ? 4 : -3, 10), last = grid.heights.length - 1;
    grid.heights[0] = grid.heights[last] = -3;
    const adjacent = Array.from({ length: grid.heights.length }, () => []);
    T.visitTriangles(grid, (a, b, c) => {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (grid.heights[u] < 0 && grid.heights[v] < 0) { adjacent[u].push(v); adjacent[v].push(u); }
      }
    });
    const visited = new Set([0]);
    for (const i of visited) for (const j of adjacent[i]) visited.add(j);
    const path = W.findPassage(grid, [-T.HALF, -T.HALF], [T.HALF, T.HALF], 0);
    assert.equal(!!path, visited.has(last), "connected component on trial " + trial);
    if (path) checkPath(grid, path, 0);
  }
});

test("an island passage replays from its seed and every leg clears the changing bed", () => {
  const a = [40, 25], b = [40, -85], world = T.createWorld("Tutorial-Ferry", "caldera"), grid = T.buildGrid(world);
  const route = W.findPassage(grid, a, b, 0, S.FLIGHT_BOUND);
  assert.ok(Q.buildRoute(grid, [a, b]).high > 15);
  assert.equal(Math.round(Q.buildRoute(grid, route).length), 130);
  assert.deepEqual(route[0], a); assert.deepEqual(route.at(-1), b);
  assert.deepEqual(W.findPassage(T.buildGrid(T.createWorld(world.seed, world.id)), a, b, 0, S.FLIGHT_BOUND), route);
  for (const level of [-6, 0, 8]) checkPath(grid, W.findPassage(grid, a, b, level, S.FLIGHT_BOUND), level, S.FLIGHT_BOUND);
});

test("skiff surge is frame-rate independent, reverses and follows a raised waterline", () => {
  const grid = bed(() => -9), path = [[0, 0], [0, -100]], positions = [];
  for (const rate of [30, 60, 120]) {
    const c = S.homeCamera(T.PRESETS.alpine);
    assert.ok(S.boardSkiff(c, grid, 0, path));
    assert.deepEqual(c.position, [0, S.SKIFF_EYE, 0]);
    const step = (keys, seconds, level = 0) => {
      for (let i = 0; i < rate * seconds; i++) S.stepCamera(c, keys, 1 / rate, grid, true, level);
    };
    step(new Set(["KeyW", "KeyE"]), 2);
    assert.ok(c.skiffSpeed > 11.9); assert.equal(c.position[1], S.SKIFF_EYE);
    step(new Set(), 1);
    const far = c.position[2];
    step(new Set(["KeyS"]), 2, 5);
    assert.ok(c.skiffSpeed < -4.9 && c.position[2] > far);
    assert.equal(c.position[1], 5 + S.SKIFF_EYE);
    positions.push(c.position.slice());
    step(new Set(["KeyD"]), 1, 5); assert.ok(c.yaw > 0.9);
  }
  for (const p of positions) p.forEach((v, i) => close(v, positions[0][i]));
});

test("a skiff can back away from the draft limit, stop at the survey boundary and transfer to flight", () => {
  const grid = bed((x, z) => z / 10), c = S.homeCamera(T.PRESETS.fjord), forward = new Set(["KeyW"]);
  assert.ok(S.boardSkiff(c, grid, 0, [[0, -20], [0, -16]]));
  for (let i = 0; i < 15; i++) S.stepCamera(c, forward, 0.1, grid);
  close(grid.surfaceAt(c.position[0], c.position[2]), -W.DRAFT);
  close(c.position[2], -15, 1e-6);
  assert.equal(c.skiffLimit, "Draft limit"); assert.equal(c.skiffSpeed, 0);
  S.stepCamera(c, new Set(["KeyS"]), 0.1, grid);
  assert.ok(c.position[2] < -15 && c.skiffSpeed < 0);
  S.stepCamera(c, new Set(), 0, grid, true, -6);
  assert.equal(c.mode, "fly"); assert.equal(c.skiffSpeed, 0);
  assert.ok(S.boardSkiff(c, grid, 0, [[260.9, -30], [261, -30]]));
  S.stepCamera(c, forward, 0.1, grid);
  close(c.position[0], S.FLIGHT_BOUND);
  assert.equal(c.skiffLimit, "Survey edge");
  S.stepCamera(c, forward, 0, grid, false);
  assert.equal(c.mode, "fly");
  const saved = structuredClone(c);
  assert.equal(S.boardSkiff(c, bed(() => 26), 0), false);
  assert.deepEqual(c, saved);
});

test("striped spar buoys mark the corners and finish of a passage at the selected water level", () => {
  const points = [[3, 2], [63, 2], [63, 8]], waterLevel = -4;
  const mesh = G.passageBuoys({ points, waterLevel });
  assert.ok(mesh.every(Number.isFinite) && mesh.length > 0);
  const tips = new Set();
  for (let i = 0; i < mesh.length; i += G.STRIDE) {
    close(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5]), 1);
    if (Math.abs(mesh[i + 1] - waterLevel - 2.34) < 1e-6) tips.add([mesh[i], mesh[i + 2]].join(","));
  }
  assert.deepEqual([...tips], ["23,2", "43,2", "63,2", "63,8"]);
});
