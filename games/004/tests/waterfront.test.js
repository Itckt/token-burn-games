'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math.js');
const G = require('../js/mesh.js');
const B = require('../js/beacon.js');
const C = require('../js/cargo.js');
const T = require('../js/tide.js');
const Q = require('../js/quay.js');
const V = require('../js/vessels.js');
const F = require('../js/flight.js');
const {projectFrom} = require('./support/projection.js');

function close(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) < tolerance, a + ' vs ' + b);
}

test('the beacon turns clockwise through eight chart bearings and steps strictly forward at a quarter turn', () => {
  const compass = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW'];
  for (const lap of [-73, -1, 0, 4802]) {
    const west = 1.5 + B.period * lap;
    for (const [i, sector] of compass.entries()) {
      const t = west + i * B.period / 8, [x, z] = B.direction(t);
      assert.equal(B.sector(t), sector);
      close(Math.hypot(x, z), 1);
      close(x, -Math.cos(i * M.TAU / 8));
      close(z, -Math.sin(i * M.TAU / 8));
      if (i % 2 === 0) {
        assert.equal(B.nextBearing(t - 1e-8), t);
        assert.equal(B.nextBearing(t), t + 8);
        assert.equal(B.nextBearing(t + 1e-8), t + 8);
      }
    }
  }
  assert.deepEqual(B.direction(0), B.direction(B.period));
});

test('the pool starts at the cone edge, crosses the optical axis and moves towards the tower with rising water', () => {
  const {slope, spread, range, aperture} = B.optics;
  let previous = Infinity;
  for (const level of [-T.amplitude, -0.25, 0, 0.75, T.amplitude]) {
    const [near, center, far] = B.waterContact(level), h = B.lamp[1] - level;
    assert.ok(near > 0 && near < center && center < far && far <= range);
    close(h - slope * near, aperture + spread * near);
    close(h - slope * center, 0);
    assert.ok(Math.abs(h - slope * far) <= aperture + spread * far + 1e-7);
    assert.ok(center < previous);
    previous = center;
  }
  const [{vertices, indices}] = B.buildBeam();
  assert.equal(vertices.length, 12 * 3);
  for (let part = 0; part < 3; part++) {
    const quad = Array.from(indices.slice(part * 6, part * 6 + 6));
    assert.equal(new Set(quad).size, 4);
    assert.ok(quad.every(i => i < 12 && vertices[3 * i + 2] === part));
  }
});

test('the crane locks, lifts, traverses and releases one load on alternating decks through both tides', () => {
  for (let leg = -10; leg <= 10; leg++) {
    const start = -18 + leg * C.leg, outbound = leg % 2 === 0;
    const source = outbound ? 'quay' : 'barge', destination = outbound ? 'barge' : 'quay';
    const surface = (name, t) => name === 'quay' ? C.quayTop : C.freeboard + T.heightAt(t);
    for (const [offset, label] of [[0,'Hook to ' + source],[4,'Locking on · ' + source],
      [6,'Hoisting from ' + source],[12,'Crossing to ' + destination],
      [24,'Lowering to ' + destination],[30,'Landed on ' + destination]]) {
      const t = start + offset, rig = C.transfer(t);
      assert.equal(rig.label, label);
      const atBarge = offset >= 24 ? outbound : !outbound;
      assert.equal(rig.along, atBarge ? C.reach : 0);
      if (offset <= 6) close(rig.bottom, surface(source, t));
      if (offset === 12 || offset === 24) close(rig.bottom, 7.4);
      if (offset === 30) close(rig.bottom, surface(destination, t));
      if (offset >= 4) close(rig.hook, rig.bottom + C.boxHeight);
    }
    for (let offset = 0; offset < C.leg; offset += 0.25) {
      const t = start + offset, rig = C.transfer(t);
      const [x,,z] = C.point(rig.along, 0);
      close(rig.x, x); close(rig.z, z);
      assert.ok(rig.hook >= rig.bottom + C.boxHeight - 1e-8 && rig.hook < C.rail);
      assert.ok(rig.bottom > T.heightAt(t));
      assert.ok(rig.along >= 0 && rig.along <= C.reach);
      if (offset > 12 && offset < 24) close(rig.bottom, 7.4);
      if (offset > 30) close(rig.bottom, surface(destination, t));
    }
    for (const edge of [0,4,6,12,24,30,31,36]) {
      const before = C.transfer(start + edge - 1e-5), after = C.transfer(start + edge + 1e-5);
      for (const key of ['along','hook','bottom']) close(before[key], after[key], 1e-6);
    }
    assert.equal(C.nextSetDown(start + 30 - 1e-8), start + 30);
    assert.equal(C.nextSetDown(start + 30), start + C.leg + 30);
  }
});

test('the portal leaves room for the full suspended container and the barge follows the tide in the static mesh', () => {
  const mesh = new G.Mesh();
  C.addBerth(mesh, Q.shoreZ);
  const [{vertices, indices}] = mesh.finish();
  const c = Math.cos(C.berth.angle), s = Math.sin(C.berth.angle);
  let deck = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const tri = Array.from(indices.subarray(i, i + 3), index => {
      const j = index * G.STRIDE, x = vertices[j] - C.berth.x, z = vertices[j + 2] - C.berth.z;
      return [x*c + z*s, vertices[j+1], -x*s + z*c, vertices[j+6], vertices[j+7], vertices[j+8]];
    });
    if (tri[0][5] < -4.5) {
      assert.ok(tri.every(p => p[3] === 1 && p[4] === 0));
      if (tri.every(p => Math.abs(p[1] - C.freeboard) < 1e-5)) deck++;
    } else {
      const gaps = [[-1.22, C.reach + 1.22], [C.quayTop + 0.01, 10.30], [-2.81, 2.81]];
      assert.ok(gaps.some(([min, max], k) => tri.every(p => p[k] < min) || tri.every(p => p[k] > max)),
        'no leg or diagonal intersects the moving spreader or container');
    }
  }
  assert.ok(deck >= 6);
});

test('the barge and beacon caisson leave clearance around the full oriented hull of every passing vessel', () => {
  const [bx,,bz] = C.point(C.reach, 0);
  const axes = angle => [[Math.cos(angle), Math.sin(angle)], [-Math.sin(angle), Math.cos(angle)]];
  const barge = axes(C.berth.angle);
  const radius = (axis, basis, length, width) => length * Math.abs(M.dot(axis, basis[0])) + width * Math.abs(M.dot(axis, basis[1]));
  for (const [pose, scale, period] of [[V.ferryPose,1,V.ferryPeriod],[t => V.ferryPose(t,1),0.64,210],[V.junkPose,1,280]]) {
    const length = 7.25 * scale, width = 1.7 * scale;
    for (let time = 0; time <= period; time += 0.25) {
      const p = pose(time), hull = axes(p.angle);
      const toBarge = [bx - p.x, bz - p.z], toBeacon = [B.lamp[0] - p.x, B.lamp[2] - p.z];
      assert.ok([...hull, ...barge].some(axis => Math.abs(M.dot(axis, toBarge)) >
        radius(axis, hull, length, width) + radius(axis, barge, 2.64, 8.24) + 0.5));
      const end = Math.max(Math.abs(M.dot(toBeacon,hull[0])) - length, 0);
      const side = Math.max(Math.abs(M.dot(toBeacon,hull[1])) - width, 0);
      assert.ok(Math.hypot(end, side) > 3.72 + 0.5);
    }
  }
});

test('the beacon tower and the cargo rig fit their portrait and landscape lookout frames on all four routes', () => {
  const state = F.createFlight(true);
  for (const id of ['beacon', 'cargo']) {
    F.chooseLookout(state, id);
    for (const [i, route] of F.routes.entries()) {
      F.chooseRoute(state, i);
      for (let step = 0; step <= 36; step++) {
        F.seek(state, step / 36);
        if (!route.onDeck) state.worldTime = step * 5;
        const shot = F.camera(state), rig = C.transfer(state.worldTime);
        const points = id === 'beacon' ? [-3.72,3.72].flatMap(x => [-3.72,3.72].flatMap(z =>
          [0,12.8].map(y => [B.lamp[0]+x, y, B.lamp[2]+z]))) :
          [-1.20,1.20].flatMap(x => [-2.8,2.8].flatMap(z =>
            [rig.bottom, rig.hook+0.43, C.rail].map(y => C.point(rig.along+x, y, z))));
        for (const aspect of [0.48, 16/9]) {
          const project = projectFrom(shot, aspect);
          for (const p of points) {
            const [x,y] = project(p);
            assert.ok(Math.max(Math.abs(x),Math.abs(y)) < 0.97,
              [id, route.name, state.worldTime, aspect, x, y].join(' / '));
          }
        }
      }
    }
  }
});
