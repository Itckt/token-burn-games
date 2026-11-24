(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const field = common ? require("./field.js") : root.Isobar.field;
  const cycle = common ? require("./lifecycle.js") : root.Isobar.lifecycle;
  const SLOTS = ["A", "B"];
  const key = slot => "isobar.observation.v1." + slot;

  function capture(state, point, inCycle) {
    const record = { version: 1, mode: inCycle ? "cycle" : "manual", time: state.time, x: point.x, z: point.z };
    if (!inCycle) {
      record.signal = state.signal;
      record.strength = state.strength;
      record.phase = state.phase;
      record.rainTravel = state.rainTravel;
    }
    return record;
  }

  // A life-cycle instant can be reconstructed from time alone. Manual storms
  // also need their eased strength and integrated rotation and rain travel.
  function pose(record) {
    return record.mode === "cycle" ? cycle.at(record.time) : record;
  }

  function decode(json) {
    if (!json) return null;
    let record;
    try { record = JSON.parse(json); } catch { return null; }
    const between = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
    if (!record || record.version !== 1 || !between(record.time, 0, Number.MAX_SAFE_INTEGER) ||
        !field.inRange(record)) return null;
    const inCycle = record.mode === "cycle";
    if (inCycle) {
      if (record.time > cycle.DURATION) return null;
    } else if (record.mode !== "manual" || !Number.isInteger(record.signal) || !between(record.signal, 1, 10) ||
        !between(record.strength, 0, 1) || !between(record.phase, 0, math.TAU) || record.phase === math.TAU ||
        !between(record.rainTravel, 0, Number.MAX_SAFE_INTEGER)) return null;
    return capture(record, record, inCycle);
  }

  function open(storage) {
    const entries = {};
    for (const slot of SLOTS) {
      try { entries[slot] = decode(storage && storage.getItem(key(slot))); }
      catch { entries[slot] = null; }
    }
    function write(slot, record) {
      if (!SLOTS.includes(slot)) throw new RangeError("Unknown notebook slot");
      entries[slot] = record;
      if (!storage) return false;
      try {
        if (record) storage.setItem(key(slot), JSON.stringify(record));
        else storage.removeItem(key(slot));
        return true;
      } catch { return false; }
    }
    return { entries, write };
  }

  function difference(a, b, digits) {
    const delta = Number(b.toFixed(digits)) - Number(a.toFixed(digits));
    return (delta < 0 ? "−" : delta > 0 ? "+" : "") + Math.abs(delta).toFixed(digits);
  }

  const api = { SLOTS, capture, pose, decode, open, difference };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).notebook = api;
})(globalThis);
