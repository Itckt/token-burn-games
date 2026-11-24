"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bodies } = require("../js/catalog");
const { START_DAYS, systemAt } = require("../js/physics");
const { OrbitCamera, HOME } = require("../js/camera");
const { project, add, scale } = require("../js/math");
const { Renderer } = require("../js/renderer");
const { TRAIL_MARKS, TRAIL_STEPS } = require("../js/geometry");
const { environment } = require("./fixtures");

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a-b) <= tolerance, a + " differs from " + b);
const samePosition = (a, b, tolerance) => a.forEach((n, i) => near(n, b[i], tolerance));

test("pair camera keeps both endpoints and Saturn's ring extent inside the frame during fast playback, seeks and resize", () => {
  for (const [i, a] of bodies.entries()) for (const b of bodies.slice(i + 1)) {
    const camera = new OrbitCamera(2), initial = systemAt(START_DAYS);
    camera.framePair(a.id, b.id, initial);
    camera.step(8, initial, 2);
    for (const [offset, aspect] of [[0, 2], [100/60, 2], [200/60, 2], [300/60, 0.55], [-700000, 3.9], [2000000, 0.8]]) {
      const states = systemAt(START_DAYS + offset), view = camera.step(1/60, states, aspect);
      samePosition(view.center, scale(add(states[a.id].position, states[b.id].position), 0.5));
      for (const body of [a, b]) {
        const pos = states[body.id].position, r = body.radius * (body.id === "saturn" ? 2.28 : 1);
        for (let k = 0; k < 32; k++) {
          const y = 1 - (k + 0.5) / 16, horizontal = Math.sqrt(1 - y*y);
          const surface = add(pos, scale([horizontal*Math.cos(k*2.4), y, horizontal*Math.sin(k*2.4)], r));
          const p = project(surface, view.matrix, 1, 1);
          assert.ok(p && p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98,
            a.name + " / " + b.name + " clipped at aspect " + aspect);
        }
      }
    }
  }
});

test("pair framing opens broadside, respects manual orbit and zoom, and survives an endpoint exchange", () => {
  const states = systemAt(START_DAYS), camera = new OrbitCamera(2);
  camera.orbit(24, -13);
  camera.zoomBy(0.85);
  camera.step(8, states, 2);
  const saved = { ...camera.goal }, center = camera.center.slice(), distance = camera.distance;
  camera.framePair("earth", "neptune", states);
  camera.step(0, states, 2);
  samePosition(camera.center, center);
  near(camera.distance, distance);
  const view = camera.step(8, states, 2);
  const x = id => project(states[id].position, view.matrix, 1, 1).x;
  assert.ok(Math.abs(x("earth") - x("neptune")) > 0.6);
  camera.orbit(70, 12);
  camera.zoomBy(0.7);
  camera.step(8, states, 2);
  const goal = { ...camera.goal };
  for (const pair of [["neptune", "earth"], ["earth", "earth"], ["moon", "earth"], ["constructor", "mars"]]) {
    camera.framePair(...pair, states);
    assert.deepEqual(camera.goal, goal);
    assert.deepEqual(camera.pair, ["earth", "neptune"]);
  }
  camera.framePair("sun", "mars", states);
  camera.follow("earth", states);
  assert.equal(camera.pair, null);
  camera.frameOrbit("saturn");
  camera.framePair("saturn", "uranus", states);
  assert.equal(camera.framedOrbit, null);
  camera.overview();
  assert.equal(camera.focused, false);
  assert.deepEqual(camera.goal, saved);
  camera.framePair("sun", "mars", states);
  camera.overview(true);
  assert.deepEqual(camera.goal, HOME);
});

test("motion trails use bounded reusable GPU buffers and never upload while only the camera moves", () => {
  const canvas = environment().get("space"), renderer = new Renderer(canvas), gl = canvas.gl;
  renderer.resize(680, 340, 2);
  const camera = new OrbitCamera(2);
  function draw(from, to, day, duration) {
    const states = systemAt(day);
    gl.draws.length = 0;
    renderer.scene(states, day, camera.step(1/60, states, 2), { selected: from, destination: to, trailDays: duration });
    return gl.draws.filter(d => d.tint);
  }
  assert.equal(draw("earth", "mars", START_DAYS, 0).length, 0);
  const allocations = gl.buffers.length, uploads = gl.uploads;
  const [first, firstDots, second, secondDots] = draw("earth", "mars", START_DAYS, 30);
  assert.deepEqual([first.mode, first.count, firstDots.mode, firstDots.count], [gl.LINE_STRIP, TRAIL_STEPS + 1, gl.POINTS, TRAIL_MARKS]);
  assert.equal(first.vertex, firstDots.vertex);
  assert.equal(second.vertex, secondDots.vertex);
  assert.notEqual(first.vertex, second.vertex);
  assert.notDeepEqual(first.tint, second.tint);
  assert.ok([first, firstDots, second, secondDots].every(d => d.depth && d.blend && !d.write));
  assert.equal(gl.buffers.length, allocations + 2);
  assert.equal(gl.uploads, uploads + 2);
  camera.orbit(35, 12);
  draw("earth", "mars", START_DAYS, 30);
  assert.equal(gl.uploads, uploads + 2);
  draw("earth", "venus", START_DAYS, 30);
  assert.equal(gl.uploads, uploads + 3);
  for (const day of [START_DAYS + 1, -10000, START_DAYS]) {
    const draws = draw("earth", "venus", day, 7);
    assert.equal(draws[0].vertex, first.vertex);
    assert.equal(draws[2].vertex, second.vertex);
    samePosition(draws[0].vertex.data.slice(0, 3), systemAt(day).earth.position, 1e-6);
    samePosition(draws[2].vertex.data.slice(-5, -2), systemAt(day - 7).venus.position, 1e-6);
  }
  const solar = draw("sun", "mercury", START_DAYS, 30);
  assert.equal(solar.length, 2);
  assert.deepEqual(solar[0].tint, second.tint);
  assert.equal(draw("earth", "venus", START_DAYS, 0).length, 0);
  assert.equal(gl.buffers.length, allocations + 2);
});
