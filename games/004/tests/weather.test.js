'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/weather.js');
const F = require('../js/flight.js');

test('every weather preset has independent state, exact endpoints and bounded shader inputs', () => {
  const weather = W.create(), other = W.create();
  for (const id of ['squall', 'mist', 'moonlit']) {
    const before = [...weather.values], target = W.profiles[id];
    assert.equal(W.select(weather, id, true), true);
    assert.deepEqual(weather.values, before);
    for (const invalid of [0, -1, NaN, Infinity]) W.advance(weather, invalid);
    assert.deepEqual(weather.values, before);
    for (let i = 0; i < 20; i++) {
      W.advance(weather, 0.1);
      assert.ok(weather.values.every((v, j) => v >= Math.min(target[j], before[j]) && v <= Math.max(target[j], before[j])));
    }
    assert.equal(weather.from, null);
    assert.deepEqual(weather.values, target);
    assert.notEqual(weather.values, target);
    assert.equal(W.select(weather, id, false), false);
  }
  assert.deepEqual(other, W.create());
  for (const id of ['', 'unknown', '__proto__', 'toString']) assert.equal(W.select(weather, id, true), false);
  assert.deepEqual(weather.values, W.profiles.moonlit);
});

test('weather blends restart from the displayed atmosphere and ignore frame subdivision', () => {
  const a = W.create(), b = W.create();
  for (const state of [a, b]) W.select(state, 'mist', true);
  W.advance(a, 0.75);
  for (let i = 0; i < 6; i++) W.advance(b, 0.125);
  assert.deepEqual(a.values, b.values);
  const between = a.values.slice();
  assert.ok(between[0] > 0 && between[0] < 1);
  W.select(a, 'squall', true);
  assert.deepEqual(a.values, between);
  assert.equal(W.select(a, 'squall', true), false);
  W.advance(a, 0.1);
  assert.ok(a.values[1] > between[1]);
  W.select(a, 'squall', false);
  assert.deepEqual(a.values, W.profiles.squall);
  assert.equal(a.from, null);
  W.select(a, 'moonlit', true);
  W.advance(a, 20000);
  assert.deepEqual(a.values, [0, 0, 0]);
});

test('pausing mid-squall freezes the blend and rain clock, and resuming completes the same transition', () => {
  const state = F.createFlight();
  W.select(state.weather, 'squall', true);
  F.advance(state, 0.1);
  const time = state.worldTime, before = state.weather.values.slice();
  state.playing = false;
  for (let i = 0; i < 25; i++) F.advance(state, 0.1);
  assert.deepEqual(state.weather.values, before);
  assert.equal(state.worldTime, time);
  state.playing = true;
  for (let i = 0; i < 20; i++) F.advance(state, 0.1);
  assert.deepEqual(state.weather.values, W.profiles.squall);
});
