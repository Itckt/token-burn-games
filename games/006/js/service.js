(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { STATIONS, nextStation } = node ? require('./route.js') : Nightline.route;
  const MARK_TOLERANCE = 1;

  function createSheet() { return { departedAt: null, count: 0, entries: [] }; }

  function recordArrival(sheet, from, time, error, atLimit, meter,
    { booked = STATIONS[from].booked, trace = [], arrivalClock = null, quality = null } = {}) {
    const seconds = Math.round(time - sheet.departedAt);
    const entry = { number: sheet.count + 1, from, to: nextStation(from), seconds, booked, error, atLimit, trace, arrivalClock,
      drawn: meter?.drawn ?? 0, returned: meter?.returned ?? 0, quality: quality && { ...quality } };
    sheet.entries.unshift(entry);
    if (sheet.entries.length > STATIONS.length) sheet.entries.pop();
    sheet.count++;
    sheet.departedAt = null;
    return entry;
  }

  function clockLabel(seconds) {
    const whole = Math.max(0, Math.floor(seconds + 1e-8));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  function timingLabel(seconds, booked) {
    const difference = seconds - booked;
    if (Math.abs(difference) <= 5) return 'On time';
    return Math.abs(difference) + ' s ' + (difference < 0 ? 'early' : 'late');
  }

  function markLabel(error, atLimit) {
    if (error === null) return 'Automatic';
    if (Math.abs(error) < 0.05) return 'On mark';
    const metres = Math.abs(error), digits = metres.toFixed(1);
    const boundary = metres > MARK_TOLERANCE && Number(digits) === MARK_TOLERANCE;
    const offset = (boundary ? 'Just over ' : '') + digits + ' m ' + (error < 0 ? 'short' : 'long');
    if (atLimit) return 'Limit · ' + offset;
    return Math.abs(error) <= MARK_TOLERANCE ? 'On mark · ' + offset : offset;
  }

  const api = { MARK_TOLERANCE, createSheet, recordArrival, clockLabel, timingLabel, markLabel };
  if (node) module.exports = api;
  else Nightline.service = api;
})();
