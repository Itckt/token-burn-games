"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, MemoryStorage } = require("../test-support/platform.js");
const M = require("../js/model.js");
const { KEY } = require("../js/storage.js");

const monday = "2024-12-30";
const tuesday = "2024-12-31";
const wednesday = "2025-01-01";
function journalWith(state = M.emptyState(), options = {}) {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify(state));
  return fixture({ date: monday, storage, ...options });
}
const habit = f => f.app.context().state.habits[0];
const chosenDays = f => f.content.querySelectorAll('[name="weekday"]').filter(input => input.checked).map(input => Number(input.value));

test("a weekday routine can be created, checked, backfilled and reopened through the normal controls", async () => {
  const f = journalWith();
  await f.click("new-habit");
  assert.deepEqual(chosenDays(f), M.DAILY);
  await f.submit("Library steps", "boot", []);
  assert.match(f.content.querySelector("#form-error").textContent, /at least one weekday/);
  assert.equal(f.content.querySelector("#habit-name").value, "Library steps");
  assert.equal(f.app.context().state.habits.length, 0);
  await f.submit("Library steps", "boot", [0, 2]);
  assert.match(f.control("day", { day: tuesday }).attrs["aria-label"], /rest day$/);
  await f.click("day", { day: tuesday });
  assert.match(f.content.textContent, /Rest day/);
  await f.click("close");
  await f.click("month", { offset: "1" });
  await f.click("day", { day: wednesday });
  assert.equal(f.content.querySelector(".upcoming-habit").textContent, "Library steps");
  assert.equal(f.control("check"), undefined);
  await f.click("close");
  await f.click("current-month");
  await f.click("check");
  f.setDate(tuesday);
  assert.match(f.main.querySelector(".habit-list").textContent, /No habits scheduled today/);
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 0");
  await f.click("day", { day: tuesday });
  assert.match(f.content.textContent, /Rest day/);
  assert.equal(f.control("check"), undefined);
  await f.click("close");
  f.navigate("habits");
  assert.equal(f.control("check").disabled, true);
  assert.match(f.main.querySelector(".manage-card").textContent, /Mon, Wed/);
  assert.match(f.main.querySelector(".mini-week").textContent, /Tuesday, December 31, 2024, rest day/);
  f.setDate(wednesday);
  await f.click("check");
  assert.match(f.main.querySelector(".manage-streak").textContent, /2 days/);
  f.navigate("overview");
  await f.click("month", { offset: "-1" });
  await f.click("day", { day: monday });
  await f.click("check");
  assert.equal(f.control("check").attrs["aria-pressed"], "false");
  await f.click("check");
  await f.click("close");
  const reopened = fixture({ storage: f.storage, date: wednesday, hash: "#statistics" });
  assert.deepEqual(habit(reopened).checks, [monday, wednesday]);
  assert.deepEqual(reopened.main.querySelectorAll(".metric").map(el => el.querySelector("strong").textContent), ["2", "100%", "2 / 7"]);
  assert.match(reopened.main.querySelector(".breakdown-row").textContent, /2 \/ 2/);
});

test("editing weekdays shows the effective plan and preserves past check-ins in the calendar", async () => {
  const f = journalWith(undefined, { hash: "#habits" });
  await f.click("new-habit");
  await f.submit("Stretch", "sun");
  await f.click("check");
  await f.click("edit");
  await f.submit("Stretch", "sun", [2]);
  assert.match(f.main.querySelector(".schedule-change").textContent, /Dec 31.*Wed/);
  assert.equal(f.control("check").attrs["aria-pressed"], "true");
  await f.click("edit");
  assert.deepEqual(chosenDays(f), [2]);
  await f.click("close");
  f.setDate(tuesday);
  assert.equal(f.control("check").disabled, true);
  f.navigate("overview");
  await f.click("day", { day: monday });
  assert.equal(f.control("check").attrs["aria-pressed"], "true");
  await f.click("close");
  f.setDate(wednesday);
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 1");
});

test("cancelling deletion restores an unsaved name, icon and schedule", async () => {
  const f = fixture({ hash: "#habits" });
  const before = f.storage.getItem(KEY);
  await f.click("edit", { id: "reading" });
  f.content.querySelector("#habit-name").value = "A draft";
  for (const radio of f.content.querySelectorAll('[name="habitIcon"]')) radio.checked = radio.value === "leaf";
  for (const input of f.content.querySelectorAll('[name="weekday"]')) input.checked = input.value === "3";
  await f.click("remove-prompt");
  await f.click("back-confirm");
  assert.equal(f.content.querySelector("#habit-name").value, "A draft");
  assert.equal(f.content.querySelector("form").elements.habitIcon.value, "leaf");
  assert.deepEqual(chosenDays(f), [3]);
  assert.equal(f.storage.getItem(KEY), before);
  await f.submit("A draft");
  assert.equal(habit(f).name, "A draft");
  assert.deepEqual(habit(f).schedules.at(-1).days, [3]);
});

test("an open editor merges independent metadata and schedule changes from another tab", async () => {
  const f = fixture({ hash: "#habits" });
  await f.click("edit", { id: "reading" });
  let next = M.changeSchedule(f.app.context().state, "reading", [0, 4], "2026-11-23");
  next = M.editHabit(next, "reading", "Evening chapters", "book");
  f.storage.setItem(KEY, JSON.stringify(next));
  f.win.emit("storage", { key: KEY });
  await f.submit("Read 10 pages", "moon");
  assert.deepEqual([habit(f).name, habit(f).icon, habit(f).schedules.at(-1).days], ["Evening chapters", "moon", [0, 4]]);
});

test("a stale daily button cannot add a check-in on the rest day after midnight", async () => {
  const initial = M.addHabit(M.emptyState(), { id: "walk", name: "Walk", icon: "boot", days: [0] }, monday);
  const f = journalWith(initial);
  f.setDate(tuesday, false);
  await f.click("check");
  assert.deepEqual(habit(f).checks, []);
  assert.match(f.doc.getElementById("toast").textContent, /not scheduled/);
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 0");
});

test("weekly progress earns one pennant, links to the earning day, and updates after an undo", async () => {
  let state = M.addHabit(M.emptyState(), { id: "one", name: "Read", icon: "book" }, monday);
  state = M.addHabit(state, { id: "two", name: "Walk", icon: "boot" }, monday);
  const f = journalWith(state);
  assert.equal(f.control("goal").attrs["aria-label"], "Set weekly goal");
  await f.click("goal");
  assert.equal(f.content.querySelector("form").elements.weeklyTarget.value, "0");
  await f.submitGoal(2);
  await f.click("check", { id: "one" });
  await f.click("check", { id: "two" });
  assert.match(f.main.querySelector(".goal-result").textContent, /1 \/ 2 active days/);
  f.setDate(wednesday);
  await f.click("check", { id: "two" });
  assert.equal(f.main.querySelectorAll(".stamped").length, 2);
  assert.match(f.main.querySelector(".goal-result").textContent, /pennant earned/);
  assert.match(f.doc.getElementById("toast").textContent, /Switchback pennant earned/);
  f.navigate("rewards");
  assert.match(f.control("pennants").textContent, /Weekly goals met · 1/);
  await f.click("pennants");
  assert.match(f.content.textContent, /Week of Dec 30, 2024/);
  await f.click("day", { day: wednesday });
  await f.click("check", { id: "two" });
  assert.match(f.doc.getElementById("toast").textContent, /pennant returned/);
  await f.click("close");
  assert.match(f.control("pennants").textContent, /Weekly goals met · 0/);
  f.navigate("overview");
  await f.click("check", { id: "one" });
  f.setDate("2025-01-06");
  assert.match(f.main.querySelector(".goal-result").textContent, /0 \/ 2 active days/);
  await f.click("goal");
  await f.submitGoal(0);
  const reopened = fixture({ storage: f.storage, date: "2025-01-06", hash: "#rewards" });
  assert.match(reopened.control("pennants").textContent, /Weekly goals met · 1/);
  reopened.navigate("overview");
  assert.equal(reopened.control("goal").attrs["aria-label"], "Set weekly goal");
});

test("a goal form held over Sunday midnight saves to the new week and preserves the earned week", async () => {
  let state = M.addHabit(M.emptyState(), { id: "rest", name: "Stretch", icon: "sun" }, monday);
  state = M.setWeeklyGoal(state, monday, 1);
  state = M.setCheck(state, "rest", monday, true, monday);
  const f = journalWith(state, { date: "2025-01-05" });
  await f.click("goal");
  f.setDate("2025-01-06", false);
  await f.submitGoal(5);
  assert.deepEqual(f.app.context().state.weeklyGoals, [{ from: monday, target: 1 }, { from: "2025-01-06", target: 5 }]);
  assert.match(f.main.querySelector(".goal-card").textContent, /0 \/ 5/);
});

test("the effective date in an open habit editor follows midnight without resetting its draft", async () => {
  const initial = M.addHabit(M.emptyState(), { id: "walk", name: "Walk", icon: "boot" }, monday);
  const f = journalWith(initial, { hash: "#habits" });
  await f.click("edit");
  const input = f.content.querySelector("#habit-name");
  input.value = "Walk home";
  assert.match(f.content.querySelector("#schedule-hint").textContent, /Dec 31, 2024/);
  f.setDate(tuesday);
  assert.match(f.content.querySelector("#schedule-hint").textContent, /Jan 1, 2025/);
  assert.equal(f.content.querySelector("#habit-name"), input);
  await f.submit(input.value, "boot", [2]);
  assert.equal(habit(f).schedules[0].from, wednesday);
});

test("leaving a confirmation while its write is waiting for a lock cancels the replacement", async () => {
  let release;
  const locks = { request(_name, work) { return new Promise(resolve => { release = () => resolve(work()); }); } };
  const f = fixture({ locks });
  const raw = f.storage.getItem(KEY);
  await f.click("settings");
  await f.click("reset-prompt", { kind: "empty" });
  f.doc.emit("click", { target: f.control("reset") });
  await Promise.resolve();
  assert.equal(typeof release, "function");
  f.doc.emit("click", { target: f.control("back-confirm") });
  release();
  await f.app.idle();
  assert.equal(f.storage.getItem(KEY), raw);
  assert.equal(f.content.querySelector("#dialog-title").textContent, "Journal settings");
  f.app.destroy();
});

test("a lapsed journal welcomes a new streak and deleting the focused habit restores focus to the page", async () => {
  const initial = M.addHabit(M.emptyState(), { id: "read", name: "Read", icon: "book" }, monday);
  const f = journalWith(M.setCheck(initial, "read", monday, true, monday), { date: wednesday });
  assert.match(f.main.querySelector(".hero").textContent, /start a new streak/);
  f.navigate("habits");
  await f.click("edit");
  await f.click("remove-prompt");
  await f.click("remove");
  assert.equal(f.doc.activeElement, f.main);
});

test("an untouched weekly goal form cannot roll back a newer target saved by another tab", async () => {
  const f = journalWith(M.setWeeklyGoal(M.emptyState(), monday, 2));
  const second = fixture({ date: monday, storage: f.storage });
  await f.click("goal");
  await second.click("goal");
  await second.submitGoal(5);
  const writes = f.storage.writes;
  await f.submitGoal(2);
  assert.equal(M.weeklyTarget(f.app.context().state, monday), 5);
  assert.equal(f.storage.writes, writes);
  assert.match(f.main.querySelector(".goal-card").textContent, /0 \/ 5/);
});

test("a queued main-page check-in cannot write or restart timers after the app closes", async () => {
  let release;
  const locks = { request(_name, work) { return new Promise(resolve => { release = () => resolve(work()); }); } };
  const f = fixture({ locks });
  const raw = f.storage.getItem(KEY);
  f.doc.emit("click", { target: f.control("check", { id: "walking" }) });
  await Promise.resolve();
  f.app.destroy();
  release();
  await f.app.idle();
  assert.equal(f.storage.getItem(KEY), raw);
  assert.equal(f.win.timers.size, 0);
});

test("the focused daily checklist row follows midnight to the same habit", () => {
  const f = fixture();
  f.control("check", { id: "reading" }).focus();
  f.setDate("2026-11-24");
  assert.equal(f.doc.activeElement.dataset.key, "check-reading-2026-11-24");
  assert.equal(f.doc.activeElement, f.control("check", { id: "reading" }));
});
