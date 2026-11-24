'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const S = require('../js/service.js');
const tick = 1 / 60;

function depart(target, manual = true) {
  const s = R.createRide();
  if (manual) R.command(s, 'mode');
  while (s.target < target) R.command(s, 'faster');
  return s;
}

function until(s, done, seconds = 200) {
  for (let i = 0; i < seconds * 60 && !done(s); i++) R.advance(s, tick);
  assert.ok(done(s), 'reached the requested state in simulated time');
}

test('both viaducts join tunnels on chunk boundaries and repeat on either side of the loop seam', () => {
  assert.equal(R.VIADUCTS.length, 2);
  for (const lap of [-2, 0, 1, 9000]) for (const span of R.VIADUCTS) {
    const at = lap * R.LENGTH;
    assert.equal(span.start % R.CHUNK, 0);
    assert.equal(span.end % R.CHUNK, 0);
    assert.equal(R.locationName(at + span.start - 0.01), 'Running tunnel');
    assert.equal(R.viaductAt(at + span.end), null);
    assert.equal(R.locationName(at + span.end), 'Running tunnel');
    for (const d of [span.start, span.start + 1, span.end - 0.01]) {
      assert.equal(R.stationAt(at + d), -1);
      assert.equal(R.viaductAt(at + d), span);
      assert.equal(R.locationName(at + d), span.name);
    }
    assert.equal(R.locationName(at), 'Kowloon Tong');
  }
});

test('manual stopping is opt-in at the berth, follows normal door interlocks and locks the mode during a run', () => {
  const s = R.createRide();
  assert.equal(s.manual, false);
  R.command(s, 'doors'); R.advance(s, 0.5);
  R.command(s, 'mode'); R.command(s, 'faster'); R.advance(s, 0.5);
  assert.equal(s.manual, true);
  assert.equal(s.berth, 0); assert.equal(s.position, 0);
  assert.equal(s.sheet.departedAt, null);
  R.command(s, 'doors'); until(s, r => r.berth === null);
  assert.equal(s.door, 0);
  assert.match(R.command(s, 'mode'), /berthed/);
  assert.equal(s.manual, true);
  R.command(s, 'pause');
  assert.match(R.command(s, 'mode'), /Resume/);
  assert.equal(R.keyAction('KeyM'), 'mode');
});

test('cab light and rail acoustics have the same continuous exposure envelope at every portal', () => {
  for (const lap of [-1, 0, 110]) for (const span of R.VIADUCTS) {
    for (const [offset, exposure] of [[-13, 0], [-12, 0], [-6, 0.15625], [0, 0.5], [6, 0.84375], [12, 1], [20, 1]]) {
      assert.equal(R.openAir(lap * R.LENGTH + span.start + offset), exposure);
      assert.equal(R.openAir(lap * R.LENGTH + span.end - offset), exposure);
    }
  }
  R.STATIONS.forEach(station => assert.equal(R.openAir(station.at), 0));
});

test('following the brake cue at every target speed earns an on-mark stop with the original signed error', () => {
  for (let target = 10; target <= 80; target += 10) {
    const s = depart(target);
    until(s, r => R.brakeCue(r) === 'Brake now');
    const predicted = R.brakeOffset(s);
    R.command(s, 'brake');
    assert.match(R.brakeCue(s), /Braking/);
    until(s, r => r.alignment !== null);
    const error = s.position - s.nextMark;
    assert.ok(Math.abs(predicted - error) < 0.001, 'braking prediction agrees with integrated motion');
    assert.ok(Math.abs(error) <= S.MARK_TOLERANCE);
    assert.equal(s.sheet.count, 0);
    for (let i = 0; i < 300 && s.alignment; i++) {
      const previousSpeed = s.speed;
      R.advance(s, tick);
      assert.ok(Math.abs(s.speed - previousSpeed) <= 1.1 * tick + 1e-8);
    }
    assert.deepEqual([s.position, s.speed, s.door, s.phase, s.target], [432, 0, 0, 'opening', 0]);
    const [entry] = s.sheet.entries;
    assert.equal(entry.error, error);
    assert.equal(entry.atLimit, false);
    assert.match(S.markLabel(entry.error, entry.atLimit), /^On mark/);
    R.advance(s, 20);
    assert.equal(s.sheet.count, 1);
    assert.equal(s.berth, 1);
  }
});

test('an early stop can wait and creep up, and requesting a high target from rest does not falsely report braking', () => {
  const s = depart(30);
  until(s, r => r.position >= 360);
  R.command(s, 'brake'); until(s, r => r.speed === 0);
  const short = s.position;
  assert.ok(s.nextMark - short > R.LEVEL_RANGE);
  R.advance(s, 12);
  assert.equal(s.position, short); assert.equal(s.berth, null);
  assert.match(R.brakeCue(s), /Move up/);
  while (s.target < 80) R.command(s, 'faster');
  R.advance(s, tick);
  assert.equal(s.protection, false);
  assert.equal(R.driveState(s), 'Powering');
  until(s, r => R.brakeOffset(r) >= -5);
  R.command(s, 'brake'); until(s, r => r.alignment !== null);
  assert.ok(s.alignment.error >= -5 && s.alignment.error < -4);
  until(s, r => r.berth === 1);
  assert.match(S.markLabel(s.sheet.entries[0].error, false), /m short$/);
});

test('an unattended manual approach stops at its overrun limit and reverses to the berth with doors locked', () => {
  const s = depart(80);
  until(s, r => r.protection);
  assert.equal(R.driveState(s), 'Protection');
  assert.match(R.brakeCue(s), /Overrun/);
  until(s, r => r.alignment !== null);
  const mark = s.nextMark;
  assert.deepEqual([s.position, s.speed, s.target], [mark + R.LEVEL_RANGE, 0, 0]);
  assert.equal(s.alignment.atLimit, true);
  R.advance(s, 1.1);
  R.command(s, 'pause');
  const saved = structuredClone(s);
  R.advance(s, 3600); assert.deepEqual(s, saved);
  R.command(s, 'pause');
  for (const action of ['doors', 'faster', 'brake']) assert.match(R.command(s, action), /locked/);
  assert.match(R.command(s, 'mode'), /berthed/);
  for (let i = 0; i < 600 && s.alignment; i++) {
    const previous = s.position;
    assert.equal(s.berth, null); assert.equal(s.door, 0);
    assert.ok(s.speed <= 1.25);
    R.advance(s, tick);
    assert.ok(s.position <= previous && s.position >= mark);
  }
  assert.equal(s.alignment, null);
  assert.equal(s.position, mark); assert.equal(s.berth, 1);
  assert.equal(s.sheet.entries[0].error, 8);
  assert.equal(S.markLabel(8, true), 'Limit · 8.0 m long');
  R.command(s, 'mode'); R.command(s, 'faster');
  until(s, r => r.berth === 2);
  assert.equal(s.sheet.entries[0].error, null);
  assert.equal(s.target, 10);
});

test('the eight-metre pickup boundary is inclusive and stops just outside it can move again', () => {
  for (const [offset, expected] of [[-8.001, 'running'], [-8, 'aligning'], [0, 'opening'], [4, 'aligning']]) {
    const s = depart(10);
    R.advance(s, tick);
    Object.assign(s, { speed: 0, target: 0, position: s.nextMark + offset });
    R.advance(s, tick);
    assert.equal(s.phase, expected, String(offset));
    if (expected === 'running') {
      assert.match(R.command(s, 'doors'), /berthed/);
      R.command(s, 'faster'); R.advance(s, 0.1); assert.ok(s.speed > 0);
    } else if (expected === 'aligning') {
      assert.equal(s.alignment.error, offset);
      until(s, r => r.berth === 1);
      assert.equal(s.sheet.entries[0].error, offset);
    } else assert.equal(s.sheet.entries[0].error, 0);
  }
});

test('manual protection, levelling, run entries and fractional ticks agree across different frame rates', () => {
  const reference = depart(80);
  R.advance(reference, 55);
  for (const rate of [24, 60, 144]) {
    const s = depart(80);
    for (let i = 0; i < rate * 55; i++) R.advance(s, 1 / rate);
    assert.ok(s.fraction < 1e-8);
    assert.deepEqual({ ...s, fraction: 0 }, { ...reference, fraction: 0 });
  }
});

test('the run clock starts on departure, includes a stop between stations and excludes pause and platform waits', () => {
  function timedRun(waitAtOrigin, hold, pause) {
    const s = R.createRide();
    R.advance(s, waitAtOrigin);
    assert.equal(s.sheet.departedAt, null);
    R.command(s, 'faster'); R.advance(s, 3);
    assert.ok(Math.abs(s.sheet.departedAt - waitAtOrigin) < 1e-8);
    R.command(s, 'brake'); until(s, r => !r.speed);
    R.advance(s, hold);
    R.command(s, 'pause'); R.advance(s, pause); R.command(s, 'pause');
    while (s.target < 60) R.command(s, 'faster');
    until(s, r => r.berth === 1);
    assert.equal(s.sheet.departedAt, null);
    assert.equal(s.sheet.entries[0].booked, R.STATIONS[0].booked);
    R.command(s, 'brake'); R.advance(s, 600); R.command(s, 'doors'); R.advance(s, 12);
    assert.equal(s.sheet.count, 1);
    return s.sheet.entries[0].seconds;
  }
  assert.equal(timedRun(20, 12, 100) - timedRun(0, 0, 0), 12);
});

test('the run sheet rolls over the line seam and retains the latest five of eleven arrivals in order', () => {
  const s = depart(80, false);
  for (let n = 1; n <= 11; n++) {
    until(s, r => r.sheet.count === n);
    assert.equal(s.berth, n % 5);
    assert.equal(s.sheet.entries.length, Math.min(n, 5));
    s.sheet.entries.forEach((entry, i) => {
      assert.equal(entry.to, (n - i) % 5);
      assert.equal(entry.from, (n - i - 1) % 5);
      assert.equal(entry.booked, R.STATIONS[entry.from].booked);
      assert.equal(entry.error, null);
      assert.ok(Number.isInteger(entry.seconds) && entry.seconds > 0);
    });
  }
});

test('clock, punctuality and signed stopping labels handle minute rollover and both edges of each allowance', () => {
  assert.deepEqual([0, 59.9, 60 - 1e-12, 65, 3601].map(S.clockLabel), ['0:00', '0:59', '1:00', '1:05', '60:01']);
  assert.deepEqual([36, 37, 42, 47, 48].map(t => S.timingLabel(t, 42)),
    ['6 s early', 'On time', 'On time', 'On time', '6 s late']);
  assert.equal(S.markLabel(null, false), 'Automatic');
  assert.equal(S.markLabel(-0.01, false), 'On mark');
  for (const side of [-1, 1]) {
    assert.match(S.markLabel(side, false), /^On mark/);
    assert.doesNotMatch(S.markLabel(side * 1.1, false), /^On mark/);
  }
});

test('a zero-target assisted stop within rounding distance unlocks, and an overflow-sized time step is ignored', () => {
  const s = depart(10, false);
  R.advance(s, tick);
  Object.assign(s, { position: s.nextMark - 0.0001, target: 0, speed: 0 });
  R.advance(s, tick);
  assert.equal(s.berth, 1); assert.equal(s.position, 432);
  const saved = structuredClone(s);
  R.advance(s, Number.MAX_VALUE);
  assert.deepEqual(s, saved);
});
