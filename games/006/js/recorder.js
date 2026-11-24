(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const lineSpeed = node ? require('./line-speed.js') : Nightline.lineSpeed;
  const MAX_SAMPLES = 256, FIRST_INTERVAL = 30; // Fixed 60 Hz ticks.

  function sample(s, tick, origin) {
    const point = { tick, metres: s.position - origin, speed: s.speed * 3.6,
      target: s.target, power: s.meter.power };
    if (s.limits) point.limit = lineSpeed.postedAt(s.position);
    return point;
  }
  function begin(s) {
    return { origin: s.position, tick: 0, interval: FIRST_INTERVAL, samples: [sample(s, 0, s.position)] };
  }
  function advance(log, s, arrival = false) {
    log.tick++;
    if (!arrival && log.tick % log.interval !== 0) return;
    if (log.samples.length >= MAX_SAMPLES) {
      // Keep departure and a uniform time axis even on a leg with a very long wait.
      log.interval *= 2;
      log.samples = log.samples.filter(point => point.tick % log.interval === 0);
    }
    if (arrival || log.tick % log.interval === 0) log.samples.push(sample(s, log.tick, log.origin));
    return log.samples;
  }
  const api = { MAX_SAMPLES, begin, advance };
  if (node) module.exports = api;
  else Nightline.recorder = api;
})();
