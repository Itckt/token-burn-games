(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { clamp } = common ? require("./math.js") : root.OrbitAtlas.math;
  const J2000 = Date.UTC(2000, 0, 1, 12);
  const DAY_MS = 86400000;
  const toDays = milliseconds => (milliseconds - J2000) / DAY_MS;
  const START_DAYS = toDays(Date.UTC(2026, 0, 1));
  const MIN_DAYS = toDays(Date.parse("0001-01-01T00:00:00Z"));
  const MAX_DAYS = toDays(Date.parse("9999-12-31T23:59:59.999Z"));
  const SPEEDS = Object.freeze([0.1, 0.25, 1, 3, 10, 30, 100]);
  const inCalendar = days => Number.isFinite(days) && days >= MIN_DAYS && days <= MAX_DAYS;
  const dateAt = days => new Date(J2000 + Math.round(days * DAY_MS));
  const dateOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };
  const calendar = new Intl.DateTimeFormat("en-GB", dateOptions);
  const minute = new Intl.DateTimeFormat("en-GB", { ...dateOptions, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const formatDate = date => calendar.format(date);
  const formatUTC = days => minute.format(dateAt(days)) + " UTC";

  // A datetime-local field supplies wall-clock digits. Interpret them in UTC
  // and round-trip to reject overflow dates such as 29 February 2100.
  function parseUTCMinute(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const days = toDays(Date.parse(value + ":00Z"));
    return inCalendar(days) && dateAt(days).toISOString().slice(0, 16) === value ? days : null;
  }

  class Clock {
    constructor(days = START_DAYS) {
      if (!inCalendar(days)) throw new RangeError("Date outside the simulation calendar");
      this.days = days;
      this.speedIndex = 2;
      this.direction = 1;
      this.paused = false;
      this.roundoff = 0;
    }
    get speed() { return SPEEDS[this.speedIndex]; }
    get date() { return dateAt(this.days); }
    setSpeed(index) {
      if (Number.isFinite(index)) this.speedIndex = clamp(Math.round(index), 0, SPEEDS.length - 1);
    }
    reverse() { this.direction *= -1; }
    seek(days) {
      if (!inCalendar(days)) return false;
      this.days = days;
      this.roundoff = 0;
      this.paused = true;
      return true;
    }
    advance(seconds) {
      if (this.paused || !Number.isFinite(seconds) || seconds <= 0) return this.days;
      // Keep the fraction lost in the last addition. Sixty 1/60-day frames
      // should land on the same UTC midnight as one full-day step.
      const increment = seconds * this.speed * this.direction - this.roundoff;
      const next = this.days + increment;
      if (next <= MIN_DAYS || next >= MAX_DAYS) {
        this.seek(clamp(next, MIN_DAYS, MAX_DAYS));
      } else {
        this.roundoff = (next - this.days) - increment;
        this.days = next;
      }
      return this.days;
    }
  }

  const api = { J2000, DAY_MS, START_DAYS, MIN_DAYS, MAX_DAYS, SPEEDS, Clock, dateAt, parseUTCMinute,
    inCalendar, formatDate, formatUTC };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).time = api;
})(globalThis);
