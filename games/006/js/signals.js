(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { mod } = node ? require('./math.js') : Nightline.math;
  const { STATIONS, LENGTH, CHUNK, legLength } = node ? require('./route.js') : Nightline.route;
  const CLEAR = 0, CAUTION = 1, STOP = 2;
  const SETBACK = 10; // Distance from the driver's eye to the mast at a signal stop.
  const markers = new Map();
  const blocks = STATIONS.map((station, leg) => {
    const length = legLength(leg);
    const home = station.at + CHUNK * Math.floor(length / (2 * CHUNK)) + CHUNK / 2;
    const distant = home - 8 * CHUNK;
    for (const at of [distant, home]) {
      markers.set(Math.floor(at / CHUNK), Object.freeze({ at, leg, distant: at === distant }));
    }
    return { home, distant, clearAfter: 8 + length / CHUNK };
  });

  function markerInChunk(index) { return markers.get(mod(index, LENGTH / CHUNK)) || null; }
  function booked(leg, enabled) { return STATIONS[leg].booked + (enabled ? 22 : 0); }

  function secondsToClear(s) {
    if (!s.signalled) return 0;
    const elapsed = s.sheet.departedAt === null ? 0 : s.time - s.sheet.departedAt;
    const left = blocks[s.last].clearAfter - elapsed;
    return left > 1e-8 ? left : 0;
  }
  function homeMark(s) {
    return s.nextMark - legLength(s.last) + blocks[s.last].home - STATIONS[s.last].at;
  }
  function stopDistance(s) {
    return secondsToClear(s) ? Math.max(0, homeMark(s) - SETBACK - s.position) : Infinity;
  }
  function aspect(s, marker, absoluteAt) {
    if (marker.leg !== s.last || !secondsToClear(s)) return CLEAR;
    const expected = homeMark(s) + marker.at - blocks[s.last].home;
    return expected === absoluteAt ? (marker.distant ? CAUTION : STOP) : CLEAR;
  }
  function indication(s) {
    if (!s.signalled) return null;
    const distance = homeMark(s) - s.position;
    if (distance < 0) return null;
    const left = secondsToClear(s);
    if (!left) return { aspect: CLEAR, text: 'Clear · proceed' };
    if (distance <= SETBACK + 0.01 && s.speed === 0) {
      return { aspect: STOP, text: 'Signal hold · clears in ' + Math.ceil(left) + ' s' };
    }
    const distant = distance > blocks[s.last].home - blocks[s.last].distant;
    return { aspect: distant ? CAUTION : STOP,
      text: (distant ? 'Caution · stop signal in ' : 'Stop signal · ') + Math.round(distance) + ' m' };
  }

  const api = { CLEAR, CAUTION, STOP, SETBACK, booked, markerInChunk, secondsToClear, homeMark,
    stopDistance, aspect, indication };
  if (node) module.exports = api;
  else Nightline.signals = api;
})();
