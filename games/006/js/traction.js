(function () {
  'use strict';
  const EMPTY_KG = 36000, RIDER_KG = 70, JOULES_PER_KWH = 3600000;
  const DRIVE_EFFICIENCY = 0.86, RECOVERY_EFFICIENCY = 0.64;

  function createMeter() { return { drawn: 0, returned: 0, power: 0 }; }
  function resistance(speed) { return 0.055 + 0.00034 * speed * speed; }

  // Speed is in m/s. Kinetic energy plus work against rolling and air
  // resistance gives wheel work in either direction, including levelling.
  function measure(meter, riders, before, after, distance, dt, coasting) {
    const mass = EMPTY_KG + RIDER_KG * riders;
    const kinetic = 0.5 * (after - before) * (after + before);
    const work = mass * (kinetic + resistance(before) * distance);
    let lineJoules = work >= 0 ? work / DRIVE_EFFICIENCY : work * RECOVERY_EFFICIENCY;
    if (coasting) lineJoules = Math.min(0, lineJoules);
    if (Math.abs(lineJoules) < 1e-6) lineJoules = 0;
    meter.power = lineJoules / (1000 * dt);
    meter.drawn += Math.max(0, lineJoules) / JOULES_PER_KWH;
    meter.returned += Math.max(0, -lineJoules) / JOULES_PER_KWH;
  }

  const api = { createMeter, resistance, measure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Nightline.traction = api;
})();
