'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {lighting} = require('../js/atmosphere.js');
const F = require('../js/flight.js');
const W = require('../js/weather.js');
const {loadPage} = require('./support/page.js');

test('interrupting blue hour with dawn blends from the displayed sky and keeps all three light weights physical', () => {
  const sky = lighting.create(), other = lighting.create();
  assert.deepEqual(sky.values, [0, 0]);
  lighting.select(sky, 'blue', true);
  lighting.advance(sky, 1.5);
  assert.deepEqual(sky.values, [0.5, 0]);
  lighting.select(sky, 'dawn', true);
  assert.deepEqual(sky.values, [0.5, 0]);
  for (const dt of [-1, 0, NaN, Infinity]) lighting.advance(sky, dt);
  assert.deepEqual(sky.values, [0.5, 0]);
  let previous = sky.values;
  for (let i = 0; i < 30; i++) {
    lighting.advance(sky, 0.1);
    const [blue, dawn] = sky.values;
    assert.ok(blue <= previous[0] && dawn >= previous[1]);
    assert.ok(blue >= 0 && dawn >= 0 && blue + dawn <= 1);
    previous = sky.values;
  }
  assert.deepEqual(sky.values, [0, 1]);
  assert.equal(sky.from, null);
  assert.deepEqual(other.values, [0, 0]);
  for (const id of ['__proto__', 'toString', '', 'midday']) assert.equal(lighting.select(sky, id, true), false);
  assert.deepEqual(sky.values, [0, 1]);
});

test('lighting and weather have independent transitions that hold on pause and run at the same wall-clock pace at every flight speed', () => {
  for (const speed of F.speeds) {
    const state = F.createFlight();
    state.speed = speed;
    lighting.select(state.lighting, 'dawn', true);
    W.select(state.weather, 'squall', true);
    for (let i = 0; i < 10; i++) F.advance(state, 0.1);
    const light = state.lighting.values.slice(), weather = state.weather.values.slice(), time = state.worldTime;
    assert.ok(Math.abs(time - speed) < 1e-9);
    assert.ok(Math.abs(light[1] - 7/27) < 1e-9);
    assert.ok(Math.abs(weather[1] - 0.5) < 1e-9);
    state.playing = false;
    F.seek(state, 0.83);
    F.advance(state, 1);
    assert.equal(state.worldTime, time);
    assert.deepEqual(state.lighting.values, light);
    assert.deepEqual(state.weather.values, weather);
    lighting.select(state.lighting, 'blue', false);
    assert.equal(state.lighting.from, null);
    assert.deepEqual(state.lighting.values, [1, 0]);
    assert.deepEqual(state.weather.values, weather);
  }
});

test('the light menu and shortcut reach both scene passes in all nine weather and light combinations without reallocating', () => {
  const p = loadPage({reduced:true}), light = p.id('lighting'), weather = p.id('weather');
  p.ready(); p.tick();
  const uploads = () => [...p.gl.buffers, ...p.gl.textures].map(b => b.uploads);
  const before = uploads(), programs = p.gl.programs.length, targets = p.gl.framebuffers.length;
  assert.equal(light.value, 'midnight');
  p.key('T'); p.tick();
  assert.equal(light.value, 'blue');
  p.key('t', {target:light}); p.key('t', {repeat:true});
  assert.equal(p.frames.size, 0);
  for (const sky of ['dawn', 'midnight', 'blue']) {
    light.value = sky; light.emit('change');
    for (const forecast of ['mist', 'squall', 'moonlit']) {
      weather.value = forecast; weather.emit('change'); p.tick();
      const scenery = p.gl.draws.filter(d => d.uniforms.uMirror);
      assert.ok(scenery.some(d => d.uniforms.uMirror[0] === -1) && scenery.some(d => d.uniforms.uMirror[0] === 1));
      for (const d of scenery) {
        assert.deepEqual(d.uniforms.uTwilight, lighting.profiles[sky]);
        assert.deepEqual(d.uniforms.uWeather, W.profiles[forecast]);
      }
      assert.equal(p.frames.size, 0);
    }
  }
  assert.deepEqual(uploads(), before);
  assert.equal(p.gl.programs.length, programs);
  assert.equal(p.gl.framebuffers.length, targets);
});
