"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { challenge, dailyCode, formatTime, Records } = require("../js/trials.js");
const { Session, SPEEDS } = require("../js/session.js");

test("a shared code has a stable normalized mix and returns an independent list each time", () => {
  const expected = { code: "3-HKBU", moves: ["L'", "F2", "R"] };
  assert.deepEqual(challenge("  3-hKbU "), expected);
  challenge("3-HKBU").moves.fill("U");
  assert.deepEqual(challenge("3-HKBU"), expected);
  assert.deepEqual(challenge("1-b").moves, ["U'"]);
  assert.notDeepEqual(challenge("3-HKBU2").moves, expected.moves);
  for (let length = 1; length <= 20; length++) {
    for (const tag of ["A", "0", "COMMUTE", "0123456789abcdef"]) {
      const { moves } = challenge(length + "-" + tag);
      assert.equal(moves.length, length);
      const axes = moves.map(move => cube.describe(move).axis);
      assert.ok(axes.every((axis, i) => !i || axis !== axes[i - 1]));
      assert.equal(cube.isSolved(cube.apply(cube.create(), moves)), false);
    }
  }
});

test("invalid codes reject out-of-range lengths, punctuation, empty seeds and internal whitespace", () => {
  for (const code of [null, 123, "", "0-A", "21-A", "01-A", "1-", "1-A-B", "2-港", "2-A B", "3-A_A",
    "2-ABCDEFGHIJKLMNOPQ", "2- A", "3.5-ABC", "5-A\nB"]) {
    assert.throws(() => challenge(code), RangeError);
  }
});

test("the daily code changes at Hong Kong midnight across month, year and leap-day boundaries", () => {
  for (const [iso, code] of [
    ["2026-12-31T15:59:59.999Z", "12-20261231"], ["2026-12-31T16:00:00.000Z", "12-20270101"],
    ["2024-02-28T16:00:00.000Z", "12-20240229"], ["2024-02-29T16:00:00.000Z", "12-20240301"]
  ]) {
    assert.equal(dailyCode(new Date(iso)), code);
    assert.equal(challenge(code).moves.length, 12);
  }
});

test("time displays truncate to hundredths and reject coerced or unrepresentable times", () => {
  for (const [ms, expected] of [[0, "0:00.00"], [9.99, "0:00.00"], [19.9, "0:00.01"],
    [59999, "0:59.99"], [60000, "1:00.00"], [3600010, "60:00.01"]]) assert.equal(formatTime(ms), expected);
  const records = new Records();
  for (const ms of [null, "235", -0.01, Infinity, NaN, 1e18]) {
    assert.throws(() => formatTime(ms), RangeError);
    assert.throws(() => records.record("1-A", ms, 1), RangeError);
  }
  for (const turns of [0, -1, 1.5, "1", NaN]) assert.throws(() => records.record("1-A", 10, turns), RangeError);
  assert.equal(records.best("1-A"), null);
});

test("personal bests survive reload, isolate codes, and break hundredth-second ties by turn count", () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const records = new Records(storage);
  const first = records.record("1-A", 2068.5, 4);
  assert.deepEqual(first, { ms: 2060, turns: 4 });
  first.ms = 0;
  assert.deepEqual(records.record("1-A", 2100, 1), { ms: 2060, turns: 4 });
  records.record("1-A", 2069, 3);
  records.record("1-B", 900, 2);
  const other = new Records(storage);
  assert.deepEqual(other.best("1-A"), { ms: 2060, turns: 3 });
  other.record("1-A", 2000, 5);
  assert.deepEqual(records.best("1-A"), { ms: 2000, turns: 5 });
  records.best("1-B").turns = 7;
  assert.deepEqual(records.best("1-B"), { ms: 900, turns: 2 });
});

test("damaged, unreadable or unwritable records still allow a best time in memory", () => {
  for (const value of ["{", "null", "false", "[]", '{"ms":-10,"turns":1}', '{"ms":1,"turns":2}',
    '{"ms":"20","turns":2}', '{"ms":50,"turns":0}', '{"ms":1e30,"turns":1}']) {
    const r = new Records({ getItem: () => value, setItem() { throw Error("quota"); } });
    assert.equal(r.best("3-HKBU"), null);
    r.record("3-HKBU", 25, 1);
    assert.deepEqual(r.best("3-HKBU"), { ms: 20, turns: 1 });
  }
  const blocked = new Records({ getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } });
  blocked.record("1-B", 499, 2);
  assert.deepEqual(blocked.record("1-B", 700, 1), { ms: 490, turns: 2 });
});

test("a trial starts on the first accepted turn and finishes at the solving commit, dropping queued input", () => {
  for (const speed of SPEEDS) {
    let now = 0;
    const s = new Session([], () => now);
    s.setSpeed(speed);
    assert.ok(s.startTrial(" 1-b "));
    assert.equal(s.source, "Time trial");
    assert.deepEqual(s.history, ["U'"]);
    assert.equal(s.trialElapsed(), 0);
    assert.throws(() => s.manual("X"), RangeError);
    assert.equal(s.trial.startedAt, null);
    now = 8000;
    assert.equal(s.trialElapsed(), 0);
    assert.ok(s.manual("U"));
    assert.ok(s.manual("L"));
    assert.equal(s.trial.startedAt, now);
    now += 159;
    s.tick(159);
    assert.equal(s.trialElapsed(), 159);
    assert.equal(s.trial.turns, 0);
    assert.ok(s.active.angle !== 0);
    now++;
    s.tick(2000);
    assert.equal(s.solved, true);
    assert.equal(s.trial.turns, 1);
    assert.equal(s.trial.finishedAt, 8160);
    assert.equal(s.active, null);
    assert.deepEqual(s.history, ["U'", "U"]);
    now += 60000;
    assert.equal(s.trialElapsed(), 160);
    assert.ok(s.canStartSequence);
    assert.equal(s.speed, speed);
    assert.ok(s.startTrial("1-B"));
    assert.deepEqual(s.history, ["U'"]);
    assert.equal(s.trialElapsed(), 0);
  }
});

test("only manual turns count during a trial, including half turns and time spent between moves", () => {
  let now = 0;
  const s = new Session([], () => now);
  s.startTrial("1-A"); // F2
  assert.ok(s.manual("U"));
  now = 160;
  s.tick(160);
  assert.equal(s.trial.turns, 1);
  now += 30000;
  assert.equal(s.trialElapsed(), 30160); // Zero is a valid starting timestamp.
  assert.equal(s.mode, "idle");
  assert.equal(s.undo(), false);
  assert.equal(s.playAlgorithm(["F2"]), false);
  assert.equal(s.scramble(), false);
  assert.equal(s.requestSolve(), null);
  assert.equal(s.seek(0), false);
  assert.equal(s.startTrial("1-B"), false);
  s.manual("U'");
  s.manual("F2");
  now += 359;
  s.tick(359);
  assert.equal(s.trial.turns, 2);
  assert.equal(s.solved, false);
  now++;
  s.tick(1);
  assert.ok(s.solved);
  assert.equal(s.trial.turns, 3);
  assert.equal(s.trialElapsed(), 30520);
  assert.deepEqual(s.history, ["F2", "U", "U'", "F2"]);
});

test("ending a trial keeps exactly its committed history and reset retires every partial or queued turn", () => {
  const s = new Session();
  s.startTrial("3-HKBU");
  s.manual("U");
  s.manual("F");
  s.tick(220);
  assert.ok(s.active.progress > 0);
  const expected = [...challenge("3-HKBU").moves, "U"];
  assert.ok(s.endTrial());
  assert.equal(s.trial, null);
  assert.equal(s.tick(5000), false);
  assert.deepEqual(s.history, expected);
  assert.deepEqual(s.pieces, cube.apply(cube.create(), expected));
  assert.ok(s.receiveSolution(s.requestSolve().ticket, cube.inverseSequence(s.history)));
  s.tick(10000);
  assert.ok(s.solved);
  assert.ok(s.startTrial("1-B")); // Starting from a finished review also retires its slider.
  assert.equal(s.playback, null);
  s.manual("U");
  s.tick(90);
  s.reset();
  assert.equal(s.trial, null);
  assert.deepEqual(s.pieces, cube.create());
  assert.equal(s.endTrial(), false);
});

test("bad codes and pending work preserve the current puzzle and solver ticket", () => {
  const s = new Session(), before = cube.clone(s.pieces), revision = s.revision;
  assert.throws(() => s.startTrial("21-HKBU"), RangeError);
  assert.equal(s.revision, revision);
  assert.deepEqual(s.pieces, before);
  const job = s.requestSolve();
  assert.equal(s.startTrial("3-HKBU"), false);
  assert.ok(s.cancelPlanning(job.ticket));
  assert.ok(s.startTrial("3-HKBU"));
  assert.equal(s.receiveSolution(job.ticket, cube.inverseSequence(cube.STARTER)), false);
  s.manual("R");
  for (const interval of [Infinity, NaN, -10]) assert.equal(s.tick(interval), false);
  assert.equal(s.active.progress, 0);
  assert.equal(s.trial.turns, 0);
});
