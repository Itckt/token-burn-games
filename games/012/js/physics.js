(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, wrap, radians, scale } = common ? require("./math.js") : root.OrbitAtlas.math;
  const { planets, bodies, byId } = common ? require("./catalog.js") : root.OrbitAtlas.catalog;
  const time = common ? require("./time.js") : root.OrbitAtlas.time;
  const YEAR_DAYS = 365.2568983;
  const MU = (TAU / YEAR_DAYS) ** 2; // AU³ / day²

  // A bracketed Newton iteration remains safe even for nearly parabolic ellipses.
  function eccentricAnomaly(mean, e) {
    if (!Number.isFinite(mean) || !(e >= 0 && e < 1)) throw new RangeError("Expected an elliptic orbit");
    const m = wrap(mean + Math.PI) - Math.PI;
    let low = -Math.PI, high = Math.PI;
    let estimate = e < 0.8 ? m : Math.sign(m) * Math.PI;
    for (let i = 0; i < 60; i++) {
      const residual = estimate - e * Math.sin(estimate) - m;
      if (Math.abs(residual) < 1e-13) break;
      if (residual > 0) high = estimate;
      else low = estimate;
      const step = estimate - residual / (1 - e * Math.cos(estimate));
      estimate = step > low && step < high ? step : (low + high) / 2;
    }
    return estimate;
  }

  function orbitAxes(inclination, perihelion, node) {
    const angle = radians(perihelion - node), i = radians(inclination), n = radians(node);
    const c = Math.cos(angle), s = Math.sin(angle);
    const ci = Math.cos(i), si = Math.sin(i), cn = Math.cos(n), sn = Math.sin(n);
    return {
      peri: [cn * c - sn * s * ci, s * si, -(sn * c + cn * s * ci)],
      tangent: [-cn * s - sn * c * ci, c * si, sn * s - cn * c * ci]
    };
  }

  function compileOrbit([a, e, inclination, longitude, perihelion, node]) {
    return { ...orbitAxes(inclination, perihelion, node), a, e, minorRatio: Math.sqrt(1 - e * e),
      m0: radians(longitude - perihelion), period: YEAR_DAYS * Math.pow(a, 1.5) };
  }

  const orbits = Object.fromEntries(planets.map(p => [p.id, compileOrbit(p.elements)]));

  function inPlane(orbit, x, y) {
    return orbit.peri.map((p, i) => p * x + orbit.tangent[i] * y);
  }

  function pointOnOrbit(orbit, anomaly, axis = orbit.a) {
    return inPlane(orbit, axis * (Math.cos(anomaly) - orbit.e),
      axis * orbit.minorRatio * Math.sin(anomaly));
  }

  function anomalyAt(orbit, days) {
    return eccentricAnomaly(orbit.m0 + (TAU / orbit.period) * (days % orbit.period), orbit.e);
  }

  function orbitalState(orbit, days) {
    const n = TAU / orbit.period;
    const anomaly = anomalyAt(orbit, days);
    const rate = n / (1 - orbit.e * Math.cos(anomaly));
    return {
      position: pointOnOrbit(orbit, anomaly),
      velocity: inPlane(orbit, -orbit.a * Math.sin(anomaly) * rate,
        orbit.a * orbit.minorRatio * Math.cos(anomaly) * rate),
      anomaly, distance: orbit.a * (1 - orbit.e * Math.cos(anomaly))
    };
  }

  function bodyStateAt(id, days) {
    if (id === "sun") return { position: [0, 0, 0], positionAU: [0, 0, 0], velocity: [0, 0, 0], distance: 0 };
    if (!Object.hasOwn(orbits, id)) throw new RangeError("Choose the Sun or a planet");
    const orbit = orbits[id], state = orbitalState(orbit, days);
    return { position: scale(state.position, byId[id].track / orbit.a),
      positionAU: state.position, velocity: state.velocity, distance: state.distance };
  }

  function systemAt(days) {
    const states = {};
    for (const body of bodies) states[body.id] = bodyStateAt(body.id, days);
    return states;
  }

  const api = { ...time, YEAR_DAYS, MU, eccentricAnomaly, orbitAxes, compileOrbit, orbits, pointOnOrbit,
    anomalyAt, orbitalState, bodyStateAt, systemAt };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).physics = api;
})(globalThis);
