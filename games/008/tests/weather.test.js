"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../js/weather");
const G = require("../js/meshes");

test("weather reaches its target in visible seconds and gives equal blends at different frame rates", () => {
  const states = [20, 60, 120].map(hz => {
    const weather = W.create();
    W.select(weather, "squall");
    for (let i = 0; i < hz; i++) W.advance(weather, 1 / hz);
    return weather;
  });
  const reference = states[0].weights.slice();
  for (const state of states) {
    state.weights.forEach((v, i) => assert.ok(Math.abs(v - reference[i]) < 1e-12 && v > 0 && v < 1));
    W.advance(state, W.FADE_SECONDS);
    assert.deepEqual(state.weights, [0.56, 1]);
    W.advance(state, 3600);
    assert.deepEqual(state.weights, [0.56, 1]);
    W.select(state, "clear"); W.advance(state, 3);
    assert.deepEqual(state.weights, [0, 0]);
  }
});

test("a weather change can be reversed mid-fade without a jump, shared state or a reset on reselect", () => {
  const a = W.create(), b = W.create();
  W.select(a, "squall");
  W.advance(a, W.FADE_SECONDS / 2);
  assert.deepEqual(a.weights, [0.28, 0.5]);
  W.select(a, "mist");
  W.advance(a, 0); W.advance(a, -4);
  assert.deepEqual(a.weights, [0.28, 0.5]);
  W.advance(a, W.FADE_SECONDS / 2);
  assert.ok(a.weights[0] > 0.28 && a.weights[1] < 0.5);
  W.select(a, "mist"); W.advance(a, W.FADE_SECONDS / 2);
  assert.deepEqual(a.weights, [1, 0]);
  assert.deepEqual(b.weights, [0, 0]);
  for (const name of ["unknown", "constructor", "__proto__"]) assert.throws(() => W.select(b, name), RangeError);
  assert.equal(b.name, "clear");
});

test("rain billboards replay a bounded volume with two nondegenerate triangles for each seed position", () => {
  const mesh = G.rainField(67);
  assert.equal(mesh.length, 67 * 30);
  assert.deepEqual(mesh, G.rainField(67));
  assert.equal(G.rainField(0).length, 0);
  const seeds = new Set();
  for (let start = 0; start < mesh.length; start += 30) {
    const point = Array.from(mesh.slice(start, start + 3));
    seeds.add(point.join("|"));
    assert.ok(point.every(v => v >= 0 && v < 1));
    for (let triangle = 0; triangle < 2; triangle++) {
      const corners = [];
      for (let v = 0; v < 3; v++) {
        const i = start + 15 * triangle + v * 5;
        assert.deepEqual(Array.from(mesh.slice(i, i + 3)), point);
        corners.push(mesh.slice(i + 3, i + 5));
      }
      const [a, b, c] = corners;
      const area = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      assert.equal(area, 1);
    }
  }
  assert.equal(seeds.size, 67);
});
