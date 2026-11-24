"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, MemoryStorage } = require("../test-support/platform.js");
const M = require("../js/model.js");
const { KEY } = require("../js/storage.js");
const today = "2026-11-23";

function blankStorage() {
  const storage = new MemoryStorage();
  storage.setItem(KEY,JSON.stringify(M.emptyState()));
  return storage;
}
function current(f) { return f.app.context().state; }
function tile(f,day) { return f.main.querySelector(`[data-key="day-${day}"]`); }

test("overview renders a dated reward calendar, streak, habit checklist, and seven-day chart", () => {
  const f = fixture();
  assert.equal(f.doc.title,"Overview · Embertrail");
  assert.equal(f.main.querySelector("h1").textContent,"Trail overview");
  assert.match(f.main.querySelector("time").textContent,/Monday, November 23, 2026/);
  assert.equal(f.main.querySelectorAll('[data-action="day"]').length,30);
  assert.equal(tile(f,today).attrs["aria-current"],"date");
  assert.match(tile(f,today).attrs["aria-label"],/collected$/);
  assert.equal(f.main.querySelector(".count-pill").textContent,"2 / 4");
  assert.equal(f.main.querySelector('[role="progressbar"]').attrs["aria-valuenow"],"50");
  assert.equal(f.main.querySelectorAll(".chart-column").length,7);
  assert.match(f.main.querySelector(".hero").textContent,/6 day streak/);
  assert.match(f.doc.getElementById("sidebar").textContent,/Starter journal/);
});

test("a checklist gesture updates the view, saved history, and a reopened journal", async () => {
  const f = fixture();
  assert.equal(f.control("check",{id:"walking"}).attrs["aria-pressed"],"false");
  await f.click("check",{id:"walking"});
  assert.equal(f.main.querySelector(".count-pill").textContent,"3 / 4");
  assert.equal(f.control("check",{id:"walking"}).attrs["aria-pressed"],"true");
  assert.equal(f.doc.activeElement.dataset.key,"check-walking-" + today);
  const reopened = fixture({storage:f.storage});
  assert.equal(reopened.main.querySelector(".count-pill").textContent,"3 / 4");
  await reopened.click("check",{id:"walking"});
  assert.equal(reopened.main.querySelector(".count-pill").textContent,"2 / 4");
  assert.equal(M.findHabit(current(reopened),"walking").checks.includes(today),false);
});

test("new journal replacement requires confirmation and persists through reopening", async () => {
  const f = fixture();
  const before = f.storage.getItem(KEY);
  await f.click("settings");
  assert.match(f.content.textContent,/sample history/);
  await f.click("reset-prompt",{kind:"empty"});
  await f.click("back-confirm");
  assert.equal(f.storage.getItem(KEY),before);
  await f.click("reset-prompt",{kind:"empty"});
  await f.click("reset");
  assert.equal(f.dialog.open,false);
  assert.deepEqual(current(f),M.emptyState());
  assert.match(f.main.querySelector(".hero").textContent,/0 day streak/);
  assert.deepEqual(current(fixture({storage:f.storage})),M.emptyState());
});

test("build a habit, collect today's prize, inspect its source and undo from the calendar", async () => {
  const f = fixture({storage:blankStorage()});
  await f.click("new-habit");
  assert.equal(f.doc.activeElement.id,"habit-name");
  assert.equal(f.content.querySelectorAll('[type="radio"]').length,8);
  await f.submit("  Walk to Kowloon Tong  ","boot");
  assert.equal(f.dialog.open,false);
  const id = current(f).habits[0].id;
  assert.equal(current(f).habits[0].name,"Walk to Kowloon Tong");
  assert.equal(current(f).habits[0].icon,"boot");
  await f.click("check",{id});
  assert.match(f.doc.getElementById("toast").textContent,/collected/);
  assert.match(f.main.querySelector(".hero").textContent,/1 day streak/);
  const reward = M.rewardForDay(today);
  f.navigate("rewards");
  assert.equal(f.control("reward",{reward}).querySelector(".reward-count").textContent,"× 1");
  await f.click("reward",{reward});
  assert.match(f.content.textContent,/1 collected/);
  await f.click("day",{day:today});
  assert.match(f.content.textContent,/Reward collected/);
  await f.click("check",{id});
  assert.match(f.content.textContent,/Available reward/);
  await f.click("close");
  assert.equal(f.control("reward",{reward}).querySelector(".reward-count").textContent,"× 0");
  f.navigate("statistics");
  assert.deepEqual(f.main.querySelectorAll(".metric").map(el => el.querySelector("strong").textContent),["0","0%","0 / 7"]);
});

test("names and icon edits preserve history and treat user-entered markup as text", async () => {
  const f = fixture({hash:"#habits"});
  const before = [...M.findHabit(current(f),"reading").checks];
  await f.click("edit",{id:"reading"});
  const name = 'Read <notes> & "reflect"';
  await f.submit(name,"moon");
  assert.deepEqual(M.findHabit(current(f),"reading").checks,before);
  assert.equal(M.findHabit(current(f),"reading").icon,"moon");
  assert.equal(f.main.querySelector("h2").textContent,name);
  assert.equal(f.main.querySelector("notes"),null);
  assert.equal(f.control("edit",{id:"reading"}).attrs["aria-label"],"Edit " + name);
  f.navigate("overview");
  assert.equal(f.control("check",{id:"reading"}).querySelector("strong").textContent,name);
});

test("an invalid submission stays editable, reports its error, and creates nothing", async () => {
  const f = fixture({storage:blankStorage()});
  await f.click("new-habit");
  await f.submit("  ","book");
  assert.equal(f.dialog.open,true);
  assert.match(f.content.querySelector("#form-error").textContent,/1 and 60/);
  assert.equal(current(f).habits.length,0);
  await f.submit("Read after lunch","book");
  assert.equal(f.dialog.open,false);
  assert.equal(current(f).habits.length,1);
});

test("rapid repeated form submissions create a single habit", async () => {
  const f = fixture({storage:blankStorage()});
  await f.click("new-habit");
  const form = f.content.querySelector("form");
  form.elements.habitName.value = "Read";
  f.doc.emit("submit",{target:form});
  f.doc.emit("submit",{target:form});
  await f.app.idle();
  assert.equal(current(f).habits.length,1);
});

test("deleting from the editor can be cancelled and removes check-ins only on confirmation", async () => {
  const f = fixture({hash:"#habits"});
  const old = f.storage.getItem(KEY);
  await f.click("edit",{id:"revision"});
  await f.click("remove-prompt");
  assert.match(f.content.textContent,/all its check-ins/);
  await f.click("back-confirm");
  assert.equal(f.content.querySelector("#habit-name").value,"Review lecture notes");
  assert.equal(f.storage.getItem(KEY),old);
  await f.click("remove-prompt");
  await f.click("remove");
  assert.equal(f.dialog.open,false);
  assert.equal(f.main.querySelectorAll(".manage-card").length,3);
  assert.ok(!JSON.parse(f.storage.getItem(KEY)).habits.some(h => h.id === "revision"));
});

test("calendar navigation wraps years and returns to the current month", async () => {
  const f = fixture({date:"2025-12-31"});
  await f.click("month",{offset:"1"});
  assert.equal(f.app.context().month,"2026-01");
  assert.equal(f.main.querySelector(".month-name").textContent,"January 2026");
  await f.click("month",{offset:"-1"});
  await f.click("month",{offset:"-1"});
  assert.equal(f.app.context().month,"2025-11");
  await f.click("current-month");
  assert.equal(f.app.context().month,"2025-12");
  assert.equal(f.control("current-month"),undefined);
});

test("upcoming calendar rewards have a preview and cannot receive check-ins", async () => {
  const f = fixture();
  const before = f.storage.getItem(KEY);
  await f.click("day",{day:"2026-11-28"});
  assert.match(f.content.textContent,/Upcoming reward/);
  assert.match(f.content.textContent,/Wayfarer chest/);
  assert.equal(f.content.querySelectorAll('[data-action="check"]').length,0);
  const cancel = f.dialog.emit("cancel");
  assert.equal(cancel.defaultPrevented,true);
  assert.equal(f.dialog.open,false);
  assert.equal(f.doc.activeElement.dataset.key,"day-2026-11-28");
  assert.equal(f.storage.getItem(KEY),before);
});

test("backfilling a missed date bridges two streaks and unchecking splits them again", async () => {
  const f = fixture();
  const date = "2026-11-17";
  await f.click("day",{day:date});
  assert.match(f.content.textContent,/Available reward/);
  await f.click("check",{id:"reading"});
  assert.match(f.content.textContent,/Reward collected/);
  assert.match(f.main.querySelector(".hero").textContent,/12 day streak/);
  assert.equal(f.doc.activeElement, f.control("check",{id:"reading"}));
  await f.click("check",{id:"reading"});
  await f.click("close");
  assert.match(f.main.querySelector(".hero").textContent,/6 day streak/);
  assert.match(tile(f,date).attrs["aria-label"],/uncollected$/);
});

test("dates before a habit's creation never offer it for backfill", async () => {
  const f = fixture({storage:blankStorage()});
  await f.click("new-habit");
  await f.submit("A new routine","leaf");
  await f.click("day",{day:"2026-11-22"});
  assert.equal(f.content.querySelectorAll('[data-action="check"]').length,0);
  assert.match(f.content.textContent,/No habits had started/);
});

test("the compact overview links to every habit when the checklist exceeds four", async () => {
  const f = fixture();
  await f.click("new-habit");
  await f.submit("Stretch","sun");
  assert.equal(f.main.querySelectorAll(".habit-row").length,4);
  assert.equal(f.main.querySelector(".card-link").textContent,"View all 5 habits");
  assert.equal(f.main.querySelector(".count-pill").textContent,"2 / 5");
  f.navigate("habits");
  assert.equal(f.main.querySelectorAll(".manage-card").length,5);
  await f.click("check",{id:"test-1"});
  assert.equal(f.control("check",{id:"test-1"}).attrs["aria-pressed"],"true");
});

test("all statistics windows show correct totals, labels, per-habit counts, and chart buckets", async () => {
  const f = fixture({hash:"#statistics"});
  for (const span of [30,90,7]) {
    await f.click("period",{span:String(span)});
    const expected = M.stats(current(f),today,span);
    assert.equal(f.control("period",{span:String(span)}).attrs["aria-pressed"],"true");
    assert.deepEqual(f.main.querySelectorAll(".metric").map(el => el.querySelector("strong").textContent),
      [String(expected.done),expected.rate+"%",expected.active + " / " + span]);
    const bars = f.main.querySelectorAll(".bar-value").map(el => Number(el.textContent));
    assert.equal(bars.reduce((a,b) => a+b,0),expected.done);
    assert.ok(bars.length <= 12);
    assert.match(f.main.querySelector('[role="img"]').attrs["aria-label"],/check-in/);
    assert.equal(f.main.querySelectorAll(".breakdown-row").length,4);
  }
});

test("midnight refreshes the daily checklist, streak grace period and calendar month", () => {
  const f = fixture({date:"2026-11-30"});
  f.setDate("2026-12-01");
  assert.equal(f.app.context().month,"2026-12");
  assert.equal(f.main.querySelector(".count-pill").textContent,"0 / 4");
  assert.equal(tile(f,"2026-12-01").attrs["aria-current"],"date");
  assert.match(f.main.querySelector(".hero").textContent,/6 day streak/);
  f.setDate("2026-12-02");
  assert.match(f.main.querySelector(".hero").textContent,/0 day streak/);
  assert.ok(M.findHabit(current(f),"reading").checks.includes("2026-11-30"));
});

test("midnight and external updates respect the browsed month and an unsaved form", async () => {
  const f = fixture({date:"2026-11-30"});
  await f.click("month",{offset:"-1"});
  await f.click("new-habit");
  const input = f.content.querySelector("#habit-name");
  input.value = "Draft";
  f.setDate("2026-12-01");
  f.win.emit("storage",{key:KEY});
  assert.equal(f.app.context().month,"2026-10");
  assert.equal(f.content.querySelector("#habit-name"),input);
  assert.equal(input.value,"Draft");
  await f.submit(input.value,"pencil");
  assert.equal(current(f).habits.at(-1).start,"2026-12-01");
});

test("checklist gestures across midnight use the new day while a dated calendar edit keeps its date", async () => {
  const f = fixture();
  f.setDate("2026-11-24",false);
  await f.click("check",{id:"reading"});
  assert.ok(M.findHabit(current(f),"reading").checks.includes("2026-11-24"));
  assert.ok(M.findHabit(current(f),"reading").checks.includes(today));
  assert.equal(f.main.querySelector(".count-pill").textContent,"1 / 4");
  await f.click("day",{day:"2026-11-24"});
  f.setDate("2026-11-25",false);
  await f.click("check",{id:"walking"});
  const habit = M.findHabit(current(f),"walking");
  assert.ok(habit.checks.includes("2026-11-24"));
  assert.ok(!habit.checks.includes("2026-11-25"));
});

test("external deletion closes a stale editor and never resurrects the deleted habit", async () => {
  const f = fixture({hash:"#habits"});
  await f.click("edit",{id:"water"});
  const next = M.removeHabit(current(f),"water");
  f.storage.setItem(KEY,JSON.stringify(next));
  f.win.emit("storage",{key:KEY});
  assert.equal(f.dialog.open,false);
  assert.equal(f.main.querySelectorAll(".manage-card").length,3);
  assert.match(f.doc.getElementById("toast").textContent,/removed/);
});

test("cooperating tabs serialize simultaneous check-ins against the same device journal", async () => {
  const storage = new MemoryStorage();
  let queue = Promise.resolve();
  const names = [];
  const locks = {request(name,fn) { names.push(name); queue = queue.then(fn); return queue; }};
  const a = fixture({storage,locks}), b = fixture({storage,locks});
  await Promise.all([a.click("check",{id:"walking"}),b.click("check",{id:"revision"})]);
  assert.deepEqual(names,[KEY,KEY]);
  a.win.emit("storage",{key:KEY});
  b.win.emit("storage",{key:KEY});
  assert.equal(a.main.querySelector(".count-pill").textContent,"4 / 4");
  assert.deepEqual(current(a),current(b));
});

test("file origins that deny Web Locks can still save changes", async () => {
  const locks = {request() { return Promise.reject(Object.assign(new Error("denied"),{name:"SecurityError"})); }};
  const f = fixture({locks});
  await f.click("check",{id:"walking"});
  assert.equal(f.main.querySelector(".count-pill").textContent,"3 / 4");
  assert.equal(JSON.parse(f.storage.getItem(KEY)).habits.find(h => h.id === "walking").checks.includes(today),true);
});

test("the damaged-save notice leads to a confirmed recovery and memory saves disclose their lifetime", async () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY,"unreadable");
  const f = fixture({storage});
  assert.match(f.main.querySelector(".save-notice").textContent,/could not be read/);
  await f.click("settings");
  await f.click("reset-prompt",{kind:"sample"});
  assert.equal(storage.getItem(KEY),"unreadable");
  await f.click("reset");
  assert.equal(f.main.querySelector(".save-notice"),null);
  assert.equal(current(f).habits.length,4);
  const memory = fixture({storage:null});
  assert.match(memory.main.querySelector(".save-notice").textContent,/this session/);
  await memory.click("check",{id:"revision"});
  assert.equal(memory.main.querySelector(".count-pill").textContent,"3 / 4");
});

test("navigation supports direct links, falls back for unknown routes, and dismisses dialogs", async () => {
  const f = fixture({hash:"#unknown"});
  assert.equal(f.app.context().view,"overview");
  await f.click("new-habit");
  for (const [route,title] of [["habits","My habits"],["statistics","Statistics"],["rewards","Reward shelf"],["overview","Trail overview"]]) {
    f.navigate(route);
    assert.equal(f.dialog.open,false);
    assert.equal(f.main.querySelector("h1").textContent,title);
    assert.equal(f.doc.getElementById("sidebar").querySelector('[aria-current="page"]').attrs.href,"#" + route);
    assert.equal(f.doc.activeElement,f.main);
  }
  f.app.destroy();
  assert.equal(f.win.timers.size,0);
  assert.ok([...f.win.listeners.values()].every(set => set.size === 0));
});
