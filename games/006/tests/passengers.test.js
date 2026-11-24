'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/passengers.js');
const R = require('../js/ride.js');
const tick = 1 / 60;

test('platform queues repeat by visit, vary across laps, and have valid onward destinations', () => {
  const variants = new Set();
  for (let visit = -20; visit <= 80; visit++) {
    const call = P.platformCall(visit);
    assert.deepEqual(call, P.platformCall(visit));
    assert.ok(call.queue.length >= 3 && call.queue.length <= P.MAX_WAITING);
    assert.ok(call.queue.every(i => Number.isInteger(i) && i >= 0 && i < R.STATIONS.length && i !== call.station));
    if (call.station === 1) assert.deepEqual(call.queue.slice(0, 3), [3, 3, 3]);
    if (call.station === 0) variants.add(call.queue.join(','));
  }
  assert.ok(variants.size > 5);
});

test('alighting frees seats before boarding and a full carriage leaves the excess queue intact', () => {
  const car = P.createCar();
  car.destinations = [2, P.CAPACITY - 2, 0, 0, 0];
  const call = car.call;
  const transfer = () => {
    for (let i = 0; i < P.CROSSING_TIME * 60; i++) P.exchange(car, tick, 5);
  };
  P.exchange(car, tick, P.CROSSING_TIME - tick);
  assert.equal(call.crossing, null, 'insufficient time before closing');
  transfer(); assert.deepEqual([P.load(car), call.alighted, call.boarded], [17, 1, 0]);
  transfer(); assert.deepEqual([P.load(car), call.alighted, call.boarded], [16, 2, 0]);
  transfer(); transfer();
  assert.deepEqual([P.load(car), call.alighted, call.boarded], [18, 2, 2]);
  const expected = [0, 16, 0, 0, 0];
  for (const destination of call.queue.slice(0, 2)) expected[destination]++;
  assert.deepEqual(car.destinations, expected);
  const full = structuredClone(car);
  transfer(); assert.deepEqual(car, full);
});

test('closing admits no new rider but lets the person in the doorway finish, and reopening resumes the same queue', () => {
  const s = R.createRide(), call = s.car.call;
  const initial = P.load(s.car);
  R.command(s, 'doors'); R.advance(s, R.DOOR_TIME / 2);
  R.command(s, 'doors'); R.advance(s, R.DOOR_TIME);
  assert.equal(call.boarded, 0); assert.equal(P.load(s.car), initial);
  R.command(s, 'doors'); R.advance(s, R.DOOR_TIME + tick);
  assert.equal(call.crossing.boarding, true);
  R.command(s, 'doors'); R.command(s, 'pause');
  const frozen = structuredClone(s);
  R.advance(s, 20); assert.deepEqual(s, frozen);
  R.command(s, 'pause');
  while (call.crossing) {
    const opening = s.door * s.door * (3 - 2 * s.door) * 2 * 0.81;
    assert.ok(opening > 0.55, 'both leaves clear the width of the rider');
    R.advance(s, tick);
  }
  assert.deepEqual([call.boarded, P.load(s.car)], [1, initial + 1]);
  R.advance(s, 6); assert.equal(s.phase, 'ready'); assert.equal(call.boarded, 1);
  R.command(s, 'doors'); R.advance(s, 10);
  assert.equal(call.boarded, call.queue.length);
  const loaded = structuredClone(s.car.destinations);
  R.command(s, 'doors'); R.advance(s, 10);
  assert.deepEqual(s.car.destinations, loaded);
  assert.equal(s.sheet.count, 0);
});

test('the passenger ledger conserves riders through missed pickups, five-second dwells and the loop seam', () => {
  const s = R.createRide();
  for (let i = 0; i < 8; i++) R.command(s, 'faster');
  let last = s.car.call, aboardAtArrival = P.load(s.car);
  for (let i = 0; i < 60000 && s.sheet.count < 12; i++) {
    if (s.berth === 2 && s.phase === 'dwell' && s.dwell > 4.9) R.command(s, 'doors');
    R.advance(s, tick);
    if (last !== s.car.call) {
      assert.equal(P.load(s.car), aboardAtArrival + last.boarded - last.alighted);
      assert.equal(s.car.call.visit, s.sheet.count);
      assert.equal(s.car.call.station, s.berth);
      if (last.station === 2 || last.visit === 0) assert.equal(last.boarded, 0);
      last = s.car.call; aboardAtArrival = P.load(s.car);
    }
    assert.ok(P.load(s.car) <= P.CAPACITY && s.car.destinations.every(n => Number.isInteger(n) && n >= 0));
    if (s.berth === null) assert.equal(last.crossing, null);
  }
  assert.equal(s.sheet.count, 12);
});

test('rider poses use one aligned doorway, advance the queue, and clear unused slots on reuse', () => {
  const car = P.createCar(), call = car.call, poses = new Float32Array((P.MAX_WAITING + 1) * 4);
  P.writePoses(call, poses);
  const rear = poses[4];
  assert.ok(poses[0] > 2.43 && rear > poses[0]);
  assert.equal(poses.at(-1), 0);
  for (let i = 0; i < 23; i++) P.exchange(car, tick, 5);
  P.writePoses(call, poses);
  assert.ok(poses[0] < 1.6 && Math.abs(poses[2] - 2) < 0.25);
  assert.ok(poses[4] < rear && poses[4] > 2.43);
  while (call.crossing) P.exchange(car, tick, 0);
  P.writePoses(call, poses);
  assert.deepEqual([...poses.slice(0, 4)], [0, 0, 0, 0]);
  car.call = P.platformCall(1);
  for (let i = 0; i < 18; i++) P.exchange(car, tick, 5);
  P.writePoses(car.call, poses);
  assert.ok(poses.at(-4) > 1.87 && poses.at(-4) < 2.25);
  assert.ok(Math.abs(poses.at(-2) - 2) < 0.25 && poses.at(-1) > 0);
});
