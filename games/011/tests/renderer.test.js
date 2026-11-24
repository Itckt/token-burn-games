"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TestGL } = require("./support/webgl");
const { makeRenderer, resolution } = require("../js/renderer");
const s = require("../js/storm");
const m = require("../js/math");
const field = require("../js/field");
const cycle = require("../js/lifecycle");

function scene(failure) {
  const gl = new TestGL(failure);
  const canvas = { width: 0, height: 0, getContext: name => name === "webgl" ? gl : null };
  const renderer = makeRenderer(canvas);
  renderer.resize(900, 420, 1.25);
  return { gl, renderer, canvas, state: s.makeState(), view: m.cameraFrame(m.makeCamera(), 900 / 420) };
}

test("resolution honours DPR with nonzero integer dimensions and a bounded fullscreen workload", () => {
  assert.deepEqual(resolution(900, 420, 1), [900, 420]);
  assert.deepEqual(resolution(320, 200, 3), [560, 350]);
  assert.deepEqual(resolution(0, 0, 1), [1, 1]);
  const [w, h] = resolution(3840, 2160, 2);
  assert.ok(w * h < 1503000); assert.ok(Math.abs(w / h - 16 / 9) < 0.003);
});

test("all four render passes bind complete shader inputs, textures and in-bounds geometry", () => {
  const { gl, renderer, canvas, state, view } = scene();
  renderer.render(state, view);
  assert.deepEqual(gl.viewportSize, [0, 0, canvas.width, canvas.height]);
  assert.deepEqual(gl.draws.map(d => d.name), ["sea", "rain", "deck", "cloud"]);
  assert.deepEqual(gl.draws.map(d => d.blended), [false, true, true, true]);
  assert.equal(gl.draws[1].mode, gl.LINES);
  assert.equal(gl.draws[1].count, s.rainCount(state.strength) * 2);
  assert.equal(gl.draws[3].count, s.cloudCount(state.strength) * 6);
  assert.equal(gl.draws[3].mode, gl.TRIANGLES);
  assert.equal(gl.draws[0].uniforms.uGrid, 1);
  renderer.dispose();
  assert.equal(gl.active.size, 0);
  assert.ok(gl.resources.every(r => r.deleted));
});

test("all ten signals produce their exact active populations while reusing allocated GPU storage", () => {
  const { gl, renderer, state, view } = scene();
  const allocations = gl.resources.length;
  for (let level = 1; level <= 10; level++) {
    state.strength = s.normalized(level);
    s.advance(state, 0.02);
    state.strength = s.normalized(level);
    renderer.render(state, view);
    assert.equal(gl.draws.at(-3).count, s.rainCount(state.strength) * 2);
    assert.equal(gl.draws.at(-1).count, s.cloudCount(state.strength) * 6);
  }
  assert.equal(gl.resources.length, allocations);
  renderer.dispose();
});

test("older storm states without section settings still draw an uncut optical scene", () => {
  const { gl, renderer, state, view } = scene();
  delete state.section;
  renderer.render(state, view);
  assert.deepEqual(gl.draws.map(d => d.name), ["sea", "rain", "deck", "cloud"]);
  assert.deepEqual(gl.draws[0].uniforms.uTransect, [0, 0, 0]);
  for (const draw of gl.draws.slice(1)) assert.deepEqual(draw.uniforms.uCut, [0, 0]);
  renderer.dispose();
});

test("cloud indices sort quads back-to-front, including camera moves while the storm is paused", () => {
  const { gl, renderer, state } = scene();
  const camera = m.makeCamera();
  for (const yaw of [0.38, 2.2, -1.1]) {
    camera.yaw = yaw;
    const view = m.cameraFrame(camera, 2.1);
    renderer.render(state, view);
    const draw = gl.draws.at(-1), positions = new Float32Array(draw.attrs.aCenter.buffer.bytes.buffer);
    const indices = new Uint16Array(draw.indexBuffer.bytes.buffer, 0, draw.count);
    let previous = -Infinity;
    for (let i = 0; i < indices.length; i += 6) {
      const base = indices[i] * 5;
      const depth = m.dot(positions.subarray(base, base + 3), view.back);
      assert.ok(depth >= previous - 0.000001);
      previous = depth;
      for (let corner = 1; corner < 4; corner++) {
        assert.deepEqual(positions.subarray(base, base + 5), positions.subarray(base + corner * 5, base + (corner + 1) * 5));
      }
    }
  }
  renderer.dispose();
});

test("layer switches remove the corresponding passes and leave the other layers live", () => {
  const { gl, renderer, state, view } = scene();
  for (const clouds of [false, true]) for (const rain of [false, true]) for (const grid of [false, true]) {
    state.layers = { clouds, rain, grid };
    gl.draws.length = 0; renderer.render(state, view);
    assert.deepEqual(gl.draws.map(d => d.name), ["sea", ...(rain ? ["rain"] : []), ...(clouds ? ["deck", "cloud"] : [])]);
    assert.equal(gl.draws[0].uniforms.uGrid, Number(grid));
  }
  const uploads = gl.uploads;
  renderer.render(state, view); assert.equal(gl.uploads, uploads);
  renderer.dispose();
  const count = gl.draws.length; renderer.render(state, view); assert.equal(gl.draws.length, count);
  renderer.dispose();
});

test("failed shader compilation and linking clean up partially allocated graphics objects", () => {
  for (const failure of ["compile", "link"]) {
    const gl = new TestGL(failure);
    assert.throws(() => makeRenderer({ getContext: () => gl }), new RegExp("test " + failure + " error"));
    assert.ok(gl.resources.length >= 2 && gl.resources.every(r => r.deleted));
  }
});

test("a missing WebGL context produces a clear error and the legacy context name is supported", () => {
  const requests = [];
  assert.throws(() => makeRenderer({ getContext: name => { requests.push(name); return null; } }), /WebGL is unavailable/);
  assert.deepEqual(requests, ["webgl", "experimental-webgl"]);
  const gl = new TestGL();
  makeRenderer({ getContext: name => name === "experimental-webgl" ? gl : null }).dispose();
  assert.ok(gl.resources.every(r => r.deleted));
});

test("radar draws the shared echo field in one pass and reuses its texture across mode and signal changes", () => {
  const { gl, renderer, state, view } = scene();
  const initial = gl.resources.length;
  state.imagery = "radar";
  for (const signal of [1, 5, 10]) {
    Object.assign(state, { signal, strength: s.normalized(signal), time: signal + 9.2, phase: signal / 2 });
    state.layers.grid = signal === 1;
    gl.draws.length = 0;
    renderer.render(state, view);
    assert.deepEqual(gl.draws.map(d => d.name), ["radar"]);
    const { uniforms, texture, blended, count } = gl.draws[0];
    assert.equal(count, 6); assert.equal(blended, false);
    assert.equal(uniforms.uGrid, Number(state.layers.grid));
    assert.equal(uniforms.uPhase, state.phase); assert.equal(uniforms.uStrength, state.strength);
    assert.equal(uniforms.uScale, s.radialScale(state.strength));
    assert.equal(uniforms.uRain, s.readings(state.strength, state.time).rain);
    assert.equal(uniforms.uSweep, state.time % 8 * m.TAU / 8);
    assert.equal(texture.parameters.get(gl.TEXTURE_MIN_FILTER), gl.LINEAR);
    assert.equal(texture.parameters.get(gl.TEXTURE_WRAP_T), gl.CLAMP_TO_EDGE);
    assert.deepEqual(texture.pixels, field.echoMap().data);
    assert.equal(gl.resources.length, initial + 1);
    assert.equal(gl.uploads, 0);
  }
  state.imagery = "cloud"; renderer.render(state, view);
  const particleUploads = gl.uploads;
  state.imagery = "radar"; renderer.render(state, view);
  assert.equal(gl.resources.length, initial + 1); assert.equal(gl.uploads, particleUploads);
  renderer.dispose(); assert.ok(gl.resources.every(r => r.deleted));
});

test("rewinding at peak strength re-sorts clouds and a phase-only edit updates frozen rain and cloud buffers", () => {
  const { gl, renderer, state, view } = scene();
  state.playing = false;
  Object.assign(state, cycle.at(41)); renderer.render(state, view);
  Object.assign(state, cycle.at(35)); renderer.render(state, view);
  function checkDepthOrder() {
    const draw = gl.draws.at(-1), centers = new Float32Array(draw.attrs.aCenter.buffer.bytes.buffer);
    const indices = new Uint16Array(draw.indexBuffer.bytes.buffer, 0, draw.count);
    let previous = -Infinity;
    for (let i = 0; i < indices.length; i += 6) {
      const o = indices[i] * 5, depth = m.dot(centers.subarray(o, o + 3), view.back);
      assert.ok(depth >= previous - 1e-6);
      previous = depth;
    }
  }
  checkDepthOrder();
  const rain = gl.draws.at(-3).attrs.aPosition.buffer;
  const previousRain = rain.bytes.slice(0, 24);
  state.phase += 0.5; renderer.render(state, view);
  assert.notDeepEqual(rain.bytes.subarray(0, 24), previousRain);
  checkDepthOrder();
  const uploads = gl.uploads;
  renderer.render(state, view); assert.equal(gl.uploads, uploads);
  renderer.dispose();
});
