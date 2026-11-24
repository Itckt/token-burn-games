"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const M = require("../js/math");
const S = require("../js/simulation");
const O = require("../js/observatory");
const { triangleRaycast } = require("./support/geometry");

const bed = (heightAt, n = 8) => T.buildGrid({ number: 32, heightAt }, n);
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, a + " differs from " + b);

test("the skyline uses north-up bearings, wraps through north and retains negative elevation angles", () => {
  const grid = bed(() => -12), eye = [45, 22, -32], profile = O.skyline(grid, eye);
  assert.equal(profile.length, 360);
  for (const [degrees, distance] of [[0, 232], [90, 219], [180, 296], [270, 309], [45, 219 * Math.SQRT2]]) {
    const ridge = profile[degrees];
    near(ridge.height, -12); near(ridge.distance, distance);
    near(ridge.angle, Math.atan2(-34, distance));
    near(Math.hypot(ridge.x - eye[0], ridge.z - eye[2]), distance);
    near(O.horizonAt(grid, eye, (degrees - 720) * O.DEGREE).angle, ridge.angle);
  }
  assert.equal(O.horizonAt(grid, [T.HALF, 3, T.HALF], Math.PI), null);
  near(O.horizonAt(grid, [T.HALF, 3, T.HALF], 0).distance, 2 * T.HALF);
  assert.throws(() => O.horizonAt(grid, [300, 2, 0], 0), RangeError);
  assert.throws(() => O.horizonAt(grid, [0, -13, 0], 0), /below the terrain/);
  assert.throws(() => O.horizonAt(grid, eye, NaN), RangeError);
});

test("a summit along a seeded diagonal can block a sightline between two lower cell edges", () => {
  const grid = bed(() => 0, 2), eye = [-132, 30, 70];
  grid.heights[1] = grid.heights[3] = 50;
  grid.splits.fill(0);
  const ridge = O.horizonAt(grid, eye, 0);
  near(ridge.z, -132); near(ridge.height, 50); near(ridge.angle, Math.atan2(20, 202));
  grid.splits[0] = 1;
  const cleared = O.horizonAt(grid, eye, 0);
  near(cleared.z, -T.HALF); near(cleared.height, 25); assert.ok(cleared.angle < 0);
});

test("sightlines immediately above and below the measured skyline agree with brute-force triangle hits", () => {
  const grid = T.buildGrid(T.createWorld("Evening edition", "caldera"), 36);
  const cast = triangleRaycast(grid);
  for (const eye of [[73, 74, 125], [201, 220, -191], [0, 6, 0]]) {
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const yaw = degrees * O.DEGREE, hit = O.horizonAt(grid, eye, yaw);
      assert.equal(cast(eye, M.direction(yaw, hit.angle + 1e-6)), Infinity);
      assert.ok(Number.isFinite(cast(eye, M.direction(yaw, hit.angle - 1e-6))));
      near(hit.height, grid.surfaceAt(hit.x, hit.z));
    }
  }
});

test("summit placement includes the clipped flight boundary and gives a repeatable station on flat ground", () => {
  assert.deepEqual(O.summit(bed(() => -4)), [0, -4, 0]);
  const slope = bed((x, z) => x * 0.5 + z * 0.25);
  assert.deepEqual(O.summit(slope), [S.FLIGHT_BOUND, 0.75 * S.FLIGHT_BOUND, S.FLIGHT_BOUND]);
  const grid = bed(() => 0, 2);
  grid.splits.fill(1);
  grid.heights[4] = 10; grid.heights[8] = 90;
  const [x, height, z] = O.summit(grid, 100);
  near(x, 100); near(z, 100); near(height, 10 + 80 * 100 / 264);
  assert.throws(() => O.summit(grid, 0), RangeError);
});

test("a flat station sees open daylight at whole minutes and a north wall can shade the entire day", () => {
  const eye = [0, 2, 0];
  assert.deepEqual(O.sunWindows(bed(() => 0), eye), { windows: [{ start: 361, end: 1080 }], minutes: 719 });
  assert.deepEqual(O.sunWindows(bed((x, z) => z === -33 ? 130 : 0, 16), eye), { windows: [], minutes: 0 });
  for (const hour of [-4, 0, 6, 12, 18, 24, 33.5]) assert.deepEqual(S.sunDirection(hour), S.lighting(hour).sun);
});

test("a pinnacle splits the day into separate sun windows with minute edges matching independent rays", () => {
  const grid = bed((x, z) => x === 0 && z === -99 ? 120 : 0, 32), eye = [0, 2, 0];
  const cast = triangleRaycast(grid), { windows, minutes } = O.sunWindows(grid, eye);
  assert.deepEqual(windows, [{ start: 361, end: 709 }, { start: 808, end: 1080 }]);
  let litMinutes = 0;
  for (let minute = 0; minute < 1440; minute++) {
    const sun = S.sunDirection(minute / 60);
    const lit = sun[1] > 1e-9 && cast(eye, sun) === Infinity;
    const scheduled = windows.some(w => w.start <= minute && minute < w.end);
    assert.equal(scheduled, lit, "minute " + minute);
    if (lit) litMinutes++;
  }
  assert.equal(minutes, litMinutes);
});

test("the light projector encloses the entire bed and orders casters before receivers along a solar ray", () => {
  for (const range of [{ low: -16, high: 215 }, { low: -6, high: -6 }]) {
    for (const sun of [S.sunDirection(6.01), S.sunDirection(12), S.sunDirection(17.9), [0, 1, 0]]) {
      const matrix = O.lightProjection(range, sun);
      const project = p => [0, 1, 2].map(i => matrix[i] * p[0] + matrix[4 + i] * p[1] + matrix[8 + i] * p[2] + matrix[12 + i]);
      for (const x of [-T.HALF, T.HALF]) for (const y of [range.low, range.high]) for (const z of [-T.HALF, T.HALF]) {
        assert.ok(project([x, y, z]).every(v => Math.abs(v) < 1));
      }
      const bedPoint = [42, range.low, 75], caster = bedPoint.map((v, i) => v + sun[i] * 40);
      const a = project(bedPoint), b = project(caster);
      near(a[0], b[0]); near(a[1], b[1]); assert.ok(b[2] < a[2]);
      assert.deepEqual([matrix[3], matrix[7], matrix[11], matrix[15]], [0, 0, 0, 1]);
    }
  }
});
