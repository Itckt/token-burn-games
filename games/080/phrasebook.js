"use strict";

const StreetPhrasebook = (() => {
  const { entries, resolveEntry } = typeof module === "object" && module.exports
    ? require("./lookup.js") : StreetLookup;

  function exportList(terms) {
    return entries.filter(entry => terms.has(entry.term)).map(entry => entry.term).join("\n");
  }

  function importList(text, book) {
    const expressions = new Set();
    for (const [index, raw] of text.split(/\r\n|[\r\n\u2028\u2029]/u).entries()) {
      const value = raw.trim();
      if (!value) continue;
      const entry = resolveEntry(value);
      if (!entry) {
        throw new RangeError(`Line ${index + 1} has an unknown or incomplete expression “${value}”. Use a full headword, listed spelling or complete reading.`);
      }
      expressions.add(entry);
    }

    // Resolve the whole list first. Each subsequent save is an idempotent addition.
    let added = 0;
    for (const entry of expressions) {
      try {
        if (book.set(entry, true)) added++;
      } catch (err) {
        throw new Error(`Import stopped at ${entry.term} with ${added} added. ${err.message} You can retry the same list.`, { cause: err });
      }
    }
    return { added, existing: expressions.size - added };
  }

  function importSummary({ added, existing }) {
    if (!added && !existing) return "The list is empty. Enter one expression per line.";
    return `Added ${added} expression${added === 1 ? "" : "s"}. ${existing} already saved.`;
  }

  function pagePhrasebook(win) {
    const prefix = "street-cantonese.phrasebook.";
    const terms = new Set();
    let storage;
    function read() {
      try {
        storage = win?.localStorage;
        if (!storage) return;
        const saved = entries.filter(entry => storage.getItem(prefix + entry.term) === "1");
        terms.clear();
        for (const entry of saved) terms.add(entry.term);
      } catch {
        storage = null;
      }
    }
    read();
    return {
      terms,
      get persistent() { return Boolean(storage); },
      set(entry, saved) {
        const key = prefix + entry.term;
        let existed = terms.has(entry.term);
        if (saved) terms.add(entry.term);
        else terms.delete(entry.term);
        try {
          if (storage) {
            existed = storage.getItem(key) === "1";
            if (saved && !existed) storage.setItem(key, "1");
            if (!saved && existed) storage.removeItem(key);
          }
        } catch {
          storage = null;
        }
        return existed !== saved;
      },
      refresh(event) {
        if (!storage || (event.storageArea && event.storageArea !== storage)) return false;
        if (event.key !== null && !event.key.startsWith(prefix)) return false;
        read();
        return true;
      },
    };
  }

  return { exportList, importList, importSummary, pagePhrasebook };
})();

if (typeof module === "object" && module.exports) module.exports = StreetPhrasebook;
