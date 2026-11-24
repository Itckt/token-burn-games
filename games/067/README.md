# Embertrail

Embertrail is an offline daily habit tracker. Check off a habit to light up its calendar tile, extend your streak, and collect an original pixel-art reward. The journal includes a seven-day activity chart, longer-term statistics, and a shelf showing the dates you earned each collectible.

## Run the tracker

Open **index.html** in a current browser. All scripts, styles, and artwork are included in this folder. The local-file version works offline and has no build step.

For a stable local address, you can also use the included server with Node.js 18 or newer. This project was built and tested with Node.js 22.22.3.

```sh
node server.js
```

The server listens at **http://127.0.0.1:3000**. Stop it with **Ctrl+C**. To choose another port, use `node server.js --port 8080`. The server uses only Node’s standard library and binds to the loopback interface.

## Start your journal

The first visit opens **Starter journal**, with four editable habits and 35 days of example history. Try checking off “Walk the HKBU loop” after your walk from Kowloon Tong. To begin tracking your own history, select the journal settings at the bottom of the sidebar, choose **Start an empty journal**, and confirm. On a small screen, journal settings are at the top right.

- **Trail overview** shows your current and best journal streaks, today’s checklist, a monthly reward calendar, and the last seven days of activity. Select a calendar tile to see its reward and eligible habits.
- **My habits** lets you name a habit, choose its weekdays and icon, and check in when it’s due. The pencil opens the editor. Deleting a habit requires confirmation and removes its check-ins from every statistic.
- **Statistics** shows check-ins, completion rate, active days, and a per-habit breakdown over the last 7, 30, or 90 days. The activity chart groups longer periods into labeled intervals.
- **Reward shelf** shows how many of each item you have collected. Select an item and then an earned date to revisit that day.

## How the numbers work

| Measure | Rule |
| --- | --- |
| Daily reward | The first completed habit on a date earns its item. Extra check-ins count toward habit statistics. Undoing the last check-in on that date returns its item. |
| Milestone chest | The 7th, 14th, 21st, and 28th of each month offer a Wayfarer chest. One check-in on the applicable date earns it. |
| Journal streak | Consecutive local dates with at least one completed habit. A run ending yesterday stays current while you still have today to continue it. |
| Habit streak | Consecutive scheduled days completed for one habit. Rest days preserve the run, and a habit due today has until midnight to continue it. Personal best on the overview is the longest journal streak across all recorded dates. |
| Completion rate | Completed check-ins divided by eligible habit-days in the selected period, rounded to a whole percent. A newly created habit counts from its start date. A dash means there were zero eligible habit-days. |
| Active days | Distinct checked-in dates in the selected period, including today when you have checked in. |

Calendar weeks begin on Monday. You can backfill or undo check-ins on eligible dates from a habit’s creation date through today. Future tiles preview their rewards and scheduled habits. Backfilling a gap can join two streaks. The display follows your device’s local date and refreshes when the day changes.

## Where progress is saved

The app automatically saves to browser storage on this device. Use the same browser and entry point for the same journal. Opening the file directly, using a different server address or port, and using a different browser profile can each give you a separate journal. Clearing that browser’s site data removes its save.

**Saved on this device** indicates persistent storage. **Session only** means changes are held in memory until the page closes or reloads. If a saved journal becomes unreadable, settings lets you explicitly replace it with an empty or starter journal.

## Run the tests

From this folder, run the complete suite with the installed Node.js runtime.

```sh
node tools/run-tests.js
```

The runner uses the built-in `node:test` and `node:assert` modules in one process and returns a failing exit code for a failed test. It runs entirely from the command line, with in-memory storage, events, and HTTP request/response objects. It requires neither a browser nor a listening server.

Coverage includes habit creation and editing, calendar corrections, reward reversals, streaks, changing time zones, leap years, midnight rollover, statistics, persistence, storage failures, and cross-tab changes. Integration tests exercise the controls and shipped script startup, check accessible labels and asset references, and decode both pixel landscapes.

The bundled landscapes can be rebuilt with `node tools/draw-art.js`. Their source and the hand-drawn collectible sprites are included in the project.

## Round 2

- **Weekday schedules.** Choose **Repeat on** when creating or editing a habit. For a library walk on HKBU class days, pick the days you’re on campus. The checklist, calendar, streak and completion rate follow that schedule. New habits start today. Weekday edits start tomorrow, or after the latest saved check-in if the device clock has moved back. The editor shows the effective date.
- **Weekly goals.** Choose **Set goal** on the overview and pick one to seven active days per week. The first check-in on each date fills one stamp. Reaching the target earns a **Switchback pennant**. Select it on the reward shelf to revisit the date you earned it. Changing the target or choosing **Off** takes effect in the current Monday–Sunday week. Earlier weeks keep their targets, and correcting a check-in recalculates the affected award.
- **Portable backups.** Under **Journal settings**, use **Download backup** to save a local JSON file. **Choose backup** checks the file and previews its habit count, check-in count and latest check-in. **Restore journal** confirms the replacement. Downloads and restores also work in a session-only journal.

Version 1 saves open with their daily routines and history intact. The next edit saves them in version 2 at the same storage address, so an older tab can recognize the format change. Weekly goals start off in existing and empty journals. A freshly loaded starter journal includes a three-day goal.

Cancelling a deletion now returns you to your unsaved edits. An editor also preserves independent changes made in another tab. Scheduling, historical eligibility and streak calculations share the same rules across views. The expanded command-line suite covers rest days, week boundaries, reward reversals, cancelled writes, and backup validation and recovery.

## Round 3

- **Counted habits.** In the habit editor, set a daily target from 2 to 999 and optionally name the unit. A three-round practice session with your campus trio can count as one check-in. Open the habit from the checklist or calendar, enter how many rounds you’ve finished, and choose **Save progress**. Reaching the target earns the check-in. Lowering the count revises streaks, rewards and statistics. A target of 1 keeps the one-tap checklist. Target and weekday edits take effect after today or the latest recorded progress, whichever is later.
- **Field notes.** Open a calendar date through today and choose **Add note** to write up to 500 characters. Dates with a note carry a pencil mark. **Field notes** above the calendar lets you search the text or an ISO date such as `2024-02-29` and reopen the entry. Save an empty note to remove it. Rest days can have notes, and only completed habits earn rewards.
- **Period comparisons and weekday review.** **Statistics** shows how check-ins, active days and completion rate changed from the preceding 7, 30 or 90 days. Rate changes use percentage points. Choose a weekday to see what was due on each date and open one to correct a count or check-in. The comparison updates immediately.

Version 1 and 2 journals open at the same storage address and upgrade to version 3 on the next change. Backups now carry field notes, partial counts and dated targets. Fresh starter journals include a two-bottle habit and a field note from a walk to the HKBU library.

One-tap check-ins and counted habits now share the same progress update logic. The command-line suite covers partial progress across midnight, reward reversals, conflicting edits, backup migration and leap-day comparisons. Regression fixes preserve another tab’s weekly-goal change, cancel queued writes when the app closes, and keep keyboard focus on the daily checklist as the date changes.
