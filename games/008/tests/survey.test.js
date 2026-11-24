"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const S = require("../js/simulation");
const Q = require("../js/survey");
const art = require("../js/cartography");
const N = require("../js/noise");
const M = require("../js/math");

function near(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);
}
function checkSurface(route, grid, count) {
  near(route.samples[0].distance, 0);
  near(route.samples.at(-1).distance, route.length);
  for (let i = 1; i < route.samples.length; i++) {
    assert.ok(route.samples[i].distance > route.samples[i - 1].distance);
  }
  for (let i = 0; i <= count; i++) {
    const s = Q.stationAt(route, route.length * i / count);
    near(s.height, grid.surfaceAt(s.x, s.z));
    assert.ok(s.altitude >= Math.max(T.WATER, s.height) + Q.CLEARANCE - 1e-7);
  }
}

test("transect length, climb and submerged span include fractional shoreline crossings in either direction", () => {
  const grid = T.buildGrid({ number: 12, heightAt: x => x / 2 }, 16);
  const a = [-60, 12], b = [120, 12];
  const route = Q.buildRoute(grid, [a, b]), back = Q.buildRoute(grid, [b, a]);
  for (const path of [route, back]) {
    near(path.length, 180); near(path.low, -30); near(path.high, 60); near(path.submerged, 60);
    checkSurface(path, grid, 151);
  }
  near(route.ascent, 90); near(back.ascent, 0);
  near(Q.stationAt(route, -999).distance, 0);
  near(Q.stationAt(route, Infinity).distance, route.length);
  near(Q.stationAt(route, 60).height, T.WATER);
});

test("both seeded diagonals contribute their actual extrema inside a cell", () => {
  const grid = T.buildGrid({ number: 0, heightAt: (x, z) => x === z ? 33 : -17 }, 2);
  const unit = grid.step, corner = -T.HALF, z = corner + unit * 0.4;
  const a = [corner + 0.1 * unit, z], b = [corner + 0.9 * unit, z];
  for (const split of [0, 1]) {
    grid.splits.fill(split);
    const route = Q.buildRoute(grid, [a, b]);
    assert.equal(route.samples.length, 3);
    const cut = route.samples[1];
    near(cut.x, corner + unit * (split ? 0.4 : 0.6));
    near(cut.height, split ? 33 : -17);
    checkSurface(route, grid, 320);
  }
});

test("corner, edge and diagonal paths have strictly increasing stations, including repeated vertices", () => {
  const grid = T.buildGrid(T.createWorld("Mesa"), 8), r = T.HALF;
  for (const points of [
    [[-r, -r], [0, 0], [0, 0], [r, r]], [[r, -r], [-r, r]],
    [[0, r], [0, -r]], [[r, r], [r, -r], [-r, -r]], [[-r, 1e-12], [1e-12, -r]]
  ]) checkSurface(Q.buildRoute(grid, points), grid, 257);
  for (const points of [[], null, [null], Array(2), [[0, 0], Array(2)], [[0, 0]], [[0, 0], [0, 0]],
    [[0, NaN], [2, 0]], [[0, 0], [r + 0.01, 0]]]) {
    assert.throws(() => Q.buildRoute(grid, points), RangeError);
  }
});

test("flat, entirely wet and sea-level legs have finite measurements and poses", () => {
  for (const height of [-5, 0, 20]) {
    const grid = T.buildGrid({ number: 3, heightAt: () => height }, 3);
    const route = Q.buildRoute(grid, [[9, 4], [14, 4]]);
    near(route.length, Q.MIN_LEG); near(route.submerged, height < 0 ? 5 : 0);
    near(route.ascent, 0);
    for (const distance of [-1, 0, 2.5, 5, 99]) {
      const pose = Q.flightPose(route, distance);
      near(pose.position[1], Math.max(0, height) + Q.CLEARANCE);
      near(pose.yaw, Math.PI / 2);
      assert.ok(Number.isFinite(pose.pitch));
    }
  }
});

test("a guided flight climbs before a narrow crest and limits the grade on both approaches", () => {
  const grid = T.buildGrid({ number: 5, heightAt: x => x === 0 ? 95 : -3 }, 48);
  const route = Q.buildRoute(grid, [[-180, 12], [180, 12]]);
  const early = Q.stationAt(route, 100), peak = Q.stationAt(route, 180), late = Q.stationAt(route, 260);
  assert.ok(early.height < 0 && early.altitude > 45 && late.altitude > 45);
  near(peak.altitude, 95 + Q.CLEARANCE);
  let previous = Q.flightPose(route, 0);
  for (let i = 1; i <= route.length * 2; i++) {
    const pose = Q.flightPose(route, i / 2);
    assert.ok(Math.abs(pose.position[1] - previous.position[1]) <= Q.MAX_GRADE / 2 + 1e-8);
    near(pose.yaw, Math.PI / 2);
    assert.ok(Math.abs(pose.pitch) < Math.PI / 2);
    previous = pose;
  }
  checkSurface(route, grid, 1000);
});

test("a short returning leg keeps a meaningful heading when its lookahead spans both ends of a loop", () => {
  const grid = T.buildGrid({ number: 2, heightAt: () => 0 }, 2);
  const route = Q.buildRoute(grid, [[0, 0], [4, 0], [0, 0]]);
  near(Q.flightPose(route, 3).yaw, Math.PI / 2);
  near(Q.flightPose(route, 6).yaw, -Math.PI / 2);
});

test("sub-ulp final legs cannot create duplicate stations or a non-finite endpoint pose", () => {
  const grid = T.buildGrid({ number: 3, heightAt: () => 5 }, 4);
  const route = Q.buildRoute(grid, [[-200, 0], [0, 0], [1e-16, 0]]);
  checkSurface(route, grid, 50);
  near(route.length, 200);
  const pose = Q.flightPose(route, route.length);
  assert.ok([...pose.position, pose.yaw, pose.pitch].every(Number.isFinite));
  near(pose.yaw, Math.PI / 2);
});

test("a moving waterline changes wet spans and tour clearance while ground measurements stay fixed", () => {
  const grid = T.buildGrid({ number: 1, heightAt: x => x / 4 }, 8);
  const points = [[-80, 12], [80, 12]];
  for (const level of [-6, 0, 8]) {
    const route = Q.buildRoute(grid, points, level);
    near(route.length, 160); near(route.ascent, 40);
    near(route.low, -20); near(route.high, 20);
    near(route.submerged, 80 + level * 4);
    near(Q.flightPose(route, 0).position[1], level + Q.CLEARANCE);
    for (let d = 0; d <= route.length; d++) {
      const s = Q.stationAt(route, d);
      near(s.height, grid.surfaceAt(s.x, s.z));
      assert.ok(s.altitude >= Math.max(s.height, level) + Q.CLEARANCE - 1e-7);
    }
  }
  assert.throws(() => Q.buildRoute(grid, points, Infinity), RangeError);
});

test("seeded inlet flights and arbitrary transects track the rendered terrain in every biome", () => {
  for (const id of Object.keys(T.PRESETS)) {
    const world = T.createWorld("Lantern Ferry", id), grid = T.buildGrid(world);
    const points = Q.inletPath(world), route = Q.buildRoute(grid, points);
    assert.deepEqual(points, Q.inletPath(T.createWorld("Lantern Ferry", id)));
    assert.notDeepEqual(points, Q.inletPath(T.createWorld("Last Tutorial", id)));
    assert.ok(points.every(p => p.every(n => Math.abs(n) <= S.FLIGHT_BOUND)));
    assert.ok(route.submerged > 50 && route.ascent > 20);
    checkSurface(route, grid, 1001);
    const rng = N.random(world.number);
    for (let i = 0; i < 10; i++) {
      const point = () => [rng(), rng()].map(v => (2 * v - 1) * S.FLIGHT_BOUND);
      checkSurface(Q.buildRoute(grid, [point(), point()]), grid, 191);
    }
  }
});

test("overview picking round-trips world coordinates and rejects the letterbox at any aspect", () => {
  for (const [w, h] of [[820, 260], [125, 900], [77, 77], [1, 1]]) {
    const frame = art.mapFrame(w, h, null, true);
    for (const p of [[-T.HALF, -T.HALF], [T.HALF, T.HALF], [32, 144], [0, 0]]) {
      const screen = art.mapPoint(frame, ...p);
      assert.ok(screen[0] >= 0 && screen[0] <= w && screen[1] >= 0 && screen[1] <= h);
      const picked = art.groundPoint(frame, ...screen);
      picked.forEach((v, i) => near(v, p[i]));
    }
    for (const pixel of [[0, h / 2], [w / 2, 0], [w, h]]) assert.equal(art.groundPoint(frame, ...pixel), null);
    for (const pos of [[-261, 55, -261], [261, 20, 261], [0, 10, 0]]) {
      const track = art.mapFrame(w, h, pos, false), [x, y] = art.mapPoint(track, pos[0], pos[2]);
      assert.ok(track.ox <= 0 && track.oz <= 0 && track.ox + track.tile >= w - 1e-7 && track.oz + track.tile >= h - 1e-7);
      near(M.clamp(x, 0, w), x); near(M.clamp(y, 0, h), y);
    }
  }
});

test("an isolated vertex exactly on a contour produces no zero-length strokes", () => {
  assert.deepEqual(art.contourSegments([0, -1, -1, -1], 2, 2, 0), []);
  assert.deepEqual(art.contourSegments([0, 0, -1, -1], 2, 2, 0), [[[1, 0], [0, 0]]]);
});

test("projection rounding at the outer edge still produces a valid world point on fractional map tiles", () => {
  for (let width = 15; width < 170; width++) {
    for (let height = 16; height < 170; height += 9) {
      const frame = art.mapFrame(width, height, null, true);
      const p = art.groundPoint(frame, ...art.mapPoint(frame, T.HALF, T.HALF));
      assert.ok(p && p.every(v => v <= T.HALF && v >= T.HALF - 1e-8));
    }
  }
});
