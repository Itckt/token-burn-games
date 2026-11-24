(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, clamp, mix } = common ? require("./math.js") : root.Isobar.math;
  const DAY = 1440, DEFAULT_MINUTES = 15 * 60;
  // Each row contains the unlit cloud, sunlit cloud, open water and rain colours.
  const NIGHT = [[0.085, 0.13, 0.23], [0.59, 0.73, 0.88], [0.041, 0.082, 0.14], [0.39, 0.55, 0.74]];
  const TWILIGHT = [[0.24, 0.21, 0.33], [1, 0.78, 0.58], [0.16, 0.16, 0.21], [0.82, 0.67, 0.64]];
  const DAYLIGHT = [[0.207, 0.30, 0.383], [0.932, 0.95, 0.935], [0.083, 0.155, 0.188], [0.47, 0.73, 0.84]];

  function smooth(low, high, value) {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function at(minutes) {
    if (!Number.isFinite(minutes)) minutes = DEFAULT_MINUTES;
    const time = ((minutes % DAY) + DAY) % DAY;
    const angle = TAU * (time / DAY - 0.5);
    // Idealized arc: sunrise in the east, noon to the south (+Z).
    const noon = Math.cos(angle), elevation = 0.92 * noon;
    const sun = [-Math.sin(angle), elevation, Math.sqrt(1 - 0.92 ** 2) * noon];
    const moonlit = elevation < 0;
    const direction = moonlit ? sun.map(component => -component) : sun;
    // Fade directional light to zero at the handover to the opposite light.
    const contrast = moonlit ? 0.32 * smooth(0, 0.22, -elevation) : 0.47 * smooth(0, 0.19, elevation);
    const incident = direction.map(component => component * contrast);
    const dusk = smooth(-0.28, 0, elevation), day = smooth(0.02, 0.54, elevation);
    const [shadow, lit, water, rain] = NIGHT.map((rgb, i) => rgb.map((v, c) =>
      mix(mix(v, TWILIGHT[i][c], dusk), DAYLIGHT[i][c], day)));
    const period = elevation < -0.22 ? "Night" : elevation > 0.4 ? "Daylight" : time < DAY / 2 ? "Dawn" : "Dusk";
    return { direction, incident, contrast, shadow, lit, water, rain, period };
  }

  function clock(minutes) {
    return [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, "0")).join(":");
  }

  const api = { DAY, DEFAULT_MINUTES, at, clock };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).lighting = api;
})(globalThis);
