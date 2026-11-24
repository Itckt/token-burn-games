"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/model.js");
const { KEY, createJournal } = require("../js/storage.js");
const { MemoryStorage } = require("../test-support/platform.js");
const day = "2026-11-23";
const add = id => state => M.addHabit(state,{id,name:"Habit " + id,icon:"leaf"},day);

test("first open seeds and persists once, and later openings preserve the original dates", () => {
  const storage = new MemoryStorage();
  const initial = createJournal(storage,day);
  assert.equal(initial.mode,"local");
  assert.equal(storage.writes,1);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)),initial.state);
  const later = createJournal(storage,"2026-12-01");
  assert.deepEqual(later.state,initial.state);
  assert.equal(storage.writes,1);
});

test("a deliberately empty journal stays empty after reopening", () => {
  const storage = new MemoryStorage();
  createJournal(storage,day).replace(M.emptyState());
  assert.deepEqual(createJournal(storage,day).state,M.emptyState());
});

test("independent tabs merge successive edits against the latest saved state", () => {
  const storage = new MemoryStorage();
  const first = createJournal(storage,day);
  first.replace(M.emptyState());
  const second = createJournal(storage,day);
  first.change(add("a"));
  second.change(add("b"));
  first.change(state => M.setCheck(state,"a",day,true,day));
  second.change(state => M.editHabit(state,"b","New name","cup"));
  first.refresh();
  assert.deepEqual(first.state.habits.map(h => [h.id,h.name,h.checks]),[["a","Habit a",[day]],["b","New name",[]]]);
  assert.deepEqual(first.state,second.state);
});

test("idempotent writes and rejected changes leave persisted bytes untouched", () => {
  const storage = new MemoryStorage();
  const journal = createJournal(storage,day);
  const raw = storage.getItem(KEY);
  journal.change(state => M.setCheck(state,"reading",day,true,day));
  assert.equal(storage.writes,1);
  assert.throws(() => journal.change(state => M.setCheck(state,"reading","2026-12-10",true,day)));
  assert.throws(() => journal.change(() => ({version:-1})));
  assert.throws(() => journal.replace({version:5}));
  assert.equal(storage.getItem(KEY),raw);
  assert.deepEqual(journal.state,JSON.parse(raw));
});

test("a missing or unreadable storage API allows a complete in-memory session", () => {
  for (const storage of [null,{getItem(){throw new Error("denied");}}]) {
    const journal = createJournal(storage,day);
    assert.equal(journal.mode,"memory");
    journal.replace(M.emptyState());
    journal.change(add("notes"));
    journal.refresh();
    journal.change(state => M.setCheck(state,"notes",day,true,day));
    assert.deepEqual(journal.state.habits[0].checks,[day]);
  }
});

test("write failure preserves the new check-in and marks the journal session-only", () => {
  const storage = new MemoryStorage();
  const journal = createJournal(storage,day);
  const raw = storage.getItem(KEY);
  storage.setItem = () => { throw new Error("quota"); };
  journal.change(s => M.setCheck(s,"walking",day,true,day));
  assert.equal(journal.mode,"memory");
  assert.ok(M.findHabit(journal.state,"walking").checks.includes(day));
  assert.equal(storage.getItem(KEY),raw);
  journal.refresh();
  assert.ok(M.findHabit(journal.state,"walking").checks.includes(day));
});

test("a storage read failure after startup retains existing entries", () => {
  const storage = new MemoryStorage();
  const journal = createJournal(storage,day);
  storage.getItem = () => { throw new Error("blocked"); };
  journal.change(add("new"));
  assert.equal(journal.mode,"memory");
  assert.equal(journal.state.habits.length,5);
});

test("damaged and unknown-version saves survive inspection and ordinary edits", () => {
  for (const raw of ["{broken","null",'{"version":2}', JSON.stringify({...M.emptyState(),habits:[{}]})]) {
    const storage = new MemoryStorage();
    storage.setItem(KEY,raw);
    const journal = createJournal(storage,day);
    assert.equal(journal.mode,"damaged");
    assert.deepEqual(journal.state,M.emptyState());
    assert.throws(() => journal.change(add("a")),/unreadable/);
    assert.equal(storage.getItem(KEY),raw);
    journal.replace(M.emptyState());
    assert.equal(journal.mode,"local");
    journal.change(add("recovered"));
    assert.equal(createJournal(storage,day).state.habits[0].id,"recovered");
  }
});

test("external replacements, repairs and removal refresh an already open session", () => {
  const storage = new MemoryStorage();
  const journal = createJournal(storage,day);
  storage.setItem(KEY,"?");
  journal.refresh();
  assert.equal(journal.mode,"damaged");
  storage.setItem(KEY,JSON.stringify(M.emptyState()));
  journal.refresh();
  assert.equal(journal.mode,"local");
  journal.change(add("a"));
  storage.removeItem(KEY);
  journal.refresh();
  assert.deepEqual(journal.state,M.emptyState());
  journal.change(add("only"));
  assert.equal(journal.state.habits.length,1);
});

test("a version 1 journal upgrades on its first change and keeps intervening edits from older tabs", () => {
  const oldHabit = { id: "legacy", name: "Walk", icon: "boot", start: "2026-11-20", checks: ["2026-11-20"] };
  const oldSave = { version: 1, sample: false, habits: [oldHabit] };
  const raw = JSON.stringify(oldSave, null, 2);
  const storage = new MemoryStorage();
  storage.setItem(KEY, raw);
  const journal = createJournal(storage, day);
  assert.equal(journal.state.version, 3);
  assert.deepEqual(journal.state.weeklyGoals, []);
  assert.deepEqual(journal.state.notes, {});
  assert.deepEqual(journal.state.habits, [oldHabit]);
  journal.change(s => M.editHabit(s, "legacy", "Walk", "boot"));
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(storage.writes, 1);

  storage.setItem(KEY, JSON.stringify({ ...oldSave, habits: [{ ...oldHabit, checks: [...oldHabit.checks, day] }] }));
  journal.change(s => M.changeSchedule(s, "legacy", [1, 3], day));
  const saved = JSON.parse(storage.getItem(KEY));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.habits[0].checks, ["2026-11-20", day]);
  assert.deepEqual(saved.habits[0].schedules, [{ from: "2026-11-24", days: [1, 3] }]);
  assert.deepEqual(createJournal(storage, day).state, saved);
  assert.equal(storage.data.size, 1);
});
