'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/timehouse.js');
const G = require('../js/mesh.js');
const Q = require('../js/quay.js');
const V = require('../js/vessels.js');
const W = require('../js/cableway.js');
const F = require('../js/flight.js');
const {checkChunk} = require('./support/mesh.js');
const {projectFrom} = require('./support/projection.js');

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, a + ' vs ' + b);

test('the four-faced clock carries the minute into the hour and the date through midnight on either side of zero', () => {
  assert.equal(H.reading(0).label, '23:58');
  for (const [time, label, directions] of [
    [8, '00:00', [0,1,0,1]], [728, '03:00', [1,0,0,1]],
    [1508, '06:15', [Math.sin(Math.PI*6.25/6),Math.cos(Math.PI*6.25/6),1,0]]
  ]) {
    for (const day of [-2,0,601]) {
      const r = H.reading(time + day*5760);
      assert.equal(r.label, label);
      directions.forEach((v,i) => near(r.hands[i], v));
    }
  }
  assert.equal(H.reading(8 - 1e-7).label, '23:59');
  for (const [drop, previous] of [[8,'23:59'], [-52,'23:44']]) {
    const before = drop - Math.abs(drop) * Number.EPSILON;
    assert.equal(H.reading(before).label, previous);
    assert.equal(H.reading(before).signal, 'Ball aloft');
    assert.equal(H.nextDrop(before), drop);
  }
  for (const step of [-1e-7, 1e-7]) {
    H.reading(8 + step).hands.forEach((n,i) => near(n, H.reading(8).hands[i]));
  }
});

test('the ball winds up, holds, drops with increasing speed and rests until the next quarter', () => {
  for (const quarter of [-11,0,1,2001]) {
    const drop = quarter*H.quarter + 8;
    assert.equal(H.nextDrop(drop - 1e-8), drop);
    assert.equal(H.nextDrop(drop), drop + H.quarter);
    assert.equal(H.nextDrop(drop + 1e-8), drop + H.quarter);
    for (const [offset, signal, fraction] of [[-13,'Ball down',0],[-8,'Raising',0.5],[-4,'Ball aloft',1],
      [0,'Dropping',1],[0.6,'Dropping',0.75],[1.21,'Ball down',0]]) {
      const r = H.reading(drop + offset);
      assert.equal(r.signal, signal);
      near(r.lift, H.rise*fraction);
    }
    for (const edge of [-12,-4,0,1.2])
      near(H.reading(drop+edge-1e-6).lift, H.reading(drop+edge+1e-6).lift, 0.00001);
    for (let t = drop; t < drop + H.quarter; t += 0.17) {
      const {hands,lift} = H.reading(t);
      assert.ok(lift >= 0 && lift <= H.rise);
      near(Math.hypot(...hands.slice(0,2)), 1);
      near(Math.hypot(...hands.slice(2)), 1);
    }
  }
});

test('all four dials have upright coordinates and the full time ball travel stays on the fixed mast', () => {
  const mesh = new G.Mesh(); H.addTower(mesh, Q.shoreZ);
  const [chunk] = mesh.finish(); checkChunk(chunk);
  const {vertices} = chunk, normals = new Set(), ball = [], mast = [];
  for (let j = 0; j < vertices.length; j += G.STRIDE) {
    const [x,y,z,nx,ny,nz,u,v,tile] = vertices.subarray(j, j+9);
    const dx = x-H.center[0], dz = z-H.center[2];
    if (tile === H.dialTile) {
      normals.add([Math.round(nx), Math.round(nz)].join('/'));
      near(ny, 0); near(Math.hypot(u,v), 1);
      near(y-H.center[1], v*H.dialRadius, 1e-5);
      near(dx*nz - dz*nx, u*H.dialRadius, 1e-5);
      assert.ok(dx*nx + dz*nz > 3.12);
    } else if (tile === H.ballTile) {
      ball.push(y);
      assert.ok(Math.hypot(dx,dz) <= 0.931);
    } else if (Math.hypot(dx,dz) < 0.21 && y > 20) mast.push(y);
  }
  assert.deepEqual(normals, new Set(['1/0','0/1','-1/0','0/-1']));
  assert.ok(ball.length > 100 && mast.length > 12);
  assert.ok(Math.min(...ball) > Math.min(...mast));
  assert.ok(Math.max(...ball) + H.rise < Math.max(...mast));
});

test('the clock pier is clear of the vessels at both ends of their turning circles', () => {
  const [x,,z] = H.center;
  for (const [pose, period, scale] of [[V.ferryPose,240,1], [t=>V.ferryPose(t,1),210,0.64], [V.junkPose,280,1]]) {
    for (let t = 0; t < period; t += 0.25) {
      const hull = pose(t), c = Math.abs(Math.cos(hull.angle)), s = Math.abs(Math.sin(hull.angle));
      const length = 7.25*scale, width = 1.7*scale;
      assert.ok(Math.abs(hull.x-x) > 3.68 + c*length+s*width+0.4 ||
        Math.abs(hull.z-z) > 3.54 + s*length+c*width+0.4);
    }
  }
});

test('the whole signal tower and the tracked car fit their lookouts on every route in portrait and landscape', () => {
  const state = F.createFlight(true);
  for (const id of ['timehouse', 'cableway']) {
    F.chooseLookout(state, id);
    for (const [i, route] of F.routes.entries()) {
      F.chooseRoute(state, i);
      for (let step = 0; step <= 72; step++) {
        F.seek(state, step / 72);
        if (!route.onDeck) state.worldTime = step * 5;
        const car = W.car(state.worldTime), [x,,z] = H.center;
        const points = id === 'timehouse' ? [[x,H.ballY+H.rise+1.57,z],
          ...[-3.68,3.68].flatMap(dx => [-3.54,3.54].map(dz => [x+dx,-0.86,z+dz]))] :
          [0,W.floorDrop+0.12].flatMap(y => [-2.2,2.2].flatMap(dx => [-1.7,1.7].map(dz =>
            [car.x+dx,car.y+y,car.z+dz])));
        for (const aspect of [0.48, 16/9]) {
          const project = projectFrom(F.camera(state), aspect);
          assert.ok(points.every(p => project(p).every(n => Math.abs(n) < 0.95)), id + ' on ' + route.name);
        }
      }
    }
  }
});
