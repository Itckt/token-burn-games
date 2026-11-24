"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/model.js");

const start = "2024-02-26"; // Monday
const routine = { id: "practice", name: "Practice scales", icon: "leaf" };
const create = days => M.addHabit(M.emptyState(), { ...routine, days }, start);
const check = (state, day, value = true) => M.setCheck(state, routine.id, day, value, day);

test("legacy journals remain daily, and creating a scheduled habit owns its weekday list", () => {
  const legacy = create();
  assert.deepEqual(legacy.habits[0], { ...routine, start, checks: [] });
  assert.equal(M.weeklyTarget(legacy, start), 0);
  const days = [0, 2, 4];
  const planned = create(days);
  days.pop();
  assert.deepEqual(M.weekdaysOn(planned.habits[0], start), [0, 2, 4]);
  assert.equal(M.validateState(planned), planned);
  assert.equal(M.isDue(legacy.habits[0], "2024-02-29"), true);
  assert.equal(M.editHabit(legacy, routine.id, "  Practice scales ", routine.icon), legacy);
});

test("rest days are excluded from backfills, day progress and completion denominators", () => {
  let state = M.addHabit(M.emptyState(), { ...routine, days: [0, 2, 4] }, "2024-02-27");
  for (const day of ["2024-02-28", "2024-03-01"]) state = check(state, day);
  for (const rest of ["2024-02-27", "2024-02-29", "2024-03-03"]) {
    assert.deepEqual(M.dayProgress(state, rest), { due: [], done: 0 });
    assert.throws(() => M.setCheck(state, routine.id, rest, true, "2024-03-04"), /scheduled/);
  }
  const stats = M.stats(state, "2024-03-04", 7);
  assert.deepEqual(stats.daily.map(d => d.due), [0, 1, 0, 1, 0, 0, 1]);
  assert.deepEqual([stats.due, stats.done, stats.rate, stats.active], [3, 2, 67, 2]);
  assert.deepEqual(M.habitStreaks(state.habits[0], "2024-03-04"), { current: 2, best: 2 });
  assert.deepEqual(M.habitStreaks(state.habits[0], "2024-03-05"), { current: 0, best: 2 });
  assert.deepEqual(M.streaks(M.earnedDays(state, "2024-03-04"), "2024-03-04"), { current: 0, best: 1 });
});

test("schedule edits begin the following day, and repeat edits update the same dated plan", () => {
  const wed = "2024-02-28";
  const before = check(create(), wed);
  let state = M.changeSchedule(before, routine.id, [3], wed);
  assert.equal(M.isDue(state.habits[0], "2024-02-29"), true);
  assert.equal(M.changeSchedule(state, routine.id, [3], wed), state);
  state = M.changeSchedule(state, routine.id, [4], wed);
  assert.deepEqual(state.habits[0].schedules, [{ from: "2024-02-29", days: [4] }]);
  assert.deepEqual(M.stats(state, wed, 7).daily, M.stats(before, wed, 7).daily);
  assert.deepEqual(M.earnedDays(state, wed), [wed]);
  assert.equal(M.isDue(state.habits[0], "2024-02-29"), false);
  assert.equal(M.isDue(state.habits[0], "2024-03-01"), true);
  assert.deepEqual(before.habits[0].checks, [wed]);
  assert.equal(before.habits[0].schedules, undefined);
  assert.equal(M.validateState(state), state);
});

test("editing after a clock rollback protects later check-ins and keeps subsequent plans", () => {
  let state = check(create(), "2024-03-01");
  state = M.changeSchedule(state, routine.id, [2], "2024-03-06");
  state = M.changeSchedule(state, routine.id, [0], "2024-02-29");
  assert.deepEqual(state.habits[0].schedules, [
    { from: "2024-03-02", days: [0] }, { from: "2024-03-07", days: [2] }
  ]);
  assert.equal(M.isDue(state.habits[0], "2024-03-01"), true);
  assert.equal(M.isDue(state.habits[0], "2024-03-04"), true);
  assert.equal(M.isDue(state.habits[0], "2024-03-11"), false);
  assert.equal(M.validateState(state), state);
});

test("scheduled streaks and statistics agree with a day-by-day ledger through leap day and two plan changes", () => {
  let state = create([0, 3, 5]);
  state = M.changeSchedule(state, routine.id, [1, 4], M.shiftDay(start, 11));
  state = M.changeSchedule(state, routine.id, [6], M.shiftDay(start, 39));
  let run = 0, best = 0, available = 0, total = 0;
  for (let i = 0; i < 75; i++) {
    const day = M.shiftDay(start, i);
    const due = (i < 12 ? [0, 3, 5] : i < 40 ? [1, 4] : [6]).includes(i % 7);
    const complete = due && i % 5 !== 2;
    if (due) available++;
    if (complete) {
      total++;
      best = Math.max(best, ++run);
      state = check(state, day);
    }
    assert.deepEqual(M.habitStreaks(state.habits[0], day), { current: run, best }, day);
    const stats = M.stats(state, day, i + 1);
    assert.deepEqual([stats.due, stats.done], [available, total], day);
    if (due && !complete) run = 0; // Today's open slot expires tomorrow.
  }
  assert.ok(best > 1);
});

test("invalid weekdays, contradictory check-ins and malformed dated plans are rejected", () => {
  const base = create([0]);
  const habit = base.habits[0];
  const withSchedule = schedules => ({ ...base, habits: [{ ...habit, schedules }] });
  for (const days of [[], [8], [-1], [0, 0], [0, 2, 1], [0.5], ["0"], null]) {
    assert.throws(() => create(days), /weekday/);
    assert.throws(() => M.changeSchedule(base, routine.id, days, start), /weekday/);
    assert.throws(() => M.validateState(withSchedule([{ from: start, days }])), /weekday/);
  }
  for (const entries of [null, {}, [null], [{ from: "2024-02-25", days: [0] }],
    [{ from: "2024-02-30", days: [0] }], [...habit.schedules, ...habit.schedules]]) {
    assert.throws(() => M.validateState(withSchedule(entries)));
  }
  assert.throws(() => M.validateState({ ...base, habits: [{ ...habit, checks: ["2024-02-27"] }] }), /history/);
  assert.throws(() => M.changeSchedule(base, routine.id, [0], "bad date"), /date/);
});

test("goal weeks start on the same Monday across New Year and count each active date once", () => {
  let state = M.setWeeklyGoal(create(), "2025-01-01", 2);
  state = M.addHabit(state, { ...routine, id: "second" }, start);
  for (const day of ["2024-12-29", "2024-12-30", "2025-01-01", "2025-01-05", "2025-01-06"]) state = check(state, day);
  state = M.setCheck(state, "second", "2024-12-30", true, "2025-01-06");
  assert.equal(M.weekStart("2025-01-05"), "2024-12-30");
  assert.equal(M.weekStart("2025-01-06"), "2025-01-06");
  assert.deepEqual(M.weekProgress(state, "2025-01-01"), {
    from: "2024-12-30", target: 2, active: ["2024-12-30", "2025-01-01"]
  });
  assert.deepEqual(M.weeklyPennants(state, "2024-12-31"), []);
  assert.deepEqual(M.weeklyPennants(state, "2025-01-06"), [{ from: "2024-12-30", target: 2, earnedOn: "2025-01-01" }]);
  assert.deepEqual(M.weekProgress(state, "2025-01-06").active, ["2025-01-06"]);
});

test("goal edits and Off apply from the chosen week and preserve earlier and later targets", () => {
  let state = M.setWeeklyGoal(create(), start, 1);
  assert.equal(M.setWeeklyGoal(state, "2024-03-03", 1), state);
  state = M.setWeeklyGoal(state, "2024-03-11", 0);
  state = M.setWeeklyGoal(state, "2024-03-06", 2);
  state = M.setWeeklyGoal(state, "2024-03-07", 3);
  for (const day of [start, "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-11"]) state = check(state, day);
  assert.deepEqual(state.weeklyGoals.map(e => [e.from, e.target]), [[start, 1], ["2024-03-04", 3], ["2024-03-11", 0]]);
  assert.deepEqual(M.weeklyPennants(state, "2024-03-11").map(w => w.earnedOn), [start, "2024-03-06"]);
  assert.equal(M.validateState(state), state);
  for (const target of [-1, 8, 2.5, "2", null]) {
    assert.throws(() => M.setWeeklyGoal(state, start, target), /goal/);
    assert.throws(() => M.validateState({ ...state, weeklyGoals: [{ from: start, target }] }), /goal/);
  }
  assert.throws(() => M.setWeeklyGoal(state, "2024-02-30", 3), /date/);
  assert.throws(() => M.validateState({ ...state, weeklyGoals: [{ from: "2024-02-27", target: 3 }] }), /Monday/);
});

test("a backfill can move the pennant date, and undo or deletion recalculates it", () => {
  let state = M.setWeeklyGoal(create(), start, 2);
  state = M.addHabit(state, { ...routine, id: "second" }, start);
  for (const day of ["2024-02-28", "2024-03-01"]) state = check(state, day);
  state = M.setCheck(state, "second", "2024-02-28", true, "2024-03-01");
  const dates = s => M.weeklyPennants(s, "2024-03-01").map(award => award.earnedOn);
  assert.deepEqual(dates(state), ["2024-03-01"]);
  state = check(state, start);
  assert.deepEqual(dates(state), ["2024-02-28"]);
  state = check(state, "2024-02-28", false);
  assert.deepEqual(dates(state), ["2024-02-28"]);
  assert.deepEqual(dates(M.removeHabit(state, "second")), ["2024-03-01"]);
  assert.deepEqual(dates(M.removeHabit(state, routine.id)), []);
});

test("calendar padding and partial goal weeks work at both ends of the stored date range", () => {
  for (const day of [M.FIRST_DAY, M.LAST_DAY]) {
    const grid = M.calendarDays(day.slice(0, 7));
    assert.equal(M.dayDistance(grid[0], grid.at(-1)), grid.length - 1);
    assert.equal(grid.filter(d => d.startsWith(day.slice(0, 7))).length, 31);
    const state = M.setWeeklyGoal(check(M.addHabit(M.emptyState(), routine, day), day), day, 1);
    assert.equal(M.validateState(state), state);
    assert.equal(M.weekProgress(state, day).target, 1);
    assert.deepEqual(M.weeklyPennants(state, day).map(w => w.earnedOn), [day]);
    assert.doesNotThrow(() => M.validateState(M.starterState(day)));
  }
  const withLastCheck = check(create(), M.LAST_DAY);
  assert.equal(M.scheduleChangeDate(withLastCheck.habits[0], start), null);
  assert.throws(() => M.changeSchedule(withLastCheck, routine.id, [0], start), /no later dates/);
  assert.equal(M.isDue(withLastCheck.habits[0], start), true);
});
