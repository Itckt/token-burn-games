"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bodies, planets, byId } = require("../js/catalog");
const { orbits, orbitalState, systemAt } = require("../js/physics");
const { apsisDay } = require("../js/observations");
const { MIN_DAYS, MAX_DAYS, START_DAYS, inCalendar } = require("../js/time");
const { validPair, cycleDays, encounterWindow, encounterPlan, rangeAt, trailDuration } = require("../js/encounters");
const { TRAIL_MARKS, TRAIL_STEPS, TRAIL_FLOATS, writeMotionTrail } = require("../js/geometry");
const { FieldLog } = require("../js/fieldlog");
const { MemoryStorage } = require("./fixtures");

function near(value, expected, tolerance) {
  assert.ok(Math.abs(value - expected) <= tolerance, value + " differs from " + expected);
}
function separation(a, b, day) {
  const at = id => id === "sun" ? [0, 0, 0] : orbitalState(orbits[id], day).position;
  const p = at(a), q = at(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

test("encounter windows follow the synodic cycle, in both directions, between calendar limits", () => {
  const period = cycleDays("earth", "mars");
  near(period, 779.93, 0.02);
  assert.equal(cycleDays("mars", "earth"), period);
  near(cycleDays("sun", "neptune"), orbits.neptune.period, 1e-10);
  const future = encounterWindow("earth", "mars", START_DAYS, 1);
  const past = encounterWindow("earth", "mars", future.end, -1);
  assert.equal(future.start, START_DAYS);
  near(future.end - future.start, period, 1e-9);
  near(future.start, past.start, 1e-9);
  for (const limit of [MIN_DAYS, MAX_DAYS]) for (const direction of [1, -1]) {
    const { start, end } = encounterWindow("uranus", "neptune", limit, direction);
    assert.ok(inCalendar(start) && inCalendar(end) && end > start);
    assert.ok(start === limit || end === limit);
    near(end - start, cycleDays("uranus", "neptune"), 1e-9);
  }
  assert.deepEqual(encounterWindow("earth", "venus", MAX_DAYS - 0.01, 1), { start: MAX_DAYS - 0.01, end: MAX_DAYS });
});

test("all 36 pairs have the turning points independently located from sampled physical distances", () => {
  for (const [index, first] of bodies.entries()) for (const second of bodies.slice(index + 1)) {
    const a = first.id, b = second.id;
    for (const direction of [-1, 1]) {
      const plan = encounterPlan(a, b, encounterWindow(a, b, START_DAYS, direction));
      const span = plan.end - plan.start, delta = span * 1e-6;
      // An independent finite difference of the 3D distance, without using velocities or the forecast solver.
      const trend = t => separation(a, b, t + delta) - separation(a, b, t - delta);
      let lastDay = plan.start, last = trend(lastDay), index = 0;
      for (let i = 1; i <= 512; i++) {
        const t = plan.start + span * i / 512, now = trend(t);
        if (Math.sign(last) !== Math.sign(now)) {
          const event = plan.events[index++];
          assert.ok(event && event.day >= lastDay && event.day <= t, a + "/" + b + " missed a turn");
          assert.equal(event.kind, now > 0 ? "Closest" : "Farthest");
          near(event.au, separation(a, b, event.day), 1e-12);
          near(event.rateKmS, 0, 1e-8);
        }
        last = now;
        lastDay = t;
      }
      assert.equal(index, plan.events.length);
      assert.equal(plan.curve[0].day, plan.start);
      assert.equal(plan.curve.at(-1).day, plan.end);
      assert.ok(plan.curve.every((p, i) => plan.low <= p.au && p.au <= plan.high && (!i || p.day > plan.curve[i-1].day)));
      for (const event of plan.events) assert.ok(plan.curve.some(p => p.day === event.day));
    }
  }
});

test("Sun encounters coincide with analytical apsides, including exact events on either chart edge", () => {
  for (const body of planets) {
    const orbit = orbits[body.id], start = apsisDay(orbit, START_DAYS, "perihelion");
    const span = { start, end: start + orbit.period };
    const p = encounterPlan(body.id, "sun", span);
    assert.deepEqual(p.events.map(e => e.kind), ["Closest", "Farthest", "Closest"]);
    near(p.events[0].day, start, 1e-9);
    near(p.events[1].day, start + orbit.period / 2, 1e-9);
    near(p.events[2].day, span.end, 1e-9);
    near(p.events[0].au, orbit.a * (1 - orbit.e), 1e-12);
    near(p.events[1].au, orbit.a * (1 + orbit.e), 1e-12);
    assert.deepEqual(encounterPlan("sun", body.id, span), p);
  }
});

test("very short windows have ordered, finite chart data without invented turning points", () => {
  const perihelion = apsisDay(orbits.mercury, START_DAYS, "perihelion");
  for (const span of [{ start: perihelion + 0.00001, end: perihelion + 0.00002 },
    { start: MAX_DAYS - 5e-10, end: MAX_DAYS }, { start: MIN_DAYS, end: MIN_DAYS + 0.001 }]) {
    const plan = encounterPlan("sun", "mercury", span);
    assert.equal(plan.events.length, 0);
    assert.ok(plan.high > plan.low);
    assert.ok(plan.curve.every((p, i) => inCalendar(p.day) && Number.isFinite(p.au) && (!i || p.day > plan.curve[i-1].day)));
  }
});

test("forecast inputs reject identical endpoints, inherited properties and invalid time windows", () => {
  for (const id of ["earth", "moon", "constructor", "__proto__", "pluto", null]) {
    assert.equal(validPair("earth", id), false);
    assert.throws(() => cycleDays("earth", id), RangeError);
    assert.throws(() => rangeAt("earth", id, START_DAYS), RangeError);
  }
  for (const t of [NaN, Infinity, MIN_DAYS - 1]) assert.throws(() => encounterWindow("mars", "sun", t, 1), RangeError);
  assert.throws(() => encounterWindow("mars", "sun", 0, 0), RangeError);
  for (const [start, end] of [[5, 5], [1, 0], [MIN_DAYS - 1, 0], [0, 1000]]) {
    assert.throws(() => encounterPlan("earth", "sun", { start, end }), RangeError);
  }
});

test("trail lookbacks use the shorter orbit for an adaptive pair and stop at the calendar start", () => {
  assert.equal(trailDuration("off", "earth", "mars", START_DAYS), 0);
  assert.equal(trailDuration("garbage", "earth", "mars", START_DAYS), 0);
  assert.equal(trailDuration("7", "earth", "earth", START_DAYS), 0);
  assert.equal(trailDuration("7", "sun", "earth", START_DAYS), 7);
  assert.equal(trailDuration("quarter", "sun", "earth", START_DAYS), orbits.earth.period / 4);
  for (const pair of [["uranus", "neptune"], ["neptune", "uranus"]]) {
    assert.equal(trailDuration("quarter", ...pair, START_DAYS), orbits.uranus.period / 4);
    assert.equal(trailDuration("30", ...pair, MIN_DAYS + 0.25), 0.25);
    assert.equal(trailDuration("quarter", ...pair, MIN_DAYS), 0);
  }
});

test("every trail vertex and all six beads occupy the correct Kepler positions at equal time intervals", () => {
  const data = new Float32Array(TRAIL_FLOATS);
  for (const [id, day, duration] of [["mercury", -370000, 30], ["neptune", MAX_DAYS, orbits.neptune.period / 4],
    ["earth", MIN_DAYS + 0.1, 0.1]]) {
    assert.equal(writeMotionTrail(data, orbits[id], byId[id].track, day, duration), data);
    for (let i = 0; i < TRAIL_FLOATS / 5; i++) {
      const bead = i > TRAIL_STEPS;
      const age = bead ? (i - TRAIL_STEPS) / TRAIL_MARKS : i / TRAIL_STEPS;
      const expected = systemAt(day - age * duration)[id].position;
      expected.forEach((v, j) => near(data[i * 5 + j], v, 2e-6));
      near(data[i * 5 + 3], age, 1e-7);
      assert.equal(data[i * 5 + 4], Number(bead));
    }
  }
  assert.throws(() => writeMotionTrail([], orbits.mars, 1, 0, 7), RangeError);
  for (const span of [0, Infinity, -1]) assert.throws(() => writeMotionTrail(data, orbits.earth, 1, 0, span), RangeError);
});

test("field notes retain exact instants across sessions and independent writers without overwriting nearby notes", () => {
  const storage = new MemoryStorage(), first = new FieldLog(storage), other = new FieldLog(storage);
  const day = START_DAYS + 0.123456789;
  first.save("earth", "mars", day, "  Kowloon Tong night shift  ");
  other.save("venus", "earth", day, "Inner pair");
  other.save("earth", "mars", day + 1e-8, "Later in the same minute");
  first.save("earth", "mars", day, "Renamed");
  const reopened = new FieldLog(storage);
  assert.equal(reopened.entries.length, 3);
  assert.equal(reopened.entries[0].day, day + 1e-8);
  assert.equal(reopened.entries.find(note => note.name === "Renamed").day, day);
  reopened.remove(reopened.entries[0]);
  first.refresh();
  assert.deepEqual(first.entries.map(note => note.name), ["Inner pair", "Renamed"]);
});

test("invalid storage entries stay isolated and storage failure preserves working session notes", () => {
  const storage = new MemoryStorage(), log = new FieldLog(storage);
  log.save("sun", "earth", 0, "A".repeat(80));
  const key = storage.key(0), prefix = key.slice(0, -("sun/earth/0".length));
  const bad = ["another-project", ...["sun/sun/0", "moon/sun/0", "sun/earth/01", "sun/earth/NaN",
    "sun/earth/8/extra", "sun/earth/9000000", "__proto__/venus/0"].map(s => prefix + s)];
  for (const key of bad) storage.setItem(key, "Foreign or malformed");
  log.refresh();
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].name.length, 60);
  for (const args of [["sun", "sun", 0, "x"], ["sun", "mars", Infinity, "x"], ["earth", "sun", 0, "  "]]) {
    assert.throws(() => log.save(...args), RangeError);
  }
  storage.setItem = () => { throw new Error("Quota"); };
  log.save("venus", "mars", START_DAYS, "Session note");
  log.refresh();
  assert.equal(log.storage, null);
  assert.equal(log.entries.length, 2);
  log.remove(log.entries[0]);
  assert.equal(log.entries.length, 1);
  assert.ok(bad.every(key => storage.getItem(key) === "Foreign or malformed"));
  const denied = new FieldLog({ get length() { throw new Error("Denied"); } });
  denied.save("sun", "mars", 0, "In memory");
  assert.equal(denied.entries[0].name, "In memory");
});
