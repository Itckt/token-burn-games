(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { legLength } = node ? require('./route.js') : Nightline.route;
  const { clockLabel, markLabel, MARK_TOLERANCE } = node ? require('./service.js') : Nightline.service;
  const cards = Object.freeze({ free: 'Free running', coast: 'Coasting',
    smooth: 'Steady carriage', mark: 'Precision stop' });
  const BRAKE_LIMIT = 1.6, SIDE_LIMIT = 0.85, LATE_MARGIN = 10;
  const coastGoal = from => Math.ceil(legLength(from) / 4);

  function brief(card, from, booked) {
    if (card === 'coast') return 'Coast for ' + coastGoal(from) + ' m with traction off and arrive by ' +
      clockLabel(booked + LATE_MARGIN) + ' elapsed.';
    if (card === 'smooth') return 'Keep peak braking at or below ' + BRAKE_LIMIT.toFixed(2) +
      ' m/s² and sideways acceleration at or below ' + SIDE_LIMIT + ' m/s².';
    if (card === 'mark') return 'Use M for manual stops. Bring the train to rest within ' +
      MARK_TOLERANCE + ' m of the S board.';
    return 'Choose a duty at a station to score the next leg.';
  }
  function forces(log) {
    return 'Peak brake ' + log.peakBrake.toFixed(2) + ' m/s² · sideways ' + log.peakSide.toFixed(2) + ' m/s²';
  }
  function coastReading(log, seconds) {
    return Math.floor(log.coastMetres + 1e-8) + ' m coasted · ' + clockLabel(seconds) + ' elapsed';
  }
  function result(card, entry) {
    const { quality, seconds, booked, from, error, atLimit } = entry;
    if (!quality || card === 'free') return null;
    let passed, detail;
    switch (card) {
      case 'coast':
        passed = quality.coastMetres + 1e-8 >= coastGoal(from) && seconds <= booked + LATE_MARGIN;
        detail = coastReading(quality, seconds); break;
      case 'smooth':
        // Judge the same hundredths that a driver can read on the instrument.
        passed = Number(quality.peakBrake.toFixed(2)) <= BRAKE_LIMIT &&
          Number(quality.peakSide.toFixed(2)) <= SIDE_LIMIT;
        detail = forces(quality); break;
      case 'mark':
        passed = Number.isFinite(error) && !atLimit && Math.abs(error) <= MARK_TOLERANCE;
        detail = markLabel(error, atLimit); break;
      default: return null;
    }
    return { card, passed, detail };
  }
  const api = { cards, brief, forces, coastReading, result };
  if (node) module.exports = api;
  else Nightline.duties = api;
})();
