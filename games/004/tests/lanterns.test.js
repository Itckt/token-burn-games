'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lanterns.js');
const F = require('../js/flight.js');
const T = require('../js/tide.js');
const M = require('../js/math.js');
const {projectFrom} = require('./support/projection.js');

test('every formation holds, eases into the next and joins the first without a jump', () => {
  const leg = L.hold + L.travel;
  for (let i = 0; i < L.names.length; i++) {
    const next = (i + 1) % L.names.length, t = i * leg;
    const anchor = [0, 0, 0]; anchor[i] = 1;
    for (const delta of [0, L.hold / 2, L.hold]) {
      for (const lap of [-27, 0, 15]) assert.deepEqual(L.cue(t + delta + lap * L.period), {weights:anchor, label:L.names[i]});
    }
    let previous = 0;
    for (let j = 1; j < 50; j++) {
      const {weights, label} = L.cue(t + L.hold + j / 50 * L.travel);
      assert.equal(label, 'Forming ' + L.names[next]);
      assert.ok(weights[next] > previous && weights[next] < 1);
      assert.equal(weights[i] + weights[next], 1);
      assert.equal(weights[(next + 1) % L.names.length], 0);
      previous = weights[next];
    }
    assert.ok(L.cue(t - 0.001).weights[i] > 1 - 1e-6);
    assert.ok(L.cue(t + L.hold + 0.001).weights[next] < 1e-6);
  }
});

test('one indexed lantern batch carries three distinct, evenly lit sets of anchors and four corners per light', () => {
  const batches = L.buildMesh();
  assert.equal(batches.length, 1);
  const [{vertices, indices}] = batches;
  assert.ok(vertices instanceof Float32Array && indices instanceof Uint16Array);
  assert.equal(vertices.length, L.count * 4 * L.STRIDE);
  assert.equal(indices.length, L.count * 6);
  const formations = [[], [], []];
  for (let i = 0; i < L.count; i++) {
    const first = i * 4, anchors = L.poses(i);
    assert.deepEqual(Array.from(indices.slice(i*6, i*6+6)), [first, first+1, first+2, first, first+2, first+3]);
    anchors.forEach((point, j) => {
      assert.ok(point.every(Number.isFinite));
      for (const other of formations[j]) assert.ok(Math.hypot(...M.subtract(point, other)) > 0.6);
      formations[j].push(point);
    });
    for (const [corner, uv] of [[0,[-1,-1]], [1,[1,-1]], [2,[1,1]], [3,[-1,1]]]) {
      const base = (first + corner) * L.STRIDE;
      assert.deepEqual(vertices.slice(base, base+9), new Float32Array(anchors.flat()));
      assert.deepEqual(Array.from(vertices.slice(base+9, base+11)), uv);
      assert.ok(vertices.slice(base+11, base+14).every(v => v > 0 && v <= 1));
    }
  }
  assert.deepEqual(L.buildMesh(), batches);
  for (const points of formations) {
    assert.ok(Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) > 17);
    assert.ok(Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) > 10);
  }
});

test('the opening sails and both new lookouts fit a portrait or wide frame on every route', () => {
  const state = F.createFlight(true), pier = T.landing;
  const lamps = Array.from({length:L.count}, (_, i) => L.poses(i).map(p => M.add(p, L.origin))).flat();
  for (const aspect of [16/9, 0.65, 0.48]) {
    const opening = projectFrom(F.sampleRoute(0, 0), aspect);
    assert.ok(lamps.every(p => opening(p).every(v => Math.abs(v) < 0.97)));
    for (const subject of ['lanterns', 'landing']) {
      F.chooseLookout(state, subject);
      for (let route = 0; route < F.routes.length; route++) {
        F.chooseRoute(state, route);
        for (let step = 0; step <= 16; step++) {
          F.seek(state, step / 16);
          state.worldTime = T.period * step / 16;
          const level = T.heightAt(state.worldTime);
          const shot = F.camera(state), project = projectFrom(shot, aspect);
          assert.deepEqual(shot.aim, subject === 'lanterns' ? L.origin : [pier.x, level + pier.freeboard + 1, pier.z]);
          const points = subject === 'lanterns' ? lamps : [-9.25, 9.25].flatMap(x =>
            [-2.15, 2.15].flatMap(z => [level, level + 4.2].map(y => [pier.x + x, y, pier.z + z])));
          assert.ok(points.every(p => project(p).every(v => Math.abs(v) < 0.96)));
        }
      }
    }
  }
});
