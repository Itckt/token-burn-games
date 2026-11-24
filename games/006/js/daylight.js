(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { clamp } = node ? require('./math.js') : Nightline.math;
  // Six timetable seconds per running second. Integer ticks wrap at midnight.
  const TICKS_PER_MINUTE = 600, DAY = 1440 * TICKS_PER_MINUTE;
  const shifts = Object.freeze([
    Object.freeze({ name: 'Evening', minute: 18 * 60 + 5 }),
    Object.freeze({ name: 'Last train', minute: 23 * 60 + 58 }),
    Object.freeze({ name: 'First train', minute: 6 * 60 + 12 })
  ]);
  function createClock() { return { shift: 0, tick: shifts[0].minute * TICKS_PER_MINUTE }; }
  function nextShift(clock) {
    clock.shift = (clock.shift + 1) % shifts.length;
    clock.tick = shifts[clock.shift].minute * TICKS_PER_MINUTE;
  }
  function advance(clock) { clock.tick = (clock.tick + 1) % DAY; }
  function minuteOfDay(clock) { return Math.floor(clock.tick / TICKS_PER_MINUTE); }
  function clockLabel(clock) {
    const minute = minuteOfDay(clock);
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
  }
  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function sunlight(clock) {
    const angle = 2 * Math.PI * (clock.tick / DAY - 0.25);
    const height = Math.sin(angle);
    return [smooth((height + 0.13) / 0.32), 1 - smooth(Math.abs(height) / 0.28), Math.cos(angle), height];
  }
  const api = { shifts, SECONDS_PER_MINUTE: TICKS_PER_MINUTE / 60, createClock, nextShift, advance, minuteOfDay, clockLabel, sunlight };
  if (node) module.exports = api;
  else Nightline.daylight = api;
})();
