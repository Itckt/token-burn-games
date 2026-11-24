"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const M = require("../js/math");
const N = require("../js/noise");
const P = require("../js/probe");
const art = require("../js/cartography");
const { triangleRaycast } = require("./support/geometry");

const gridOf = (heightAt, segments = 8) => T.buildGrid({ number: 12, heightAt }, segments);
function near(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);
}

test("soundings hit the visible water first, expose its bed, and resolve a zero-depth terrace as ground", () => {
  const grid = gridOf(() => -7), eye = [21, 30, 22], down = [0, -8, 0];
  for (const [level, kind, distance, depth] of [[8, "water", 22, 15], [0, "water", 30, 7],
    [-6, "water", 36, 1], [-7, "ground", 37, 0], [null, "ground", 37, 0]]) {
    const hit = P.cast(grid, eye, down, level);
    assert.equal(hit.kind, kind); near(hit.distance, distance); near(hit.depth, depth);
    near(hit.x, eye[0]); near(hit.z, eye[2]); near(hit.bed, -7);
    assert.equal(hit.aspect, null); near(hit.slope, 0);
  }
  assert.equal(P.cast(grid, eye, [0, 1, 0], 0), null);
  assert.equal(P.cast(grid, eye, [0, 0, 0], 0), null);
  assert.equal(P.cast(grid, eye, [NaN, -1, 0], 0), null);
});

test("a slanted ray reports the first ground face, its true grade and its downhill compass aspect", () => {
  const grid = gridOf((x, z) => 15 + x / 8 - z / 4);
  const target = [31, grid.surfaceAt(31, -51), -51], eye = [0, 70, 20];
  const ray = M.subtract(target, eye), hit = P.cast(grid, eye, ray, 8);
  assert.equal(hit.kind, "ground"); near(hit.distance, Math.hypot(...ray));
  near(hit.x, target[0]); near(hit.z, target[2]); near(hit.bed, target[1]);
  near(hit.slope, Math.atan(Math.hypot(1 / 8, 1 / 4)) * 180 / Math.PI);
  assert.equal(hit.aspect, "SW");
  const ridge = gridOf(x => x === 0 ? 40 : -5, 24);
  const blocked = P.cast(ridge, [-45, 22, 3], [2, -0.5, 0], 0);
  assert.equal(blocked.kind, "ground"); assert.ok(blocked.x < 0 && blocked.bed > 0);
});

test("probe clipping handles vertical, horizontal, boundary-parallel and outside-in rays", () => {
  const grid = gridOf(x => x / 4), r = T.HALF;
  near(P.cast(grid, [0, 25, -r], [4, 0, 0]).x, 100);
  near(P.cast(grid, [r + 30, 55, 0], [-1, 0, 0]).x, 220);
  near(P.cast(grid, [r, 80, r], [0, -1, 0]).bed, 66);
  for (const [eye, ray] of [[[r + 1, 80, 0], [0, -1, 0]], [[0, 90, r + 1], [1, 0, 0]],
    [[r + 1, 60, 0], [1, -1, 0]], [[10, 1300, 0], [0, -1, 0]], [[r, 66.1, 0], [0, -1, 0]]]) {
    assert.equal(P.cast(grid, eye, ray), null);
  }
});

test("grazing probe rays agree with an independent intersection of every triangle", () => {
  const grid = T.buildGrid(T.createWorld("Rim light", "caldera"), 27), rng = N.random(41);
  const firstFace = triangleRaycast(grid, 0.35, 1200);
  for (let i = 0; i < 90; i++) {
    const eye = [(rng() - 0.5) * 630, 20 + rng() * 90, (rng() - 0.5) * 630];
    const ray = [2 * rng() - 1, rng() * 0.55 - 0.4, 2 * rng() - 1];
    const expected = firstFace(eye, ray), hit = P.cast(grid, eye, ray);
    if (expected === Infinity) assert.equal(hit, null);
    else { near(hit.distance, expected); near(hit.bed, eye[1] + M.normalize(ray)[1] * expected); }
  }
});

test("the relief map follows the mesh diagonal across ridges and ambiguous saddles", () => {
  const grid = gridOf(() => 0, 2);
  grid.heights.set([7, -3, 6, -2, 4, -8, -4, 9, -1]);
  for (const diagonal of [0, 1]) {
    grid.splits.fill(diagonal);
    for (const level of [-2, 0, 3, 6]) {
      const segments = art.contourSegments(grid.heights, 3, 3, level, grid.splits);
      assert.ok(segments.length);
      for (const [a, b] of segments) {
        assert.notDeepEqual(a, b);
        for (const t of [0, 0.3, 0.5, 1]) {
          near(grid.surfaceAt(M.lerp(a[0], b[0], t) * grid.step - T.HALF,
            M.lerp(a[1], b[1], t) * grid.step - T.HALF), level);
        }
      }
    }
  }
  const seam = art.contourSegments([0, -1, -1, 0], 2, 2, 0, [1]);
  assert.equal(seam.length, 1);
  assert.deepEqual(seam[0].sort((a, b) => a[0] - b[0]), [[0, 0], [1, 1]]);
});
