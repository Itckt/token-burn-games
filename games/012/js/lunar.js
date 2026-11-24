(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { radians, add, scale, cross, normalize, basisMatrix } = dep("math");
  const { orbitAxes, eccentricAnomaly, pointOnOrbit } = dep("physics");
  const { AU_KM } = dep("observations");
  const { moon } = dep("catalog");
  const AXIS_AU = 384400 / AU_KM;
  const TRACK = 1.53;
  const e = 0.0549;
  // Unit ellipse for the reusable lunar guide. Its orientation changes with the nodes and apsides.
  const shape = Object.freeze({ a: 1, e, minorRatio: Math.sqrt(1 - e*e), peri: [1,0,0], tangent: [0,1,0] });

  function lunarOrbit(days) {
    const perihelion = (83.3531 + 0.1114035 * days) % 360;
    const node = (125.0446 - 0.0529538 * days) % 360;
    const orbit = { ...shape, ...orbitAxes(5.145, perihelion, node), a: AXIS_AU };
    const anomaly = eccentricAnomaly(radians((134.9634 + 13.064993 * days) % 360), e);
    const relative = pointOnOrbit(orbit, anomaly);
    return { orbit, relative, pole: cross(orbit.peri, orbit.tangent) };
  }

  function moonMatrix(lunar, center, radius) {
    const front = normalize(scale(lunar.relative, -1));
    return basisMatrix(center, cross(lunar.pole, front), lunar.pole, front, radius);
  }

  function moonInScene(days, earth) {
    const lunar = lunarOrbit(days), { orbit, relative, pole } = lunar;
    const position = add(earth.position, scale(relative, TRACK / AXIS_AU));
    return { position, model: moonMatrix(lunar, position, moon.radius),
      light: normalize(scale(add(earth.positionAU, relative), -1)),
      guide: basisMatrix(earth.position, orbit.peri, orbit.tangent, pole, TRACK) };
  }

  const api = { AXIS_AU, TRACK, shape, lunarOrbit, moonMatrix, moonInScene };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).lunar = api;
})(globalThis);
