"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const S = require("../js/simulation");
const Q = require("../js/survey");
const M = require("../js/math");
const R = require("../js/relay");
const G = require("../js/meshes");

const grid = T.buildGrid({ number: 3, heightAt: () => -4 }, 12);
const flatRoute = (a, b) => Q.buildRoute(grid, [a, b]);
const gate = x => ({ center: [x, 10, 0], normal: [1, 0], radius: 4 });
function near(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);
}

test("the caldera replays a breached rim, flooded bowl and central cinder island for different seeds", () => {
  for (const seed of [T.DEFAULT_SEED, "Last-Minibus", "八點半"]) {
    const w = T.createWorld(seed, "caldera"), g = T.buildGrid(w, 64);
    assert.deepEqual(g.heights, T.buildGrid(T.createWorld(seed, "caldera"), 64).heights);
    assert.ok(w.heightAt(-12, -32) < -6);
    for (const z of [15, 45, 75, 95, 115, 145, 200]) assert.ok(w.heightAt(w.riverCenter(z), z) < 0);
    for (const angle of [-Math.PI, -2.1, -1.57, -0.6, 0, 0.7, 2.4]) {
      let rim = -Infinity;
      for (let radius = 80; radius <= 164; radius += 3) {
        rim = Math.max(rim, w.heightAt(-9 + Math.cos(angle) * radius, -26 + Math.sin(angle) * radius));
      }
      assert.ok(rim > 43, "a raised rim around the breach");
    }
    let cone = -Infinity;
    for (let x = 20; x <= 55; x += 3) for (let z = -48; z <= -25; z += 3) cone = Math.max(cone, w.heightAt(x, z));
    assert.ok(cone > 17);
    assert.ok(w.heightAt(38, 8) < 0 && w.heightAt(38, -80) < 0);
    const route = Q.buildRoute(g, Q.inletPath(w));
    assert.ok(route.submerged > 80 && route.high > 50);
  }
});

test("gates follow measured stations over every preset, aim the launch and clear both banks of the aperture", () => {
  for (const id of Object.keys(T.PRESETS)) {
    const w = T.createWorld("Shore light", id), g = T.buildGrid(w, 96);
    const r = Q.buildRoute(g, Q.inletPath(w), 8), course = R.buildCourse(g, r);
    assert.deepEqual(course, R.buildCourse(g, r));
    assert.equal(course.gates.length, Math.ceil(r.length / 60));
    const aim = M.normalize(M.subtract(course.gates[0].center, course.launch.position));
    near(M.dot(aim, M.direction(course.launch.yaw, course.launch.pitch)), 1);
    course.gates.forEach((gate, i) => {
      const [x, y, z] = gate.center, [nx, nz] = gate.normal;
      const station = Q.stationAt(r, (i + 1) / course.gates.length * r.length);
      near(x, station.x); near(z, station.z); near(Math.hypot(nx, nz), 1);
      assert.ok(y >= station.altitude - 1e-8);
      for (let j = -24; j <= 24; j++) {
        const side = gate.rimRadius * j / 24;
        assert.ok(y - gate.rimRadius >= Math.max(8, g.surfaceAt(x - nz * side, z + nx * side)) + 2 - 1e-8);
      }
    });
  }
});

test("relay spacing supports the minimum transect, refuses sub-five-metre traces and caps long courses", () => {
  assert.equal(R.buildCourse(grid, flatRoute([0, 0], [0, 0.001])), null);
  const short = R.buildCourse(grid, flatRoute([S.FLIGHT_BOUND - 5, 0], [S.FLIGHT_BOUND, 0]));
  assert.equal(short.gates.length, 1); near(short.gates[0].radius, 1.4);
  const g = short.gates[0];
  near(R.crossing(g, short.launch.position, g.center), 1);
  const long = R.buildCourse(grid, Q.buildRoute(grid, [[-230, -230], [230, 230], [-230, 230], [230, -230]]));
  assert.equal(long.gates.length, 8);
  assert.ok(long.gates.every(gate => gate.radius === 8));
});

test("a diagonal gate at the survey edge clears a sharp summit beneath its in-bounds rim", () => {
  const field = T.buildGrid({ number: 1, heightAt: (x, z) => Math.max(0, 85 - 18 * Math.hypot(x - 254, z + 77)) }, 144);
  const end = [S.FLIGHT_BOUND, -82], from = [end[0] - 27.5, end[1] - 27.5 * Math.sqrt(3)];
  const g = R.buildCourse(field, Q.buildRoute(field, [from, end])).gates.at(-1);
  for (let i = -100; i <= 100; i++) {
    const d = i / 100 * g.rimRadius, point = [end[0] - d * g.normal[1], end[1] + d * g.normal[0]];
    if (T.inSurvey(point)) assert.ok(g.center[1] - g.rimRadius >= field.surfaceAt(...point) + 2 - 1e-8);
  }
});

test("swept aperture hits include the rim, fast passes and reverse approaches", () => {
  const g = gate(10);
  near(R.crossing(g, [-100, 10, 0], [100, 10, 0]), 0.55);
  near(R.crossing(g, [25, 14, 0], [5, 14, 0]), 0.75);
  near(R.crossing(g, [5, 10, -4], [10, 10, -4]), 1);
  assert.ok(R.crossing(g, [10 - 1e-10, 10, 0], [11, 10, 0]) > 0);
  assert.equal(R.crossing(g, [5, 14.001, 0], [15, 14.001, 0]), null);
  assert.equal(R.crossing(g, [5, 13, 3], [15, 13, 3]), null);
  assert.equal(R.crossing(g, [1, 10, 0], [9.9, 10, 0]), null);
  assert.equal(R.crossing(g, [10, 10, -5], [10, 10, 5]), null);
  const diagonal = { ...g, normal: [Math.SQRT1_2, Math.SQRT1_2] };
  near(R.crossing(diagonal, [8, 10, -2], [16, 10, 6]), 0.25);
});

test("split times are independent of frame rate, gate order is enforced, and a finish is immutable", () => {
  const course = { gates: [gate(10), gate(23), gate(48)] };
  for (const fps of [1, 24, 60, 120]) {
    const run = R.start(course), rest = [0, 10, 0];
    R.advance(run, rest, rest, 100); assert.equal(run.started, false); assert.equal(run.elapsed, 0);
    for (let i = 0; i < fps * 2; i++) R.advance(run, [i * 60 / fps, 10, 0], [(i + 1) * 60 / fps, 10, 0], 1 / fps);
    assert.ok(run.finished); near(run.elapsed, 0.8);
    [10 / 60, 23 / 60, 0.8].forEach((t, i) => near(run.splits[i], t));
    R.advance(run, [50, 10, 0], [-20, 10, 0], 5);
    near(run.elapsed, 0.8); assert.equal(run.splits.length, 3);
  }
  const run = R.start({ gates: [gate(20), gate(10)] });
  R.advance(run, [0, 10, 0], [30, 10, 0], 3);
  assert.deepEqual(run.splits, [2]); near(run.elapsed, 3);
  R.advance(run, [30, 10, 0], [30, 10, 0], 4);
  R.advance(run, [30, 10, 0], [0, 10, 0], NaN);
  near(run.elapsed, 7); assert.equal(run.splits.length, 1);
  R.advance(run, [30, 10, 0], [0, 10, 0], 3);
  assert.deepEqual(run.splits, [2, 9]); near(run.elapsed, 9);
  assert.equal(R.formatTime(59.96), "1:00.0");
});

test("batched ring meshes close their seams and leave the measured apertures empty", () => {
  const course = R.buildCourse(grid, flatRoute([12, 70], [-63, -45])), data = G.relayGates(course.gates);
  assert.equal(data.length, course.gates.length * 64 * 6 * 6);
  assert.deepEqual(data, G.relayGates(course.gates));
  for (let i = 0; i < data.length; i += 6) {
    const [x, y, z, index, angle, outer] = data.subarray(i, i + 6);
    const g = course.gates[index], d = M.subtract([x, y, z], g.center);
    near(d[0] * g.normal[0] + d[2] * g.normal[1], 0, 1e-5);
    near(Math.hypot(...d), outer ? g.rimRadius : g.radius, 1e-5);
    assert.ok(angle >= 0 && angle <= 1);
  }
  assert.equal(G.relayGates([]).length, 0);
});
