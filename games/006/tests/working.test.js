'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const L = require('../js/line-speed.js');
const D = require('../js/daylight.js');
const B = require('../js/boarding.js');
const P = require('../js/passengers.js');
const G = require('../js/signals.js');

const tick = 1 / 60;
function until(s, predicate, seconds = 90) {
  for (let i = 0; i < seconds * 60 && !predicate(s); i++) R.advance(s, tick);
  assert.ok(predicate(s), 'reached the requested operating state');
}
function selectSpeed(s, kmh) {
  while (s.target < kmh) R.command(s, 'faster');
}

test('every curve has an entry and release board on plain track, including negative and distant laps', () => {
  const count = R.LENGTH / R.CHUNK;
  assert.equal(Array.from({ length: count }, (_, i) => L.boardInChunk(i)).filter(Boolean).length, 10);
  for (const lap of [-3, 0, 9801]) {
    for (const [leg, zone] of L.zones.entries()) {
      for (const [at, before, after] of [[zone.entry, 80, zone.kmh], [zone.release, zone.kmh, 80]]) {
        const absolute = lap * R.LENGTH + at;
        assert.equal(R.routeLeg(absolute), leg);
        assert.equal(R.stationAt(absolute), -1);
        assert.deepEqual(L.boardInChunk(Math.floor(absolute / R.CHUNK)), { at, kmh: after });
        assert.equal(L.postedAt(absolute - 0.0001), before);
        assert.equal(L.postedAt(absolute), after);
        assert.equal(L.postedAt(absolute + 0.0001), after);
      }
    }
  }
  assert.match(L.indication(147.999), /40 km\/h in 1 m/);
  assert.match(L.indication(148), /College curve/);
  assert.match(L.indication(276), /restored/);
});

test('supervision enters all five limits at the posted speed, releases traction and books two complete laps', () => {
  const s = R.createRide();
  assert.equal(s.limits, false); R.command(s, 'limits'); selectSpeed(s, 80);
  let entries = 0, releases = 0, braking = 0;
  for (let i = 0; i < 600 * 60 && s.sheet.count < 10; i++) {
    const previous = s.speed, before = L.postedAt(s.position), leg = s.last;
    R.advance(s, tick);
    const limit = L.postedAt(s.position);
    assert.ok(s.speed * 3.6 <= limit + 1e-6);
    assert.ok(previous - s.speed <= 1.36 * tick + 1e-7, 'inside the service brake envelope');
    assert.ok(s.speed - previous <= 1.10 * tick + 1e-7);
    if (R.driveState(s) === 'Line brake') { braking++; assert.ok(s.meter.power < 0); }
    if (before > limit) {
      entries++;
      assert.equal(R.driveState(s), 'Line limit');
      assert.ok(Math.abs(s.speed * 3.6 - limit) < 0.001);
      assert.equal(s.target, 80);
    }
    if (before < limit) {
      releases++;
      const atBoard = s.speed; R.advance(s, tick);
      assert.ok(s.speed > atBoard);
    }
    if (leg !== s.last) {
      const run = s.sheet.entries[0];
      assert.equal(run.booked, R.STATIONS[leg].booked + L.allowance(leg, false));
      assert.ok(Math.abs(run.seconds - run.booked) <= 5);
      assert.ok(run.trace.some(point => point.limit === L.zones[leg].kmh));
      assert.equal(run.trace.at(-1).limit, 80);
    }
  }
  assert.equal(s.sheet.count, 10); assert.equal(entries, 10); assert.equal(releases, 10);
  assert.ok(braking > 100);
});

test('a lower target, coasting and a red signal each retain authority inside a supervised curve', () => {
  const slow = R.createRide(); R.command(slow, 'limits'); selectSpeed(slow, 30);
  until(slow, r => r.position >= 152);
  assert.equal(slow.speed, 30 / 3.6); assert.equal(R.driveState(slow), 'Cruising');
  R.command(slow, 'coast'); const entering = slow.speed;
  until(slow, r => r.position >= 280);
  assert.ok(slow.speed < entering); assert.equal(slow.meter.power, 0);
  assert.equal(slow.coasting, true); assert.equal(slow.target, 30);

  const s = R.createRide();
  for (const action of ['signals', 'limits', 'mode']) R.command(s, action);
  selectSpeed(s, 80);
  until(s, r => R.driveState(r) === 'Signal hold');
  assert.equal(s.position, G.homeMark(s) - G.SETBACK);
  assert.equal(L.postedAt(s.position), 40); assert.equal(s.door, 0);
  assert.match(R.command(s, 'limits'), /berthed/);
  R.command(s, 'brake'); const hold = s.position;
  until(s, r => G.secondsToClear(r) === 0);
  assert.equal(s.position, hold); assert.equal(s.target, 0);
  selectSpeed(s, 80);
  until(s, r => R.brakeOffset(r) >= -0.3);
  R.command(s, 'brake'); until(s, r => r.berth === 1);
  assert.ok(Math.abs(s.sheet.entries[0].error) <= 1);
  assert.equal(s.sheet.entries[0].booked, G.booked(0, true) + L.allowance(0, true));
});

test('the last submillimetre before the platform or manual overrun mark obeys the same brake rate', () => {
  for (const manual of [false, true]) for (const target of [20, 50, 80]) {
    const s = R.createRide(); if (manual) R.command(s, 'mode'); selectSpeed(s, target);
    const end = s.nextMark + (manual ? R.LEVEL_RANGE : 0), maxBrake = manual ? 2.50 : 1.36;
    for (let i = 0; i < 110 * 60 && s.sheet.count === 0; i++) {
      const before = s.speed; R.advance(s, tick);
      assert.ok(s.position <= end + 1e-9);
      assert.ok(before - s.speed <= maxBrake * tick + 1e-7, 'final tick at ' + target + ' km/h target');
    }
    assert.equal(s.sheet.count, 1); assert.equal(s.speed, 0); assert.equal(s.berth, 1);
    assert.equal(s.sheet.entries[0].atLimit, manual);
  }
});

test('guard working serves a long exchange, proves the locks and consumes one clearance per berth', () => {
  const s = R.createRide();
  assert.match(R.command(s, 'bell'), /Switch on/);
  R.command(s, 'guard'); selectSpeed(s, 80);
  s.car.destinations = [12, 1, 0, 0, 0];
  R.advance(s, 8); assert.equal(s.position, 0); assert.equal(s.recording, null);
  assert.ok(!B.active(s)); assert.match(R.command(s, 'bell'), /Open for passengers/);
  R.command(s, 'doors'); R.advance(s, 0.2);
  assert.match(R.command(s, 'doors'), /Keep the doors open/);
  R.advance(s, 6.5);
  assert.equal(s.phase, 'dwell'); assert.equal(s.door, 1); assert.equal(s.guard.opened, true);
  assert.ok(B.active(s)); assert.match(R.command(s, 'doors'), /exchange/);
  until(s, r => !B.active(r)); assert.equal(s.car.call.alighted, 12);
  assert.equal(s.car.call.boarded, s.car.call.queue.length);
  R.advance(s, 5); assert.equal(s.door, 1); assert.equal(s.sheet.count, 0);
  R.command(s, 'doors'); R.advance(s, R.DOOR_TIME - tick);
  assert.match(R.command(s, 'bell'), /lock the doors/);
  R.advance(s, tick); assert.equal(B.lamp(s), 2); assert.equal(R.driveState(s), 'Guard hold');
  R.advance(s, 10); assert.equal(s.position, 0); assert.equal(s.sheet.departedAt, null);
  R.command(s, 'brake'); R.command(s, 'bell'); R.command(s, 'bell');
  assert.equal(s.guard.bells, 1); assert.equal(B.lamp(s), 3);
  R.advance(s, 3); assert.equal(s.position, 0);
  R.command(s, 'doors'); assert.equal(s.guard.cleared, false);
  R.advance(s, 2); R.command(s, 'doors'); R.advance(s, 2);
  selectSpeed(s, 80); R.advance(s, tick); assert.equal(s.position, 0);
  R.command(s, 'bell'); R.advance(s, tick); assert.ok(s.position > 0); assert.equal(B.lamp(s), 0);
  assert.match(R.command(s, 'guard'), /berthed/); assert.match(R.command(s, 'bell'), /at a station/);
  until(s, r => r.berth === 1);
  assert.equal(s.phase, 'opening'); assert.equal(s.guard.cleared, false); assert.equal(s.guard.opened, false);
  assert.equal(s.guard.bells, 2);
  assert.equal(s.sheet.entries[0].seconds, 38, 'guard duties are outside the running allowance');
});

test('capacity, switching during a crossing, and switching back to timed doors cannot strand the guard', () => {
  const s = R.createRide(); R.command(s, 'doors'); R.advance(s, R.DOOR_TIME + 0.1);
  R.command(s, 'doors'); assert.equal(s.phase, 'closing');
  R.command(s, 'guard'); R.advance(s, 2);
  assert.equal(s.guard.opened, true); assert.equal(s.car.call.boarded, 1);
  assert.equal(B.lamp(s), 1); assert.match(R.command(s, 'bell'), /Open for passengers/);
  s.car.destinations = [0, P.CAPACITY, 0, 0, 0];
  R.command(s, 'doors'); R.advance(s, 2);
  assert.doesNotMatch(B.instruction(s), /Passengers crossing/);
  assert.equal(s.car.call.boarded, 1); assert.ok(s.car.call.boarded < s.car.call.queue.length);
  R.command(s, 'doors'); R.advance(s, 2); assert.equal(B.lamp(s), 2);
  R.command(s, 'doors'); R.advance(s, 2); R.command(s, 'guard');
  R.advance(s, R.DWELL_TIME - tick); assert.equal(s.phase, 'dwell');
  R.advance(s, tick); assert.equal(s.phase, 'closing'); selectSpeed(s, 10);
  R.advance(s, R.DOOR_TIME + tick); assert.ok(s.position > 0);
});

test('shift clocks wrap midnight, distinguish both horizons and retain exact time through stops and pauses', () => {
  const s = R.createRide(), clock = s.clock;
  assert.equal(D.clockLabel(clock), '18:05'); const dusk = D.sunlight(clock);
  R.command(s, 'shift'); assert.equal(D.clockLabel(clock), '23:58');
  const night = D.sunlight(clock); assert.equal(night[0], 0); assert.equal(night[1], 0);
  R.advance(s, 60); assert.equal(D.clockLabel(clock), '23:58');
  R.command(s, 'faster'); R.advance(s, 20 - tick);
  assert.equal(D.clockLabel(clock), '23:59'); const beforeMidnight = D.sunlight(clock);
  R.command(s, 'pause'); const saved = structuredClone(s);
  R.command(s, 'shift'); R.advance(s, 600); assert.deepEqual(s, saved);
  R.command(s, 'pause'); R.advance(s, tick);
  assert.equal(D.clockLabel(clock), '00:00');
  D.sunlight(clock).forEach((v, i) => assert.ok(Math.abs(v - beforeMidnight[i]) < 0.00001));
  R.command(s, 'brake'); R.advance(s, 12); assert.equal(s.speed, 0); assert.equal(D.clockLabel(clock), '00:01');
  const frozen = [s.time, s.position, s.recording.tick, s.target];
  R.command(s, 'shift'); assert.equal(D.clockLabel(clock), '06:12');
  assert.deepEqual([s.time, s.position, s.recording.tick, s.target], frozen);
  const dawn = D.sunlight(clock);
  assert.ok(dawn[0] > dusk[0] && dusk[0] > night[0]); assert.ok(dawn[2] > 0.99 && dusk[2] < -0.99);
  R.command(s, 'shift'); assert.equal(D.clockLabel(clock), '18:05');
});

test('clock, curves, guard dispatch, passengers and recordings agree at different input frame rates', () => {
  function drive(fps) {
    const s = R.createRide();
    const wait = sec => { for (let i = 0; i < sec * fps; i++) R.advance(s, 1 / fps); };
    for (const action of ['shift', 'limits', 'guard', 'doors']) R.command(s, action);
    selectSpeed(s, 80); wait(9); R.command(s, 'doors'); wait(2); R.command(s, 'bell');
    wait(25); R.command(s, 'pause'); wait(1); R.command(s, 'pause'); wait(24);
    assert.equal(s.sheet.count, 1); assert.equal(s.berth, 1); assert.equal(s.guard.cleared, false);
    assert.equal(s.sheet.entries[0].arrivalClock, D.clockLabel(s.clock));
    return { ...s, fraction: 0 };
  }
  assert.deepEqual(drive(144), drive(20));
});
