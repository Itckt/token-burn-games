'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/shuttle.js');
const R = require('../js/route.js');

test('two coupled cars enter and leave each viaduct from cover, on repeatable simulated headways', () => {
  for (const span of R.VIADUCTS) {
    const at = (span.start + span.end) / 2;
    let seen = false, gap = false;
    for (let time = 0; time < S.HEADWAY; time += 0.25) {
      const cars = S.carsAt(at, time);
      assert.deepEqual(S.carsAt(at, time + 100 * S.HEADWAY), cars);
      if (cars.length === 0) gap = true;
      if (cars.length !== 2) continue;
      seen = true;
      const [head, tail] = cars;
      assert.ok(Math.abs(tail.at - head.at - S.SPACING) < 1e-8);
      assert.ok(head.cos > 0 && tail.cos < 0);
      const after = S.carsAt(at, time + 0.01).find(car => car.car === head.car);
      if (after) assert.ok(Math.abs(head.at - after.at - S.SPEED * 0.01) < 1e-8);
      const nextLap = S.carsAt(at + R.LENGTH * 9000, time);
      for (const [i, car] of cars.entries()) {
        assert.ok(Math.abs(nextLap[i].at - 9000*R.LENGTH - car.at) < 1e-7);
        assert.ok(Math.abs(nextLap[i].x - car.x) < 1e-7);
        assert.ok(Math.abs(car.cos**2 + car.sin**2 - 1) < 1e-10);
      }
    }
    assert.ok(seen && gap);
    for (const portal of [span.start, span.end]) {
      const positions = [];
      for (let time = 0; time < S.HEADWAY; time += 0.05) {
        for (const car of S.carsAt(portal, time)) if (car.car === 0) positions.push(car.at);
      }
      assert.ok(portal === span.start ? Math.min(...positions) < portal - S.BORE :
        Math.max(...positions) > portal + S.BORE);
    }
  }
  for (const station of R.STATIONS) assert.deepEqual(S.carsAt(station.at, 18), []);
});

test('both bogies follow the neighbouring rails throughout the bends and each car stays clear of the driver’s track', () => {
  for (const span of R.VIADUCTS) {
    let checked = 0;
    for (let at = span.start; at < span.end; at += 8) for (let t = 0; t < S.HEADWAY; t += 1.75) {
      for (const car of S.carsAt(at, t)) {
        for (const z of [-3.28,3.28]) {
          const mark = car.at - z * car.cos;
          const x = car.x - z * car.sin;
          assert.ok(Math.abs(x - R.trackOffset(mark) - S.TRACK_X) < 0.03);
        }
        for (const z of [-5,5]) {
          const nearestSide = car.x - z * car.sin + 1.43 * Math.abs(car.cos);
          assert.ok(nearestSide < R.trackOffset(car.at - z * car.cos) - 4.8);
        }
        checked++;
      }
    }
    assert.ok(checked > 100);
  }
});
