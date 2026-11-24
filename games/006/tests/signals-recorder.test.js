'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const G = require('../js/signals.js');
const log = require('../js/recorder.js');
const tick = 1 / 60;

function service(target = 80, manual = false) {
  const s = R.createRide();
  R.command(s, 'signals');
  if (manual) R.command(s, 'mode');
  while (s.target < target) R.command(s, 'faster');
  return s;
}
function until(s, predicate, seconds = 180) {
  for (let i = 0; i < seconds * 60 && !predicate(s); i++) R.advance(s, tick);
  assert.ok(predicate(s), 'reached the requested point in service');
}

test('each leg has an advance warning and a stop signal belonging to the correct absolute block', () => {
  const period = R.LENGTH / R.CHUNK, markers = [];
  for (let i = 0; i < period; i++) {
    const marker = G.markerInChunk(i);
    assert.equal(G.markerInChunk(i - period), marker);
    assert.equal(G.markerInChunk(i + period * 9000), marker);
    if (marker) markers.push(marker);
  }
  assert.equal(markers.length, 2 * R.STATIONS.length);
  for (const lap of [-1, 0, 9000]) for (const [leg, station] of R.STATIONS.entries()) {
    const s = service(), start = lap * R.LENGTH + station.at;
    Object.assign(s, { berth: leg, last: leg, position: start, nextMark: start + R.legLength(leg) });
    const [warning, home] = markers.filter(marker => marker.leg === leg);
    assert.ok(warning.distant && !home.distant);
    assert.ok(warning.at > station.at && home.at > warning.at + 100);
    assert.equal(R.stationAt(home.at), -1);
    assert.equal(G.homeMark(s), lap * R.LENGTH + home.at);
    assert.equal(G.aspect(s, warning, lap * R.LENGTH + warning.at), G.CAUTION);
    assert.equal(G.aspect(s, home, lap * R.LENGTH + home.at), G.STOP);
    assert.equal(G.aspect(s, home, (lap + 1) * R.LENGTH + home.at), G.CLEAR);
    const another = markers.find(m => m.leg !== leg);
    assert.equal(G.aspect(s, another, lap * R.LENGTH + another.at), G.CLEAR);
    R.command(s, 'signals');
    assert.equal(G.aspect(s, home, lap * R.LENGTH + home.at), G.CLEAR);
    assert.equal(G.indication(s), null);
  }
});

test('the reservation starts at departure and a red signal brings both driving modes smoothly to the same stop', () => {
  for (const manual of [false, true]) {
    const s = service(0, manual), hold = G.homeMark(s) - G.SETBACK;
    R.advance(s, 60); R.command(s, 'doors'); R.advance(s, 15);
    assert.equal(G.secondsToClear(s), 35);
    for (let i = 0; i < 8; i++) R.command(s, 'faster');
    let braked = false, regenerated = false;
    until(s, state => state.speed === 0 && state.position === hold, 31);
    assert.equal(R.driveState(s), 'Signal hold'); assert.equal(s.sheet.count, 0);
    assert.match(R.command(s, 'doors'), /berthed/); assert.match(R.command(s, 'signals'), /berthed/);
    assert.equal(s.door, 0); assert.equal(s.berth, null);
    assert.ok(G.secondsToClear(s) > 8 && G.secondsToClear(s) < 10);
    for (const p of s.recording.samples) {
      assert.ok(p.metres <= hold);
      if (p.power < 0) regenerated = true;
      if (p.metres > 130 && p.speed > 0 && p.speed < 45) braked = true;
    }
    assert.ok(braked && regenerated);
    const energy = { ...s.meter, power: 0 };
    R.advance(s, 2);
    assert.deepEqual(s.meter, energy); assert.equal(s.position, hold);
    R.command(s, 'pause'); const paused = structuredClone(s);
    R.advance(s, 300); assert.deepEqual(s, paused);
    R.command(s, 'pause');
    until(s, state => G.secondsToClear(state) === 0, 10);
    assert.equal(s.target, 80); assert.ok(s.speed > 0 && s.speed <= 1.1 * tick + 1e-9);
    until(s, state => state.berth === 1);
    assert.equal(s.sheet.entries[0].booked, 64);
    if (manual) assert.equal(s.sheet.entries[0].atLimit, true);
    else assert.equal(s.sheet.entries[0].seconds, 62);
  }
});

test('all five signal stops repeat across the loop seam without crossing a red or exceeding service brake effort', () => {
  const s = service();
  for (let visit = 1; visit <= 6; visit++) {
    const mark = G.homeMark(s) - G.SETBACK, lastCount = s.sheet.count;
    let held = false, brakes = 0;
    for (let i = 0; i < 80 * 60 && s.sheet.count === lastCount; i++) {
      const speed = s.speed;
      R.advance(s, tick);
      if (s.sheet.count !== lastCount) break;
      assert.ok(s.speed >= speed - 1.36*tick - 1e-7);
      if (G.secondsToClear(s)) {
        assert.ok(s.position <= mark + 1e-9);
        held ||= s.position === mark && s.speed === 0;
        if (s.signalBrake && s.speed > 0) brakes++;
      }
    }
    assert.ok(held && brakes > 100);
    assert.equal(s.sheet.count, visit); assert.equal(s.berth, visit % R.STATIONS.length);
    assert.ok(Math.abs(s.sheet.entries[0].seconds - s.sheet.entries[0].booked) <= 5);
  }
});

test('a slow train gets green on approach and the driver keeps control of a zero target or coast after release', () => {
  const slow = service(10);
  R.advance(slow, 35);
  assert.ok(slow.position < G.homeMark(slow) - 90); assert.equal(G.secondsToClear(slow), 0);
  assert.equal(slow.signalBrake, false);
  assert.equal(G.indication(slow).aspect, G.CLEAR);
  until(slow, s => s.position > G.homeMark(s)); assert.equal(G.indication(slow), null);

  for (const action of ['brake', 'coast']) {
    const s = service();
    until(s, ride => R.driveState(ride) === 'Signal hold');
    R.command(s, action); R.advance(s, 18);
    assert.equal(s.speed, 0); assert.equal(s.position, G.homeMark(s) - G.SETBACK);
    assert.equal(R.driveState(s), 'Stopped'); assert.equal(s.sheet.count, 0);
    R.command(s, action === 'coast' ? 'coast' : 'faster'); R.advance(s, tick);
    assert.ok(s.speed > 0);
  }
});

test('a trace starts on departure, samples the live instruments and ends exactly when the doors unlock', () => {
  const s = service(0);
  R.advance(s, 10);
  assert.equal(s.recording, null);
  for (let i = 0; i < 8; i++) R.command(s, 'faster');
  R.advance(s, 7.5);
  const first = s.recording.samples[0], sample = s.recording.samples.at(-1);
  assert.deepEqual(first, { tick: 0, metres: 0, speed: 0, target: 80, power: 0 });
  assert.deepEqual(sample, { tick: 450, metres: s.position, speed: s.speed*3.6, target: s.target, power: s.meter.power });
  R.command(s, 'coast'); R.advance(s, 0.5); assert.equal(s.recording.samples.at(-1).power, 0);
  R.command(s, 'coast');
  until(s, ride => ride.berth === 1);
  const entry = s.sheet.entries[0], trace = entry.trace, last = trace.at(-1);
  assert.equal(entry.number, 1); assert.equal(s.recording, null);
  assert.equal(last.metres, 432); assert.equal(last.power, 0); assert.equal(last.speed, 0);
  assert.equal(last.tick, Math.round((s.time - 10) * 60));
  assert.equal(entry.seconds, Math.round(last.tick/60));
  assert.ok(trace.some(p => p.power < 0));
  assert.ok(trace.some(p => p.speed === 0 && p.metres === 206 && p.target === 80));
  const saved = structuredClone(trace);
  R.advance(s, 14); assert.deepEqual(trace, saved);
  assert.notEqual(s.recording.samples, trace);
  assert.equal(s.recording.samples[0].metres, 0);
});

test('long recordings keep their endpoints and bounded, ordered samples even when arrival falls on a compaction tick', () => {
  const s = R.createRide(), n = log.MAX_SAMPLES;
  for (const duration of [30, (n-1)*30, (n-1)*30+1, n*30, n*120+1]) {
    const recording = log.begin(s);
    for (let i = 1; i <= duration; i++) {
      log.advance(recording, s, i === duration);
      assert.ok(recording.samples.length <= n);
    }
    const times = recording.samples.map(p => p.tick);
    assert.equal(times[0], 0); assert.equal(times.at(-1), duration);
    assert.ok(times.every((t,i) => i === 0 || t > times[i-1]));
    assert.ok(times.slice(0,-1).every(t => t % recording.interval === 0));
  }
});

test('recorder and signals agree across display rates, including signal release and reverse levelling', () => {
  function run(hz) {
    const s = service(80, true);
    for (let i = 0; i < hz * 85; i++) R.advance(s, 1 / hz);
    const entry = s.sheet.entries[0];
    assert.equal(entry.atLimit, true); assert.ok(entry.trace.some(p => p.metres > 439));
    assert.equal(entry.trace.at(-1).metres, 432);
    return entry;
  }
  const expected = run(60);
  for (const hz of [24, 144]) assert.deepEqual(run(hz), expected);
});
