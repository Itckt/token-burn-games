(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const KM_PER_UNIT = 10, RANGE = 12, MAP_EXTENT = 13;
  const BANDS = [
    { rate: 1, color: "#477e9a" }, { rate: 5, color: "#4aa9af" },
    { rate: 15, color: "#91c79c" }, { rate: 30, color: "#e6ce78" },
    { rate: 50, color: "#ef975f" }, { rate: 75, color: "#df7488" }
  ];
  const WIND_STOPS = [
    { speed: 0, color: "#132c40" }, { speed: 40, color: "#205766" },
    { speed: 80, color: "#3e918a" }, { speed: 120, color: "#a6b97b" },
    { speed: 160, color: "#d9a16e" }, { speed: 190, color: "#cf7569" }
  ];
  const METRICS = {
    wind: { label: "Wind", unit: "km/h", min: 0, max: 200, digits: 0, color: "#c5ef83" },
    rain: { label: "Rain", unit: "mm/h", min: 0, max: 90, digits: 1, color: "#89c9dc" },
    pressure: { label: "Pressure", unit: "hPa", min: 910, max: 1020, digits: 0, color: "#c4aedc" }
  };
  const WALL_RADIUS = 2.06, EYE_WIND = 0.06, WIND_DECAY = 0.65;
  const INFLOW = 18 * Math.PI / 180;
  const AMBIENT_PRESSURE = 1012, PRESSURE_RADIUS = 4.5, PRESSURE_EXPONENT = 1.6;

  function windFraction(radius) {
    if (radius <= WALL_RADIUS) return math.mix(EYE_WIND, 1, radius / WALL_RADIUS);
    return Math.pow(WALL_RADIUS / radius, WIND_DECAY);
  }

  function inRange(point) {
    return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.z) &&
      Math.hypot(point.x, point.z) <= RANGE + 1e-6);
  }

  function bearing(x, z) {
    if (Math.hypot(x, z) < 1e-8) return null;
    return (Math.atan2(x, -z) * 180 / Math.PI + 360) % 360;
  }

  // Positive X is east and negative Z is north. The tangential component
  // follows the clouds counterclockwise, with an 18-degree inward component.
  function windDirection(x, z) {
    const radius = Math.hypot(x, z);
    if (radius < 1e-8) return null;
    return { x: (z * Math.cos(INFLOW) - x * Math.sin(INFLOW)) / radius,
      z: (-x * Math.cos(INFLOW) - z * Math.sin(INFLOW)) / radius };
  }

  // Rain echoes in the storm's reference frame. The optical particles and
  // the echoes use the same three arm centres, twist and radial contraction.
  function echoDensity(x, z) {
    const r = Math.hypot(x, z);
    if (r < 0.9 || r >= MAP_EXTENT) return 0;
    const angle = Math.atan2(z, x);
    const wallRadius = WALL_RADIUS + 0.14 * Math.sin(3 * angle);
    let echo = Math.exp(-Math.pow((r - wallRadius) / 0.64, 2));
    for (let arm = 0; arm < storm.ARM_REACH.length; arm++) {
      const delta = angle - storm.armAngle(r, arm);
      const across = r * Math.atan2(Math.sin(delta), Math.cos(delta));
      const width = 0.6 + 0.07 * r;
      const core = Math.exp(-Math.pow(across / width, 2));
      const feeder = 0.38 * Math.exp(-Math.pow((across - 0.39 * r) / width, 2));
      const tail = math.clamp((storm.ARM_REACH[arm] - r) / 2.2, 0, 1);
      echo = Math.max(echo, tail * (core + feeder) / (1 + 0.026 * r));
    }
    const cells = 0.88 + 0.12 * Math.sin(2.9 * x + 1.7 * z) * Math.cos(2.2 * z - 0.6 * x);
    return math.clamp(echo * cells * math.clamp((r - 0.9) / 0.62, 0, 1), 0, 1);
  }

  let cachedMap;
  function echoMap() {
    if (cachedMap) return cachedMap;
    const size = 256, data = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
      const z = ((row + 0.5) / size * 2 - 1) * MAP_EXTENT;
      for (let col = 0; col < size; col++) {
        const x = ((col + 0.5) / size * 2 - 1) * MAP_EXTENT;
        const offset = 4 * (row * size + col);
        const value = Math.round(echoDensity(x, z) * 255);
        data[offset] = data[offset + 1] = data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
    cachedMap = { width: size, height: size, data };
    return cachedMap;
  }

  // Match WebGL LINEAR filtering, including the half-texel offset and edges.
  function sampleMap(map, x, z) {
    const u = math.clamp((0.5 + x / (2 * MAP_EXTENT)) * map.width - 0.5, 0, map.width - 1);
    const v = math.clamp((0.5 + z / (2 * MAP_EXTENT)) * map.height - 0.5, 0, map.height - 1);
    const left = Math.floor(u), bottom = Math.floor(v);
    const right = Math.min(left + 1, map.width - 1), top = Math.min(bottom + 1, map.height - 1);
    const texel = (col, row) => map.data[4 * (row * map.width + col)] / 255;
    return math.mix(math.mix(texel(left, bottom), texel(right, bottom), u - left),
      math.mix(texel(left, top), texel(right, top), u - left), v - bottom);
  }

  function preset(name, state) {
    if (name === "eye") return { x: 0, z: 0 };
    const outer = name === "band";
    const r = outer ? 7.2 : WALL_RADIUS;
    const angle = (outer ? storm.armAngle(r, 0) : -0.7) + storm.bandTurn(r, state.phase, state.strength);
    const radius = r * storm.radialScale(state.strength);
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  }

  function echoAt(state, point, r, scale) {
    if (r === 0) return 0;
    const angle = -storm.bandTurn(r, state.phase, state.strength);
    const c = Math.cos(angle), s = Math.sin(angle);
    return sampleMap(echoMap(), (c * point.x - s * point.z) / scale, (s * point.x + c * point.z) / scale);
  }

  function pressureAt(radius, central) {
    return math.mix(central, AMBIENT_PRESSURE, -Math.expm1(-Math.pow(radius / PRESSURE_RADIUS, PRESSURE_EXPONENT)));
  }

  function sampleMetric(state, point, metric, current) {
    const scale = storm.radialScale(state.strength), r = Math.hypot(point.x, point.z) / scale;
    switch (metric) {
      case "wind": return current.wind * windFraction(r);
      case "rain": return current.rain * echoAt(state, point, r, scale);
      case "pressure": return pressureAt(r, current.pressure);
      default: throw new RangeError("Unknown surface metric");
    }
  }

  function sample(state, point, stormReadings = storm.readings(state.strength, state.time)) {
    const distance = Math.hypot(point.x, point.z), scale = storm.radialScale(state.strength);
    const r = distance / scale, echo = echoAt(state, point, r, scale);
    const direction = windDirection(point.x, point.z);
    return {
      wind: stormReadings.wind * windFraction(r), rain: stormReadings.rain * echo,
      pressure: pressureAt(r, stormReadings.pressure),
      km: distance * KM_PER_UNIT,
      bearing: bearing(point.x, point.z),
      flowBearing: direction && bearing(direction.x, direction.z),
      zone: r < 1.2 ? "Eye" : r < 3 ? "Eyewall" : echo >= 0.2 ? "Rainband" : "Between bands"
    };
  }

  const api = { KM_PER_UNIT, RANGE, MAP_EXTENT, BANDS, WIND_STOPS, METRICS, WALL_RADIUS, EYE_WIND, WIND_DECAY,
    INFLOW, AMBIENT_PRESSURE, PRESSURE_RADIUS, PRESSURE_EXPONENT, pressureAt,
    inRange, windFraction, windDirection, bearing, echoMap, sampleMap, preset, sampleMetric, sample };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).field = api;
})(globalThis);
