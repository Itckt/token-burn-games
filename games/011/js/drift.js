(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const EYE_LIMIT_KM = 1;
  const inward = Math.sin(field.INFLOW), twist = 1 / Math.tan(field.INFLOW);

  function release(state, point) {
    if (!field.inRange(point)) throw new RangeError("Release the parcel within the instrument range");
    return { x: point.x, z: point.z, time: state.time, signal: state.signal,
      wind: storm.readings(state.strength, state.time).wind,
      wallKm: field.WALL_RADIUS * storm.radialScale(state.strength) * field.KM_PER_UNIT };
  }

  // Integrate the radial component of the measured wind. Outside the
  // eyewall the speed follows a power law. Inside it decays linearly.
  function trace(launch, minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("Drift duration must be finite and nonnegative");
    const startKm = Math.hypot(launch.x, launch.z) * field.KM_PER_UNIT;
    const wall = launch.wallKm, speed = launch.wind * inward;
    const exponent = 1 + field.WIND_DECAY;
    const outerHours = startKm > wall ? wall * Math.expm1(exponent * Math.log(startKm / wall)) / (exponent * speed) : 0;
    const innerStart = Math.min(startKm, wall);
    const slope = (1 - field.EYE_WIND) / wall, offset = field.EYE_WIND / slope;
    const innerHours = Math.max(0, Math.log((innerStart + offset) / (EYE_LIMIT_KM + offset)) / (speed * slope));
    const stopHours = outerHours + innerHours;
    const hours = Math.min(minutes / 60, stopHours);
    let endKm = startKm;
    if (hours > 0 && hours >= stopHours) {
      endKm = EYE_LIMIT_KM;
    } else if (hours > 0 && hours <= outerHours) {
      endKm = wall * Math.pow(1 + (outerHours - hours) * exponent * speed / wall, 1 / exponent);
    } else if (hours > 0) {
      endKm = innerStart + (innerStart + offset) * Math.expm1(-speed * slope * (hours - outerHours));
    }
    const turn = hours ? twist * Math.log(endKm / startKm) : 0;
    const scale = startKm ? endKm / startKm : 1;
    const c = Math.cos(turn), s = Math.sin(turn);
    return { launch, minutes, elapsed: hours * 60, reachedEye: hours >= stopHours,
      distanceKm: (startKm - endKm) / inward, endKm,
      end: { x: scale * (c * launch.x - s * launch.z), z: scale * (s * launch.x + c * launch.z) } };
  }

  const api = { EYE_LIMIT_KM, release, trace };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).drift = api;
})(globalThis);
