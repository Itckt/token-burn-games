'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../js/quay.js');
const M = require('../js/math.js');
const C = require('../js/city.js');
const G = require('../js/mesh.js');

function close(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
}

test('the shuttle calls at three named stops, dwells and changes ends without turning its body', () => {
  for (const [arrival, stop, next, direction] of [
    [10, 1, 2, 1], [49, 2, 1, -1], [88, 1, 0, -1], [127, 0, 1, 1]
  ]) {
    const car = Q.tramPose(arrival);
    assert.equal(car.at, Q.stops[stop].name);
    assert.equal(car.x, Q.stops[stop].x);
    assert.equal(car.next, Q.stops[next].name);
    assert.equal(car.direction, direction);
    assert.deepEqual(Q.tramPose(arrival + Q.dwell - 0.001), car);
    assert.equal(Q.tramPose(arrival + Q.dwell).at, null);
    assert.ok(direction * (Q.tramPose(arrival + Q.dwell + 1).x - car.x) > 0);
    for (const time of [arrival, arrival + Q.dwell]) {
      const before = Q.tramPose(time - 0.002), after = Q.tramPose(time + 0.002);
      assert.ok(Math.abs(after.x - before.x) / 0.004 < 0.002, 'continuous velocity at a stop');
      assert.ok(Math.abs(after.angle - before.angle) < 0.00001, 'the chassis stays on its rails');
    }
  }
});

test('tram wheels follow the curved track through negative time, complete laps and reversals', () => {
  const speed = 4;
  for (let t = -Q.tramPeriod; t <= Q.tramPeriod; t += 0.51) {
    const car = Q.tramPose(t), later = Q.tramPose(t + Q.tramPeriod * 17);
    for (const key of ['x','y','z','angle']) close(car[key], later[key]);
    assert.equal(car.at, later.at);
    assert.ok(car.x >= Q.stops[0].x && car.x <= Q.stops[2].x);
    close(car.z, Q.trackZ(car.x));
    assert.ok(car.y > 1.3 && car.y < 1.5);
    const slope = (Q.trackZ(car.x + 0.001) - Q.trackZ(car.x - 0.001)) / 0.002;
    close(Math.tan(car.angle), slope);
    const next = Q.tramPose(t + 0.01);
    assert.ok(Math.hypot(next.x - car.x, next.z - car.z) < speed * 0.01);
    for (const end of [-4.75, 4.75]) {
      const x = car.x + end * Math.cos(car.angle);
      close(car.z + end * Math.sin(car.angle), Q.trackZ(x), 0.05);
    }
  }
});

test('the tram clears seeded shopfronts and the pier stands outside the ferry lanes', () => {
  for (const seed of [0, 852, 31676, C.SEED, 0xffffffff]) {
    const front = C.generateCity(seed).buildings.filter(b => b.row === 0);
    for (let t = 0; t < Q.tramPeriod; t += 0.5) {
      const car = Q.tramPose(t);
      const c = Math.cos(car.angle), s = Math.sin(car.angle);
      // Clip the landward side of the oriented car to the width of each facade.
      const sideX = car.x + 1.10 * s, sideZ = car.z - 1.10 * c;
      for (const b of front) {
        const left = Math.max(-4.8, (b.x - b.width / 2 - sideX) / c);
        const right = Math.min(4.8, (b.x + b.width / 2 - sideX) / c);
        if (left <= right) assert.ok(sideZ + Math.min(left*s, right*s) > b.z + b.depth / 2 + 1.35);
      }
    }
  }
  for (let t = 0; t < 280; t += 0.5) {
    for (const boat of [C.ferryPose(t), C.ferryPose(t, 1), C.junkPose(t)]) {
      assert.ok(Math.abs(boat.x - Q.wheel.x) > 12.4 + 7.2 || boat.z - 2 > Q.wheel.z + 4.2);
    }
  }
});

test('the wheel closes its orbit at either end of the clock and spaces every hanger equally', () => {
  const {radius, cabins, period} = Q.wheel;
  for (const time of [-period, -0.01, 0, period / 4, period - 0.0001, 93481]) {
    const angle = Q.wheelAngle(time);
    assert.ok(angle >= 0 && angle < M.TAU);
    for (let i = 0; i < cabins; i++) {
      const p = Q.hanger(i, angle), q = Q.hanger(i + 1, angle);
      close(Math.hypot(...p), radius);
      close(Math.hypot(...M.subtract(p, q)), 2 * radius * Math.sin(Math.PI / cabins));
      const repeat = Q.hanger(i, Q.wheelAngle(time + period));
      p.forEach((value, axis) => close(value, repeat[axis]));
    }
  }
});

test('one cabin buffer holds twelve separate pivots and keeps roofs level clear of the pier', () => {
  const [batch] = Q.buildWheelCabins(), {vertices} = batch;
  const cabins = new Map();
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    const pin = Array.from(vertices.subarray(i + 6, i + 8)), key = pin.join(',');
    if (!cabins.has(key)) cabins.set(key, {pin, points: []});
    cabins.get(key).points.push(Array.from(vertices.subarray(i, i + 3)));
  }
  assert.equal(cabins.size, Q.wheel.cabins);
  for (const [index, {pin, points}] of [...cabins.values()].entries()) {
    Q.hanger(index).forEach((value, i) => close(value, pin[i], 1e-5));
    assert.ok(points.some(p => p[1] < -1.5) && points.some(p => p[1] >= -0.01));
    for (let angle = 0; angle < M.TAU; angle += 0.23) {
      const y = pin[0] * Math.sin(angle) + pin[1] * Math.cos(angle);
      assert.ok(points.every(p => Q.wheel.y + y + p[1] > 1.35));
    }
  }
});
