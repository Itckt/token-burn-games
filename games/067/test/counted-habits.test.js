"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/model.js");
const { parseJournal } = require("../js/storage.js");

const monday = "2024-02-26";
const thursday = "2024-02-29";
const friday = "2024-03-01";
const routine = { id: "read", name: "Evening reading", icon: "book", target: 10, unit: "pages" };
const create = options => M.addHabit(M.emptyState(), { ...routine, ...options }, monday);
const record = (state, day, amount, today = day) => M.setProgress(state, "read", day, amount, today);
const habit = state => M.findHabit(state, "read");

test("a count earns one check-in at its target and reverses cleanly through partial and zero", () => {
  const initial = M.setWeeklyGoal(create(), monday, 1);
  const partial = record(initial, thursday, 4);
  const full = record(partial, thursday, 10);
  const corrected = record(full, thursday, 9);
  const cleared = record(corrected, thursday, 0);
  for (const [state, value] of [[initial, 0], [partial, 4], [full, 10], [corrected, 9], [cleared, 0]]) {
    const done = Number(value === 10);
    assert.equal(M.progressOn(habit(state), thursday), value);
    assert.deepEqual(habit(state).checks, done ? [thursday] : []);
    assert.deepEqual(habit(state).partials, value > 0 && !done ? { [thursday]: value } : undefined);
    assert.deepEqual(M.earnedDays(state, thursday), habit(state).checks);
    assert.deepEqual(M.rewardShelf(state, thursday)[M.rewardForDay(thursday)], habit(state).checks);
    assert.equal(M.weeklyPennants(state, thursday).length, done);
    assert.deepEqual(M.habitStreaks(habit(state), thursday), { current: done, best: done });
    const stats = M.stats(state, thursday, 1);
    assert.deepEqual([stats.due, stats.done, stats.active, stats.rate], [1, done, done, done * 100]);
    assert.equal(record(state, thursday, value), state);
    assert.deepEqual(parseJournal(JSON.stringify(state)), state);
  }
  assert.deepEqual(cleared, initial);
});

test("filling an earlier count joins two streaks and another habit can retain a shared reward", () => {
  let state = create();
  for (const date of [friday, "2024-02-28"]) state = record(state, date, 10);
  state = record(state, thursday, 2);
  assert.deepEqual(M.habitStreaks(habit(state), friday), { current: 1, best: 1 });
  state = M.setCheck(state, "read", thursday, true, friday);
  assert.deepEqual(habit(state).checks, ["2024-02-28", thursday, friday]);
  assert.deepEqual(M.habitStreaks(habit(state), friday), { current: 3, best: 3 });
  state = M.addHabit(state, { id: "walk", name: "Walk", icon: "boot" }, thursday);
  state = M.setCheck(state, "walk", thursday, true, friday);
  state = record(state, thursday, 1, friday);
  assert.deepEqual(M.streaks(M.earnedDays(state, friday), friday), { current: 3, best: 3 });
  assert.equal(M.dayProgress(state, thursday).done, 1);
  assert.equal(M.habitStreaks(habit(state), friday).best, 1);
  assert.deepEqual(M.removeHabit(state, "walk").habits, [habit(state)]);
  assert.equal(M.earnedDays(M.removeHabit(state, "walk"), friday).includes(thursday), false);
  assert.equal(M.progressOn(habit(M.setCheck(state, "read", thursday, false, friday)), thursday), 0);
});

test("dated targets retain historical amounts and units through increases, decreases and a return to one tap", () => {
  let state = M.changeTarget(create(), "read", 7, "  sections ", monday);
  assert.equal(M.changeTarget(state, "read", 7, "sections", monday), state);
  state = M.changeTarget(state, "read", 5, "chapters", monday);
  assert.equal(habit(state).targets.length, 2);
  state = record(state, monday, 8, thursday);
  state = record(state, thursday, 5);
  state = M.changeTarget(state, "read", 1, "chapters", thursday);
  state = M.setCheck(state, "read", friday, true, friday);
  assert.deepEqual(habit(state).targets.map(({ from, amount, unit }) => [from, amount, unit]), [
    [monday, 10, "pages"], ["2024-02-27", 5, "chapters"], [friday, 1, ""]
  ]);
  assert.equal(M.progressOn(habit(state), monday), 8);
  assert.equal(M.progressOn(habit(state), thursday), 5);
  assert.equal(M.progressOn(habit(state), friday), 1);
  assert.throws(() => record(state, thursday, 6, friday), /whole number/);
  assert.equal(M.validateState(state), state);
});

test("a rolled-back clock preserves future partials when changing targets or weekdays", () => {
  let state = record(create(), friday, 4);
  state = M.changeTarget(state, "read", 12, "pages", "2024-03-06");
  state = M.changeTarget(state, "read", 3, "sets", monday);
  state = M.changeSchedule(state, "read", [0, 2], monday);
  assert.equal(M.scheduleChangeDate(habit(state), monday), "2024-03-02");
  assert.deepEqual(habit(state).targets.map(row => row.from), [monday, "2024-03-02", "2024-03-07"]);
  assert.equal(M.targetOn(habit(state), friday).amount, 10);
  assert.equal(M.targetOn(habit(state), "2024-03-07").amount, 12);
  assert.equal(M.progressOn(habit(state), friday), 4);
  assert.equal(M.isDue(habit(state), friday), true);
  assert.equal(M.isDue(habit(state), "2024-03-02"), false);
  assert.deepEqual(M.earnedDays(state, monday), []);
  assert.equal(M.validateState(state), state);
  const last = record(create(), M.LAST_DAY, 1);
  assert.equal(M.scheduleChangeDate(habit(last), friday), null);
  assert.throws(() => M.changeTarget(last, "read", 3, "sets", friday), /no later dates/);
});

test("target and amount inputs reject invalid numbers, rest days and out-of-range dates", () => {
  const state = create({ days: [0, 3] });
  for (const target of [0, -1, 1000, "2", 2.5, NaN, Infinity]) {
    assert.throws(() => create({ target }), /daily target/);
    assert.throws(() => M.changeTarget(state, "read", target, "", monday), /daily target/);
  }
  assert.equal(M.targetOn(habit(create({ target: 999, unit: "🌱".repeat(24) })), monday).amount, 999);
  for (const unit of [null, "a\nb", "🌱".repeat(25)]) assert.throws(() => create({ unit }), /unit/);
  assert.equal(M.targetOn(habit(create({ unit: "  頁  " })), monday).unit, "頁");
  for (const value of [-1, 11, 3.1, NaN, "3", null, false]) assert.throws(() => record(state, monday, value), /whole number/);
  for (const day of ["2024-02-25", "2024-02-30", friday]) assert.throws(() => record(state, day, 1, thursday), /date/);
  assert.throws(() => record(state, "2024-02-27", 1), /scheduled/);
  assert.throws(() => M.setProgress(state, "gone", monday, 1, monday), /no longer/);
  assert.throws(() => M.changeTarget(state, "read", 2, "sets", "bad"), /date/);
  assert.deepEqual(habit(state).checks, []);
  assert.equal(habit(state).partials, undefined);
});

test("backups reject inconsistent count histories while accepting a later count after clock rollback", () => {
  const state = record(create({ days: [0, 3] }), monday, 10);
  const withHabit = patch => parseJournal(JSON.stringify({ ...state, habits: [{ ...habit(state), ...patch }] }));
  for (const partials of [null, [], "4", { [monday]: 2 }, { [thursday]: 0 }, { [thursday]: 10 },
    { [thursday]: 2.5 }, { [thursday]: "2" }, { "2024-02-27": 1 }, { "2024-02-22": 1 }, { "2024-02-30": 3 }]) {
    assert.throws(() => withHabit({ partials }), /partial count/i);
  }
  for (const targets of [null, {}, [{ from: monday, amount: 1, unit: "pages" }],
    [{ from: "2024-02-25", amount: 2, unit: "" }], [{ from: monday, amount: 2, unit: " pages" }],
    [habit(state).targets[0], habit(state).targets[0]], [{ from: monday, amount: 1000, unit: "" }]]) {
    assert.throws(() => withHabit({ targets }));
  }
  assert.equal(M.progressOn(habit(withHabit({ partials: { [thursday]: 9 } })), thursday), 9);
});
