(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EmberModel = factory();
})(globalThis, function () {
  "use strict";

  const DAY = 86400000;
  const VERSION = 3;
  const MAX_TARGET = 999;
  const MAX_NOTE = 500;
  const SINGLE = Object.freeze({ amount: 1, unit: "" });
  const FIRST_DAY = "0000-01-01";
  const LAST_DAY = "9999-12-31";
  const WEEKDAYS = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  const DAILY = Object.freeze(WEEKDAYS.map((_, index) => index));
  const ICONS = ["book", "boot", "drop", "pencil", "leaf", "moon", "cup", "sun"];
  const REWARDS = {
    coin: { name: "Sun coins", tone: "gold", group: "Daily find" },
    gem: { name: "Dusk crystal", tone: "violet", group: "Daily find" },
    sprout: { name: "Trail sprout", tone: "green", group: "Daily find" },
    bottle: { name: "Dew flask", tone: "blue", group: "Daily find" },
    scroll: { name: "Pocket map", tone: "peach", group: "Daily find" },
    chest: { name: "Wayfarer chest", tone: "amber", group: "Calendar milestone" }
  };
  const rewardCycle = ["coin", "gem", "sprout", "coin", "bottle", "scroll", "gem", "bottle", "sprout", "scroll"];
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  const idPattern = /^[a-z0-9_-]{1,80}$/i;
  const dateFormats = new Map();

  function stamp(key) {
    return Date.parse(key + "T00:00:00Z");
  }

  function validDay(key) {
    if (typeof key !== "string" || !isoPattern.test(key)) return false;
    const time = stamp(key);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key;
  }

  function localDay(now = new Date()) {
    return [String(now.getFullYear()).padStart(4, "0"), String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")].join("-");
  }

  function shiftDay(key, by) {
    return new Date(stamp(key) + by * DAY).toISOString().split("T")[0];
  }

  function dayDistance(from, to) {
    return (stamp(to) - stamp(from)) / DAY;
  }

  function weekday(day) {
    return (new Date(stamp(day)).getUTCDay() + 6) % 7;
  }

  function weekStart(day) {
    return shiftDay(day, -weekday(day));
  }

  function formatDay(key, options) {
    const id = JSON.stringify(options);
    if (!dateFormats.has(id)) dateFormats.set(id, new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }));
    return dateFormats.get(id).format(stamp(key));
  }

  function shiftMonth(month, by) {
    const date = new Date(stamp(month + "-01"));
    date.setUTCMonth(date.getUTCMonth() + by);
    return date.toISOString().split("T")[0].slice(0, -3);
  }

  function calendarDays(month) {
    const first = month + "-01";
    const offset = weekday(first);
    const start = shiftDay(first, -offset);
    const size = dayDistance(first, shiftMonth(month, 1) + "-01");
    const cells = Math.ceil((offset + size) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => shiftDay(start, i));
  }

  function rewardForDay(key) {
    const day = Number(key.slice(8));
    return day % 7 === 0 ? "chest" : rewardCycle[(day - 1) % rewardCycle.length];
  }

  function emptyState() {
    return { version: VERSION, sample: false, habits: [], weeklyGoals: [], notes: {} };
  }

  function cleanName(name) {
    if (typeof name !== "string" || !name.trim() || Array.from(name.trim()).length > 60) {
      throw new Error("Use a habit name between 1 and 60 characters.");
    }
    return name.trim();
  }

  function checkIcon(icon) {
    if (!ICONS.includes(icon)) throw new Error("Choose a habit icon.");
  }

  // Plans are ordered by effective date. Editing one entry keeps later plans intact.
  function entryOn(entries, day) {
    if (entries) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].from <= day) return entries[i];
      }
    }
  }

  function putEntry(entries = [], entry) {
    return [...entries.filter(item => item.from < entry.from), entry, ...entries.filter(item => item.from > entry.from)];
  }

  function validateEntries(entries, validate) {
    if (entries === undefined) return;
    if (!Array.isArray(entries)) throw new Error("Invalid plan history.");
    let previous = "";
    for (const entry of entries) {
      if (!entry || !validDay(entry.from) || entry.from <= previous) throw new Error("Invalid plan date or order.");
      validate(entry);
      previous = entry.from;
    }
  }

  function checkWeekdays(days) {
    if (!Array.isArray(days) || !days.length) throw new Error("Choose at least one weekday.");
    for (let i = 0; i < days.length; i++) {
      if (!DAILY.includes(days[i]) || (i > 0 && days[i] <= days[i - 1])) throw new Error("Invalid weekday selection.");
    }
  }

  function checkTarget(target) {
    if (!Number.isInteger(target) || target < 0 || target > 7) throw new Error("Choose a weekly goal of 1 to 7 days, or Off.");
  }

  function weekdaysOn(habit, day) {
    return entryOn(habit.schedules, day)?.days ?? DAILY;
  }

  function targetOn(habit, day) {
    return entryOn(habit.targets, day) ?? SINGLE;
  }

  function dailyTarget(amount, unit) {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TARGET) {
      throw new Error(`Choose a daily target between 1 and ${MAX_TARGET}.`);
    }
    if (typeof unit !== "string" || Array.from(unit.trim()).length > 24 || /[\r\n]/.test(unit)) {
      throw new Error("Use a single-line unit of up to 24 characters.");
    }
    return { amount, unit: amount === 1 ? "" : unit.trim() };
  }

  function progressOn(habit, day) {
    return habit.checks.includes(day) ? targetOn(habit, day).amount : habit.partials?.[day] ?? 0;
  }

  function isDue(habit, day) {
    if (day < habit.start) return false;
    const days = weekdaysOn(habit, day);
    return days.length === 7 || days.includes(weekday(day));
  }

  function scheduleChangeDate(habit, today) {
    // A rolled-back clock must also protect unfinished counts on later dates.
    const lastCheck = habit.checks.at(-1);
    let after = lastCheck > today ? lastCheck : today;
    for (const day of Object.keys(habit.partials ?? {})) if (day > after) after = day;
    if (after < habit.start) return habit.start;
    return after === LAST_DAY ? null : shiftDay(after, 1);
  }

  function dateMap(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function cleanNote(text) {
    if (typeof text !== "string") throw new Error("Use plain text for a field note.");
    const clean = text.replace(/\r\n?/g, "\n").trim();
    if (Array.from(clean).length > MAX_NOTE) throw new Error(`Keep your field note to ${MAX_NOTE} characters.`);
    return clean;
  }

  function setNote(state, day, text, today) {
    if (!validDay(day) || !validDay(today) || day > today) throw new Error("Choose a note date through today.");
    const value = cleanNote(text);
    if ((state.notes?.[day] ?? "") === value) return state;
    const notes = { ...state.notes };
    if (value) notes[day] = value;
    else delete notes[day];
    return { ...state, notes };
  }

  function noteDates(state, today, query = "") {
    const term = query.trim().toLowerCase();
    return Object.keys(state.notes ?? {}).filter(day => day <= today &&
      (day.includes(term) || state.notes[day].toLowerCase().includes(term))).sort().reverse();
  }

  function validateProgress(habit) {
    let previous = "";
    for (const day of habit.checks) {
      if (!validDay(day) || day <= previous || !isDue(habit, day)) throw new Error("Invalid check-in history.");
      previous = day;
    }
    if (habit.partials === undefined) return;
    if (!dateMap(habit.partials)) throw new Error("Invalid partial counts.");
    const completed = new Set(habit.checks);
    for (const [day, amount] of Object.entries(habit.partials)) {
      if (!validDay(day) || !isDue(habit, day) || completed.has(day) ||
          !Number.isInteger(amount) || amount < 1 || amount >= targetOn(habit, day).amount) {
        throw new Error("Invalid partial count in habit history.");
      }
    }
  }

  function validateHabit(habit, ids) {
    if (!habit || typeof habit.id !== "string" || !idPattern.test(habit.id) || ids.has(habit.id) ||
        cleanName(habit.name) !== habit.name || !validDay(habit.start) || !Array.isArray(habit.checks)) {
      throw new Error("Invalid habit in journal.");
    }
    ids.add(habit.id);
    checkIcon(habit.icon);
    validateEntries(habit.schedules, entry => {
      if (entry.from < habit.start) throw new Error("Schedule begins before the habit.");
      checkWeekdays(entry.days);
    });
    validateEntries(habit.targets, entry => {
      if (entry.from < habit.start || dailyTarget(entry.amount, entry.unit).unit !== entry.unit) {
        throw new Error("Invalid daily target history.");
      }
    });
    validateProgress(habit);
  }

  function validateState(state) {
    if (!state || ![1, 2, VERSION].includes(state.version) || typeof state.sample !== "boolean" || !Array.isArray(state.habits) ||
        (state.version >= 2 && !Array.isArray(state.weeklyGoals)) ||
        ((state.version === VERSION || state.notes !== undefined) && !dateMap(state.notes))) {
      throw new Error("Unrecognized journal format.");
    }
    for (const [day, value] of Object.entries(state.notes ?? {})) {
      if (!validDay(day) || !value || cleanNote(value) !== value) throw new Error("Invalid field note.");
    }
    validateEntries(state.weeklyGoals, entry => {
      if (weekday(entry.from) !== 0 && entry.from !== FIRST_DAY) throw new Error("A weekly goal must start on Monday.");
      checkTarget(entry.target);
    });
    const ids = new Set();
    for (const habit of state.habits) validateHabit(habit, ids);
    return state;
  }

  function loadState(state) {
    validateState(state);
    return state.version === VERSION ? state :
      { ...state, version: VERSION, weeklyGoals: state.weeklyGoals ?? [], notes: state.notes ?? {} };
  }

  function findHabit(state, id) {
    const habit = state.habits.find(item => item.id === id);
    if (!habit) throw new Error("This habit is no longer in the journal.");
    return habit;
  }

  function addHabit(state, { id, name, icon, days = DAILY, target = 1, unit = "" }, today) {
    if (typeof id !== "string" || !idPattern.test(id) || state.habits.some(h => h.id === id)) {
      throw new Error("Choose a unique habit ID.");
    }
    if (!validDay(today)) throw new Error("Invalid start date.");
    checkIcon(icon);
    checkWeekdays(days);
    const habit = { id, name: cleanName(name), icon, start: today, checks: [] };
    if (days.length < 7) habit.schedules = [{ from: today, days: [...days] }];
    const goal = dailyTarget(target, unit);
    if (target > 1) habit.targets = [{ from: today, ...goal }];
    return { ...state, habits: [...state.habits, habit] };
  }

  function replaceHabit(state, habit) {
    return { ...state, habits: state.habits.map(h => h.id === habit.id ? habit : h) };
  }

  function editHabit(state, id, name, icon) {
    const habit = findHabit(state, id);
    const trimmed = cleanName(name);
    checkIcon(icon);
    if (trimmed === habit.name && icon === habit.icon) return state;
    return replaceHabit(state, { ...habit, name: trimmed, icon });
  }

  function planStart(habit, today) {
    if (!validDay(today)) throw new Error("Invalid schedule date.");
    const from = scheduleChangeDate(habit, today);
    if (!from) throw new Error("There are no later dates available for a new schedule.");
    return from;
  }

  function changeSchedule(state, id, days, today) {
    const habit = findHabit(state, id);
    checkWeekdays(days);
    const from = planStart(habit, today);
    if (weekdaysOn(habit, from).join() === days.join()) return state;
    return replaceHabit(state, { ...habit, schedules: putEntry(habit.schedules, { from, days: [...days] }) });
  }

  function changeTarget(state, id, amount, unit, today) {
    const habit = findHabit(state, id);
    const from = planStart(habit, today);
    const goal = dailyTarget(amount, unit);
    const previous = targetOn(habit, from);
    if (previous.amount === goal.amount && previous.unit === goal.unit) return state;
    return replaceHabit(state, { ...habit, targets: putEntry(habit.targets, { from, ...goal }) });
  }

  function removeHabit(state, id) {
    findHabit(state, id);
    return { ...state, habits: state.habits.filter(h => h.id !== id) };
  }

  function setCheck(state, id, day, checked, today) {
    if (typeof checked !== "boolean") throw new Error("Invalid check-in.");
    const target = targetOn(findHabit(state, id), day);
    return setProgress(state, id, day, checked ? target.amount : 0, today);
  }

  function setProgress(state, id, day, amount, today) {
    const habit = findHabit(state, id);
    if (!validDay(day) || !validDay(today) || day > today || day < habit.start) {
      throw new Error("Choose a date between the habit’s start and today.");
    }
    if (!isDue(habit, day)) throw new Error("This habit is not scheduled on that date.");
    const target = targetOn(habit, day).amount;
    if (!Number.isInteger(amount) || amount < 0 || amount > target) {
      throw new Error(`Enter a whole number from 0 to ${target}.`);
    }
    const previous = progressOn(habit, day);
    if (previous === amount) return state;
    const next = { ...habit };
    if (amount === target) next.checks = [...habit.checks, day].sort();
    else if (previous === target) next.checks = habit.checks.filter(d => d !== day);
    if (amount > 0 && amount < target) next.partials = { ...habit.partials, [day]: amount };
    else if (habit.partials?.[day]) {
      next.partials = { ...habit.partials };
      delete next.partials[day];
      if (!Object.keys(next.partials).length) delete next.partials;
    }
    return replaceHabit(state, next);
  }

  function earnedDays(state, today) {
    const days = new Set();
    for (const habit of state.habits) {
      for (const day of habit.checks) if (day <= today) days.add(day);
    }
    return [...days].sort();
  }

  function countRuns(sorted, today, hasGap) {
    let previous = "";
    let run = 0;
    let best = 0;
    for (const day of sorted) {
      if (day > today) break;
      run = previous && !hasGap(previous, day) ? run + 1 : 1;
      best = Math.max(run, best);
      previous = day;
    }
    const current = previous && !hasGap(previous, today) ? run : 0;
    return { current, best };
  }

  const hasCalendarGap = (previous, day) => dayDistance(previous, day) > 1;

  function streaks(days, today) {
    return countRuns([...new Set(days)].sort(), today, hasCalendarGap);
  }

  function habitStreaks(habit, today) {
    if (!habit.schedules?.length) return countRuns(habit.checks, today, hasCalendarGap);
    return countRuns(habit.checks, today, (previous, day) => {
      const distance = dayDistance(previous, day);
      for (let offset = 1; offset < distance; offset++) {
        if (isDue(habit, shiftDay(previous, offset))) return true;
      }
      return false;
    });
  }

  function dayProgress(state, day) {
    const due = state.habits.filter(habit => isDue(habit, day));
    return { due, done: due.filter(h => h.checks.includes(day)).length };
  }

  function rewardShelf(state, today) {
    const shelf = Object.fromEntries(Object.keys(REWARDS).map(id => [id, []]));
    for (const day of earnedDays(state, today)) shelf[rewardForDay(day)].push(day);
    return shelf;
  }

  function weeklyTarget(state, day) {
    return entryOn(state.weeklyGoals, day)?.target ?? 0;
  }

  function setWeeklyGoal(state, today, target) {
    checkTarget(target);
    if (!validDay(today)) throw new Error("Invalid weekly goal date.");
    // The first few supported dates belong to a week whose Monday precedes the journal's date range.
    const monday = weekStart(today);
    const from = monday < FIRST_DAY ? FIRST_DAY : monday;
    if (weeklyTarget(state, from) === target) return state;
    return { ...state, weeklyGoals: putEntry(state.weeklyGoals, { from, target }) };
  }

  function weekProgress(state, today, earned = earnedDays(state, today)) {
    const from = weekStart(today);
    const active = earned.filter(day => day >= from && day <= today);
    return { from, target: weeklyTarget(state, today), active };
  }

  function weeklyPennants(state, today) {
    const awards = [];
    if (!state.weeklyGoals?.length) return awards;
    let week, target, count;
    for (const day of earnedDays(state, today)) {
      const from = weekStart(day);
      if (week !== from) {
        week = from;
        target = weeklyTarget(state, day);
        count = 0;
      }
      count++;
      if (count === target) awards.push({ from, target, earnedOn: day });
    }
    return awards;
  }

  function stats(state, today, span) {
    if (!Number.isInteger(span) || span < 1 || span > 366) throw new Error("Choose a valid time range.");
    if (!validDay(today)) throw new Error("Choose a valid statistics date.");
    const length = Math.min(span, dayDistance(FIRST_DAY, today) + 1);
    const start = shiftDay(today, 1 - length);
    const daily = Array.from({ length }, (_, i) => ({ day: shiftDay(start, i), done: 0, due: 0 }));
    let done = 0;
    let due = 0;
    const habits = state.habits.map(habit => {
      const checks = new Set(habit.checks);
      let count = 0;
      let available = 0;
      for (const day of daily) {
        if (!isDue(habit, day.day)) continue;
        available++;
        day.due++;
        if (checks.has(day.day)) {
          day.done++;
          count++;
        }
      }
      done += count;
      due += available;
      return { habit, done: count, due: available, rate: available ? Math.round(count * 100 / available) : 0 };
    });
    return { daily, habits, done, due, rate: due ? Math.round(done * 100 / due) : 0,
      active: daily.filter(day => day.done > 0).length };
  }

  function groupWeekdays(daily) {
    const weekdays = WEEKDAYS.map(name => ({ name, done: 0, due: 0, dates: [] }));
    for (const row of daily) {
      const group = weekdays[weekday(row.day)];
      group.done += row.done;
      group.due += row.due;
      group.dates.push(row);
    }
    return weekdays;
  }

  function periodReview(state, today, span) {
    const current = stats(state, today, span);
    const first = current.daily[0].day;
    const previous = dayDistance(FIRST_DAY, first) >= span ? stats(state, shiftDay(first, -1), span) : null;
    return { current, previous, weekdays: groupWeekdays(current.daily) };
  }

  function starterState(today) {
    const samples = [
      ["reading", "Read 10 pages", "book"],
      ["walking", "Walk the HKBU loop", "boot"],
      ["water", "Drink two bottles of water", "drop", { amount: 2, unit: "bottles" }],
      ["revision", "Review lecture notes", "pencil"]
    ];
    const history = Math.min(34, dayDistance(FIRST_DAY, today));
    const start = shiftDay(today, -history);
    const habits = samples.map(([id, name, icon, target], index) => {
      const checks = [];
      for (let age = history; age >= 0; age--) {
        if ([6, 12, 22, 25, 31].includes(age)) continue;
        const checked = age === 0 ? index === 0 || index === 2 :
          index === age % 4 || (age * 7 + index * 11) % 13 < 6;
        if (checked) checks.push(shiftDay(today, -age));
      }
      const habit = { id, name, icon, start, checks };
      if (target) {
        habit.targets = [{ from: start, ...target }];
        const partialDay = shiftDay(today, -4);
        if (history >= 4 && !checks.includes(partialDay)) habit.partials = { [partialDay]: 1 };
      }
      return habit;
    });
    const state = setWeeklyGoal({ ...emptyState(), sample: true, habits }, start, 3);
    return setNote(state, shiftDay(today, -Math.min(2, history)),
      "Took the long way to the HKBU library after class. The extra walk helped me settle in to read.", today);
  }

  return { ICONS, REWARDS, WEEKDAYS, DAILY, MAX_TARGET, MAX_NOTE, FIRST_DAY, LAST_DAY, validDay, localDay, shiftDay, dayDistance, weekStart, formatDay, shiftMonth, calendarDays,
    rewardForDay, emptyState, starterState, validateState, loadState, findHabit, addHabit, editHabit, removeHabit,
    setCheck, earnedDays, streaks, habitStreaks, dayProgress, rewardShelf, stats, weekdaysOn, isDue, scheduleChangeDate,
    changeSchedule, changeTarget, targetOn, progressOn, setProgress, weeklyTarget, setWeeklyGoal, weekProgress,
    weeklyPennants, setNote, noteDates, groupWeekdays, periodReview };
});
