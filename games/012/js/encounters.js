(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { clamp, bisectZero } = dep("math");
  const { orbits, bodyStateAt } = dep("physics");
  const { signalRange } = dep("observations");
  const { MIN_DAYS, MAX_DAYS, inCalendar } = dep("time");

  const isEndpoint = id => id === "sun" || Object.hasOwn(orbits, id);
  const validPair = (from, to) => typeof from === "string" && typeof to === "string"
    && from !== to && isEndpoint(from) && isEndpoint(to);

  function cycleDays(from, to) {
    if (!validPair(from, to)) throw new RangeError("Choose two different bodies");
    // A stationary Sun has zero angular frequency.
    const frequency = id => id === "sun" ? 0 : 1 / orbits[id].period;
    return 1 / Math.abs(frequency(from) - frequency(to));
  }

  function encounterWindow(from, to, anchor, direction) {
    const cycle = cycleDays(from, to);
    if (!inCalendar(anchor) || ![1, -1].includes(direction)) throw new RangeError("Invalid encounter window");
    // At the very first or last instant there is still a full window to explore inward.
    if (anchor === MIN_DAYS) direction = 1;
    if (anchor === MAX_DAYS) direction = -1;
    const other = clamp(anchor + direction * cycle, MIN_DAYS, MAX_DAYS);
    return { start: Math.min(anchor, other), end: Math.max(anchor, other) };
  }

  function rangeAt(from, to, day) {
    if (!validPair(from, to) || !Number.isFinite(day)) throw new RangeError("Invalid pair measurement");
    return signalRange(bodyStateAt(from, day), bodyStateAt(to, day));
  }

  function encounterPlan(from, to, span) {
    const cycle = cycleDays(from, to), { start, end } = span;
    if (!inCalendar(start) || !inCalendar(end) || !(start < end) || end - start > cycle + 1e-8) {
      throw new RangeError("Expected up to one encounter cycle inside the atlas calendar");
    }
    const sample = day => ({ day, ...rangeAt(from, to, day) });
    const steps = 128;
    const times = new Set(Array.from({ length: steps + 1 }, (_, i) =>
      i === steps ? end : start + (end - start) * (i / steps)));
    const curve = [...times].map(sample);
    // Look just outside the window to classify turning points right at an edge.
    // These guard samples never become chart points or visitable dates.
    const tolerance = Math.max(1e-10, 8 * Number.EPSILON * Math.max(Math.abs(start), Math.abs(end)));
    const brackets = [sample(start - tolerance), ...curve, sample(end + tolerance)];
    const events = [];
    for (let i = 1; i < brackets.length; i++) {
      const left = brackets[i - 1], right = brackets[i];
      let kind;
      if (left.rateKmS <= 0 && right.rateKmS > 0) kind = "Closest";
      else if (left.rateKmS >= 0 && right.rateKmS < 0) kind = "Farthest";
      else continue;
      const day = bisectZero(t => rangeAt(from, to, t).rateKmS, left.day, right.day);
      const event = { ...sample(clamp(day, start, end)), kind };
      events.push(event);
      if (!times.has(event.day)) curve.push(event);
    }
    curve.sort((a, b) => a.day - b.day);
    const distances = curve.map(point => point.au);
    const min = Math.min(...distances), max = Math.max(...distances);
    const margin = Math.max(0.001, (max - min) * 0.12);
    return { ...span, curve, events, low: Math.max(0, min - margin), high: max + margin };
  }

  function trailDuration(setting, from, to, days) {
    if (!validPair(from, to) || !inCalendar(days)) return 0;
    const shortest = Math.min(orbits[from]?.period ?? Infinity, orbits[to]?.period ?? Infinity);
    const span = setting === "quarter" ? shortest / 4 : setting === "7" ? 7 : setting === "30" ? 30 : 0;
    return Math.min(span, days - MIN_DAYS);
  }

  const api = { validPair, cycleDays, encounterWindow, encounterPlan, rangeAt, trailDuration };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).encounters = api;
})(globalThis);
