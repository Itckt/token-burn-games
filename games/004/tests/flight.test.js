'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/flight.js');
const M = require('../js/math.js');
const C = require('../js/city.js');

const distance = (a,b) => Math.hypot(...M.subtract(a,b));
const close = (a,b,eps=1e-7) => assert.ok(Math.abs(a-b) < eps, `${a} vs ${b}`);

test('each camera path stays above navigable water and flies smoothly through its last frame', () => {
  for (const [index, route] of F.routes.entries()) {
    let previous = F.sampleRoute(index, -0.25);
    for (let time = 0; time <= route.duration; time += 0.25) {
      const shot = F.sampleRoute(index, time);
      assert.ok(shot.eye[1] > 4 && shot.eye[2] > C.shoreZ(shot.eye[0]) + 8);
      assert.ok(shot.aim[2] < shot.eye[2] - 35);
      assert.ok(shot.fov > 35 && shot.fov < 75);
      assert.ok(distance(shot.eye, previous.eye) / 0.25 < 4, 'camera speed');
      const dir = M.normalize(M.subtract(shot.aim, shot.eye));
      const lastDir = M.normalize(M.subtract(previous.aim, previous.eye));
      assert.ok(M.dot(dir, lastDir) > 0.9999);
      previous = shot;
    }
    const start = F.sampleRoute(index, 0), end = F.sampleRoute(index, route.duration);
    if (route.onDeck) {
      assert.deepEqual([end.eye[0], end.eye[2], end.aim], [start.eye[0], start.eye[2], start.aim]);
      close(end.eye[1] - start.eye[1], C.ferryPose(route.duration).y - C.ferryPose(0).y);
    } else assert.deepEqual(end, start);
  }
});

test('route and harbour clocks follow playback speed and freeze together when paused', () => {
  const state = F.createFlight();
  assert.equal(state.playing, true);
  F.cycleSpeed(state);
  assert.equal(state.speed, 2);
  for (let frame = 0; frame < 60; frame++) F.advance(state, 1/60);
  close(state.time, 2);
  close(state.worldTime, 2);
  state.playing = false;
  for (let frame = 0; frame < 10; frame++) F.advance(state, 0.1);
  close(state.time, 2);
  close(state.worldTime, 2);
  F.cycleSpeed(state);
  assert.equal(state.speed, 0.5);
  F.cycleSpeed(state);
  assert.equal(state.speed, 1);
});

test('playback wraps seamlessly, clamps long frame gaps and discards invalid deltas', () => {
  const state = F.createFlight();
  state.time = F.routes[0].duration - 0.02;
  F.advance(state, 15);
  close(state.time, 0.1);
  close(state.worldTime, 0.12);
  for (const dt of [NaN, Infinity, -1]) F.advance(state, dt);
  close(state.time, 0.1);
  close(state.worldTime, 0.12);
});

test('look is bounded, damped and independent of frame subdivision', () => {
  const a = F.createFlight(), b = F.createFlight();
  a.playing = b.playing = false;
  for (const state of [a,b]) F.look(state, 5, -8);
  assert.ok(a.targetYaw < 1 && a.targetPitch > -0.5);
  F.advance(a, 0.1);
  for (let i = 0; i < 6; i++) F.advance(b, 1/60);
  close(a.yaw, b.yaw);
  close(a.pitch, b.pitch);
  assert.ok(a.yaw > 0 && a.yaw < a.targetYaw && a.pitch < 0);
  const neutral = F.sampleRoute(0, 0), adjusted = F.camera(a);
  assert.deepEqual(adjusted.eye, neutral.eye);
  close(distance(neutral.eye, neutral.aim), distance(adjusted.eye, adjusted.aim));
  assert.ok(adjusted.aim[0] > neutral.aim[0] && adjusted.aim[1] < neutral.aim[1]);
});

test('switching midway through a blend starts at the displayed view and lands on the new route', () => {
  const state = F.createFlight();
  F.look(state, 0.2, -0.12);
  F.advance(state, 0.1);
  const original = F.camera(state);
  for (const id of [-1, F.routes.length, 1.5, NaN, 0]) assert.equal(F.chooseRoute(state, id), false);
  assert.equal(F.chooseRoute(state, 1), true);
  assert.deepEqual(F.camera(state), original);
  for (let i = 0; i < 6; i++) F.advance(state, 0.1);
  const midflight = F.camera(state);
  assert.notDeepEqual(midflight.eye, original.eye);
  F.chooseRoute(state, 2);
  assert.deepEqual(F.camera(state), midflight);
  assert.equal(state.time, 0);
  assert.ok(state.worldTime > 0.6);
  for (let i = 0; i < 20; i++) F.advance(state, 0.1);
  assert.equal(state.transition, null);
  assert.deepEqual(F.camera(state), F.sampleRoute(2, state.time));
});

test('timeline scrubbing selects a camera position without advancing the boat simulation', () => {
  const state = F.createFlight();
  state.playing = false;
  F.chooseRoute(state, 1);
  F.seek(state, 0.5);
  assert.equal(state.transition, null);
  assert.equal(state.time, 48);
  assert.deepEqual(F.camera(state), F.sampleRoute(1,48));
  F.seek(state, NaN);
  assert.equal(state.time, 48);
  F.seek(state, 1.1);
  assert.equal(state.time, 96);
  F.seek(state, -0.01);
  assert.equal(state.time, 0);
  assert.equal(state.worldTime, 0);
});

test('reduced motion begins paused and changes the view immediately', () => {
  const state = F.createFlight(true);
  assert.equal(state.playing, false);
  F.chooseRoute(state, 2);
  assert.equal(state.transition, null);
  assert.deepEqual(F.camera(state), F.sampleRoute(2, 0));
  F.look(state, 0.25, 0.14);
  F.advance(state, 0);
  assert.equal(state.yaw, 0.25);
  assert.equal(state.pitch, 0.14);
  assert.equal(state.time, 0);
});

test('render resolution respects device density, aspect, adaptive scaling and the pixel budget', () => {
  assert.deepEqual(F.renderSize(0, 0, 1), [1,1]);
  assert.deepEqual(F.renderSize(600, 400, 3), [900,600]);
  assert.deepEqual(F.renderSize(600, 400, 1, 0.6), [360,240]);
  for (const [w,h] of [[3840,2160],[1080,2400],[7680,4320]]) {
    const [rw,rh] = F.renderSize(w,h,2);
    assert.ok(rw * rh < 1902000);
    close(rw/rh, w/h, 0.003);
  }
});

test('the clock displays whole minutes and seconds at both route endpoints', () => {
  assert.equal(F.formatTime(0), '00:00');
  assert.equal(F.formatTime(59.99), '00:59');
  assert.equal(F.formatTime(60), '01:00');
  assert.equal(F.formatTime(150), '02:30');
});

test('each lookout tracks its subject from every route, including after a seek or a speed change', () => {
  const Q = require('../js/quay.js');
  for (let route = 0; route < F.routes.length; route++) {
    const state = F.createFlight(true);
    state.worldTime = 19.34;
    F.chooseRoute(state, route);
    for (const subject of ['wheel', 'tram', 'junk']) {
      F.chooseLookout(state, subject);
      for (const phase of [0, 0.37, 0.98, 1]) {
        F.seek(state, phase);
        const shot = F.camera(state), pose = subject === 'tram' ? Q.tramPose(state.worldTime) : C.junkPose(state.worldTime);
        const point = subject === 'wheel' ? [Q.wheel.x, Q.wheel.y, Q.wheel.z] :
          [pose.x, pose.y + (subject === 'tram' ? 2.1 : 4.1), pose.z];
        const clock = F.routes[route].onDeck ? state.worldTime : state.time;
        assert.deepEqual(shot.eye, F.sampleRoute(route, clock).eye);
        assert.deepEqual(shot.aim, point);
        assert.ok(shot.fov >= 29 && shot.fov <= 65);
      }
      const before = state.worldTime;
      state.playing = true; state.speed = 2;
      F.advance(state, 0.1);
      close(state.worldTime, before + 0.2);
      assert.deepEqual(F.camera(state).aim, F.lookoutPoint(subject, state.worldTime));
    }
    assert.equal(F.chooseLookout(state, 'route'), true);
    assert.deepEqual(F.camera(state), F.sampleRoute(route, F.routes[route].onDeck ? state.worldTime : state.time));
    for (const invalid of ['route', '', null, '__proto__']) assert.equal(F.chooseLookout(state, invalid), false);
  }
});

test('switching subjects during a turn starts at the displayed shot and leaves both clocks intact', () => {
  const state = F.createFlight();
  state.time = 57; state.worldTime = 131;
  F.look(state, -0.25, 0.22); F.advance(state, 0.1);
  for (const subject of ['tram', 'junk', 'wheel', 'route']) {
    const from = F.camera(state), {time, worldTime} = state;
    F.chooseLookout(state, subject);
    assert.deepEqual(F.camera(state), from);
    assert.equal(state.time, time);
    assert.equal(state.worldTime, worldTime);
    F.advance(state, 0.1); F.advance(state, 0.1);
  }
  for (let i = 0; i < 20; i++) F.advance(state, 0.1);
  assert.deepEqual(F.camera(state), F.sampleRoute(state.route, state.time));
});

test('a moving junk passing under the rooftop camera keeps a continuous sightline throughout the turn', () => {
  const state = F.createFlight();
  state.route = 2; state.time = 60; state.worldTime = 164;
  F.chooseLookout(state, 'junk');
  let previous;
  for (let frame = 0; frame < 80; frame++) {
    const shot = F.camera(state), direction = M.normalize(M.subtract(shot.aim, shot.eye));
    if (previous) assert.ok(M.dot(previous, direction) > 0.995, 'no reversal across the bearing seam');
    previous = direction;
    F.advance(state, 1/30);
  }
  assert.equal(state.transition, null);
  assert.deepEqual(F.camera(state).aim, F.lookoutPoint('junk', state.worldTime));
});

test('tracking a boat through the nadir keeps the roof route north-up and small look inputs stay small', () => {
  const state = F.createFlight(true);
  F.chooseRoute(state, 2); F.chooseLookout(state, 'junk');
  let previous;
  for (let time = 66; time < 70; time += 1/60) {
    state.time = time; state.worldTime = time + 68;
    const shot = F.camera(state), basis = M.cameraBasis(shot.eye, shot.aim, shot.up);
    if (previous) assert.ok(M.dot(previous.right, basis.right) > 0.9999, 'continuous camera roll');
    assert.ok(basis.up[2] < -0.99);
    previous = basis;
  }
  F.look(state, 0.001, -0.001); F.advance(state, 0);
  const steered = F.camera(state), basis = M.cameraBasis(steered.eye, steered.aim, steered.up);
  assert.ok(M.dot(previous.forward, basis.forward) > 0.99999);
  assert.ok(M.dot(previous.right, basis.right) > 0.99999);
});

test('event jumps pick the next distinct arrival, formation or tide turn on either side of a cycle boundary', () => {
  const state = F.createFlight(true);
  for (const [subject, step, first] of [['tram',39,10], ['lanterns',16,0], ['landing',90,45]]) {
    F.chooseLookout(state, subject);
    for (const lap of [-31, -1, 0, 1, 61740]) {
      const boundary = first + lap * step;
      for (const [offset, expected] of [[-0.0001,boundary],[0,boundary+step],[0.0001,boundary+step]]) {
        state.worldTime = boundary + offset;
        assert.equal(F.nextEvent(state).time, expected);
        assert.equal(state.worldTime, boundary + offset);
      }
    }
  }
  for (const subject of ['route', 'wheel', 'junk']) {
    F.chooseLookout(state, subject);
    assert.equal(F.nextEvent(state), null);
  }
});
