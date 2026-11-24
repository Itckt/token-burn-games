(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.EmberStorage = factory(root.EmberModel);
})(globalThis, function (model) {
  "use strict";
  // Keep the original storage address so existing journals and cross-tab locks are shared.
  const KEY = "embertrail.journal.v1";

  function parseJournal(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Choose a valid Embertrail JSON backup.");
    }
    return model.loadState(data);
  }

  function createJournal(storage, today) {
    let state = model.starterState(today);
    let mode = storage ? "local" : "memory";

    function persist(next) {
      next = model.loadState(next);
      if (storage && mode !== "memory") {
        try {
          storage.setItem(KEY, JSON.stringify(next));
          mode = "local";
        } catch {
          mode = "memory";
        }
      }
      state = next;
    }

    function read(first = false) {
      if (mode === "memory") return;
      let raw;
      try {
        raw = storage.getItem(KEY);
      } catch {
        mode = "memory";
        return;
      }
      if (raw === null) {
        if (first) persist(state);
        else state = model.emptyState();
        if (!first) mode = "local";
        return;
      }
      try {
        state = parseJournal(raw);
        mode = "local";
      } catch {
        state = model.emptyState();
        mode = "damaged";
      }
    }

    read(true);
    return {
      get state() { return state; },
      get mode() { return mode; },
      refresh: read,
      change(operation) {
        read();
        if (mode === "damaged") throw new Error("Open journal settings to replace the unreadable save.");
        const next = operation(state);
        if (next !== state) persist(next);
        return state;
      },
      replace(next) { persist(next); }
    };
  }

  return { KEY, createJournal, parseJournal };
});
