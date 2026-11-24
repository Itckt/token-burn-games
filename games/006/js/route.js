(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { mod } = node ? require('./math.js') : Nightline.math;
  const LENGTH = 2352, CHUNK = 16, STATION_BACK = 64, STATION_FRONT = 48;
  // The running allowance belongs to the leg departing this station.
  const STATIONS = Object.freeze([
    { name: 'Kowloon Tong', chinese: '九龍塘', at: 0, booked: 42, tile: [0.16, 0.45, 0.40] },
    { name: 'Campus Gate', chinese: '校園站', at: 432, booked: 42, tile: [0.24, 0.42, 0.52] },
    { name: 'Junction Road', chinese: '聯合道', at: 864, booked: 47, tile: [0.51, 0.31, 0.23] },
    { name: 'Lok Fu', chinese: '樂富', at: 1392, booked: 45, tile: [0.39, 0.42, 0.26] },
    { name: 'Lion Rock', chinese: '獅子山', at: 1872, booked: 45, tile: [0.39, 0.33, 0.49] }
  ].map(s => Object.freeze({ ...s, tile: Object.freeze(s.tile) })));
  const VIADUCTS = Object.freeze([
    Object.freeze({ name: 'College Viaduct', start: 80, end: 320 }),
    Object.freeze({ name: 'Foothill Viaduct', start: 1488, end: 1744 })
  ]);

  function nextStation(i) { return (i + 1) % STATIONS.length; }
  function legLength(i) { return mod(STATIONS[nextStation(i)].at - STATIONS[i].at, LENGTH); }

  function routeLeg(s) {
    const at = mod(s, LENGTH);
    for (let i = STATIONS.length - 1; i >= 0; i--) if (at >= STATIONS[i].at) return i;
    return 0;
  }

  function stationAt(s) {
    const at = mod(s, LENGTH);
    for (let i = 0; i < STATIONS.length; i++) {
      const delta = mod(at - STATIONS[i].at + STATION_BACK, LENGTH) - STATION_BACK;
      if (delta < STATION_FRONT) return i;
    }
    return -1;
  }

  function viaductAt(s) {
    const at = mod(s, LENGTH);
    return VIADUCTS.find(span => at >= span.start && at < span.end) || null;
  }

  function locationName(s) {
    const station = stationAt(s);
    return station >= 0 ? STATIONS[station].name : viaductAt(s)?.name || 'Running tunnel';
  }

  // The windows pick up daylight over the twelve metres on either side of a portal.
  function openAir(s) {
    const at = mod(s, LENGTH);
    for (const span of VIADUCTS) {
      const inside = Math.min(at - span.start, span.end - at);
      if (inside > -12) {
        const t = Math.min(1, (inside + 12) / 24);
        return t * t * (3 - 2 * t);
      }
    }
    return 0;
  }

  const bends = STATIONS.map((station, leg) => {
    const start = station.at + STATION_FRONT, end = station.at + legLength(leg) - STATION_BACK;
    return { start, end, k: Math.PI / (end - start), amplitude: (leg % 2 ? -1 : 1) * (17 + 3 * leg) };
  });
  function trackOffset(s) {
    const at = mod(s, LENGTH), bend = bends[routeLeg(at)];
    if (at <= bend.start || at >= bend.end) return 0;
    const arch = Math.sin(bend.k * (at - bend.start));
    return bend.amplitude * arch * arch * arch;
  }

  function trackSlope(s) { return (trackOffset(s + 0.05) - trackOffset(s - 0.05)) / 0.10; }

  // Signed curvature of the same centreline used to bend the rail meshes.
  function trackCurvature(s) {
    const at = mod(s, LENGTH), { start, end, k, amplitude } = bends[routeLeg(at)];
    if (at <= start || at >= end) return 0;
    const sin = Math.sin(k * (at - start)), cos = Math.cos(k * (at - start));
    const slope = 3 * amplitude * k * sin * sin * cos;
    const second = 3 * amplitude * k * k * sin * (2 * cos * cos - sin * sin);
    return second / Math.pow(1 + slope * slope, 1.5);
  }

  const api = { LENGTH, CHUNK, STATION_BACK, STATION_FRONT, STATIONS, VIADUCTS,
    nextStation, legLength, routeLeg, stationAt, viaductAt, locationName, openAir, trackOffset, trackSlope, trackCurvature };
  if (node) module.exports = api;
  else Nightline.route = api;
})();
