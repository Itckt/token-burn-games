'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const C = require('../js/camera.js');
const comfort = require('../js/comfort.js');
const saloon = require('../js/saloon.js');
const duties = require('../js/duties.js');
const signals = require('../js/signals.js');
const dt = 1 / 60;

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' vs ' + expected);
}
function depart(card = 'free', target = 80, manual = false) {
  const s = R.createRide();
  assert.equal(R.selectDuty(s, card), '');
  if (manual) R.command(s, 'mode');
  for (let i = 0; i < target; i += 10) R.command(s, 'faster');
  R.advance(s, dt);
  return s;
}
function until(s, predicate, hz = 60) {
  for (let i = 0; i < hz * 240 && !predicate(); i++) R.advance(s, 1 / hz);
  assert.ok(predicate(), 'reached the expected point in service');
}

test('passenger eye moves within the carriage, follows its heading, and keeps its seat on a free look', () => {
  const c = C.createCamera(), slow = C.createCamera();
  const eye = () => C.eye(c, 0, 0, 0, 1, 0);
  assert.deepEqual(eye(), [-0.12, 2.465, 0]);
  C.setView(c, 'saloon'); C.setView(slow, 'saloon');
  assert.equal(c.seat, 0); assert.ok(C.moving(c));
  for (let i = 0; i < 6; i++) C.advance(c, 1 / 60);
  for (let i = 0; i < 3; i++) C.advance(slow, 1 / 30);
  assert.ok(c.seat > 0 && c.seat < 1); near(c.seat, slow.seat); near(c.yaw, slow.yaw);
  C.advance(c, 5); assert.equal(C.moving(c), false);
  const [x, y, z] = eye();
  assert.ok(x < -0.92 && x > -1.37 && y > 1.99 && y < 2.66 && z > 4.45 && z < 5.22);
  const turned = C.eye(c, 0, 0, 17, 0, 1);
  near(turned[0], 17 - z); near(turned[1], y); near(turned[2], x);
  C.pan(c, 0.42, -0.16); C.advance(c, 5);
  assert.equal(c.preset, 'free'); assert.deepEqual(eye(), [x, y, z]);
  for (const preset of ['front', 'left', 'platform']) {
    C.setView(c, 'saloon'); C.advance(c, 5); C.setView(c, preset); C.advance(c, 5);
    assert.deepEqual(eye(), [-0.12, 2.465, 0]);
  }
});

test('the passenger sign follows the actual doors, the protected signal and the 80 m approach across laps', () => {
  const s = R.createRide();
  const current = key => assert.equal(saloon.message(s).stage.key, key);
  current('ready'); R.command(s, 'doors'); current('opening');
  R.advance(s, R.DOOR_TIME); current('dwell'); R.command(s, 'doors'); current('closing');
  R.command(s, 'doors'); current('opening');
  assert.match(saloon.message(s).chinese, /九龍塘/);
  Object.assign(s, { berth: 1, phase: 'dwell' });
  assert.match(saloon.message(s).english, /HKBU exit on right · Campus Gate/);
  s.phase = 'closing'; current('closing');
  for (const lap of [0, 23]) for (const [leg, station] of R.STATIONS.entries()) {
    Object.assign(s, { phase: 'running', berth: null, last: leg, signalled: true,
      speed: 0, position: lap * R.LENGTH + station.at, nextMark: lap * R.LENGTH + station.at + R.legLength(leg) });
    s.sheet.departedAt = s.time; s.position = signals.homeMark(s) - signals.SETBACK;
    current('hold'); assert.equal(saloon.message(s).station, R.nextStation(leg));
    s.time += 60; current('next');
    s.position = s.nextMark - saloon.APPROACH - 0.001; current('next');
    s.position = s.nextMark - saloon.APPROACH; current('arriving');
    s.position = s.nextMark + R.LEVEL_RANGE; current('arriving');
    assert.ok(saloon.message(s).english.endsWith(R.STATIONS[R.nextStation(leg)].name));
  }
});

test('signed track curvature matches the mesh centreline through bends, level platforms and the seam', () => {
  for (const lap of [-4, 0, 719]) for (const [i, station] of R.STATIONS.entries()) {
    const start = lap * R.LENGTH + station.at;
    for (const offset of [-R.STATION_BACK, 0, R.STATION_FRONT]) assert.equal(R.trackCurvature(start + offset), 0);
    for (let metres = R.STATION_FRONT + 1; metres < R.legLength(i) - R.STATION_BACK; metres += 9.5) {
      const x = start + metres, h = 0.1;
      const second = (R.trackOffset(x + h) - 2 * R.trackOffset(x) + R.trackOffset(x - h)) / (h * h);
      near(R.trackCurvature(x), second / Math.pow(1 + R.trackSlope(x) ** 2, 1.5), 1e-8);
    }
  }
});

test('handstraps settle aft under power, lean out of a bend and return exactly to vertical at rest', () => {
  const s = comfort.createSwing();
  for (let i = 0; i < 180; i++) comfort.swing(s, 1.1, 0.85, dt);
  near(s.rear, Math.atan2(1.1, 9.81), 1e-5);
  near(s.side, -Math.atan2(0.85, 9.81), 1e-5);
  const before = s.rear;
  comfort.swing(s, -2.5, 0, dt);
  assert.ok(s.rear < before && s.rear > 0, 'the strap retains momentum when braking starts');
  for (let i = 0; i < 90; i++) comfort.swing(s, -2.5, 0, dt);
  assert.ok(s.rear < -0.23);
  for (let i = 0; i < 180; i++) comfort.swing(s, 0, 0, dt);
  assert.deepEqual(s, comfort.createSwing()); assert.equal(comfort.active(s), false);
  const log = comfort.createLog();
  comfort.travel({ swing: s, quality: log, position: 0, speed: dt }, 0, dt * dt / 2, dt, -1, false);
  assert.ok(s.rear < 0, 'picking up speed in reverse tilts a grip towards the front');
  assert.equal(log.peakBrake, 0);
});

test('duty selection respects the berth and suspension, including a guarded wait and a standstill on the line', () => {
  const s = R.createRide();
  for (const invalid of [null, ['smooth'], 'toString', 'unknown']) {
    assert.match(R.selectDuty(s, invalid), /listed/); assert.equal(s.duty, 'free');
  }
  R.command(s, 'guard'); R.command(s, 'faster'); R.advance(s, 3);
  assert.equal(R.selectDuty(s, 'mark'), ''); assert.equal(s.manual, false);
  R.command(s, 'pause'); assert.match(R.selectDuty(s, 'smooth'), /Resume/); R.command(s, 'pause');
  R.command(s, 'guard'); R.advance(s, 2); R.command(s, 'brake'); R.advance(s, 4);
  assert.equal(s.speed, 0); assert.equal(s.berth, null);
  assert.match(R.selectDuty(s, 'free'), /berthed/); assert.equal(s.duty, 'mark');
});

test('coasting duty counts only freely rolling metres and scores one copy at the door unlock', () => {
  const s = depart('coast');
  until(s, () => s.position >= 100);
  const start = s.position;
  R.command(s, 'coast');
  until(s, () => s.meter.power < -0.1);
  const coast = s.quality.coastMetres;
  assert.ok(coast > 250 && coast < 280);
  assert.ok(Math.abs(s.position - start - coast) < 1, 'supervised braking has just started');
  until(s, () => s.sheet.count === 1);
  const [entry] = s.sheet.entries;
  assert.equal(entry.quality.coastMetres, coast); assert.ok(entry.duty.passed);
  assert.match(entry.duty.detail, /274 m coasted/); assert.equal(entry.seconds, 43);
  const saved = structuredClone(entry);
  R.command(s, 'brake'); R.advance(s, 20);
  assert.equal(R.selectDuty(s, 'smooth'), ''); R.command(s, 'faster'); R.advance(s, 2);
  assert.equal(s.quality.coastMetres, 0); assert.deepEqual(entry, saved);
  assert.notEqual(s.quality, entry.quality);
});

test('a slow or powered trip can miss the coasting duty and timing uses the booked working for the leg', () => {
  const s = depart('coast');
  until(s, () => s.sheet.count === 1);
  const [entry] = s.sheet.entries; assert.equal(entry.duty.passed, false);
  const quality = { ...entry.quality, coastMetres: 108 };
  const result = (metres, seconds, booked) => duties.result('coast',
    { ...entry, quality: { ...quality, coastMetres: metres }, seconds, booked });
  assert.ok(result(108, 52, 42).passed);
  assert.equal(result(107.999, 42, 42).passed, false);
  assert.equal(result(108, 53, 42).passed, false);
  assert.ok(result(108, 73, 64).passed);
  assert.equal(duties.result('free', entry), null);
});

test('steady carriage grades measured acceleration and precision grades the original signed manual stop', () => {
  for (const [card, speed, manual, drive, passed] of [
    ['smooth', 40, false, false, true], ['smooth', 80, false, false, false],
    ['mark', 50, false, false, false], ['mark', 80, true, false, false], ['mark', 50, true, true, true]
  ]) {
    const s = depart(card, speed, manual);
    if (drive) { until(s, () => R.brakeCue(s) === 'Brake now'); R.command(s, 'brake'); }
    until(s, () => s.sheet.count === 1);
    const [entry] = s.sheet.entries;
    assert.equal(entry.duty.passed, passed, JSON.stringify(entry.duty));
    if (card === 'smooth') {
      near(entry.quality.peakBrake, 1.36);
      near(entry.quality.peakSide, passed ? 0.61 : 2.28, 0.01);
    } else {
      assert.equal(entry.atLimit, manual && !drive);
      assert.match(entry.duty.detail, drive ? /On mark/ : manual ? /Limit/ : /Automatic/);
    }
  }
});

test('comfort, duty and the service record agree across frame partitions and exclude paused time', () => {
  function trip(hz) {
    const s = depart('smooth', 60);
    for (let i = 0; i < 12 * hz; i++) R.advance(s, 1 / hz);
    R.command(s, 'pause'); const saved = structuredClone(s);
    R.advance(s, 900); assert.deepEqual(s, saved); R.command(s, 'pause');
    for (let i = 0; i < 30 * hz; i++) R.advance(s, 1 / hz);
    return { swing: s.swing, quality: s.quality, entry: s.sheet.entries[0] };
  }
  const reference = trip(60); assert.ok(reference.entry);
  for (const hz of [24, 144]) assert.deepEqual(trip(hz), reference);
});

test('outcomes distinguish a near miss at the stop board and agree with the displayed force precision', () => {
  const entry = { quality: { peakSide: 0.8505, peakBrake: 1.604 }, error: 1, atLimit: false };
  assert.ok(duties.result('smooth', entry).passed);
  entry.quality.peakBrake = 1.606;
  assert.equal(duties.result('smooth', entry).passed, false);
  assert.match(duties.result('smooth', entry).detail, /1\.61/);
  for (const sign of [-1, 1]) {
    entry.error = sign;
    assert.ok(duties.result('mark', entry).passed);
    entry.error = sign * 1.003;
    const result = duties.result('mark', entry);
    assert.equal(result.passed, false); assert.match(result.detail, /Just over 1\.0 m/);
  }
});
