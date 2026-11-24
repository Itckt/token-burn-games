'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const T = require('../js/traction.js');
const W = require('../js/weather.js');
const tick = 1 / 60;
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, actual + ' vs ' + expected);

function depart(manual = false) {
  const s = R.createRide();
  if (manual) R.command(s, 'mode');
  for (let i = 0; i < 8; i++) R.command(s, 'faster');
  return s;
}
function until(s, done, seconds = 100) {
  for (let i = 0; i < seconds * 60 && !done(s); i++) R.advance(s, tick);
  assert.ok(done(s), 'reached requested state');
}

test('traction meter converts mechanical work to kWh and signed kW with losses in both directions', () => {
  const m = T.createMeter();
  T.measure(m, 0, 0, 10, 50, 10, false);
  const drawn = 36000 * (50 + 0.055 * 50) / 0.86;
  near(m.drawn, drawn / 3600000); near(m.power, drawn / 10000); assert.equal(m.returned, 0);
  T.measure(m, 0, 10, 0, 20, 4, false);
  const returned = 36000 * (50 - (0.055 + 0.034) * 20) * 0.64;
  near(m.returned, returned / 3600000); near(m.power, -returned / 4000);
  near(m.drawn, drawn / 3600000);
  const loaded = T.createMeter();
  T.measure(loaded, 10, 0, 10, 50, 10, false);
  near(loaded.drawn / m.drawn, 36700 / 36000);
  T.measure(m, 0, 0, 0, 0, tick, false);
  assert.equal(m.power, 0);
});

test('coasting holds the selected target, sheds speed to resistance, and returns power on driver input', () => {
  const s = depart();
  assert.match(R.command(s, 'coast'), /depart/);
  R.advance(s, 8); const before = s.speed, energy = { ...s.meter };
  R.command(s, 'coast');
  assert.equal(R.driveState(s), 'Coasting');
  R.advance(s, tick);
  near(s.speed, before - T.resistance(before) * tick);
  R.advance(s, 5);
  assert.deepEqual([s.target, s.coasting, s.meter.power], [80, true, 0]);
  near(s.meter.drawn, energy.drawn); near(s.meter.returned, energy.returned);
  R.command(s, 'coast'); R.advance(s, tick);
  assert.equal(s.coasting, false); assert.ok(s.meter.power > 0);
  for (const action of ['slower', 'faster', 'brake']) {
    R.command(s, 'coast'); R.command(s, action); R.advance(s, tick);
    assert.equal(s.coasting, false);
  }
  assert.ok(s.hardBrake && s.meter.power < 0);
  assert.match(R.command(s, 'coast'), /target/);
});

test('an early coast can roll to rest short of the platform and restart at its saved target', () => {
  for (const manual of [true, false]) {
    const s = depart(manual); R.advance(s, 0.5); R.command(s, 'coast');
    until(s, r => !r.speed);
    const position = s.position;
    R.advance(s, 2);
    assert.deepEqual([s.speed, s.position, s.berth, s.target, s.meter.power], [0, position, null, 80, 0]);
    assert.equal(R.driveState(s), 'Stopped');
    if (manual) assert.match(R.brakeCue(s), /Move up/);
    R.command(s, 'coast'); R.advance(s, tick);
    assert.ok(s.speed > 0 && s.meter.power > 0);
  }
  const s = depart(); R.advance(s, 0.5);
  s.position = s.nextMark - 3.25;
  R.command(s, 'coast'); until(s, r => !r.speed);
  assert.ok(s.nextMark - s.position > 0.49 && s.nextMark - s.position < 0.51);
  assert.equal(R.driveState(s), 'Stopped', 'a standstill inside the one-metre approach cue still needs traction');
  R.command(s, 'coast'); until(s, r => r.berth === 1);
});

test('coasting to Campus Gate saves net energy, regenerates during the assisted stop and books one immutable result', () => {
  const normal = depart(), coast = depart();
  until(normal, r => r.berth === 1);
  until(coast, r => r.position >= 100); R.command(coast, 'coast');
  until(coast, r => r.meter.power < 0);
  assert.equal(coast.coasting, true);
  until(coast, r => r.berth === 1);
  const entry = coast.sheet.entries[0], baseline = normal.sheet.entries[0];
  assert.ok(entry.returned > 0 && entry.returned < entry.drawn);
  assert.ok(entry.drawn - entry.returned < baseline.drawn - baseline.returned);
  assert.ok(entry.seconds > baseline.seconds && Math.abs(entry.seconds - entry.booked) <= 5);
  assert.deepEqual([coast.target, coast.meter.power, coast.coasting], [80, 0, false]);
  const saved = structuredClone(entry);
  R.advance(coast, R.DWELL_TIME);
  assert.equal(coast.meter.drawn, entry.drawn);
  until(coast, r => r.berth === null);
  assert.ok(coast.meter.drawn < 0.001 && coast.meter.returned === 0);
  assert.deepEqual(entry, saved);
});

test('manual overrun protection can brake while coasting and meters reverse levelling before the doors unlock', () => {
  const s = depart(true); until(s, r => r.position >= 140);
  R.command(s, 'coast');
  until(s, r => r.protection);
  assert.equal(R.driveState(s), 'Protection'); assert.ok(s.meter.power < 0);
  until(s, r => r.alignment);
  assert.equal(s.coasting, false);
  const drawnBefore = s.meter.drawn, returnedBefore = s.meter.returned;
  assert.match(R.command(s, 'coast'), /locked/);
  until(s, r => r.berth === 1);
  assert.equal(s.sheet.entries[0].atLimit, true);
  assert.ok(s.meter.drawn > drawnBefore && s.meter.returned > returnedBefore);
});

test('rain follows portal exposure on later laps and a tunnel lets the outside glass and swept fan dry', () => {
  const dry = W.createWeather(); dry.rain = true;
  for (let i = 0; i < 180; i++) W.advance(dry, tick, 0);
  assert.deepEqual([dry.cloud, dry.water, dry.sweep], [1, 0, null]);
  const wetAt = position => {
    const w = W.createWeather(); w.rain = true;
    for (let i = 0; i < 300; i++) W.advance(w, tick, position);
    return w;
  };
  const portal = wetAt(R.VIADUCTS[0].start);
  near(portal.water, 0.5);
  const w = wetAt(170);
  assert.equal(w.water, 1); assert.deepEqual(w, wetAt(R.LENGTH * 85 + 170));
  assert.ok(w.film.every(v => v >= 0 && v <= w.water));
  for (let i = 0; i < 600; i++) W.advance(w, tick, 450);
  assert.equal(w.water, 0); assert.equal(w.sweep, null);
  assert.deepEqual(w.film, Array(8).fill(0));
  assert.equal(W.active(w), false);
  w.rain = false;
  for (let i = 0; i < 120; i++) W.advance(w, tick, 450);
  assert.equal(w.cloud, 0); assert.equal(W.active(w), false);
});

test('a manual wiper pass clears crossed angles in order, preserves water beyond the fan and parks after one cycle', () => {
  const w = W.createWeather(); w.film.fill(1); w.water = 1;
  W.wipe(w);
  for (let i = 0; i < 21; i++) W.advance(w, tick, 0);
  near(W.bladeAngle(w), W.BLADE.arc * 0.5);
  assert.equal(w.film[1], 0); assert.ok(w.film[6] > 0.9);
  const phase = w.sweep; W.wipe(w); assert.equal(w.sweep, phase);
  for (let i = 0; i < 21; i++) W.advance(w, tick, 0);
  near(W.bladeAngle(w), W.BLADE.arc);
  assert.deepEqual(w.film, Array(8).fill(0));
  assert.ok(w.water > 0.8);
  for (let i = 0; i < 42; i++) W.advance(w, tick, 0);
  assert.equal(w.sweep, null); assert.equal(W.bladeAngle(w), 0);
  W.wipe(w); assert.equal(w.sweep, 0, 'a deliberate second sweep overrides the automatic interval');
});

test('coasting, new passengers, weather and fractional ticks agree across different display rates and pauses', () => {
  function run(rate) {
    const s = depart(); R.command(s, 'rain');
    function pass(seconds) { for (let i = 0; i < rate * seconds; i++) R.advance(s, 1 / rate); }
    pass(15); R.command(s, 'coast'); pass(3); R.command(s, 'pause');
    const paused = structuredClone(s);
    for (const action of ['rain', 'wipe', 'coast']) assert.match(R.command(s, action), /Resume/);
    R.advance(s, 500); assert.deepEqual(s, paused);
    R.command(s, 'pause'); pass(30);
    assert.equal(s.sheet.count, 1); assert.ok(s.car.call.boarded > 0);
    near(s.fraction, 0);
    return { ...s, fraction: 0 };
  }
  const expected = run(60);
  for (const rate of [24, 30, 144]) assert.deepEqual(run(rate), expected);
});
