'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lesson.js');
const G = require('../js/meshes.js');

test('five immutable captioned chapters cover the 45-second timeline exactly', () => {
  assert.equal(L.steps.length, 5);
  assert.ok(Object.isFrozen(L.steps));
  let end = 0;
  for (const [index, step] of L.steps.entries()) {
    assert.ok(Object.isFrozen(step));
    assert.ok(step.name && step.title && step.icon && step.caption);
    assert.equal(step.start, end);
    assert.ok(step.duration > 0);
    const start = L.at(step.start);
    assert.equal(start.index, index);
    assert.equal(start.local, 0);
    assert.equal(start.fraction, 0);
    end += step.duration;
    assert.equal(L.at(end - 1e-7).index, index);
  }
  assert.equal(end, 45);
  assert.equal(L.duration, end);
  assert.equal(L.at(end).fraction, 1);
});

test('timeline clamps out-of-range and non-finite input', () => {
  for (const value of [-4, NaN, Infinity, undefined]) assert.equal(L.at(value).time, 0);
  assert.equal(L.at(100).time, L.duration);
  assert.equal(L.select(L.clock(), -7).time, 0);
  assert.equal(L.select(L.clock(), 300).time, L.steps.at(-1).start);
  assert.equal(L.select(L.clock(), 2.8).time, L.steps[2].start);
  assert.equal(L.formatTime(65.99), '1:05');
  assert.equal(L.formatTime(-0.1), '0:00');
});

test('play, pause, seek, finish and replay have deterministic clock semantics', () => {
  const paused = Object.freeze(L.clock());
  assert.deepEqual(paused, {time: 0, playing: false});
  assert.equal(L.tick(paused, 8), paused);
  const running = L.toggle(paused);
  for (const dt of [-1, 0, NaN, Infinity]) assert.equal(L.tick(running, dt), running);
  assert.deepEqual(L.tick(running, 1.125), {time: 1.125, playing: true});
  assert.deepEqual(L.seek(running, 30), {time: 30, playing: true});
  assert.deepEqual(L.select(running, 2), {time: 17, playing: true});
  assert.deepEqual(L.select(paused, 2), {time: 17, playing: false});
  assert.deepEqual(L.toggle(L.seek(running, 30)), {time: 30, playing: false});
  const ended = L.tick(running, 100);
  assert.deepEqual(ended, {time: 45, playing: false});
  assert.deepEqual(L.seek(running, 45), ended);
  assert.deepEqual(L.toggle(ended), running);
});

test('scene sampling is reversible and independent of frame rate', () => {
  const snapshots = [2, 10, 20, 30, 42].map(t => L.scene(t));
  for (const fps of [24, 60, 120]) {
    let state = L.clock(25, true);
    for (let i=0; i<fps*4; i++) state = L.tick(state, 1/fps);
    assert.ok(Math.abs(L.scene(state.time).water - L.scene(29).water) < 1e-10);
  }
  [42, 30, 20, 10, 2].forEach((t, i) => assert.deepEqual(L.scene(t), snapshots[4-i]));
});

test('the opening camera moves and the dry block lifts and seats back against the taper', () => {
  assert.ok(L.scene(7).yaw > L.scene(0).yaw);
  assert.equal(L.scene(8).lift, 0);
  assert.ok(L.scene(11).lift > 0.34);
  assert.ok(Math.abs(L.scene(16.9999).lift) < 1e-9);
  assert.equal(L.scene(18).lift, 0);
});

test('the bump moves the cup and cake together while the floor retains clearance', () => {
  let maximum = 0, positive = false, negative = false;
  for (let t=17; t<25; t+=0.02) {
    const s = L.scene(t);
    maximum = Math.max(maximum, s.baseFlex);
    positive ||= s.bump > 0.5;
    negative ||= s.bump < -0.5;
    assert.ok(G.FLOOR + s.baseFlex < G.BLOCK_BOTTOM);
    assert.equal(s.lift, 0);
    assert.equal(s.water, 0);
  }
  assert.ok(positive && negative && maximum > 0.09);
});

test('water fills the pocket first, covers the cake, and stays below the lip', () => {
  let previous = 0, seeped = false, covered = false;
  for (let t=0; t<=L.duration; t+=1/32) {
    const s = L.scene(t);
    assert.ok(Object.values(s).every(Number.isFinite));
    assert.ok(s.water >= previous);
    previous = s.water;
    assert.ok(s.surfaceY < G.HEIGHT);
    for (const value of [s.steam, s.stream, s.seep, s.soft, s.fraction]) assert.ok(value>=0 && value<=1);
    if (t < 25) assert.equal(s.water+s.stream+s.steam, 0);
    if (s.seep > 0) {
      assert.ok(s.stream > 0 && s.surfaceY < G.BLOCK_BOTTOM);
      seeped = true;
    }
    if (s.surfaceY > G.BLOCK_TOP) {
      assert.ok(seeped);
      covered = true;
    }
    if (t < 36) assert.equal(s.soft, 0);
  }
  assert.ok(covered);
  const end = L.scene(L.duration);
  assert.equal(end.stream, 0);
  assert.equal(end.seep, 0);
  assert.equal(end.soft, 1);
  assert.equal(end.steam, 1);
});

test('material effects meet continuously across chapter boundaries', () => {
  for (const {start} of L.steps.slice(1)) {
    const a = L.scene(start - 1e-6), b = L.scene(start);
    for (const key of ['lift','bump','baseFlex','water','stream','seep','steam','soft']) {
      assert.ok(Math.abs(a[key]-b[key]) < 0.00001, key + ' at ' + start);
    }
  }
});

test('manual orbit and zoom stay inside the camera limits without mutating the preset', () => {
  const original = Object.freeze(L.camera(0, 0.31, 1)), lim = L.limits;
  assert.equal(L.orbit(original, 100, 10000).pitch, lim.maxPitch);
  assert.equal(L.orbit(original, 0, -10000).pitch, lim.minPitch);
  assert.ok(L.orbit(original, 100, 10).yaw < 0);
  assert.equal(L.zoomBy(original, 100).zoom, lim.maxZoom);
  assert.equal(L.zoomBy(original, 0.001).zoom, lim.minZoom);
  assert.deepEqual(original, {yaw: 0, pitch: 0.31, zoom: 1});
  const far = Math.PI*12 - 0.1, returnTo = L.nearestAngle(far, 0.2);
  assert.ok(Math.abs(returnTo-far-0.3)<1e-10);
  assert.ok(Math.abs(Math.sin(returnTo)-Math.sin(0.2))<1e-10);
});

test('study speeds scale only the running lesson clock and stop exactly at the end', () => {
  for (const rate of L.rates) {
    assert.equal(L.tick(L.clock(17,true),2,rate).time,17+2*rate);
    assert.deepEqual(L.tick(L.clock(44.99,true),10,rate),L.clock(45));
    const held=L.clock(24.95);
    assert.equal(L.tick(held,10000,rate,true),held);
  }
  for (const rate of [0,-1,NaN,Infinity,1.1]) assert.equal(L.tick(L.clock(3,true),2,rate).time,5);
  assert.deepEqual(L.tick(L.clock(1,true),Number.MAX_VALUE,2),L.clock(45));
});

test('repeating keeps overshoot in the chosen chapter at all speeds, including its exact boundaries', () => {
  for (const [index,step] of L.steps.entries()) {
    const end=step.start+step.duration;
    for (const rate of L.rates) {
      const start=L.clock(step.start,true);
      assert.deepEqual(L.tick(start,step.duration/rate,rate,true),start);
      assert.deepEqual(L.tick(L.clock(end-0.5,true),1/rate,rate,true),L.clock(step.start+0.5,true));
      const many=L.tick(start,(step.duration*19+1.25)/rate,rate,true);
      assert.deepEqual(many,L.clock(step.start+1.25,true));
      assert.equal(L.at(L.tick(start,Number.MAX_VALUE,rate,true).time).index,index);
      for (const dt of [0,-1,NaN,Infinity]) assert.equal(L.tick(start,dt,rate,true),start);
    }
  }
  assert.deepEqual(L.toggle(L.clock(45),true),L.clock(36,true));
  assert.deepEqual(L.toggle(L.clock(45),false),L.clock(0,true));
});

test('chapter repetition gives the same pose after many small frames or one long frame', () => {
  for (const rate of L.rates) {
    const start=L.clock(24.8125,true), elapsed=37.5;
    const expected=L.tick(start,elapsed,rate,true);
    for (const fps of [24,60,120]) {
      let actual=start;
      for (let i=0; i<elapsed*fps; i++) actual=L.tick(actual,1/fps,rate,true);
      assert.ok(Math.abs(actual.time-expected.time)<1e-9);
      assert.equal(L.at(actual.time).index,2);
      assert.ok(Math.abs(L.scene(actual.time).baseFlex-L.scene(expected.time).baseFlex)<1e-9);
    }
  }
});
