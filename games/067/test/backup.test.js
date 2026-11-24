"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveObjectURL } = require("node:buffer");
const { MemoryStorage, fixture } = require("../test-support/platform.js");
const { KEY, parseJournal } = require("../js/storage.js");
const M = require("../js/model.js");

const today = "2026-11-23";
const file = (raw, name = "journal.json") => Object.assign(new Blob([raw], { type: "application/json" }), { name });
const download = f => f.content.querySelector("[download]");

function plannedJournal() {
  let state = M.addHabit(M.emptyState(), { id: "notes", name: '溫習 <notes> & "sketches"', icon: "book", days: [0, 6] }, "2026-11-15");
  state = M.changeSchedule(state, "notes", [0, 2, 4], "2026-11-19");
  state = M.setWeeklyGoal(state, "2026-11-16", 1);
  state = M.setWeeklyGoal(state, today, 2);
  for (const day of ["2026-11-16", "2026-11-20", today]) state = M.setCheck(state, "notes", day, true, today);
  return state;
}

test("settings downloads the actual UTF-8 journal and releases superseded and closed file URLs", async () => {
  const f = fixture();
  const writes = f.storage.writes;
  await f.click("settings");
  const link = download(f);
  const original = resolveObjectURL(link.attrs.href);
  assert.equal(link.attrs.download, "embertrail-2026-11-23.json");
  assert.equal(original.type, "application/json");
  assert.deepEqual(parseJournal(await original.text()), f.app.context().state);
  assert.equal(f.storage.writes, writes);

  const updated = plannedJournal();
  f.storage.setItem(KEY, JSON.stringify(updated));
  f.win.emit("storage", { key: KEY });
  assert.equal(resolveObjectURL(link.attrs.href), undefined);
  const refreshed = download(f).attrs.href;
  assert.deepEqual(JSON.parse(await resolveObjectURL(refreshed).text()), updated);
  await f.click("close");
  assert.equal(resolveObjectURL(refreshed), undefined);
  await f.click("settings");
  const finalUrl = download(f).attrs.href;
  f.app.destroy();
  assert.equal(resolveObjectURL(finalUrl), undefined);
});

test("a downloaded backup previews its contents, survives cancellation and restores all history on confirmation", async () => {
  const source = fixture();
  const state = plannedJournal();
  source.storage.setItem(KEY, JSON.stringify(state));
  source.win.emit("storage", { key: KEY });
  await source.click("settings");
  const backup = resolveObjectURL(download(source).attrs.href);
  const name = '<file> Kowloon Tong & notes.json';
  const picked = Object.assign(backup, { name });
  source.app.destroy();

  const f = fixture();
  const original = f.storage.getItem(KEY);
  await f.click("settings");
  await f.chooseBackup(picked);
  assert.equal(f.content.querySelector("#dialog-title").textContent, "Restore this backup?");
  assert.equal(f.content.querySelector(".backup-name").textContent, name);
  assert.equal(f.content.querySelector("file"), null);
  assert.deepEqual(f.content.querySelectorAll("dd").map(el => el.textContent), ["1", "3", "Nov 23, 2026"]);
  assert.equal(f.doc.activeElement, f.control("back-confirm"));
  assert.equal(f.storage.getItem(KEY), original);
  await f.click("back-confirm");
  assert.equal(f.storage.getItem(KEY), original);
  await f.chooseBackup(picked);
  await f.click("restore");
  assert.equal(f.dialog.open, false);
  assert.deepEqual(JSON.parse(f.storage.getItem(KEY)), state);
  const reopened = fixture({ storage: f.storage });
  assert.deepEqual(reopened.app.context().state, state);
  assert.equal(reopened.control("check").querySelector("strong").textContent, state.habits[0].name);
  assert.match(reopened.main.querySelector(".goal-result").textContent, /1 \/ 2 active days/);
  reopened.navigate("rewards");
  assert.match(reopened.control("pennants").textContent, /Weekly goals met · 1/);
});

test("an invalid backup or a read error leaves the device journal intact and permits a retry", async () => {
  const f = fixture();
  const original = f.storage.getItem(KEY);
  const writes = f.storage.writes;
  await f.click("settings");
  await f.chooseBackup(null);
  assert.equal(f.content.querySelector("#form-error").textContent, "");
  const samples = [
    [file("broken json"), /JSON backup/],
    [file('{"version":5}'), /format/],
    [file(JSON.stringify({ ...M.emptyState(), weeklyGoals: [{ from: today, target: 9 }] })), /weekly goal/],
    [file(JSON.stringify({ ...M.emptyState(), habits: [{ ...plannedJournal().habits[0], checks: ["2026-11-17"] }] })), /history/],
    [file(JSON.stringify({ ...M.emptyState(), notes: { [today]: "x".repeat(501) } })), /500 characters/],
    [file(JSON.stringify({ ...M.emptyState(), habits: [{ ...plannedJournal().habits[0], partials: { [today]: 1 } }] })), /partial count/],
    [{ name: "unavailable.json", text() { return Promise.reject(new Error("read failure")); } }, /could not be read/]
  ];
  for (const [bad, message] of samples) {
    await f.chooseBackup(bad);
    assert.match(f.content.querySelector("#form-error").textContent, message);
    assert.equal(f.content.querySelector("#dialog-title").textContent, "Journal settings");
    assert.equal(f.control("restore"), undefined);
    assert.equal(f.storage.getItem(KEY), original);
    assert.equal(f.storage.writes, writes);
  }
  await f.chooseBackup(file(JSON.stringify(M.emptyState())));
  assert.deepEqual(f.content.querySelectorAll("dd").map(el => el.textContent), ["0", "0", "None yet"]);
  await f.click("restore");
  assert.deepEqual(fixture({ storage: f.storage }).app.context().state, M.emptyState());
});

test("a cancelled or superseded file read cannot reopen a preview or overwrite a newer pick", async () => {
  const f = fixture();
  const raw = f.storage.getItem(KEY);
  let release;
  const slow = { name: "slow.json", text: () => new Promise(resolve => { release = resolve; }) };
  await f.click("settings");
  const first = f.chooseBackup(slow);
  await f.chooseBackup(file(raw, "latest.json"));
  release("broken");
  await first;
  assert.equal(f.content.querySelector(".backup-name").textContent, "latest.json");
  await f.click("back-confirm");
  const second = f.chooseBackup(slow);
  f.dialog.emit("cancel");
  await f.click("settings");
  release(raw);
  await second;
  assert.equal(f.content.querySelector("#dialog-title").textContent, "Journal settings");
  assert.equal(f.content.querySelector("#form-error").textContent, "");
  assert.equal(f.storage.getItem(KEY), raw);
  f.app.destroy();
});

test("legacy backups recover damaged storage only after confirmation", async () => {
  const legacy = { version: 1, sample: false, habits: [{ id: "walk", name: "Walk home", icon: "boot", start: today, checks: [today] }] };
  const storage = new MemoryStorage();
  storage.setItem(KEY, "unreadable");
  const f = fixture({ storage });
  await f.click("settings");
  assert.equal(download(f), null);
  await f.chooseBackup(file(JSON.stringify(legacy)));
  assert.equal(storage.getItem(KEY), "unreadable");
  await f.click("restore");
  assert.equal(f.app.context().mode, "local");
  const restored = { ...M.emptyState(), habits: legacy.habits };
  assert.deepEqual(f.app.context().state, restored);
  f.setDate("2026-11-24");
  assert.equal(f.main.querySelector(".count-pill").textContent, "0 / 1");
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), restored);
});

test("session-only journals can restore, change and export a complete portable copy", async () => {
  const f = fixture({ storage: null });
  const state = plannedJournal();
  await f.click("settings");
  await f.chooseBackup(file(JSON.stringify(state)));
  await f.click("restore");
  assert.equal(f.app.context().mode, "memory");
  await f.click("check", { id: "notes" });
  await f.click("settings");
  const bytes = await resolveObjectURL(download(f).attrs.href).text();
  assert.deepEqual(parseJournal(bytes), M.setCheck(state, "notes", today, false, today));
  f.app.destroy();
});

test("a restricted file origin can still download and restore when object URLs are unavailable", async () => {
  const f = fixture();
  f.win.URL = { createObjectURL() { throw new Error("unavailable"); } };
  await f.click("settings");
  const href = download(f).attrs.href;
  assert.match(href, /^data:application\/json;charset=utf-8,/);
  const raw = decodeURIComponent(href.slice(href.indexOf(",") + 1));
  assert.deepEqual(parseJournal(raw), f.app.context().state);
  await f.chooseBackup(file(raw));
  await f.click("restore");
  assert.deepEqual(parseJournal(f.storage.getItem(KEY)), JSON.parse(raw));
  assert.equal(f.dialog.open, false);
});
