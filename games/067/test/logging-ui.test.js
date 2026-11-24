"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveObjectURL } = require("node:buffer");
const { MemoryStorage, fixture } = require("../test-support/platform.js");
const M = require("../js/model.js");
const { KEY } = require("../js/storage.js");

const monday = "2024-02-26";
const tuesday = "2024-02-27";
const wednesday = "2024-02-28";
const leapDay = "2024-02-29";
const reading = { id: "read", name: "Read a chapter", icon: "book", target: 6, unit: "pages" };
const counted = () => M.addHabit(M.emptyState(), reading, monday);

function setup(state = M.emptyState(), options = {}) {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify(state));
  return fixture({ date: monday, storage, ...options });
}

function input(f, id, value) {
  const field = f.content.querySelector("#" + id);
  assert.ok(field, "Missing input " + id);
  field.value = String(value);
  field.focus();
  f.doc.emit("input", { target: field });
  return field;
}

async function save(f) {
  const form = f.content.querySelector("form");
  assert.ok(form);
  assert.equal(f.doc.emit("submit", { target: form }).defaultPrevented, true);
  await f.app.idle();
}

function external(f, edit) {
  const state = edit(JSON.parse(f.storage.getItem(KEY)));
  f.storage.setItem(KEY, JSON.stringify(state));
  f.win.emit("storage", { key: KEY });
}

const stateOf = f => f.app.context().state;
const title = f => f.content.querySelector("#dialog-title").textContent;
const toast = f => f.doc.getElementById("toast").textContent;

test("create a counted habit, log a partial, earn its two awards and correct it from the calendar", async () => {
  const f = setup(M.setWeeklyGoal(M.emptyState(), monday, 1));
  await f.click("new-habit");
  assert.equal(f.content.querySelector("#habit-unit").disabled, true);
  input(f, "daily-target", 6);
  assert.equal(f.content.querySelector("#habit-unit").disabled, false);
  input(f, "habit-unit", "pages");
  await f.submit("Read between lectures", "book");
  assert.match(f.control("progress").textContent, /0 \/ 6 pages/);
  await f.click("progress");
  assert.equal(f.doc.activeElement.id, "progress-amount");
  assert.match(f.content.textContent, /Monday, February 26, 2024/);
  await f.click("adjust-count", { by: "-1" });
  assert.equal(f.content.querySelector("#progress-amount").value, "0");
  input(f, "progress-amount", 2);
  await f.click("adjust-count", { by: "1" });
  assert.equal(f.content.querySelector("#count-meter").value, 3);
  await save(f);
  assert.equal(f.dialog.open, false);
  assert.match(f.control("progress").textContent, /3 \/ 6 pages/);
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 1");
  assert.match(f.main.querySelector(".goal-card").textContent, /0 \/ 1/);
  assert.match(f.control("day", { day: monday }).attrs["aria-label"], /uncollected/);

  const reopened = fixture({ storage: f.storage, date: monday, hash: "#habits" });
  assert.match(reopened.control("progress").textContent, /3 \/ 6 pages/);
  assert.match(reopened.main.querySelector(".mini-week").textContent, /3 of 6 pages/);
  await reopened.click("progress");
  await reopened.click("fill-count");
  await reopened.click("adjust-count", { by: "1" });
  assert.equal(reopened.content.querySelector("#progress-amount").value, "6");
  await save(reopened);
  assert.match(toast(reopened), /collected.*pennant earned/i);
  assert.match(reopened.main.querySelector(".manage-streak").textContent, /1 day/);
  reopened.navigate("rewards");
  assert.match(reopened.control("pennants").textContent, /goals met · 1/);
  await reopened.click("reward", { reward: M.rewardForDay(monday) });
  await reopened.click("day", { day: monday });
  await reopened.click("progress");
  await reopened.click("adjust-count", { by: "-1" });
  await save(reopened);
  assert.match(title(reopened), /Feb 26/);
  assert.equal(reopened.doc.activeElement, reopened.control("progress"));
  assert.match(reopened.content.textContent, /Available reward/);
  assert.match(toast(reopened), /pennant returned/i);
  assert.match(reopened.control("progress").textContent, /5 \/ 6/);
  await reopened.click("close");
  assert.match(reopened.control("pennants").textContent, /goals met · 0/);
  reopened.navigate("statistics");
  assert.deepEqual(reopened.main.querySelectorAll(".metric").map(el => el.querySelector("strong").textContent), ["0", "0%", "0 / 7"]);
});

test("invalid amounts stay editable, cancelled progress is discarded and an open log keeps its date at midnight", async () => {
  const f = setup(counted());
  const raw = f.storage.getItem(KEY);
  await f.click("day", { day: tuesday });
  assert.equal(f.control("progress"), undefined);
  assert.match(f.content.querySelector(".upcoming-habit").textContent, /6 pages/);
  await f.click("close");
  await f.click("progress");
  for (const value of ["", "-1", "1.5", "7"]) {
    input(f, "progress-amount", value);
    await save(f);
    assert.match(f.content.querySelector("#form-error").textContent, /0 to 6/);
    assert.equal(f.storage.getItem(KEY), raw);
    assert.equal(f.content.querySelector("#progress-amount").value, value);
  }
  await f.click("back");
  assert.equal(f.storage.getItem(KEY), raw);
  await f.click("progress");
  const amount = input(f, "progress-amount", 3);
  f.setDate(tuesday);
  assert.equal(f.content.querySelector("#progress-amount"), amount);
  await save(f);
  assert.deepEqual(stateOf(f).habits[0].partials, { [monday]: 3 });
  assert.match(f.control("progress").textContent, /0 \/ 6/);
  await f.click("day", { day: monday });
  await f.click("progress");
  input(f, "progress-amount", 0);
  await save(f);
  assert.equal(stateOf(f).habits[0].partials, undefined);
});

test("a one-tap habit changing to a counted target at midnight requests an amount before awarding anything", async () => {
  const simple = M.addHabit(M.emptyState(), { ...reading, target: 1 }, monday);
  const f = setup(simple, { hash: "#habits" });
  await f.click("edit");
  input(f, "daily-target", 4);
  input(f, "habit-unit", "pages");
  await f.click("remove-prompt");
  await f.click("back-confirm");
  assert.equal(f.content.querySelector("#daily-target").value, "4");
  assert.equal(f.content.querySelector("#habit-unit").value, "pages");
  await save(f);
  assert.match(f.main.querySelector(".schedule-change").textContent, /Feb 27.*4 pages/);
  assert.ok(f.control("check"));
  f.setDate(tuesday, false);
  await f.click("check");
  assert.equal(title(f), "Log progress");
  assert.match(f.content.textContent, /Tuesday, February 27/);
  assert.deepEqual(stateOf(f).habits[0].checks, []);
  input(f, "progress-amount", 2);
  await save(f);
  assert.deepEqual(stateOf(f).habits[0].partials, { [tuesday]: 2 });
});

test("a habit edit merges an independently updated unit and preserves its old target on earlier dates", async () => {
  const f = setup(counted(), { hash: "#habits" });
  await f.click("edit");
  input(f, "daily-target", 8);
  external(f, state => M.changeTarget(state, "read", 6, "lines", monday));
  await save(f);
  const h = stateOf(f).habits[0];
  assert.deepEqual(h.targets.map(t => [t.from, t.amount, t.unit]), [[monday, 6, "pages"], [tuesday, 8, "lines"]]);
});

test("a rejected unit stays editable and switching back to a single check-in discards the disabled unit", async () => {
  const f = setup();
  await f.click("new-habit");
  input(f, "daily-target", 2);
  input(f, "habit-unit", "p".repeat(25));
  await f.submit("Walk", "boot");
  assert.match(f.content.querySelector("#form-error").textContent, /24 characters/);
  assert.equal(stateOf(f).habits.length, 0);
  input(f, "daily-target", 1);
  assert.equal(f.content.querySelector("#habit-unit").disabled, true);
  await save(f);
  assert.equal(f.dialog.open, false);
  assert.equal(stateOf(f).habits[0].targets, undefined);
  assert.ok(f.control("check"));
});

test("overlapping count edits show the saved amount, preserve the draft and accept an explicit second save", async () => {
  const f = setup(counted());
  await f.click("progress");
  const field = input(f, "progress-amount", 4);
  external(f, state => M.setProgress(state, "read", monday, 2, monday));
  assert.equal(f.content.querySelector("#progress-amount"), field);
  await save(f);
  assert.match(f.content.querySelector("#form-error").textContent, /count changed to “2”/);
  assert.equal(field.value, "4");
  assert.equal(stateOf(f).habits[0].partials[monday], 2);
  await save(f);
  assert.equal(stateOf(f).habits[0].partials[monday], 4);
  await f.click("progress");
  external(f, state => M.setProgress(state, "read", monday, 6, monday));
  await save(f); // This draft stayed at four. Keep the other tab's completed count.
  assert.deepEqual(stateOf(f).habits[0].checks, [monday]);
  assert.equal(stateOf(f).habits[0].partials, undefined);
});

test("external deletion during a calendar count returns to the day without resurrecting the habit", async () => {
  const f = setup(counted());
  await f.click("day", { day: monday });
  await f.click("progress");
  input(f, "progress-amount", 4);
  external(f, state => M.removeHabit(state, "read"));
  assert.match(title(f), /Feb 26/);
  assert.equal(f.content.querySelector("form"), null);
  assert.equal(f.control("progress"), undefined);
  assert.match(toast(f), /removed/);
  assert.deepEqual(stateOf(f).habits, []);
});

test("add a field note on an empty date, find it by text and date, safely edit it, and clear it", async () => {
  const f = setup(undefined, { date: leapDay });
  const payload = "路上看書 🍵\n<sketch> & \"notes\"";
  await f.click("day", { day: monday });
  await f.click("note");
  const note = input(f, "note-text", "a".repeat(501));
  await save(f);
  assert.match(f.content.querySelector("#form-error").textContent, /500/);
  assert.deepEqual(stateOf(f).notes, {});
  note.value = payload;
  await save(f);
  assert.equal(f.content.querySelector(".note-text").textContent, payload);
  assert.equal(f.content.querySelector("sketch"), null);
  assert.equal(f.doc.activeElement, f.control("note"));
  await f.click("close");
  assert.match(f.control("day", { day: monday }).attrs["aria-label"], /uncollected, field note/);
  assert.equal(f.main.querySelectorAll(".note-mark").length, 1);
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 0");
  await f.click("notes");
  const search = input(f, "notes-query", "<SKeTCH>");
  assert.equal(f.doc.activeElement, search);
  await f.click("day", { day: monday });
  assert.ok(f.control("back"));
  await f.click("note");
  assert.equal(f.content.querySelector("#note-text").value, payload);
  input(f, "note-text", "After the walk");
  await save(f);
  await f.click("back");
  assert.equal(f.content.querySelector("#notes-query").value, "<SKeTCH>");
  assert.match(f.content.textContent, /No matching/);
  input(f, "notes-query", monday);
  assert.equal(f.content.querySelectorAll(".note-entry").length, 1);
  await f.click("day", { day: monday });
  await f.click("note");
  input(f, "note-text", "   ");
  await save(f);
  assert.equal(f.content.querySelector(".note-text"), null);
  await f.click("close");
  assert.equal(f.main.querySelector(".note-mark"), null);
  assert.deepEqual(stateOf(f).notes, {});
});

test("notes dated from the index stay on their selected day across midnight and merge other dates", async () => {
  const f = setup();
  await f.click("day", { day: tuesday });
  assert.equal(f.control("note"), undefined);
  await f.click("close");
  await f.click("notes");
  await f.click("note-today");
  const field = input(f, "note-text", "Kept a steady pace");
  f.setDate(tuesday);
  external(f, state => M.setNote(state, tuesday, "New day", tuesday));
  assert.equal(f.content.querySelector("#note-text"), field);
  await save(f);
  assert.equal(title(f), "Field notes");
  assert.deepEqual(f.content.querySelectorAll(".note-entry").map(el => el.dataset.day), [tuesday, monday]);
  assert.deepEqual(stateOf(f).notes, { [monday]: "Kept a steady pace", [tuesday]: "New day" });
  f.setDate(monday);
  assert.equal(f.control("day", { day: tuesday }), undefined);
  assert.ok(stateOf(f).notes[tuesday]);
});

test("a simultaneous note edit can be kept or replaced explicitly, including a deletion", async () => {
  const f = setup(M.setNote(M.emptyState(), monday, "Original", monday));
  const other = fixture({ storage: f.storage, date: monday });
  for (const tab of [f, other]) {
    await tab.click("notes");
    await tab.click("note-today");
  }
  input(f, "note-text", "My draft");
  input(other, "note-text", "Another draft");
  await save(other);
  // No storage event has been delivered to the first editor. Saving reads the latest bytes.
  await save(f);
  assert.match(f.content.querySelector("#form-error").textContent, /Another draft/);
  assert.equal(f.content.querySelector("#note-text").value, "My draft");
  assert.equal(stateOf(f).notes[monday], "Another draft");
  await save(f);
  assert.equal(stateOf(f).notes[monday], "My draft");
  await f.click("note-today");
  external(f, state => M.setNote(state, monday, "", monday));
  await save(f);
  assert.deepEqual(stateOf(f).notes, {});
});

test("long note searches page in order, restore the opener and reset the page size for a new query", async () => {
  let state = M.emptyState();
  for (let age = 0; age < 25; age++) {
    state = M.setNote(state, M.shiftDay(leapDay, -age), "Walk " + age, leapDay);
  }
  const f = setup(state, { date: leapDay });
  await f.click("notes");
  assert.equal(f.content.querySelectorAll(".note-entry").length, 20);
  await f.click("more-notes");
  assert.equal(f.content.querySelectorAll(".note-entry").length, 25);
  assert.equal(f.doc.activeElement.dataset.day, M.shiftDay(leapDay, -20));
  await f.click("day", { day: M.shiftDay(leapDay, -24) });
  f.dialog.emit("cancel");
  assert.equal(title(f), "Field notes");
  assert.equal(f.doc.activeElement.dataset.day, M.shiftDay(leapDay, -24));
  input(f, "notes-query", " walk ");
  assert.equal(f.content.querySelectorAll(".note-entry").length, 20);
  assert.equal(f.control("more-notes").textContent, "Show 5 more");
  input(f, "notes-query", "absent");
  assert.equal(f.control("day"), undefined);
  await f.click("close");
  assert.equal(f.doc.activeElement.dataset.key, "field-notes");
});

test("a cancelled note save waiting for a lock cannot write its draft", async () => {
  let release;
  const locks = { request(_key, work) { return new Promise(resolve => { release = () => resolve(work()); }); } };
  const f = setup(undefined, { locks });
  const before = f.storage.getItem(KEY);
  await f.click("notes");
  await f.click("note-today");
  input(f, "note-text", "Draft");
  f.doc.emit("submit", { target: f.content.querySelector("form") });
  await Promise.resolve();
  f.dialog.emit("cancel");
  release();
  await f.app.idle();
  assert.equal(title(f), "Field notes");
  assert.equal(f.storage.getItem(KEY), before);
});

test("a portable backup previews and restores notes, counts and dated units in a session-only journal", async () => {
  let state = M.setNote(counted(), monday, "Six pages before the MTR ride", wednesday);
  state = M.setProgress(state, "read", monday, 3, wednesday);
  state = M.changeTarget(state, "read", 2, "chapters", tuesday);
  const source = setup(state);
  await source.click("settings");
  const blob = resolveObjectURL(source.content.querySelector("[download]").attrs.href);
  const f = fixture({ date: wednesday, storage: null });
  await f.click("settings");
  await f.chooseBackup(Object.assign(blob, { name: "journal.json" }));
  assert.match(f.content.textContent, /Unfinished counts1/);
  assert.match(f.content.textContent, /Field notes1/);
  await f.click("restore");
  assert.deepEqual(stateOf(f), state);
  await f.click("day", { day: monday });
  assert.match(f.content.textContent, /3 \/ 6 pages/);
  assert.match(f.content.querySelector(".note-text").textContent, /MTR/);
  await f.click("close");
  assert.match(f.control("progress").textContent, /0 \/ 2 chapters/);
  source.app.destroy();
  f.app.destroy();
});

test("weekday review opens the underlying dates and refreshes both comparisons and rates after a correction", async () => {
  let state = M.addHabit(M.emptyState(), { ...reading, days: [3] }, "2024-02-19");
  state = M.setProgress(state, "read", "2024-02-22", 6, leapDay);
  state = M.setProgress(state, "read", leapDay, 4, leapDay);
  const f = setup(state, { date: "2024-03-03", hash: "#statistics" });
  const changes = () => f.main.querySelectorAll(".metric-change").map(el => el.textContent);
  assert.deepEqual(changes(), ["−1 check-in", "−100 percentage points", "−1 active day"]);
  assert.match(f.main.querySelector(".comparison-caption").textContent, /Feb 19, 2024 – Feb 25, 2024/);
  assert.match(f.control("weekday", { index: "0" }).attrs["aria-label"], /no eligible habits/);
  assert.match(f.control("weekday", { index: "3" }).attrs["aria-label"], /0 of 1 check-ins, 0%/);
  await f.click("weekday", { index: "3" });
  assert.equal(title(f), "Thursday check-ins");
  assert.match(f.control("day", { day: leapDay }).textContent, /0 \/ 1 complete/);
  await f.click("day", { day: leapDay });
  await f.click("progress");
  await f.click("fill-count");
  await save(f);
  await f.click("back");
  assert.equal(f.doc.activeElement, f.control("day", { day: leapDay }));
  assert.match(f.control("day", { day: leapDay }).textContent, /1 \/ 1 complete/);
  await f.click("close");
  assert.equal(f.doc.activeElement, f.control("weekday", { index: "3" }));
  assert.deepEqual(changes(), ["No change", "No change", "No change"]);
  for (const [span, count] of [[30, 4], [90, 13]]) {
    await f.click("period", { span: String(span) });
    assert.deepEqual(changes(), ["+2 check-ins", "No prior rate", "+2 active days"]);
    await f.click("weekday", { index: "3" });
    const dates = f.content.querySelectorAll(".review-date");
    assert.equal(dates.length, count);
    assert.equal(dates[0].dataset.day, leapDay);
    assert.match(dates.at(-1).textContent, /No habits due/);
    await f.click("close");
  }
});

test("statistics and weekday controls handle an empty journal at the first supported date", async () => {
  const f = setup(undefined, { date: M.FIRST_DAY, hash: "#statistics" });
  assert.equal(f.main.querySelectorAll(".metric-change").length, 0);
  assert.match(f.main.querySelector(".comparison-caption").textContent, /No earlier full period/);
  assert.deepEqual(f.main.querySelectorAll(".metric").map(el => el.querySelector("strong").textContent), ["0", "—", "0 / 1"]);
  const available = f.main.querySelectorAll(".weekday-result").filter(el => !el.disabled);
  assert.equal(available.length, 1);
  await f.click("weekday", { index: available[0].dataset.index });
  assert.match(f.control("day", { day: M.FIRST_DAY }).textContent, /No habits due/);
  await f.click("day", { day: M.FIRST_DAY });
  assert.equal(f.control("check"), undefined);
  assert.ok(f.control("note"));
});
