'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math.js');
const F = require('../js/flight.js');
const V = require('../js/vessels.js');
const G = require('../js/mesh.js');
const {loadPage} = require('./support/page.js');
const {clipFrom} = require('./support/projection.js');

test('boarding joins the actual crossing, including the tide and bob of a later lap', () => {
  const state = F.createFlight(), time = 2 * V.ferryPeriod + 17.5;
  state.time = 38;
  state.worldTime = time;
  const airborne = F.camera(state);
  assert.ok(F.chooseRoute(state, 3));
  assert.deepEqual(F.camera(state), airborne);
  assert.equal(state.time, 17.5);
  assert.equal(state.worldTime, time);
  for (let i = 0; i < 22; i++) F.advance(state, 0.1);
  assert.deepEqual(F.camera(state), V.deckView(state.worldTime));
  assert.notEqual(F.camera(state).eye[1], V.deckView(state.time).eye[1]);
  const before = state.worldTime;
  F.chooseRoute(state, 1);
  assert.equal(state.time, 0);
  F.seek(state, 0.75);
  assert.equal(state.time, 72);
  assert.equal(state.worldTime, before);
  assert.deepEqual(F.camera(state), F.sampleRoute(1,72));
});

test('seeking from the end of a ferry lap and jumping to an event preserve the selected lap and playback state', () => {
  const state = F.createFlight(true);
  state.worldTime = 533;
  F.chooseRoute(state, 3);
  for (const [fraction, expected] of [[1,720],[1,720],[0.5,600],[0,480],[-1,480],[2,720]]) {
    F.seek(state, fraction);
    assert.equal(state.worldTime, expected);
    assert.deepEqual(F.camera(state), V.deckView(expected));
  }
  F.seek(state, NaN);
  assert.equal(state.time, 240);
  assert.ok(!F.jumpToEvent(state));
  F.chooseLookout(state, 'cargo');
  assert.ok(F.jumpToEvent(state));
  assert.equal(state.worldTime, 732);
  assert.equal(state.time, 12);
  assert.equal(state.playing, false);
  assert.deepEqual(F.camera(state).eye, V.deckView(732).eye);
  state.playing = true; state.speed = 2;
  F.seek(state, 1); F.advance(state, 0.1);
  assert.ok(Math.abs(state.time - 0.2) < 1e-9);
  assert.equal(state.worldTime, 960.2);
});

test('the upper deck camera stays inside the rail and the brass handrail is visible below the skyline', () => {
  const [{vertices}] = V.buildFerry(), rails = [];
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    const [x,y,z] = vertices.subarray(i, i+3);
    if (Math.abs(y - 4.91) < 0.065 && Math.abs(z) > 1.26 && Math.abs(vertices[i+9] - 0.77) < 1e-5)
      rails.push([x,y,z]);
  }
  assert.ok(rails.length > 20);
  // Sample each visible edge, including where it crosses the frame between its endpoints.
  const alongRail = [];
  for (const side of [-1,1]) {
    const corners = rails.filter(p => Math.sign(p[2]) === side).sort((a,b) => a[0] - b[0]);
    const first = corners[0], last = corners.at(-1);
    for (let i = 0; i <= 40; i++) alongRail.push(first.map((x,k) => M.mix(x,last[k],i/40)));
  }
  for (const time of [-75, 0, 60, 120, 180, 530]) {
    const ferry = V.ferryPose(time), shot = V.deckView(time);
    const c = Math.cos(ferry.angle), s = Math.sin(ferry.angle);
    const x = shot.eye[0] - ferry.x, z = shot.eye[2] - ferry.z;
    assert.ok(Math.abs(x*c + z*s - 0.55) < 1e-8 && Math.abs(z*c - x*s) < 1e-8);
    assert.ok(Math.abs(shot.eye[1] - ferry.y - 5.46) < 1e-8);
    for (const aspect of [0.48, 16/9]) {
      const clip = clipFrom(shot, aspect);
      assert.ok(alongRail.some(([a,h,b]) => {
        const [cx,cy,,w] = clip([ferry.x+a*c-b*s, ferry.y+h, ferry.z+a*s+b*c]);
        return w > 0.5 && Math.abs(cx) < w && cy/w > -1 && cy/w < -0.18;
      }));
    }
  }
});

test('dragging a playing ferry slider back across the lap boundary keeps the original crossing under the pointer', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const timeline = p.id('timeline');
  const time = () => p.gl.draws.find(d => d.uniforms.uTime).uniforms.uTime[0];
  const seek = value => { timeline.value = value; timeline.emit('input'); p.tick(0); };
  p.routes[3].emit('click'); p.tick();
  assert.ok(!p.id('deck-time').hidden);
  assert.equal(p.id('duration').textContent, '04:00');
  assert.match(timeline.getAttribute('aria-label'), /harbour time/);
  p.key(' '); p.tick();
  timeline.emit('pointerdown', {pointerId:3, button:0});
  seek(1000); assert.equal(time(), 240);
  p.tick(100);
  assert.ok(time() > 240);
  p.win.emit('pointerup', {pointerId:4});
  seek(990); assert.ok(Math.abs(time() - 237.6) < 1e-8);
  timeline.emit('input'); p.tick(0);
  assert.ok(Math.abs(time() - 237.6) < 1e-8);
  p.win.emit('pointercancel', {pointerId:3});
  seek(1000); p.tick(100); seek(250);
  assert.equal(time(), 300);
  p.key('1'); p.tick(0);
  assert.ok(p.id('deck-time').hidden);
  seek(500);
  assert.equal(time(), 300);
});
