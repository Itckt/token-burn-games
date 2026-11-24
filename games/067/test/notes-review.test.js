"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/model.js");
const { KEY, createJournal, parseJournal } = require("../js/storage.js");
const { MemoryStorage } = require("../test-support/platform.js");

const first = "2024-02-26";
const leapDay = "2024-02-29";
const today = "2024-03-03";

test("field notes preserve multiline Unicode text, can be cleared, and never earn a reward", () => {
  const empty = M.emptyState();
  const withGoal = M.setWeeklyGoal(empty, first, 1);
  const text = "讀書 🍵\nQuiet corner by the window.";
  const state = M.setNote(withGoal, first, "  讀書 🍵\r\nQuiet corner by the window.  ", today);
  assert.deepEqual(state.notes, { [first]: text });
  assert.equal(M.setNote(state, first, text, today), state);
  assert.deepEqual(M.earnedDays(state, today), []);
  assert.deepEqual(M.weeklyPennants(state, today), []);
  assert.deepEqual(M.stats(state, today, 7), M.stats(withGoal, today, 7));
  assert.deepEqual(M.setNote(state, first, " \r\n ", today), withGoal);
  assert.deepEqual(withGoal.notes, {});
  assert.deepEqual(parseJournal(JSON.stringify(state)), state);
});

test("note search matches text or ISO dates, orders newest first and honors the local date", () => {
  let state = M.setNote(M.emptyState(), today, "Read my notes", today);
  state = M.setNote(state, first, "READ before class", today);
  state = M.setNote(state, leapDay, "路上看書", today);
  assert.deepEqual(M.noteDates(state, today), [today, leapDay, first]);
  assert.deepEqual(M.noteDates(state, today, "  ReAd "), [today, first]);
  assert.deepEqual(M.noteDates(state, today, "2024-02"), [leapDay, first]);
  assert.deepEqual(M.noteDates(state, today, "看書"), [leapDay]);
  assert.deepEqual(M.noteDates(state, leapDay, "read"), [first]);
  assert.deepEqual(M.noteDates(state, today, "no match"), []);
});

test("notes validate civil dates and apply the same character limit to edits and restored notes", () => {
  const state = M.emptyState();
  const text = "🌱".repeat(M.MAX_NOTE);
  const max = M.setNote(state, M.FIRST_DAY, text, M.LAST_DAY);
  assert.equal(M.validateState(max), max);
  for (const value of [text + "x", null, 1, {}]) assert.throws(() => M.setNote(state, first, value, today));
  for (const day of ["2024-02-30", "2024-03-04", "", null]) assert.throws(() => M.setNote(state, day, "note", today), /date/);
  assert.throws(() => M.setNote(state, first, "note", "today"), /date/);
  for (const notes of [null, [], "note", { "__bad__": "note" }, { [first]: "" }, { [first]: 2 },
    { [first]: " trailing " }, { [first]: "a\rb" }, { [first]: text + "x" }]) {
    assert.throws(() => parseJournal(JSON.stringify({ ...state, notes })));
  }
  assert.throws(() => parseJournal(JSON.stringify({ version: 3, habits: [], weeklyGoals: [], sample: false })));
});

test("version 2 opens without writing and its first edit retains intervening legacy checks, goals and plans", () => {
  const storage = new MemoryStorage();
  const old = { version: 2, sample: false, weeklyGoals: [{ from: first, target: 2 }],
    habits: [{ id: "walk", name: "Walk", icon: "boot", start: first,
      schedules: [{ from: first, days: [0, 3] }], checks: [first] }] };
  const raw = JSON.stringify(old, null, 2);
  storage.setItem(KEY, raw);
  const journal = createJournal(storage, today);
  assert.deepEqual(journal.state.notes, {});
  assert.deepEqual(journal.state.habits, old.habits);
  journal.change(state => M.setNote(state, today, "", today));
  assert.equal(storage.getItem(KEY), raw);
  old.habits[0].checks.push(leapDay);
  storage.setItem(KEY, JSON.stringify(old));
  journal.change(state => M.setNote(state, leapDay, "Walked after class", today));
  const saved = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(saved, { ...old, version: 3, notes: { [leapDay]: "Walked after class" } });
  assert.deepEqual(M.weeklyPennants(saved, today).map(item => item.earnedOn), [leapDay]);
  assert.deepEqual(createJournal(storage, today).state, saved);
});

test("period comparison uses adjacent inclusive windows and weights weekdays by eligible habit-days", () => {
  let state = M.addHabit(M.emptyState(), { id: "walk", name: "Walk", icon: "boot" }, "2024-02-19");
  state = M.addHabit(state, { id: "read", name: "Reading", icon: "book", days: [0, 3], target: 5 }, first);
  for (const day of ["2024-02-19", "2024-02-25", first, leapDay, "2024-03-04"]) {
    state = M.setCheck(state, "walk", day, true, day);
  }
  state = M.setProgress(state, "read", first, 2, today);
  state = M.setProgress(state, "read", leapDay, 5, today);
  state = M.setNote(state, today, "Rested", today);
  const { current, previous, weekdays } = M.periodReview(state, today, 7);
  const totals = data => [data.daily[0].day, data.daily.at(-1).day, data.done, data.due, data.active, data.rate];
  assert.deepEqual(totals(current), [first, today, 3, 9, 2, 33]);
  assert.deepEqual(totals(previous), ["2024-02-19", "2024-02-25", 2, 7, 2, 29]);
  assert.deepEqual(weekdays.map(row => [row.done, row.due]), [[1, 2], [0, 1], [0, 1], [2, 2], [0, 1], [0, 1], [0, 1]]);
  assert.deepEqual(weekdays[3].dates, [{ day: leapDay, done: 2, due: 2 }]);
  for (const span of [30, 90]) {
    const review = M.periodReview(state, today, span);
    assert.equal(review.weekdays.flatMap(group => group.dates).length, span);
    assert.equal(review.weekdays.reduce((n, group) => n + group.due, 0), 16);
    assert.equal(review.weekdays.reduce((n, group) => n + group.done, 0), 5);
    assert.equal(review.previous.due, 0);
    assert.equal(M.dayDistance(review.previous.daily.at(-1).day, review.current.daily[0].day), 1);
  }
});

test("date windows clip at the first supported date and compare only when a complete prior period exists", () => {
  let state = M.addHabit(M.emptyState(), { id: "walk", name: "Walk", icon: "boot" }, M.FIRST_DAY);
  state = M.setCheck(state, "walk", M.FIRST_DAY, true, M.FIRST_DAY);
  const firstDay = M.periodReview(state, M.FIRST_DAY, 90);
  assert.deepEqual(firstDay.current.daily, [{ day: M.FIRST_DAY, done: 1, due: 1 }]);
  assert.equal(firstDay.previous, null);
  assert.equal(firstDay.weekdays.filter(group => group.dates.length).length, 1);
  assert.equal(M.periodReview(state, "0000-01-13", 7).previous, null);
  assert.equal(M.periodReview(state, "0000-01-14", 7).previous.daily[0].day, M.FIRST_DAY);
  assert.equal(M.periodReview(state, M.LAST_DAY, 7).current.daily.at(-1).day, M.LAST_DAY);
  assert.throws(() => M.periodReview(state, "2023-02-29", 7), /date/);
});
