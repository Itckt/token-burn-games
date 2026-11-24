"use strict";

var TwistCheckpoints = (function (cube) {
  const keys = [1, 2, 3].map(number => "twistlab.checkpoint.v1." + number);
  const NAME_LIMIT = 40;

  function slotIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= keys.length) throw new RangeError("Unknown checkpoint slot.");
    return index;
  }

  function snapshot(name, moves) {
    if (typeof name !== "string" || name.length > NAME_LIMIT) throw new RangeError("Use a name of up to 40 characters.");
    if (!Array.isArray(moves)) throw new TypeError("A checkpoint needs a move history.");
    for (const move of moves) cube.describe(move);
    return Object.freeze({ name: name.trim(), moves: Object.freeze(moves.slice()) });
  }

  function decode(raw) {
    try {
      const record = JSON.parse(raw);
      return snapshot(record.name, record.moves);
    } catch { return null; }
  }

  class Shelf {
    #slots = keys.map(() => null);
    #memoryOnly = new Set();
    constructor(storage) {
      this.storage = storage;
      this.sync();
    }
    // Separate keys let two open copies save different slots independently.
    sync(changedKey = null) {
      const updated = [];
      if (!this.storage) return updated;
      for (const [index, key] of keys.entries()) {
        if ((changedKey !== null && changedKey !== key) || this.#memoryOnly.has(index)) continue;
        try {
          const raw = this.storage.getItem(key);
          this.#slots[index] = raw == null ? null : decode(raw);
          updated.push(index);
        } catch { /* A read restriction leaves the in-memory slot intact. */ }
      }
      return updated;
    }
    get(index) {
      return this.#slots[slotIndex(index)];
    }
    #write(index, record) {
      const key = keys[slotIndex(index)];
      this.#slots[index] = record;
      if (!this.storage) return false;
      try {
        if (record) this.storage.setItem(key, JSON.stringify(record));
        else this.storage.removeItem(key);
        this.#memoryOnly.delete(index);
        return true;
      } catch {
        this.#memoryOnly.add(index);
        return false;
      }
    }
    save(index, name, moves) { return this.#write(index, snapshot(name, moves)); }
    clear(index) { return this.#write(index, null); }
  }

  return { Shelf, SLOT_COUNT: keys.length, NAME_LIMIT };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistCheckpoints;
