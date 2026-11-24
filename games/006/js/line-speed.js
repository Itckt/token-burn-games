(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { mod } = node ? require('./math.js') : Nightline.math;
  const { STATIONS, CHUNK, LENGTH, routeLeg } = node ? require('./route.js') : Nightline.route;
  const MAX_KMH = 80;
  // Entry and release boards are measured from the departure berth in metres.
  const zones = [
    { name: 'College curve', entry: 148, release: 276, kmh: 40 },
    { name: 'Junction bend', entry: 164, release: 292, kmh: 45 },
    { name: 'Market curve', entry: 196, release: 356, kmh: 50 },
    { name: 'Foothill curve', entry: 180, release: 324, kmh: 35 },
    { name: 'Depot bend', entry: 180, release: 340, kmh: 45 }
  ];
  const boards = new Map();
  for (const [leg, zone] of zones.entries()) {
    zone.entry += STATIONS[leg].at;
    zone.release += STATIONS[leg].at;
    for (const [at, kmh] of [[zone.entry, zone.kmh], [zone.release, MAX_KMH]]) {
      boards.set(Math.floor(at / CHUNK), Object.freeze({ at, kmh }));
    }
    Object.freeze(zone);
  }
  Object.freeze(zones);

  function boardInChunk(index) { return boards.get(mod(index, LENGTH / CHUNK)); }
  function allowance(leg, signalled) {
    const zone = zones[leg];
    // A train restarting at a stop signal already takes much of the curve below line speed.
    const extra = (zone.release - zone.entry) * 3.6 * (1 / zone.kmh - 1 / MAX_KMH);
    return Math.round(extra * (signalled ? 0.4 : 1));
  }
  function postedAt(position) {
    const at = mod(position, LENGTH), zone = zones[routeLeg(at)];
    return at >= zone.entry && at < zone.release ? zone.kmh : MAX_KMH;
  }

  // A trapezoidal tick followed by constant braking must reach the board at
  // or below its posted speed. A zero-speed board is a station or red signal.
  function brakingLimit(distance, previous, brake, dt, boardSpeed = 0) {
    const half = brake * dt * 0.5;
    const squared = boardSpeed * boardSpeed + half * half + brake * (2 * distance - dt * previous);
    return Math.max(boardSpeed, previous - brake * dt, Math.sqrt(Math.max(0, squared)) - half);
  }

  function speedLimit(position, previous, brake, dt) {
    const at = mod(position, LENGTH), zone = zones[routeLeg(at)];
    if (at >= zone.release) return Infinity;
    return brakingLimit(Math.max(0, zone.entry - at), previous, brake, dt, zone.kmh / 3.6);
  }

  function indication(position) {
    const at = mod(position, LENGTH), zone = zones[routeLeg(at)];
    if (at < zone.entry) return zone.kmh + ' km/h in ' + Math.ceil(zone.entry - at) + ' m';
    if (at < zone.release) return zone.name + ' · ' + MAX_KMH + ' km/h in ' + Math.ceil(zone.release - at) + ' m';
    return 'Line speed restored';
  }

  const api = { MAX_KMH, zones, boardInChunk, postedAt, brakingLimit, speedLimit, indication, allowance };
  if (node) module.exports = api;
  else Nightline.lineSpeed = api;
})();
