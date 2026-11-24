"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/model.js");

const today = "2024-03-04";
const reading = { id: "read", name: "Read 10 pages", icon: "book", start: "2024-02-20",
  checks: ["2024-02-21","2024-02-27","2024-02-29","2024-03-01","2024-03-04","2024-03-05"] };
const walking = { id: "walk", name: "Evening walk", icon: "boot", start: "2024-03-02", checks: ["2024-03-02","2024-03-04"] };
const state = { version: 1, sample: false, habits: [reading, walking] };
const fresh = () => M.addHabit(M.emptyState(), { id:"one", name:"Practice", icon:"pencil" }, "2024-02-28");

test("validates real, zero-padded civil dates, including Gregorian leap years", () => {
  for (const d of ["2024-02-29","2000-02-29","2026-11-23","0009-01-03"]) assert.equal(M.validDay(d), true, d);
  for (const d of ["1900-02-29","2023-02-29","2024-04-31","2024-2-02","2024-01-00","2024-13-01",
    "2024-01-01T12:00:00Z","yesterday","",null,15,{}]) assert.equal(M.validDay(d), false, String(d));
});

test("day and month arithmetic crosses leap days and New Year", () => {
  assert.equal(M.shiftDay("2024-02-28", 1), "2024-02-29");
  assert.equal(M.shiftDay("2024-03-01", -1), "2024-02-29");
  assert.equal(M.shiftDay("2024-12-31", 1), "2025-01-01");
  assert.equal(M.dayDistance("2024-02-28","2024-03-01"), 2);
  assert.equal(M.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(M.shiftMonth("2025-12", 14), "2027-02");
});

test("local today follows the device even when the UTC date differs", () => {
  const original = process.env.TZ;
  try {
    for (const [zone, date] of [["Asia/Hong_Kong","2024-03-01"],["America/Los_Angeles","2024-02-29"]]) {
      process.env.TZ = zone;
      assert.equal(M.localDay(new Date("2024-03-01T01:30:00Z")),date);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("streaks and weekdays use calendar dates across both DST transitions", () => {
  for (const dates of [["2024-03-09","2024-03-10","2024-03-11"],["2024-11-02","2024-11-03","2024-11-04"]]) {
    assert.deepEqual(M.streaks(dates, dates[2]), {current:3,best:3});
    assert.equal(M.formatDay(dates[1],{weekday:"long"}), "Sunday");
    assert.equal(M.dayDistance(dates[0], dates[2]),2);
  }
});

test("every month in four years occupies complete Monday-through-Sunday weeks", () => {
  for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
    const month = `${y}-${String(m).padStart(2,"0")}`;
    const grid = M.calendarDays(month);
    assert.ok([28,35,42].includes(grid.length), month);
    assert.equal(new Date(grid[0]+"T00:00Z").getUTCDay(),1);
    assert.equal(new Date(grid.at(-1)+"T00:00Z").getUTCDay(),0);
    assert.equal(grid.filter(d => d.startsWith(month)).length,new Date(Date.UTC(y,m,0)).getUTCDate());
    for (let i = 1; i < grid.length; i++) assert.equal(M.dayDistance(grid[i-1],grid[i]),1);
  }
  assert.equal(M.calendarDays("2021-02").length,28);
  assert.equal(M.calendarDays("2026-11").length,42);
});

test("adds daily habits with a cleaned name, chosen icon, and creation date", () => {
  const before = M.emptyState();
  const after = M.addHabit(before,{id:"study_2",name:"  溫習筆記  ",icon:"pencil"},today);
  assert.deepEqual(after.habits[0],{id:"study_2",name:"溫習筆記",icon:"pencil",start:today,checks:[]});
  assert.deepEqual(before.habits,[]);
  assert.equal(M.validateState(after),after);
});

test("validates names, IDs, dates, and icons at creation", () => {
  const habit = {id:"one",name:"Walk",icon:"boot"};
  for (const patch of [{name:" "},{name:null},{name:"a".repeat(61)},{id:""},{id:3},{id:"two words"},{icon:"unknown"}]) {
    assert.throws(() => M.addHabit(M.emptyState(),{...habit,...patch},today));
  }
  assert.throws(() => M.addHabit(fresh(),habit,today),/unique/);
  assert.throws(() => M.addHabit(M.emptyState(),habit,"2026-02-29"),/date/);
  assert.equal(M.addHabit(M.emptyState(),{...habit,name:"🌱".repeat(60)},today).habits.length,1);
});

test("editing preserves identity, dates, and history without mutating the original", () => {
  const after = M.editHabit(state,"read","  Read a chapter ","moon");
  assert.deepEqual(after.habits[0],{...reading,name:"Read a chapter",icon:"moon"});
  assert.equal(state.habits[0].name,"Read 10 pages");
  assert.throws(() => M.editHabit(state,"missing","Test","book"),/no longer/);
  assert.throws(() => M.editHabit(state,"read","  ","boot"),/name/);
  assert.throws(() => M.editHabit(state,"read","Test","invalid"),/icon/);
});

test("check-in and undo are idempotent, ordered, and scoped to the selected date", () => {
  const before = fresh();
  let next = M.setCheck(before,"one",today,true,today);
  next = M.setCheck(next,"one","2024-02-28",true,today);
  next = M.setCheck(next,"one","2024-02-29",true,today);
  assert.deepEqual(next.habits[0].checks,["2024-02-28","2024-02-29",today]);
  assert.equal(M.setCheck(next,"one",today,true,today),next);
  next = M.setCheck(next,"one","2024-02-29",false,today);
  assert.deepEqual(next.habits[0].checks,["2024-02-28",today]);
  assert.equal(M.setCheck(next,"one","2024-02-29",false,today),next);
  assert.deepEqual(before.habits[0].checks,[]);
});

test("check-ins reject future, pre-start, malformed dates, unknown habits, and non-booleans", () => {
  for (const day of ["2024-03-05","2024-02-27","2024-02-30",""]) {
    assert.throws(() => M.setCheck(fresh(),"one",day,true,today),/date/);
  }
  assert.throws(() => M.setCheck(fresh(),"missing",today,true,today),/no longer/);
  assert.throws(() => M.setCheck(fresh(),"one",today,"yes",today),/check-in/);
  assert.throws(() => M.setCheck(fresh(),"one",today,true,"wrong"),/date/);
});

test("current streak gives the user all of today to continue yesterday's run", () => {
  const days = ["2024-02-29","2024-03-01","2024-03-02"];
  assert.deepEqual(M.streaks(days,"2024-03-02"),{current:3,best:3});
  assert.deepEqual(M.streaks(days,"2024-03-03"),{current:3,best:3});
  assert.deepEqual(M.streaks(days,"2024-03-04"),{current:0,best:3});
  assert.deepEqual(M.streaks(days,"2024-02-28"),{current:0,best:0});
});

test("longest and current runs handle gaps, duplicates, unordered and future entries", () => {
  const days = ["2024-03-04","2024-02-24","2024-02-25","2024-02-26","2024-03-03","2024-03-04","2024-03-05"];
  assert.deepEqual(M.streaks(days,today),{current:2,best:3});
  assert.deepEqual(M.streaks([],today),{current:0,best:0});
});

test("journal streaks combine different habits and count multiple checks as one active day", () => {
  const result = M.earnedDays(state,today);
  assert.deepEqual(result,["2024-02-21","2024-02-27","2024-02-29","2024-03-01","2024-03-02","2024-03-04"]);
  assert.deepEqual(M.streaks(result,today),{current:1,best:3});
  assert.equal(M.dayProgress(state,today).done,2);
});

test("a calendar chest is reserved for the 7th, 14th, 21st and 28th of each month", () => {
  const days = Array.from({length:31},(_,i) => M.shiftDay("2024-03-01",i));
  assert.deepEqual(days.filter(d => M.rewardForDay(d) === "chest").map(d => Number(d.slice(8))),[7,14,21,28]);
  assert.ok(days.every(d => Object.hasOwn(M.REWARDS,M.rewardForDay(d))));
  assert.equal(M.rewardForDay("2024-02-29"),M.rewardForDay("2026-08-29"));
});

test("the last undo on a date returns its reward, while another habit keeps it earned", () => {
  const id = M.rewardForDay(today);
  const shelf = s => M.rewardShelf(s,today)[id];
  assert.ok(shelf(state).includes(today));
  const one = M.setCheck(state,"read",today,false,today);
  assert.ok(shelf(one).includes(today));
  const none = M.setCheck(one,"walk",today,false,today);
  assert.ok(!shelf(none).includes(today));
  assert.ok(shelf(M.setCheck(none,"walk",today,true,today)).includes(today));
  assert.equal(Object.values(M.rewardShelf(state,today)).flat().length,M.earnedDays(state,today).length);
});

test("deleting a habit recalculates historical statistics and shared rewards", () => {
  const next = M.removeHabit(state,"read");
  assert.deepEqual(next.habits,[walking]);
  assert.deepEqual(M.earnedDays(next,today),["2024-03-02",today]);
  assert.equal(M.stats(next,today,7).done,2);
  assert.equal(state.habits.length,2);
  assert.throws(() => M.removeHabit(next,"read"),/no longer/);
});

test("seven-day statistics include today, overlap only eligible dates, and exclude future checks", () => {
  const future = {id:"later",name:"Rest",icon:"moon",start:"2024-03-10",checks:[]};
  const data = M.stats({...state,habits:[...state.habits,future]},today,7);
  assert.deepEqual([data.done,data.due,data.rate,data.active],[6,10,60,5]);
  assert.deepEqual(data.daily.map(d => d.done),[1,0,1,1,1,0,2]);
  assert.deepEqual(data.daily.map(d => d.due),[1,1,1,1,2,2,2]);
  assert.deepEqual(data.habits.map(h => [h.done,h.due,h.rate]),[[4,7,57],[2,3,67],[0,0,0]]);
  assert.equal(data.daily.at(-1).day,today);
});

test("empty, single-day and newly started habit statistics have defined totals", () => {
  const empty = M.stats(M.emptyState(),today,90);
  assert.deepEqual([empty.done,empty.due,empty.rate,empty.active],[0,0,0,0]);
  assert.equal(empty.daily.length,90);
  for (const span of [0,-1,1.5,367,"7"]) assert.throws(() => M.stats(state,today,span),/range/);
  assert.equal(M.stats(state,today,1).rate,100);
  assert.equal(M.stats(fresh(),"2024-02-28",30).due,1);
  assert.deepEqual(M.dayProgress(fresh(),"2024-02-27"),{due:[],done:0});
});

test("summary totals agree with independent daily counts throughout a mixed two-month history", () => {
  const s = M.starterState("2025-01-15");
  for (let offset = -43; offset <= 17; offset++) {
    const date = M.shiftDay("2025-01-15",offset);
    for (const span of [7,30,90]) {
      const result = M.stats(s,date,span);
      const start = M.shiftDay(date,1-span);
      const checks = s.habits.flatMap(h => h.checks.filter(d => d >= start && d <= date));
      const due = s.habits.reduce((n,h) => n + Math.max(0,M.dayDistance(h.start > start ? h.start : start,date)+1),0);
      assert.equal(result.done,checks.length);
      assert.equal(result.active,new Set(checks).size);
      assert.equal(result.due,due);
      assert.equal(result.daily.reduce((n,d) => n+d.done,0),checks.length);
    }
  }
});

test("schema validation rejects invalid or ambiguous history and unsupported versions", () => {
  const base = structuredClone(reading);
  const only = habit => ({version:1,sample:false,habits:[habit]});
  for (const invalid of [null,{},[],{...state,version:2},{...M.emptyState(),version:4},{...state,sample:1},{...state,habits:{}},
    {...state,habits:[base,base]},only(null),only({...base,id:""}),only({...base,name:" untrimmed"}),
    only({...base,start:"2024-02-30"}),only({...base,icon:"missing"}),only({...base,checks:"2024-02-29"}),
    only({...base,checks:["2024-02-19"]}),only({...base,checks:[today,today]}),
    only({...base,checks:[today,"2024-03-01"]}),only({...base,checks:["2024-02-30"]})]) {
    assert.throws(() => M.validateState(invalid));
  }
  assert.equal(M.validateState(state),state);
});

test("starter history follows the first-open date and always explains the displayed streak", () => {
  for (const date of ["2024-02-29","2025-01-01","2026-11-23"]) {
    const sample = M.starterState(date);
    assert.equal(M.validateState(sample),sample);
    assert.equal(sample.sample,true);
    assert.equal(sample.habits.length,4);
    assert.equal(M.dayProgress(sample,date).done,2);
    assert.deepEqual(M.streaks(M.earnedDays(sample,date),date),{current:6,best:9});
    assert.ok(sample.habits.every(h => h.start === M.shiftDay(date,-34) && h.checks.every(d => d <= date)));
  }
});
