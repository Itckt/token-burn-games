(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, subtract, dot } = common ? require("./math.js") : root.OrbitAtlas.math;
  const AU_KM = 149597870.7;
  const LIGHT_KM_S = 299792.458;
  const AU_DAY_TO_KM_S = AU_KM / 86400;
  const APSIDES = Object.freeze({ perihelion: 0, aphelion: Math.PI });
  const SWEEP_FRACTION = 1 / 12;

  // Index complete revolutions from an occurrence near J2000. Snap numerical
  // noise at an exact event so visiting it twice advances a whole revolution.
  function apsisDay(orbit, days, kind, direction = 1) {
    if (!Object.hasOwn(APSIDES, kind) || !Number.isFinite(days) || (direction !== 1 && direction !== -1)) {
      throw new RangeError("Expected a date, an apsis and a playback direction");
    }
    const origin = (APSIDES[kind] - orbit.m0) / TAU * orbit.period;
    let turns = (days - origin) / orbit.period;
    const nearest = Math.round(turns);
    if (Math.abs(turns - nearest) <= 4 * Number.EPSILON * Math.max(1, Math.abs(turns))) turns = nearest;
    const count = direction === 1 ? Math.floor(turns) + 1 : Math.ceil(turns) - 1;
    return origin + count * orbit.period;
  }

  function signalRange(from, to) {
    const baseline = subtract(to.positionAU, from.positionAU);
    const au = Math.hypot(...baseline);
    const relativeVelocity = subtract(to.velocity, from.velocity);
    const rate = au === 0 ? 0 : dot(baseline, relativeVelocity) / au;
    return { au, lightSeconds: au * AU_KM / LIGHT_KM_S, rateKmS: rate * AU_DAY_TO_KM_S };
  }

  const api = { AU_KM, LIGHT_KM_S, AU_DAY_TO_KM_S, APSIDES, SWEEP_FRACTION, apsisDay, signalRange };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).observations = api;
})(globalThis);
