"use strict";

var TwistTrials = (function (cube) {
  function dailyCode(date = new Date()) {
    const hongKong = new Date(date.getTime() + 8 * 3600000);
    return "12-" + hongKong.toISOString().slice(0, 10).replace(/-/g, "");
  }

  function parseCode(input) {
    const match = typeof input === "string" && /^([1-9]|1[0-9]|20)-([a-z0-9]{1,16})$/i.exec(input.trim());
    if (!match) throw new RangeError("Use 1–20 turns, a hyphen and 1–16 letters or digits. Try 3-HKBU.");
    return { code: match[0].toUpperCase(), length: Number(match[1]) };
  }

  function challenge(input) {
    const { code, length } = parseCode(input);
    // FNV-1a and an unsigned 32-bit LCG keep codes portable between JS engines.
    let seed = 2166136261;
    for (const char of code) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const moves = cube.scramble(length, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    return { code, moves };
  }

  function toHundredths(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Expected a finite, nonnegative time in milliseconds.");
    }
    return Math.floor(milliseconds / 10);
  }

  function formatTime(milliseconds) {
    const hundredths = toHundredths(milliseconds);
    const seconds = Math.floor(hundredths / 100);
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") +
      "." + String(hundredths % 100).padStart(2, "0");
  }

  function validRecord(record) {
    return !!record && Number.isSafeInteger(record.ms) && record.ms >= 0 &&
      record.ms % 10 === 0 && Number.isSafeInteger(record.turns) && record.turns > 0;
  }

  function faster(a, b) {
    return !b || a.ms < b.ms || (a.ms === b.ms && a.turns < b.turns);
  }

  class Records {
    constructor(storage) {
      this.storage = storage;
      this.memory = new Map();
    }
    best(code) {
      let best = this.memory.get(code);
      try {
        const saved = JSON.parse(this.storage?.getItem("twistlab.trial.v1." + code) || "null");
        if (validRecord(saved) && faster(saved, best)) {
          best = { ms: saved.ms, turns: saved.turns };
          this.memory.set(code, best);
        }
      } catch { /* Local files and private browsing can have memory-only records. */ }
      return best ? { ...best } : null;
    }
    record(code, milliseconds, turns) {
      const result = { ms: toHundredths(milliseconds) * 10, turns };
      if (!validRecord(result)) throw new RangeError("Invalid time trial result.");
      const previous = this.best(code);
      if (!faster(result, previous)) return previous;
      this.memory.set(code, result);
      try { this.storage?.setItem("twistlab.trial.v1." + code, JSON.stringify(result)); }
      catch { /* The in-memory best is still available for this session. */ }
      return { ...result };
    }
  }
  return { parseCode, challenge, dailyCode, formatTime, Records };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistTrials;
