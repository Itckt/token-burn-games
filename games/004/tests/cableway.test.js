'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/cableway.js');
const C = require('../js/city.js');
const M = require('../js/math.js');
const G = require('../js/mesh.js');
const {checkChunk} = require('./support/mesh.js');

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, a + ' vs ' + b);

test('the last representable instant before an arrival still reports the car in transit', () => {
  const Q = require('../js/quay.js');
  for (const [pose, event, at] of [[W.car, W.nextArrival, 28], [Q.tramPose, Q.nextArrival, 10]]) {
    const before = at - 2 ** (Math.floor(Math.log2(at)) - 52);
    assert.ok(before < at);
    assert.equal(event(before), at);
    assert.equal(pose(before).at, null);
    assert.ok(pose(at).at);
  }
});

test('counter-running cars dwell, open both leaves and brake to rest at alternate platforms', () => {
  const leg = W.travel + W.dwell;
  for (const lap of [-3, 0, 375]) {
    const start = lap * W.period - 16;
    for (let i = 0; i < 2; i++) {
      const t = start + i * leg;
      assert.equal(W.nextArrival(t - 1e-8), t);
      assert.equal(W.nextArrival(t), t + leg);
      for (const returning of [false, true]) {
        const from = returning ? 1 - i : i;
        for (const elapsed of [0, 0.4, 1.5, 4.5, 5.6, W.dwell]) {
          const car = W.car(t + elapsed, returning);
          assert.equal(car.fraction, from);
          assert.equal(car.at, elapsed < W.dwell ? W.stations[from].name : null);
          assert.equal(car.next, W.stations[1 - from].name);
          if (elapsed === 0 || elapsed === W.dwell) assert.equal(car.doors, 0);
          else if (elapsed < 1 || elapsed > 5) assert.ok(car.doors > 0 && car.doors < 1);
          else assert.equal(car.doors, 1);
        }
        const before = W.car(t - 0.001, returning), after = W.car(t + W.dwell + 0.001, returning);
        near(before.fraction, from); near(after.fraction, from);
        assert.equal(before.doors, 0); assert.equal(after.doors, 0);
      }
    }
  }
  for (let time = -W.period; time <= W.period; time += 0.25) {
    const cars = [W.car(time), W.car(time, true)];
    near(cars[0].fraction + cars[1].fraction, 1);
    for (const [i, car] of cars.entries()) {
      const grip = W.grip(car.fraction, i ? -1 : 1);
      [car.x, car.y + W.floorDrop, car.z].forEach((v, k) => near(v, grip[k]));
      if (!car.at) assert.equal(car.doors, 0);
      if (car.fraction > 0 && car.fraction < 1)
        assert.ok(grip[1] < M.mix(W.stations[0].y, W.stations[1].y, car.fraction), 'the rope sags between supports');
      assert.deepEqual(W.car(time + W.period, !!i), car);
    }
    assert.ok(Math.hypot(cars[0].x - cars[1].x, cars[0].z - cars[1].z) >= 2 * W.laneOffset - 1e-7);
  }
});

test('the car grip stays on the drawn rope, including between the cable mesh joints', () => {
  const mesh = new G.Mesh();
  W.addLine(mesh);
  const chunks = mesh.finish();
  assert.equal(chunks.length, 1);
  checkChunk(chunks[0]);
  // Recover cable vertices from the actual uploaded mesh instead of assuming its subdivision.
  const {vertices} = chunks[0], [a, b] = W.stations;
  const dx = b.x-a.x, dz = b.z-a.z, length = Math.hypot(dx, dz);
  for (const lane of [-1, 1]) {
    const samples = [];
    for (let j = 0; j < vertices.length; j += G.STRIDE) {
      const x = vertices[j]-a.x, z = vertices[j+2]-a.z;
      const t = (dx*x + dz*z)/(length*length), across = (dx*z - dz*x)/length;
      if (t < -0.001 || t > 1.001 || Math.abs(across - lane*W.laneOffset) > 0.09) continue;
      const sagged = M.mix(a.y, b.y, t) - 4*3.8*t*(1-t);
      if (Math.abs(vertices[j+1] - sagged) < 0.11) samples.push([t, vertices[j+1]]);
    }
    samples.sort((a, b) => a[0] - b[0]);
    assert.ok(samples.length > 50);
    for (let step = 1; step < 100; step++) {
      const [x,y,z] = W.grip(step / 100, lane);
      const t = (dx*(x-a.x) + dz*(z-a.z)) / (length*length);
      const i = samples.findIndex(p => p[0] >= t);
      assert.ok(i > 0);
      const [lo,y0] = samples[i-1], [hi,y1] = samples[i];
      assert.ok(hi - lo < 0.05);
      near(y, M.mix(y0, y1, (t-lo)/(hi-lo)), 0.11);
    }
  }
});

test('one haul rope pays out the same length to both cars and turns both station sheaves', () => {
  const length = (from, to, lane) => {
    let previous = W.grip(from, lane), sum = 0;
    for (let i = 1; i <= 150; i++) {
      const point = W.grip(M.mix(from, to, i/150), lane);
      sum += Math.hypot(...M.subtract(point, previous));
      previous = point;
    }
    return sum;
  };
  for (const [a,b] of [[0,0.13], [0.35,0.72], [0.86,1]]) {
    const paid = length(a,b,1), taken = length(1-a,1-b,-1);
    near(paid, taken, 0.0001);
    near(paid, (W.sheaveAngle(a) - W.sheaveAngle(b)) * W.laneOffset, 0.0001);
  }
  const mesh = new G.Mesh();
  W.addLine(mesh);
  const [{vertices}] = mesh.finish(), hubs = new Set();
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    if (vertices[i+8] !== W.sheaveTile) continue;
    const x = vertices[i+6], z = vertices[i+7];
    hubs.add([x,z].join('/'));
    assert.ok(Math.hypot(vertices[i]-x, vertices[i+2]-z) <= W.laneOffset + 0.12);
  }
  assert.equal(hubs.size, 2);
});

test('the shared cabin mesh opens a person-sized passage on both sides without moving the grip or frame', () => {
  const [chunk] = W.buildCar(), {vertices, indices} = chunk;
  assert.ok(indices.length < 2000);
  checkChunk(chunk);
  const moved = vertices.slice(), doors = new Set();
  for (let j = 0; j < moved.length; j += G.STRIDE) {
    const leaf = moved[j+6];
    assert.ok([-1, 0, 1].includes(leaf));
    if (leaf) doors.add(Math.sign(moved[j+2]) + '/' + leaf);
    moved[j] += leaf * W.doorTravel;
    if (moved[j+1] > 2.11) assert.equal(leaf, 0);
  }
  assert.equal(doors.size, 4);
  checkChunk({vertices:moved, indices});
  for (let i = 0; i < indices.length; i += 3) {
    const tri = Array.from(indices.subarray(i, i+3), index => moved.subarray(index*G.STRIDE, index*G.STRIDE+3));
    if (tri.every(p => p[1] < 0.27) || tri.every(p => p[1] > 1.98)) continue;
    assert.ok(tri.every(p => p[0] < -0.65) || tri.every(p => p[0] > 0.65), 'clear passage from platform to platform');
  }
});

test('seeded roofs and projecting signs clear the cabin floor over the full crossing', () => {
  let below = 0;
  for (const seed of [0, 852, 0xffffffff, C.SEED, ...Array.from({length:24}, (_, i) => i*31721)]) {
    const city = C.generateCity(seed);
    const bounds = city.buildings.map(b => ({x:b.x, z:b.z, w:b.width + 0.3, d:b.depth + 0.3,
      top:b.height * (b.setback ? 1.16 : 1) + (b.roofType === 3 && b.row ? 5.55 : 3.2)}));
    for (const s of city.signs) bounds.push({x:s.x, z:s.z, w:s.w+0.2, d:0.4, top:s.y+s.h+0.10});
    for (const b of city.landmarks) bounds.push({x:b.x, z:b.z, w:b.width+0.4, d:b.depth+0.4, top:b.height+16});
    for (let time = 0; time < W.period; time += 1) for (const car of [W.car(time), W.car(time, true)]) {
      const c = Math.abs(Math.cos(car.angle)), s = Math.abs(Math.sin(car.angle));
      const rx = 1.8*c + 1.16*s, rz = 1.8*s + 1.16*c;
      for (const b of bounds) {
        if (Math.abs(b.x-car.x) > rx + b.w/2 || Math.abs(b.z-car.z) > rz + b.d/2) continue;
        assert.ok(b.top + 0.35 < car.y, 'clear cabin at seed ' + seed);
        below++;
      }
    }
  }
  assert.ok(below > 100, 'the line runs above occupied city blocks');
});

test('the waterfront neon leaves an open sightline to the jade car as it climbs out of Eave Street', () => {
  const F = require('../js/flight.js');
  const {projectFrom} = require('./support/projection.js');
  for (const seed of [0, 852, C.SEED]) {
    const state = F.createFlight(true), city = C.generateCity(seed);
    const opening = F.camera(state), subject = F.lookoutPoint('cableway', 0);
    for (const aspect of [0.48, 16/9]) assert.ok(projectFrom(opening, aspect)(subject).every(n => Math.abs(n) < 0.97));
    F.chooseRoute(state, 1); F.chooseLookout(state, 'cableway');
    for (let t = 0; t <= 8; t += 0.1) {
      F.seek(state, t / 96); state.worldTime = t;
      const {eye, aim} = F.camera(state);
      // Sample the segment where it crosses the first two rows of roofs.
      for (const b of city.buildings.filter(b => b.row < 2)) {
        const front = b.z + b.depth/2, back = b.z - b.depth/2;
        for (const z of [front, b.z, back]) {
          const u = (z - eye[2]) / (aim[2] - eye[2]);
          if (u < 0 || u > 1 || Math.abs(M.mix(eye[0], aim[0], u) - b.x) > b.width/2) continue;
          assert.ok(M.mix(eye[1], aim[1], u) > b.height * (b.setback ? 1.16 : 1));
        }
      }
    }
  }
});
