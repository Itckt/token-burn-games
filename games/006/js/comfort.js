(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { trackCurvature } = node ? require('./route.js') : Nightline.route;

  function createSwing() {
    return { side: 0, sideRate: 0, rear: 0, rearRate: 0 };
  }
  function createLog() { return { peakBrake: 0, peakSide: 0, coastMetres: 0 }; }
  function active(s) { return Boolean(s.side || s.rear || s.sideRate || s.rearRate); }

  // Small, damped pendulums. Positive angles move the grip right and aft.
  function tilt(s, angle, rate, acceleration, dt) {
    const target = Math.atan2(acceleration, 9.81);
    s[rate] += (60 * (target - s[angle]) - 10 * s[rate]) * dt;
    s[angle] += s[rate] * dt;
    if (!target && Math.abs(s[angle]) < 0.0003 && Math.abs(s[rate]) < 0.002) {
      s[angle] = 0; s[rate] = 0;
    }
  }
  function swing(s, forward, side, dt) {
    if (!forward && !side && !active(s)) return;
    tilt(s, 'rear', 'rearRate', forward, dt);
    tilt(s, 'side', 'sideRate', -side, dt);
  }
  function travel(ride, before, distance, dt, direction, freewheel) {
    const midpoint = ride.position - direction * distance * 0.5;
    const speed = (before + ride.speed) * 0.5, acceleration = (ride.speed - before) / dt;
    const lateral = speed ? speed * speed * trackCurvature(midpoint) : 0;
    swing(ride.swing, direction * acceleration, lateral, dt);
    const log = ride.quality;
    log.peakBrake = Math.max(log.peakBrake, -acceleration);
    log.peakSide = Math.max(log.peakSide, Math.abs(lateral));
    if (freewheel) log.coastMetres += distance;
  }
  const api = { createSwing, createLog, active, swing, travel };
  if (node) module.exports = api;
  else Nightline.comfort = api;
})();
