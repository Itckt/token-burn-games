(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const LIMIT_KM = field.RANGE * field.KM_PER_UNIT;
  const STEP_KM = 2;
  const COUNT = 2 * LIMIT_KM / STEP_KM + 1;

  // Signed distance increases along the bearing, measured clockwise from north.
  function axis(bearing) {
    const radians = bearing * Math.PI / 180;
    return { x: Math.sin(radians), z: -Math.cos(radians) };
  }

  function pointAt(direction, km) {
    return { x: direction.x * km / field.KM_PER_UNIT, z: direction.z * km / field.KM_PER_UNIT };
  }

  // The normal faces the camera so the near half is removed when orbiting.
  function nearNormal(direction, back) {
    const x = -direction.z, z = direction.x;
    const sign = x * back[0] + z * back[2] < -1e-9 ? -1 : 1;
    return { x: sign * x, z: sign * z };
  }

  function profile(state, direction, metric, values = new Float64Array(COUNT)) {
    const current = storm.readings(state.strength, state.time);
    for (let i = 0; i < COUNT; i++) {
      const point = pointAt(direction, i * STEP_KM - LIMIT_KM);
      values[i] = field.sampleMetric(state, point, metric, current);
    }
    return values;
  }

  const api = { LIMIT_KM, STEP_KM, COUNT, axis, pointAt, nearNormal, profile };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).section = api;
})(globalThis);
