(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"), require("./art.js"));
  else root.EmberViews = factory(root.EmberModel, root.EmberArt);
})(globalThis, function (M, art) {
  "use strict";
  const { icon, pixel } = art;
  const routes = { overview: "Overview", habits: "My habits", statistics: "Statistics", rewards: "Reward shelf" };
  const iconNames = { book: "Book", boot: "Walking boot", drop: "Water", pencil: "Pencil", leaf: "Leaf",
    moon: "Moon", cup: "Cup", sun: "Sun" };
  const fullDate = day => M.formatDay(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const shortDate = day => M.formatDay(day, { month: "short", day: "numeric" });
  const dated = day => M.formatDay(day, { month: "short", day: "numeric", year: "numeric" });
  const monthName = month => M.formatDay(month + "-01", { month: "long", year: "numeric" });
  const daysText = n => n + (n === 1 ? " day" : " days");
  const checksText = n => n + (n === 1 ? " check-in" : " check-ins");
  const entities = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
  const esc = value => String(value).replace(/[&<>"']/g, char => entities.get(char));
  const targetLabel = goal => goal.amount + (goal.unit ? " " + goal.unit : "");

  function scheduleLabel(days) {
    if (days.length === 7) return "Daily";
    if (days.join() === "0,1,2,3,4") return "Weekdays";
    if (days.join() === "5,6") return "Weekends";
    return days.map(index => M.WEEKDAYS[index].slice(0, 3)).join(", ");
  }

  function sidebar(view, state, mode) {
    const links = Object.entries(routes).map(([id, label]) => `<a class="nav-link${id === view ? " active" : ""}" href="#${id}" aria-label="${label}"${id === view ? ' aria-current="page"' : ""}>${icon(id)}<span>${label}</span></a>`).join("");
    const status = { local: "Saved on this device", memory: "Session only", damaged: "Save needs attention" }[mode];
    return `<a class="brand" href="#overview" aria-label="Embertrail overview">${pixel("flame", "brand-flame")}<span class="brand-words"><strong>Embertrail</strong><small>Habit journal</small></span></a>
      <nav class="primary-nav" aria-label="Main navigation">${links}</nav>
      <div class="sidebar-camp" aria-hidden="true"></div>
      <button type="button" class="profile" data-action="settings" data-key="settings" aria-label="Journal settings">
        <span class="profile-art">${pixel("pack")}</span><span class="profile-info"><strong>${state.sample ? "Starter journal" : "My journal"}</strong><small><i class="status-dot ${mode}"></i>${status}</small></span>${icon("settings", "profile-gear")}</button>`;
  }

  function newHabitButton() {
    return `<button type="button" class="button primary" data-action="new-habit" data-key="new-habit">${icon("plus")}New habit</button>`;
  }

  function pageHeader(title, today, action = "") {
    return `<header class="page-header"><div><div class="date-line">${icon("calendar")}<time datetime="${today}">${fullDate(today)}</time></div><h1>${title}</h1></div>${action}</header>`;
  }

  function saveNotice(mode) {
    if (mode === "local") return "";
    const message = mode === "damaged" ? "This device’s saved journal could not be read." : "Device storage is unavailable. Changes will last for this session.";
    return `<div class="save-notice" role="status">${message} <button class="text-button" data-action="settings">Journal settings</button></div>`;
  }

  function hero(state, today, earned) {
    const { current, best } = M.streaks(earned, today);
    let message = "Complete a habit to light your first spark.";
    if (earned.includes(today)) message = "You’ve kept the fire going today.";
    else if (state.habits.length && !state.habits.some(h => M.isDue(h, today))) message = "No habits are scheduled for today.";
    else if (current) message = "Check in today to keep your streak going.";
    else if (best) message = "Check in today to start a new streak.";
    return `<section class="hero" aria-label="Daily streak"><div class="hero-copy">
      <div class="hero-label">${icon("fire")}Current streak</div>
      <h2><span class="sr-only">${current} day streak</span>${art.streakTitle(current)}</h2><p>${message}</p>
      <div class="best-streak">${pixel("trophy")}<span>Personal best</span><strong>${daysText(best)}</strong></div>
      </div></section>`;
  }

  function calendar(state, earned, today, month) {
    let hasRestDays = false;
    let hasNotes = false;
    const cells = M.calendarDays(month).map(day => {
      const number = Number(day.slice(-2));
      if (!day.startsWith(month + "-")) return `<span class="day outside" aria-hidden="true">${number}</span>`;
      const reward = M.rewardForDay(day);
      const isToday = day === today;
      const checked = earned.has(day);
      const noted = day <= today && Boolean(state.notes?.[day]);
      if (noted) hasNotes = true;
      const rest = !checked && state.habits.some(h => h.start <= day) && !state.habits.some(h => M.isDue(h, day));
      if (rest) hasRestDays = true;
      const status = checked ? "collected" : day > today ? "upcoming" : "uncollected";
      const label = esc(`${fullDate(day)}, ${M.REWARDS[reward].name}, ${status}${rest ? ", rest day" : ""}${noted ? ", field note" : ""}`);
      return `<button type="button" class="day tile ${checked ? "earned" : "unearned"}${rest ? " rest-day" : ""}${isToday ? " today" : ""}${reward === "chest" ? " milestone" : ""}" data-action="day" data-day="${day}" data-key="day-${day}" aria-label="${label}" title="${label}"${isToday ? ' aria-current="date"' : ""}>
        <span class="day-number">${number}</span>${checked ? `<span class="day-check">${icon("check")}</span>` : ""}
        ${noted ? '<span class="note-mark">' + icon("pencil") + '</span>' : ""}${pixel(reward, "day-art")}</button>`;
    }).join("");
    return `<section class="panel calendar-card" aria-labelledby="calendar-title"><div class="title-row calendar-heading"><div>
      <h2 id="calendar-title">Reward calendar</h2><p class="panel-sub">Unlock a reward with your first check-in each day.</p></div>
      <button type="button" class="goal-edit notes-link" data-action="notes" data-key="field-notes" aria-haspopup="dialog">${icon("book")}Field notes</button>
      </div><div class="month-row"><div class="month-name">${icon("calendar")}<h3>${monthName(month)}</h3></div>
      <div class="month-controls">${month !== today.slice(0, 7) ? '<button class="today-jump" data-action="current-month">Today</button>' : ""}
      <button class="icon-button" data-action="month" data-offset="-1" data-key="prev-month" aria-label="Previous month"${month === M.FIRST_DAY.slice(0, 7) ? " disabled" : ""}>${icon("left")}</button>
      <button class="icon-button" data-action="month" data-offset="1" data-key="next-month" aria-label="Next month"${month === M.LAST_DAY.slice(0, 7) ? " disabled" : ""}>${icon("right")}</button></div></div>
      <div class="weekdays" aria-hidden="true">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="calendar-grid" role="group" aria-label="${monthName(month)} rewards">${cells}</div>
      <div class="calendar-legend"><span><i class="legend-check">${icon("check")}</i>Checked in</span>
      <span><i class="legend-today"></i>Today</span><span>${pixel("chest")}Milestone</span>${hasRestDays ? '<span><i class="legend-rest" aria-hidden="true">–</i>Rest day</span>' : ""}${hasNotes ? '<span class="note-legend">' + icon("pencil") + 'Field note</span>' : ""}</div></section>`;
  }

  function habitIcon(habit) {
    return `<span class="habit-icon tone-${habit.icon}">${icon(habit.icon)}</span>`;
  }

  function checkAttributes(habit, day, relative, counted, done) {
    const action = counted ? 'data-action="progress" aria-haspopup="dialog"' :
      `data-action="check" data-value="${!done}" aria-pressed="${done}"`;
    return `${action} data-id="${habit.id}" data-day="${day}"${relative ? ' data-relative="today"' : ""}`;
  }

  function habitRow(habit, day, today, dailyList = false) {
    const done = habit.checks.includes(day);
    const goal = M.targetOn(habit, day);
    const counted = goal.amount > 1;
    const count = counted ? `${M.progressOn(habit, day)} / ${esc(targetLabel(goal))}` : "";
    const run = M.habitStreaks(habit, day).current;
    const name = esc(habit.name);
    return `<button type="button" class="habit-row${done ? " is-done" : ""}" ${checkAttributes(habit, day, dailyList, counted, done)} data-key="check-${habit.id}-${day}" aria-label="${name}, ${fullDate(day)}${counted ? ", log progress, " + count : ""}"${day > today ? " disabled" : ""}>
      ${habitIcon(habit)}<span class="habit-copy"><strong>${name}</strong><small>${icon("fire")}${run} day streak</small></span>
      ${counted ? `<span class="count-control">${count}${icon("edit")}</span>` : `<span class="check-box">${done ? icon("check") : ""}</span>`}</button>`;
  }

  function todayHabits(state, today) {
    const { due, done } = M.dayProgress(state, today);
    const pct = due.length ? done * 100 / due.length : 0;
    const empty = state.habits.length ? "No habits scheduled today." : "Add a habit to start checking in.";
    return `<section class="panel today-card" aria-labelledby="today-habits"><div class="title-row"><h2 id="today-habits">Today’s habits</h2><span class="count-pill">${done} / ${due.length}</span></div>
      <div class="progress-track" role="progressbar" aria-label="Today’s habit completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
      <div class="habit-list">${due.length ? due.slice(0, 4).map(h => habitRow(h, today, today, true)).join("") : `<p class="empty-inline">${empty}</p>`}</div>
      <a class="card-link" href="#habits">${due.length > 4 ? `View all ${due.length} habits` : "Manage habits"}${icon("arrow")}</a></section>`;
  }

  function bucketDays(daily, size) {
    if (!Number.isInteger(size) || size < 1) throw new Error("Choose a positive chart interval.");
    const buckets = [];
    for (let i = 0; i < daily.length; i += size) {
      const group = daily.slice(i, i + size);
      buckets.push({ first: group[0].day, last: group.at(-1).day, done: group.reduce((n, d) => n + d.done, 0) });
    }
    return buckets;
  }

  function chart(daily, compact = false) {
    const size = Math.ceil(daily.length / 12);
    const buckets = bucketDays(daily, size);
    const max = Math.max(1, ...buckets.map(b => b.done));
    const details = [];
    const bars = buckets.map((bucket, index) => {
      const long = bucket.first === bucket.last ? shortDate(bucket.first) : shortDate(bucket.first) + " – " + shortDate(bucket.last);
      const label = size === 1 ? M.formatDay(bucket.first, { weekday: compact ? "narrow" : "short" }) : shortDate(bucket.first);
      const tip = long + ", " + checksText(bucket.done);
      details.push(tip);
      return `<div class="chart-column${index === buckets.length - 1 ? " latest" : ""}" title="${esc(tip)}"><div class="bar-space">
        <i class="bar${bucket.done ? "" : " zero"}" style="--bar-height:${bucket.done * 100 / max}%">${compact ? "" : `<span class="bar-value">${bucket.done}</span>`}</i></div>
        <span class="bar-label">${label}</span></div>`;
    }).join("");
    return `<div class="bar-chart${compact ? " compact" : ""}" role="img" aria-label="${esc(details.join(". "))}">${bars}</div>`;
  }

  function weekCard(state, today) {
    const week = M.stats(state, today, 7);
    return `<section class="panel week-card"><div class="title-row"><h2>Last 7 days</h2><a class="quiet-arrow" href="#statistics" aria-label="View statistics">${icon("arrow")}</a></div>
      <div class="week-summary"><strong>${week.done}</strong><span>habit check-ins</span></div>${chart(week.daily, true)}</section>`;
  }

  function weeklyGoalCard(state, today, earned) {
    const { from, active, target } = M.weekProgress(state, today, earned);
    const end = M.shiftDay(from, 6);
    const days = M.WEEKDAYS.map((name, i) => {
      const day = M.shiftDay(from, i);
      const complete = active.includes(day);
      const status = complete ? "checked in" : M.dayDistance(today, day) > 0 ? "upcoming" : day === today ? "open" : "no check-in";
      return `<li class="week-stamp${complete ? " stamped" : ""}"${day === today ? ' aria-current="date"' : ""} title="${fullDate(day)}, ${status}">
        <span aria-hidden="true">${name.slice(0, 1)}</span><i aria-hidden="true">${complete ? icon("check") : "·"}</i>
        <span class="sr-only">${fullDate(day)}, ${status}</span></li>`;
    }).join("");
    const remaining = target - active.length;
    let caption = "Choose how many days to check in each week.";
    if (target) caption = remaining > 0 ? `${daysText(remaining)} to earn the pennant.` : "Switchback pennant earned.";
    return `<section class="panel goal-card" aria-labelledby="weekly-goal-title">
      <div class="title-row"><div><h2 id="weekly-goal-title">Weekly goal</h2><p class="panel-sub">${shortDate(from)} – ${shortDate(end)}</p></div>
      <button class="goal-edit" data-action="goal" data-key="weekly-goal" aria-label="${target ? "Edit" : "Set"} weekly goal">${target ? "Edit goal" : "Set goal"}</button></div>
      <ol class="week-stamps" aria-label="Active days this week">${days}</ol>
      <div class="goal-result">${pixel("pennant")}<div>${target ? `<strong>${active.length} / ${target} active days</strong>` : ""}
      <p>${caption}</p></div></div></section>`;
  }

  function overview(ctx) {
    const { state, today, month } = ctx;
    const earned = M.earnedDays(state, today);
    return pageHeader("Trail overview", today, newHabitButton()) + hero(state, today, earned) +
      `<div class="dashboard-grid">${calendar(state, new Set(earned), today, month)}<div class="side-stack">${todayHabits(state, today)}${weeklyGoalCard(state, today, earned)}${weekCard(state, today)}</div></div>`;
  }

  function habitWeek(habit, today) {
    return Array.from({ length: 7 }, (_, i) => {
      const day = M.shiftDay(today, i - 6);
      const complete = habit.checks.includes(day);
      const due = M.isDue(habit, day);
      const partial = habit.partials?.[day];
      const status = day < habit.start ? "before start" : !due ? "rest day" : complete ? "checked in" :
        partial ? `${partial} of ${esc(targetLabel(M.targetOn(habit, day)))}` : "open";
      return `<span class="mini-day${complete ? " done" : ""}${due ? "" : " off-day"}" title="${fullDate(day)}, ${status}"><small aria-hidden="true">${M.formatDay(day, {weekday:"narrow"})}</small><i aria-hidden="true">${complete ? icon("check") : partial || (due ? "·" : "–")}</i><span class="sr-only">${fullDate(day)}, ${status}</span></span>`;
    }).join("");
  }

  function habitCard(habit, today) {
    const checked = habit.checks.includes(today);
    const due = M.isDue(habit, today);
    const streak = M.habitStreaks(habit, today);
    const pending = habit.schedules?.find(entry => entry.from > today && entry.from > habit.start);
    const nextGoal = habit.targets?.find(entry => entry.from > today && entry.from > habit.start);
    const planDay = today < habit.start ? habit.start : today;
    const goal = M.targetOn(habit, planDay);
    const counted = goal.amount > 1;
    let label = checked ? "Checked in today" : "Check in today";
    if (!due) label = habit.start > today ? "Starts " + shortDate(habit.start) : "Rest day";
    else if (counted) label = `Log progress · ${M.progressOn(habit, today)} / ${esc(targetLabel(goal))}`;
    return `<article class="panel manage-card"><div class="manage-head">${habitIcon(habit)}<button class="icon-button" data-action="edit" data-id="${habit.id}" data-key="edit-${habit.id}" aria-label="Edit ${esc(habit.name)}">${icon("edit")}</button></div>
        <h2>${esc(habit.name)}</h2><p class="panel-sub">${scheduleLabel(M.weekdaysOn(habit, planDay))}${counted ? " · " + esc(targetLabel(goal)) : ""} · Started ${dated(habit.start)}</p>
        ${pending ? `<p class="schedule-change">From ${shortDate(pending.from)} · ${scheduleLabel(pending.days)}</p>` : ""}
        ${nextGoal ? `<p class="schedule-change">From ${shortDate(nextGoal.from)} · ${nextGoal.amount === 1 ? "Single check-in" : "Target " + esc(targetLabel(nextGoal))}</p>` : ""}
        <div class="manage-streak">${icon("fire")}<strong>${daysText(streak.current)}</strong> current streak</div>
        <div class="mini-week" role="group" aria-label="Last seven days">${habitWeek(habit, today)}</div>
        <button class="button habit-toggle${checked ? " complete" : ""}" ${checkAttributes(habit, today, true, counted, checked)} data-key="manage-${habit.id}"${due ? "" : " disabled"}>${icon(due ? (checked ? "check" : "plus") : "clock")}${label}</button></article>`;
  }

  function habitsPage({ state, today }) {
    const cards = state.habits.map(habit => habitCard(habit, today)).join("");
    return pageHeader("My habits", today, newHabitButton()) + (cards ? `<div class="manage-grid">${cards}</div>` :
      `<section class="panel empty-state">${pixel("sprout")}<h2>Plant your first habit</h2><p>Choose something small you can check off each day.</p><button class="button primary" data-action="new-habit">${icon("plus")}Create a habit</button></section>`);
  }

  function difference(current, previous, unit) {
    if (current === null || previous == null) return "";
    const delta = current - previous;
    if (delta === 0) return "No change";
    return (delta > 0 ? "+" : "−") + Math.abs(delta) + " " + unit + (Math.abs(delta) === 1 ? "" : "s");
  }

  function metric(symbol, label, value, tone, change) {
    return `<div class="panel metric"><span class="metric-icon ${tone}">${icon(symbol)}</span><div><span>${label}</span><strong>${value}</strong>${change ? `<small class="metric-change">${change}</small>` : ""}</div></div>`;
  }

  function weekdayPanel(weekdays) {
    const buttons = weekdays.map(({ name, done, due, dates }, index) => {
      const rate = due ? Math.round(done * 100 / due) : 0;
      const label = due ? `${done} of ${due} check-ins, ${rate}%` : "no eligible habits";
      return `<button type="button" class="weekday-result" data-action="weekday" data-index="${index}" data-key="weekday-${index}"
        aria-label="Review ${name}, ${label}" aria-haspopup="dialog"${dates.length ? "" : " disabled"}>
        <span>${name.slice(0, 3)}</span><strong>${due ? rate + "%" : "—"}</strong>
        <span class="weekday-track" aria-hidden="true"><i style="width:${rate}%"></i></span><small>${done} / ${due}</small></button>`;
    }).join("");
    return `<section class="panel weekday-card" aria-labelledby="weekday-title"><h2 id="weekday-title">Weekday review</h2>
      <p class="panel-sub">Choose a weekday to review its scheduled check-ins.</p><div class="weekday-results">${buttons}</div></section>`;
  }

  function statisticsPage({ state, today, span }) {
    const { current: data, previous, weekdays } = M.periodReview(state, today, span);
    const comparison = previous ? `Compared with ${dated(previous.daily[0].day)} – ${dated(previous.daily.at(-1).day)}` : "No earlier full period";
    const rateChange = previous && data.due && !previous.due ? "No prior rate" :
      difference(data.due ? data.rate : null, previous?.rate, "percentage point");
    const period = `<div class="period-switch" role="group" aria-label="Statistics period">${[7,30,90].map(n =>
      `<button data-action="period" data-span="${n}" data-key="period-${n}" aria-pressed="${n === span}">${n} days</button>`).join("")}</div>`;
    const perHabit = data.habits.map(({habit, done, due, rate}) => `<div class="breakdown-row">${habitIcon(habit)}
      <div class="breakdown-main"><div><strong>${esc(habit.name)}</strong><span>${done} / ${due}</span></div>
      <div class="progress-track"><i style="width:${rate}%"></i></div></div><strong class="rate">${due ? rate + "%" : "—"}</strong></div>`).join("");
    return pageHeader("Statistics", today, period) + `<div class="metric-grid">${metric("check", "Habit check-ins", data.done, "sage", difference(data.done, previous?.done, "check-in"))}${metric("target", "Completion rate", data.due ? data.rate + "%" : "—", "peach", rateChange)}${metric("fire", "Active days", data.active + " / " + data.daily.length, "lilac", difference(data.active, previous?.active, "active day"))}</div>
      <p class="comparison-caption">${comparison}</p>
      <section class="panel activity-card"><div class="title-row"><div><h2>Check-in activity</h2><p class="panel-sub">${shortDate(data.daily[0].day)} – ${shortDate(today)} · ${data.daily.length > 12 ? "Grouped in intervals of " + daysText(Math.ceil(data.daily.length/12)) : "Daily check-ins"}</p></div>${pixel("coin", "heading-prize")}</div>${chart(data.daily)}</section>
      ${weekdayPanel(weekdays)}
      <section class="panel breakdown-card"><h2>Habit breakdown</h2><p class="panel-sub">Completed check-ins out of eligible days in this period.</p>${perHabit || '<p class="empty-inline">Your habits will appear here after you add one.</p>'}</section>`;
  }

  function weekdayDialog(index, { state, today, span }) {
    const { name, dates } = M.groupWeekdays(M.stats(state, today, span).daily)[index];
    return dialogHeader(name + " check-ins") + `<div class="review-dates">${dates.slice().reverse().map(({ day, done, due }) =>
      `<button class="review-date" data-action="day" data-day="${day}" data-key="review-${day}"><time datetime="${day}">${dated(day)}</time>
      <span>${due ? done + " / " + due + " complete" : "No habits due"}${icon("right")}</span></button>`).join("")}</div>`;
  }

  function rewardsPage({state, today}) {
    const shelf = M.rewardShelf(state, today);
    const pennants = M.weeklyPennants(state, today).length;
    const cards = Object.entries(M.REWARDS).map(([id, reward]) => `<button class="panel reward-card ${reward.tone}" data-action="reward" data-reward="${id}" data-key="reward-${id}" aria-label="${reward.name}, ${shelf[id].length} collected">
      <span class="reward-count">× ${shelf[id].length}</span><span class="reward-display">${pixel(id)}</span>
      <span class="reward-meta">${reward.group}</span><strong>${reward.name}</strong></button>`).join("");
    return pageHeader("Reward shelf", today) + `<p class="page-intro">Each checked-in date adds one find to your shelf. A chest awaits on the 7th, 14th, 21st, and 28th of every month.</p><div class="reward-grid">${cards}</div>
      <button class="panel pennant-shelf" data-action="pennants" data-key="pennants">${pixel("pennant")}
      <span><strong>Switchback pennant</strong><small>Weekly goals met · ${pennants}</small></span>${icon("right")}</button>`;
  }

  function main(ctx) {
    const pages = { overview, habits: habitsPage, statistics: statisticsPage, rewards: rewardsPage };
    return saveNotice(ctx.mode) + pages[ctx.view](ctx);
  }

  function dialogHeader(title) {
    return `<div class="dialog-heading"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-button" data-action="close" aria-label="Close dialog">${icon("close")}</button></div>`;
  }

  function formActions(label, extra = "", cancel = "close") {
    return `<p id="form-error" class="form-error" role="alert"></p><div class="dialog-actions">${extra}
      <div class="action-pair"><button type="button" class="button secondary" data-action="${cancel}">Cancel</button><button type="submit" class="button primary">${label}</button></div></div>`;
  }

  function scheduleHint(from) {
    return from ? `Weekday and target changes start ${dated(from)}. Earlier dates keep their plan.` :
      "Recorded progress reaches the end of the supported date range.";
  }

  function habitForm(modal, habit, today) {
    const editing = Boolean(habit);
    const from = editing ? M.scheduleChangeDate(habit, today) : today;
    const goal = habit ? M.targetOn(habit, from || M.LAST_DAY) : { amount: 1, unit: "" };
    const values = modal.draft || { name: habit?.name || "", icon: habit?.icon || "book",
      days: editing ? M.weekdaysOn(habit, from || M.LAST_DAY) : M.DAILY, target: goal.amount, unit: goal.unit };
    const choices = M.ICONS.map(id => `<label class="icon-choice tone-${id}" title="${iconNames[id]}"><input type="radio" name="habitIcon" value="${id}"${id === values.icon ? " checked" : ""}><span>${icon(id)}</span><span class="sr-only">${iconNames[id]}</span></label>`).join("");
    const weekdays = M.WEEKDAYS.map((day, index) => `<label class="plan-choice"><input type="checkbox" name="weekday" value="${index}"${values.days.includes(index) ? " checked" : ""}><span aria-hidden="true">${day.slice(0, 3)}</span><span class="sr-only">${day}</span></label>`).join("");
    const remove = editing ? `<button type="button" class="text-button danger-text" data-action="remove-prompt" data-id="${habit.id}">Delete habit</button>` : "";
    return dialogHeader(editing ? "Edit habit" : "New habit") + `<form id="habit-form"${editing ? ` data-id="${habit.id}"` : ""}>
      <label class="field-label" for="habit-name">Habit name</label><input class="text-input" id="habit-name" name="habitName" type="text" placeholder="e.g. Review notes on the MTR" value="${esc(values.name)}" required autofocus autocomplete="off" aria-describedby="form-error">
      <fieldset><legend>Icon</legend><div class="icon-choices">${choices}</div></fieldset>
      <fieldset id="target-fields" aria-describedby="target-hint"${from ? "" : " disabled"}><legend>Daily target</legend>
        <div class="target-inputs"><label>Quantity<input class="text-input" name="dailyTarget" id="daily-target" type="number" inputmode="numeric" min="1" max="${M.MAX_TARGET}" step="1" value="${esc(values.target)}" required></label>
        <label>Unit (optional)<input class="text-input" name="unit" id="habit-unit" type="text" placeholder="e.g. pages" value="${esc(values.unit)}"${Number(values.target) > 1 ? "" : " disabled"}></label></div>
      </fieldset><p id="target-hint" class="form-hint">Use 1 for a single check-in. A larger target lets you log a little at a time.</p>
      <fieldset id="repeat-days" aria-describedby="schedule-hint"${from ? "" : " disabled"}><legend>Repeat on</legend><div class="plan-choices">${weekdays}</div></fieldset>
      <p id="schedule-hint" class="form-hint">${editing ? scheduleHint(from) : "Choose the days you’ll do this habit. Rest days keep your habit streak going."}</p>
      ${formActions(editing ? "Save changes" : "Create habit", remove)}</form>`;
  }

  function dayDialog(state, modal, today) {
    const { day, parent } = modal;
    const reward = M.rewardForDay(day);
    const data = M.dayProgress(state, day);
    const future = day > today;
    const status = future ? "Upcoming reward" : data.done ? "Reward collected" : data.due.length ? "Available reward" : "Uncollected reward";
    const started = state.habits.some(habit => habit.start <= day);
    const message = future ? "Upcoming finds unlock with a check-in on their date." : data.done ?
      `${checksText(data.done)} on this date.` : data.due.length ? "Complete one habit on this date to collect it." :
      day === today && !state.habits.length ? "Add your first habit to collect today’s find." : "There were no eligible habits on this date.";
    const rows = data.due.map(habit => {
      if (!future) return habitRow(habit, day, today);
      const target = M.targetOn(habit, day);
      return `<div class="upcoming-habit">${habitIcon(habit)}<strong>${esc(habit.name)}</strong>${target.amount > 1 ? `<small>${esc(targetLabel(target))}</small>` : ""}</div>`;
    }).join("");
    const empty = started ? "Rest day. No habits scheduled." : future ? "No habits scheduled for this date." : "No habits had started on this date.";
    return dialogHeader(M.formatDay(day,{weekday:"long",month:"short",day:"numeric",year:"numeric"})) +
      `<div class="day-prize ${M.REWARDS[reward].tone}">${pixel(reward)}<div><small>${status}</small><h3>${M.REWARDS[reward].name}</h3><p>${message}</p></div></div>` +
      `<h3 class="dialog-section-title">Scheduled habits <span>${future ? data.due.length : data.done + " / " + data.due.length}</span></h3>
      <div class="dialog-habits">${rows || `<p class="empty-inline">${empty}</p>`}</div>` +
      (future ? "" : dayNote(state.notes?.[day], day)) +
      (parent ? `<button class="text-button back-link" data-action="back">${icon("left")}Back to ${parent.type === "notes" ? "field notes" : "weekday review"}</button>` : "");
  }

  function progressDialog(modal, { state }) {
    const habit = M.findHabit(state, modal.id);
    const goal = M.targetOn(habit, modal.day);
    return dialogHeader("Log progress") + `<form id="progress-form">
      <div class="log-heading">${habitIcon(habit)}<div><h3>${esc(habit.name)}</h3><p>${fullDate(modal.day)}</p></div></div>
      <label class="field-label" for="progress-amount">Amount completed${goal.unit ? " (" + esc(goal.unit) + ")" : ""}</label>
      <div class="count-stepper"><button class="button secondary" type="button" data-action="adjust-count" data-by="-1" aria-label="Subtract one">−</button>
      <input class="text-input" name="amount" id="progress-amount" type="number" inputmode="numeric" min="0" max="${goal.amount}" step="1" value="${modal.original}" required autofocus aria-describedby="progress-hint form-error">
      <button class="button secondary" type="button" data-action="adjust-count" data-by="1" aria-label="Add one">+</button></div>
      <progress id="count-meter" max="${goal.amount}" value="${modal.original}" aria-label="Daily target progress"></progress>
      <p id="progress-hint" class="form-hint">Reach ${esc(targetLabel(goal))} to earn this check-in.</p>
      ${formActions("Save progress", '<button type="button" class="text-button" data-action="fill-count">Fill target</button>', "back")}</form>`;
  }

  function dayNote(note, day) {
    return `<section class="day-note"><div class="title-row"><h3>${icon("pencil")}Field note</h3>
      <button class="goal-edit" data-action="note" data-day="${day}" data-key="edit-note">${note ? "Edit note" : "Add note"}</button></div>
      ${note ? `<p class="note-text">${esc(note)}</p>` : ""}</section>`;
  }

  function noteEditor({ day, original }) {
    return dialogHeader(original ? "Edit field note" : "Add field note") + `<form id="note-form">
      <label for="note-text" class="field-label">${fullDate(day)}</label>
      <textarea class="text-input" id="note-text" name="noteText" rows="5" autofocus aria-describedby="note-hint form-error">${esc(original)}</textarea>
      <p id="note-hint" class="form-hint">Up to ${M.MAX_NOTE} characters.${original ? " Save an empty note to remove it." : ""}</p>
      ${formActions("Save note", "", "back")}</form>`;
  }

  const NOTE_PAGE = 20;

  function noteResults(state, today, query, limit) {
    const days = M.noteDates(state, today, query);
    if (!days.length) return `<p class="empty-inline" role="status">${query.trim() ? "No matching field notes." : "Your dated notes will appear here."}</p>`;
    const rows = days.slice(0, limit).map(day => `<button type="button" class="note-entry" data-action="day" data-day="${day}" data-key="note-${day}">
      <time datetime="${day}">${dated(day)}</time><span>${esc(state.notes[day])}</span>${icon("right")}</button>`).join("");
    return `<p class="notes-count" role="status">${days.length} ${days.length === 1 ? "note" : "notes"}</p>${rows}` +
      (days.length > limit ? `<button type="button" class="button secondary more-notes" data-action="more-notes" data-key="more-notes">Show ${Math.min(NOTE_PAGE, days.length - limit)} more</button>` : "");
  }

  function notesDialog(modal, { state, today }) {
    return dialogHeader("Field notes") + `<div class="notes-tools"><label for="notes-query" class="field-label">Search notes</label>
      <input id="notes-query" class="text-input" data-key="notes-query" type="search" value="${esc(modal.query)}" placeholder="Text or YYYY-MM-DD" autofocus>
      <button class="goal-edit" data-action="note-today" data-key="note-today">${icon("pencil")}Today’s note</button></div>
      <div id="note-results" class="note-results">${noteResults(state, today, modal.query, modal.limit)}</div>`;
  }

  function rewardDialog(state, id, today) {
    const reward = M.REWARDS[id];
    const days = M.rewardShelf(state, today)[id].reverse();
    return dialogHeader(reward.name) + `<div class="day-prize ${reward.tone}">${pixel(id)}<div><small>${reward.group}</small><h3>${days.length} collected</h3></div></div>` +
      (days.length ? `<h3 class="dialog-section-title">Collected on</h3><div class="collection-dates">${days.map(d =>
        `<button type="button" class="date-chip" data-action="day" data-day="${d}">${M.formatDay(d,{day:"numeric",month:"short",year:"numeric"})}</button>`).join("")}</div>` :
        '<p class="dialog-note">Choose a matching date on the reward calendar and complete a habit to collect this find.</p>');
  }

  function goalDialog(target) {
    const choices = [0, 1, 2, 3, 4, 5, 6, 7].map(n => `<label class="plan-choice">
      <input type="radio" name="weeklyTarget" value="${n}"${target === n ? " checked autofocus" : ""}>
      <span>${n || "Off"}${n ? '<span class="sr-only"> active days</span>' : ""}</span></label>`).join("");
    return dialogHeader("Weekly goal") + `<form id="goal-form">
      <div class="day-prize pennant-prize">${pixel("pennant")}<div><h3>Switchback pennant</h3><p>Earn one each week by checking in on enough different days.</p></div></div>
      <fieldset><legend>Active days per week</legend><div class="plan-choices target-choices">${choices}</div></fieldset>
      <p class="form-hint">Weeks run Monday to Sunday. This target applies to the week you save it and carries forward. Earlier weeks keep their targets.</p>
      ${formActions("Save goal")}</form>`;
  }

  function pennantDialog(state, today) {
    const awards = M.weeklyPennants(state, today).reverse();
    return dialogHeader("Switchback pennant") + `<div class="day-prize pennant-prize">${pixel("pennant")}<div><small>Weekly goal</small><h3>${awards.length} earned</h3></div></div>` +
      (awards.length ? `<h3 class="dialog-section-title">Weeks completed</h3><div class="pennant-weeks">${awards.map(award =>
        `<button class="pennant-week" data-action="day" data-day="${award.earnedOn}"><span><strong>Week of ${dated(award.from)}</strong><small>${daysText(award.target)} reached on ${dated(award.earnedOn)}</small></span>${icon("right")}</button>`).join("")}</div>` :
        '<p class="dialog-note">Set a target under Weekly goal on the overview. Each day with a check-in counts once.</p>');
  }

  function settingsDialog(modal, { state, mode, backupUrl, today }) {
    const save = { local: "Your journal is saved automatically in this browser.", memory: "Storage is unavailable. Your journal lasts until you close or reload this page.",
      damaged: "The stored journal is unreadable. Choose a replacement below to use device storage again." }[mode];
    return dialogHeader("Journal settings") + `<div class="settings-intro">${pixel("pack")}<div><h3>${state.sample ? "Starter journal" : "My journal"}</h3><p>${save}</p></div></div>
      <section class="backup-section" aria-labelledby="backup-title"><h3 id="backup-title" class="dialog-section-title">Journal backup</h3>
      <p class="form-hint">Save your habits, progress and field notes in a JSON file, or choose a backup to restore.</p>
      <div class="backup-actions">${backupUrl ? `<a class="button secondary" data-key="download-backup" href="${esc(backupUrl)}" download="embertrail-${today}.json">Download backup</a>` : ""}
      <label class="button secondary file-choice" for="backup-file">Choose backup<input class="sr-only" id="backup-file" type="file" accept=".json,application/json" data-key="backup-file" aria-describedby="form-error"></label></div>
      <p id="backup-status" class="form-hint" role="status">${modal.reading ? "Reading backup…" : ""}</p><p id="form-error" class="form-error" role="alert">${esc(modal.fileError || "")}</p></section>
      <p class="dialog-note">${state.sample ? "The starter journal includes four example habits and 35 days of sample history. Start an empty journal for your own trail." : "An empty journal starts with zero habits. The starter journal includes examples you can explore and edit."}</p>
      <div class="settings-actions"><button class="button secondary" data-action="reset-prompt" data-kind="empty">Start an empty journal</button>
      <button class="text-button" data-action="reset-prompt" data-kind="sample">Load starter journal</button></div>`;
  }

  function restoreDialog({ filename, backup }) {
    const checks = backup.habits.reduce((sum, habit) => sum + habit.checks.length, 0);
    const notes = Object.keys(backup.notes).length;
    const partials = backup.habits.reduce((sum, habit) => sum + Object.keys(habit.partials ?? {}).length, 0);
    const latest = backup.habits.reduce((day, habit) => {
      const last = habit.checks.at(-1);
      return last > day ? last : day;
    }, "");
    return dialogHeader("Restore this backup?") + `<p class="backup-name">${esc(filename)}</p>
      <dl class="backup-summary"><div><dt>Habits</dt><dd>${backup.habits.length}</dd></div><div><dt>Check-ins</dt><dd>${checks}</dd></div>
      <div><dt>Latest check-in</dt><dd>${latest ? dated(latest) : "None yet"}</dd></div>
      ${partials ? `<div><dt>Unfinished counts</dt><dd>${partials}</dd></div>` : ""}${notes ? `<div><dt>Field notes</dt><dd>${notes}</dd></div>` : ""}</dl>
      <p class="dialog-note">Restoring replaces the current journal and its history with this backup.</p>
      ${confirmActions("restore", "Restore journal")}`;
  }

  function confirmActions(action, label) {
    return `<div class="dialog-actions"><div class="action-pair"><button type="button" class="button secondary" data-action="back-confirm" autofocus>Cancel</button>
      <button type="button" class="button danger" data-action="${action}">${label}</button></div></div>`;
  }

  function confirmDialog(modal, state) {
    const remove = modal.type === "remove";
    const empty = modal.kind === "empty";
    const title = remove ? "Delete this habit?" : empty ? "Start an empty journal?" : "Load the starter journal?";
    const body = remove ? `“${esc(M.findHabit(state, modal.id).name)}” and all its check-ins will be deleted. Your streaks and rewards will be recalculated.` :
      `This replaces the current journal and its history with ${empty ? "an empty journal" : "sample habits and check-ins"}.`;
    return dialogHeader(title) + `<p class="dialog-note">${body}</p>` + confirmActions(remove ? "remove" : "reset", remove ? "Delete habit" : "Replace journal");
  }

  function dialog(modal, ctx) {
    switch (modal.type) {
      case "new": return habitForm(modal, null, ctx.today);
      case "edit": return habitForm(modal, M.findHabit(ctx.state, modal.id), ctx.today);
      case "day": return dayDialog(ctx.state, modal, ctx.today);
      case "progress": return progressDialog(modal, ctx);
      case "notes": return notesDialog(modal, ctx);
      case "note": return noteEditor(modal);
      case "weekday": return weekdayDialog(modal.index, ctx);
      case "reward": return rewardDialog(ctx.state, modal.id, ctx.today);
      case "goal": return goalDialog(modal.target);
      case "pennants": return pennantDialog(ctx.state, ctx.today);
      case "settings": return settingsDialog(modal, ctx);
      case "restore": return restoreDialog(modal);
      case "remove":
      case "reset": return confirmDialog(modal, ctx.state);
      default: throw new Error("Unknown journal dialog.");
    }
  }

  return { routes, main, sidebar, dialog, fullDate, bucketDays, scheduleHint, NOTE_PAGE, noteResults };
});
