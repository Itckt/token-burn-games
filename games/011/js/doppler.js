(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const SITES = { campus: { x: -4.5, z: 2 }, pier: { x: 4, z: 5.5 } };
  const STOPS = [
    { speed: -190, color: "#83f0de" }, { speed: -95, color: "#359799" },
    { speed: 0, color: "#23323e" }, { speed: 95, color: "#b97951" }, { speed: 190, color: "#ffe0a0" }
  ];
  const BLIND_RADIUS = 0.001; // Ten metres at this map scale.
  const site = state => state.radarSite || SITES.campus;

  // Positive radial velocity is motion away from the antenna. Only the
  // horizontal component along the beam is visible to this surface instrument.
  function velocity(point, antenna, windSpeed) {
    const dx = point.x - antenna.x, dz = point.z - antenna.z;
    const range = Math.hypot(dx, dz);
    if (range <= BLIND_RADIUS || Math.hypot(point.x, point.z) <= BLIND_RADIUS) return null;
    const flow = field.windDirection(point.x, point.z);
    return windSpeed * (flow.x * dx + flow.z * dz) / range;
  }

  function reading(value) {
    if (value === null) return "—";
    const magnitude = Math.round(Math.abs(value));
    if (!magnitude) return "0 km/h";
    return magnitude + " km/h " + (value < 0 ? "toward" : "away");
  }

  const api = { SITES, STOPS, BLIND_RADIUS, site, velocity, reading };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).doppler = api;
})(globalThis);
