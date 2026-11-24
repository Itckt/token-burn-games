(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./model.js"), require("./storage.js"), require("./art.js"), require("./views.js"));
  } else {
    factory(root.EmberModel, root.EmberStorage, root.EmberArt, root.EmberViews).start({ doc: root.document, win: root });
  }
})(globalThis, function (M, Store, Art, Views) {
  "use strict";

  function start({ doc, win, clock = () => new Date(), storage, makeId }) {
    let today = M.localDay(clock());
    let month = today.slice(0, 7);
    let span = 7;
    let modal = null;
    let openerKey = "";
    let backupUrl = "";
    let toastTimer;
    let writes = Promise.resolve();
    let stopped = false;
    if (storage === undefined) {
      try { storage = win.localStorage; } catch { storage = null; }
    }
    const journal = Store.createJournal(storage, today);
    const newId = makeId || (() => win.crypto?.randomUUID?.() ||
      "h-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
    const route = () => {
      const key = win.location.hash.slice(1);
      return Object.hasOwn(Views.routes, key) ? key : "overview";
    };
    let view = route();
    const byId = id => doc.getElementById(id);
    const main = byId("main-content");
    const rail = byId("sidebar");
    const dialog = byId("journal-dialog");
    const content = byId("dialog-content");
    const toast = byId("toast");
    const context = () => ({ state: journal.state, mode: journal.mode, view, today, month, span });
    const listeners = [];

    function on(target, name, listener) {
      target.addEventListener(name, listener);
      listeners.push(() => target.removeEventListener(name, listener));
    }

    function focusKey(key, scope = doc) {
      const control = key && scope.querySelector(`[data-key="${key}"]`);
      if (!control || control.disabled) return false;
      control.focus({ preventScroll: true });
      return true;
    }

    function announce(message) {
      win.clearTimeout(toastTimer);
      toast.textContent = message;
      toastTimer = win.setTimeout(() => { toast.textContent = ""; }, 2600);
    }

    function renderMain() {
      const focus = !modal && doc.activeElement?.dataset;
      rail.innerHTML = Views.sidebar(view, journal.state, journal.mode);
      main.innerHTML = Views.main(context());
      doc.title = Views.routes[view] + " · Embertrail";
      if (focus?.key && !focusKey(focus.key)) {
        const sameHabit = focus.relative === "today" && focusKey(`check-${focus.id}-${today}`, main);
        if (!sameHabit) main.focus({ preventScroll: true });
      }
    }

    function releaseBackup() {
      if (backupUrl) win.URL.revokeObjectURL(backupUrl);
      backupUrl = "";
    }

    function makeDownload() {
      const json = JSON.stringify(journal.state, null, 2);
      try {
        backupUrl = win.URL.createObjectURL(new win.Blob([json], { type: "application/json" }));
        return backupUrl;
      } catch {
        return "data:application/json;charset=utf-8," + encodeURIComponent(json);
      }
    }

    function paintDialog(preserveFocus = false) {
      if (!modal) return;
      const key = preserveFocus && doc.activeElement?.dataset.key;
      releaseBackup();
      const download = modal.type === "settings" && journal.mode !== "damaged" ? makeDownload() : "";
      content.innerHTML = Views.dialog(modal, { ...context(), backupUrl: download });
      if (!dialog.open) dialog.showModal();
      if (!focusKey(key, content)) {
        (content.querySelector("[autofocus]") || content.querySelector("button"))?.focus({ preventScroll: true });
      }
    }

    function openModal(descriptor) {
      if (!modal) openerKey = doc.activeElement?.dataset.key || "";
      modal = descriptor;
      paintDialog();
    }

    function openChild(descriptor) {
      openModal({ ...descriptor, parent: modal, returnKey: doc.activeElement?.dataset.key });
    }

    function goBack() {
      if (!modal?.parent) return closeModal();
      const { parent, returnKey } = modal;
      openModal(parent);
      focusKey(returnKey, content);
    }

    function closeModal() {
      if (!modal && !dialog.open) return;
      modal = null;
      if (dialog.open) dialog.close();
      releaseBackup();
      content.innerHTML = "";
      if (!focusKey(openerKey)) main.focus({ preventScroll: true });
      openerKey = "";
    }

    function refresh() {
      renderMain();
      if (!modal) return;
      if (["edit", "remove", "progress"].includes(modal.type)) {
        const habit = journal.state.habits.find(h => h.id === modal.id);
        if (!habit) {
          goBack();
          announce("This habit was removed from the journal.");
          return;
        }
        if (modal.type === "edit") {
          const from = M.scheduleChangeDate(habit, today);
          byId("schedule-hint").textContent = Views.scheduleHint(from);
          byId("repeat-days").disabled = !from;
          byId("target-fields").disabled = !from;
          return;
        }
        if (modal.type === "progress") {
          const goal = M.targetOn(habit, modal.day);
          if (!M.isDue(habit, modal.day) || goal.amount !== modal.goal.amount || goal.unit !== modal.goal.unit) {
            goBack();
            announce("The plan for that date changed. Open the habit again to review it.");
          }
          return;
        }
      }
      if (modal.type === "notes") return refreshNoteResults();
      if (!["new", "goal", "note"].includes(modal.type)) paintDialog(true);
    }

    function updateClock() {
      const next = M.localDay(clock());
      if (next === today) return;
      if (month === today.slice(0, 7)) month = next.slice(0, 7);
      today = next;
      refresh();
    }

    function report(error) {
      const errorField = modal && byId("form-error");
      if (errorField) errorField.textContent = error.message;
      else announce(error.message);
    }

    // Serialize gestures in this tab. Browser Web Locks also coordinate cooperating tabs.
    function write(work, owner) {
      const run = () => {
        if (stopped) return;
        updateClock();
        if (!owner || modal === owner) work();
      };
      const locked = async () => {
        let entered = false;
        try {
          const locks = win.navigator?.locks;
          if (!locks || journal.mode === "memory") { entered = true; return run(); }
          return await locks.request(Store.KEY, () => { entered = true; return run(); });
        } catch (error) {
          // Some file origins provide storage but deny access to the lock manager.
          if (!entered && ["SecurityError","NotSupportedError","InvalidStateError"].includes(error.name)) return run();
          throw error;
        }
      };
      writes = writes.then(locked).catch(error => {
        if (stopped) return;
        refresh();
        report(error);
      });
      return writes;
    }

    function finishDialog(message) {
      renderMain();
      goBack();
      announce(message);
    }

    function openEditor(id) {
      openModal({ type: id ? "edit" : "new", id: id || newId() });
      if (id) modal.original = habitValues(byId("habit-form"));
    }

    function habitValues(form) {
      const days = Array.from(form.querySelectorAll('[name="weekday"]'))
        .filter(input => input.checked).map(input => Number(input.value));
      const target = Number(form.elements.dailyTarget.value);
      return { name: form.elements.habitName.value, icon: form.elements.habitIcon.value, days,
        target, unit: target === 1 ? "" : form.elements.unit.value };
    }

    function saveHabit(state, editor, values) {
      if (editor.type === "new") return M.addHabit(state, { id: editor.id, ...values }, today);
      const habit = M.findHabit(state, editor.id);
      const initial = editor.original;
      let next = M.editHabit(state, habit.id, values.name === initial.name ? habit.name : values.name,
        values.icon === initial.icon ? habit.icon : values.icon);
      if (values.days.join() !== initial.days.join()) next = M.changeSchedule(next, habit.id, values.days, today);
      if (values.target !== initial.target || values.unit !== initial.unit) {
        const latest = M.targetOn(habit, M.scheduleChangeDate(habit, today) || M.LAST_DAY);
        next = M.changeTarget(next, habit.id, values.target === initial.target ? latest.amount : values.target,
          values.unit === initial.unit ? latest.unit : values.unit, today);
      }
      return next;
    }

    function openProgress(id, day) {
      const habit = M.findHabit(journal.state, id);
      if (day > today || !M.isDue(habit, day)) throw new Error("Choose a scheduled date through today.");
      openChild({ type: "progress", id, day, goal: M.targetOn(habit, day), original: M.progressOn(habit, day) });
    }

    function openNote(day) {
      if (day > today) throw new Error("Choose a note date through today.");
      openChild({ type: "note", day, original: journal.state.notes[day] ?? "" });
    }

    function refreshNoteResults() {
      const results = byId("note-results");
      const focus = doc.activeElement?.closest("#note-results") && doc.activeElement.dataset.key;
      results.innerHTML = Views.noteResults(journal.state, today, modal.query, modal.limit);
      if (focus && !focusKey(focus, results)) focusKey("notes-query", content);
    }

    async function readBackup(input) {
      const file = input.files?.[0];
      const settings = modal;
      if (!file || settings?.type !== "settings") return;
      const request = Symbol();
      settings.reading = request;
      delete settings.fileError;
      input.value = "";
      byId("form-error").textContent = "";
      byId("backup-status").textContent = "Reading backup…";
      let raw;
      try {
        raw = await file.text();
      } catch {
        raw = null;
      }
      if (modal !== settings || settings.reading !== request) return;
      delete settings.reading;
      byId("backup-status").textContent = "";
      try {
        if (raw === null) throw new Error("This file could not be read. Choose the backup again.");
        const backup = Store.parseJournal(raw);
        openModal({ type: "restore", filename: file.name, backup });
      } catch (error) {
        settings.fileError = error.message;
        report(error);
      }
    }

    function rewardMessage(stateWithCheck, day, checked) {
      if (M.dayProgress(stateWithCheck, day).done !== 1) return checked ? "Habit checked in." : "Check-in removed.";
      const daily = checked ? M.REWARDS[M.rewardForDay(day)].name + " collected." : "Check-in removed.";
      if (!M.weeklyTarget(stateWithCheck, day)) return daily;
      const sunday = M.shiftDay(M.weekStart(day), 6);
      const week = M.weekProgress(stateWithCheck, M.dayDistance(sunday, today) > 0 ? sunday : today);
      if (week.active.length !== week.target) return daily;
      return daily + (checked ? " Switchback pennant earned." : " Weekly pennant returned.");
    }

    function check(data) {
      return write(() => {
        const day = data.relative === "today" ? today : data.day;
        const checked = day !== data.day || data.value === "true";
        let message;
        let needsAmount = false;
        journal.change(state => {
          // The daily target may have changed since the checkbox was painted.
          needsAmount = M.targetOn(M.findHabit(state, data.id), day).amount > 1;
          if (needsAmount) return state;
          const next = M.setCheck(state, data.id, day, checked, today);
          if (next !== state) message = rewardMessage(checked ? next : state, day, checked);
          return next;
        });
        refresh();
        if (needsAmount) openProgress(data.id, day);
        else if (message) announce(message);
      }, modal);
    }

    function adjustCount(by) {
      const input = byId("progress-amount");
      const max = modal.goal.amount;
      const value = by === null ? max : Math.trunc(Number(input.value) || 0) + by;
      input.value = String(Math.max(0, Math.min(max, value)));
      byId("count-meter").value = Number(input.value);
    }

    function act(data) {
      switch (data.action) {
        case "new-habit": openEditor(); break;
        case "edit": openEditor(data.id); break;
        case "settings": openModal({ type: "settings" }); break;
        case "close": closeModal(); break;
        case "back": goBack(); break;
        case "check": return check(data);
        case "progress": openProgress(data.id, data.relative === "today" ? today : data.day); break;
        case "adjust-count": adjustCount(Number(data.by)); break;
        case "fill-count": adjustCount(null); break;
        case "day":
          if (modal?.type === "notes" || modal?.type === "weekday") openChild({ type: "day", day: data.day });
          else openModal({ type: "day", day: data.day });
          break;
        case "weekday": openModal({ type: "weekday", index: Number(data.index) }); break;
        case "notes": openModal({ type: "notes", query: "", limit: Views.NOTE_PAGE }); break;
        case "note": openNote(data.day); break;
        case "note-today": openNote(today); break;
        case "more-notes": {
          const firstNew = modal.limit;
          modal.limit += Views.NOTE_PAGE;
          refreshNoteResults();
          byId("note-results").querySelectorAll(".note-entry")[firstNew]?.focus();
          break;
        }
        case "reward": openModal({ type: "reward", id: data.reward }); break;
        case "goal": openModal({ type: "goal", target: M.weeklyTarget(journal.state, today) }); break;
        case "pennants": openModal({ type: "pennants" }); break;
        case "month": month = M.shiftMonth(month, Number(data.offset)); renderMain(); break;
        case "current-month": month = today.slice(0, 7); renderMain(); focusKey("day-" + today); break;
        case "period": span = Number(data.span); renderMain(); break;
        case "remove-prompt":
          if (modal?.type === "edit") {
            modal.draft = habitValues(byId("habit-form"));
            openModal({ type: "remove", id: modal.id, editor: modal });
          }
          break;
        case "reset-prompt": openModal({ type: "reset", kind: data.kind }); break;
        case "back-confirm":
          if (modal?.type === "remove") openModal({ ...modal.editor });
          else openModal({ type: "settings" });
          break;
        case "remove": {
          if (modal?.type !== "remove") break;
          const id = modal.id;
          return write(() => {
            journal.change(state => M.removeHabit(state, id));
            finishDialog("Habit deleted.");
          }, modal);
        }
        case "restore":
        case "reset": {
          if (modal?.type !== data.action) break;
          const target = modal;
          return write(() => {
            const next = target.type === "restore" ? target.backup : target.kind === "sample" ? M.starterState(today) : M.emptyState();
            journal.replace(next);
            month = today.slice(0, 7);
            finishDialog(target.type === "restore" ? "Backup restored." : next.sample ? "Starter journal loaded." : "Your empty journal is ready.");
          }, target);
        }
      }
    }

    // Keep an untouched field at its latest saved value. Conflicting edits need a second save.
    function acceptEdit(editor, latest, desired, description) {
      if (desired === editor.original || desired === latest) return false;
      if (latest !== editor.original) {
        editor.original = latest;
        throw new Error(`The saved ${description} changed to ${latest === "" ? "an empty note" : "“" + latest + "”"}. Save again to use your edit, or cancel to keep the saved value.`);
      }
      return true;
    }

    function saveProgress(editor, value) {
      let message = "Progress kept.";
      journal.change(state => {
        const habit = M.findHabit(state, editor.id);
        const { amount, unit } = M.targetOn(habit, editor.day);
        if (amount !== editor.goal.amount || unit !== editor.goal.unit) throw new Error("The daily target changed. Reopen the habit to log progress.");
        const next = M.setProgress(state, editor.id, editor.day, value, today);
        const latest = M.progressOn(habit, editor.day);
        if (!acceptEdit(editor, latest, value, "count")) return state;
        const completed = value === amount;
        message = completed || latest === amount ? rewardMessage(completed ? next : state, editor.day, completed) : "Progress saved.";
        return next;
      });
      return message;
    }

    function saveNote(editor, text) {
      let message = "Field note kept.";
      journal.change(state => {
        const next = M.setNote(state, editor.day, text, today);
        const desired = next.notes[editor.day] ?? "";
        if (!acceptEdit(editor, state.notes[editor.day] ?? "", desired, "note")) return state;
        message = desired ? "Field note saved." : "Field note removed.";
        return next;
      });
      return message;
    }

    const formReaders = {
      "habit-form": habitValues,
      "goal-form": form => Number(form.elements.weeklyTarget.value),
      "progress-form": form => Number(form.elements.amount.value.trim() || NaN),
      "note-form": form => form.elements.noteText.value
    };

    function saveForm(editor, value) {
      switch (editor.type) {
        case "progress": return saveProgress(editor, value);
        case "note": return saveNote(editor, value);
        case "goal":
          journal.change(state => value === editor.target ? state : M.setWeeklyGoal(state, today, value));
          return value === editor.target ? "Weekly goal kept." : "Weekly goal saved.";
        default:
          journal.change(state => saveHabit(state, editor, value));
          return editor.type === "edit" ? "Habit updated." : "New habit added.";
      }
    }

    function submit(event) {
      const form = event.target;
      if (!Object.hasOwn(formReaders, form.id)) return;
      event.preventDefault();
      if (!modal || byId(form.id) !== form || form.dataset.saving) return;
      const target = modal;
      const value = formReaders[form.id](form);
      form.dataset.saving = "true";
      write(() => finishDialog(saveForm(target, value)), target).finally(() => { delete form.dataset.saving; });
    }

    byId("sprite-bank").innerHTML = Art.definitions();
    on(doc, "click", event => {
      if (event.target === dialog) { closeModal(); return; }
      if (event.target.closest?.(".skip-link")) {
        event.preventDefault(); main.focus(); return;
      }
      const control = event.target.closest?.("[data-action]");
      if (!control || control.disabled) return;
      try {
        const data = { ...control.dataset };
        updateClock();
        act(data);
      } catch (error) { report(error); }
    });
    on(doc, "submit", submit);
    on(doc, "input", ({ target }) => {
      if (target.id === "daily-target") byId("habit-unit").disabled = Number(target.value) <= 1;
      if (target.id === "progress-amount") byId("count-meter").value = Number(target.value) || 0;
      if (target.id === "notes-query" && modal?.type === "notes") {
        modal.query = target.value;
        modal.limit = Views.NOTE_PAGE;
        refreshNoteResults();
      }
    });
    on(doc, "change", event => { if (event.target.id === "backup-file") return readBackup(event.target); });
    on(dialog, "cancel", event => { event.preventDefault(); goBack(); });
    on(win, "hashchange", () => {
      view = route(); closeModal(); updateClock(); renderMain(); main.focus({preventScroll:true}); win.scrollTo(0, 0);
    });
    on(win, "storage", event => {
      if (event.key !== Store.KEY && event.key !== null) return;
      journal.refresh();
      refresh();
    });
    on(win, "focus", updateClock);
    on(doc, "visibilitychange", () => { if (!doc.hidden) updateClock(); });
    const dayTimer = win.setInterval(updateClock, 30000);
    renderMain();
    return {
      context, idle: () => writes,
      destroy() {
        stopped = true;
        for (const remove of listeners) remove();
        closeModal();
        win.clearInterval(dayTimer);
        win.clearTimeout(toastTimer);
      }
    };
  }

  return { start };
});
