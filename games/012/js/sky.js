(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { TAU, radians, clamp, wrap, add, subtract, scale, dot, cross, normalize, bisectZero } = dep("math");
  const { sun, moon, planets, byId } = dep("catalog");
  const { orbitalState, orbits } = dep("physics");
  const { lunarOrbit } = dep("lunar");
  const { AU_KM } = dep("observations");
  const { J2000, DAY_MS, MIN_DAYS, MAX_DAYS, dateAt } = dep("time");
  const sites = Object.freeze([
    { id: "kowloon", name: "Kowloon Tong", latitude: 22.34, longitude: 114.18, hours: 8 },
    { id: "cape", name: "Cape Town", latitude: -33.92, longitude: 18.42, hours: 2 },
    { id: "dome", name: "Dome A, Antarctica", latitude: -80.37, longitude: 77.35, hours: 0 }
  ].map(Object.freeze));
  const targets = Object.freeze([moon, sun, ...planets.filter(body => body.id !== "earth")]);
  const obliquity = radians(23.43929), cosTilt = Math.cos(obliquity), sinTilt = Math.sin(obliquity);
  const degrees = angle => angle * 180 / Math.PI;
  // Convert conventional equatorial XYZ to the atlas's Y-up ecliptic coordinates.
  const equatorial = (x, y, z) => [x, z * cosTilt - y * sinTilt, -y * cosTilt - z * sinTilt];
  const celestialNorth = equatorial(0, 0, 1);

  function observerAt(days, site) {
    const sidereal = radians(280.46061837 + site.longitude)
      + TAU * ((days % 1) + (0.00273790935 * days) % 1);
    const c = Math.cos(sidereal), s = Math.sin(sidereal);
    const lat = radians(site.latitude), cl = Math.cos(lat), sl = Math.sin(lat);
    const up = equatorial(cl*c, cl*s, sl);
    const offset = scale(up, byId.earth.diameter / (2 * AU_KM));
    const earth = orbitalState(orbits.earth, days).position;
    return { days, earth, offset, up, east: equatorial(-s, c, 0), north: equatorial(-sl*c, -sl*s, cl),
      toSun: normalize(scale(add(earth, offset), -1)) };
  }

  function sightline(id, observer) {
    const { days, earth, offset } = observer;
    let lunar, position, relative;
    if (id === "moon") {
      lunar = lunarOrbit(days);
      relative = lunar.relative;
      position = add(earth, relative);
    } else {
      if (id !== "sun" && (id === "earth" || !Object.hasOwn(orbits, id))) {
        throw new RangeError("Choose a target visible from Earth");
      }
      position = id === "sun" ? [0,0,0] : orbitalState(orbits[id], days).position;
      relative = subtract(position, earth);
    }
    return { ray: subtract(relative, offset), position, lunar };
  }

  function horizontal(ray, observer) {
    const east = dot(ray, observer.east), north = dot(ray, observer.north), up = dot(ray, observer.up);
    const level = Math.hypot(east, north);
    return { altitude: Math.atan2(up, level), azimuth: wrap(Math.atan2(east, north)), east };
  }

  function lunarPhase(fraction, relative, earth) {
    if (fraction >= 0.99) return "Near full Moon";
    if (fraction <= 0.01) return "Near new Moon";
    const waxing = cross(scale(earth, -1), relative)[1] > 0;
    if (Math.abs(fraction - 0.5) <= 0.015) return waxing ? "Near first quarter" : "Near last quarter";
    return (waxing ? "Waxing " : "Waning ") + (fraction < 0.5 ? "crescent" : "gibbous");
  }

  function observe(id, observer) {
    const { ray, position, lunar } = sightline(id, observer);
    const distance = Math.hypot(...ray), direction = scale(ray, 1 / distance);
    const eye = scale(direction, -1), light = normalize(scale(position, -1));
    const illuminated = id === "sun" ? null : clamp((1 + dot(eye, light)) / 2, 0, 1);
    const elongation = id === "sun" ? 0 : Math.acos(clamp(dot(direction, observer.toSun), -1, 1));
    const diameter = 2 * Math.asin(byId[id].diameter / (2 * AU_KM * distance));
    const phaseName = lunar ? lunarPhase(illuminated, lunar.relative, observer.earth) : "";
    return { ...horizontal(ray, observer), eye, light, lunar, distance, illuminated, phaseName, elongation, diameter };
  }

  // Looking up, east is on the left. Equal radial steps correspond to equal altitude steps.
  function chartPoint(altitude, azimuth) {
    if (altitude < -1e-7) return null;
    const radius = clamp(1 - 2 * altitude / Math.PI, 0, 1);
    return { x: -radius * Math.sin(azimuth), y: -radius * Math.cos(azimuth) };
  }

  const localDate = (days, site) => new Date(dateAt(days).valueOf() + site.hours * DAY_MS / 24);
  function dayWindow(days, site) {
    const localMidnight = Math.floor(localDate(days, site).valueOf() / DAY_MS) * DAY_MS;
    const midnight = (localMidnight - site.hours * DAY_MS / 24 - J2000) / DAY_MS;
    const start = Math.max(MIN_DAYS, midnight), end = Math.min(MAX_DAYS, midnight + 1);
    return { midnight, start, end, firstMinute: Math.round((start - midnight) * 1440),
      lastMinute: Math.min(1439, Math.floor((end - midnight) * 1440)) };
  }

  // Split at refined altitude extrema as well as regular samples. A short polar rise can
  // start and finish between adjacent quarter hours with both sample altitudes negative.
  function extremum(sample, a, b, sign) {
    for (let i = 0; i < 40; i++) {
      const third = (b - a) / 3, left = a + third, right = b - third;
      if (sign * sample(left).altitude < sign * sample(right).altitude) a = left;
      else b = right;
    }
    return (a + b) / 2;
  }

  function dayPlan(id, site, span) {
    const cache = new Map();
    function sample(day) {
      if (!cache.has(day)) {
        const observer = observerAt(day, site);
        cache.set(day, horizontal(sightline(id, observer).ray, observer));
      }
      return cache.get(day);
    }
    const steps = 96, step = (span.end - span.start) / steps;
    const curve = Array.from({ length: steps + 1 }, (_, i) => {
      const day = i === steps ? span.end : span.start + i * step;
      return { day, altitude: sample(day).altitude };
    });
    const times = curve.map(p => p.day);
    for (const point of curve) {
      const before = sample(point.day - step).altitude, after = sample(point.day + step).altitude;
      const peak = point.altitude > before && point.altitude >= after;
      if (peak || (point.altitude < before && point.altitude <= after)) {
        const day = extremum(sample, point.day - step, point.day + step, peak ? 1 : -1);
        if (day > span.start && day < span.end) times.push(day);
      }
    }
    times.sort((a, b) => a - b);
    const events = [];
    function record(kind, field, a, b) {
      const day = bisectZero(day => sample(day)[field], a, b);
      if (day < span.midnight + 1) events.push({ kind, day, ...sample(day) });
    }
    for (let i = 1; i < times.length; i++) {
      const a = times[i - 1], b = times[i], left = sample(a), right = sample(b);
      if (left.altitude <= 0 && right.altitude > 0) record("Rise", "altitude", a, b);
      if (left.altitude >= 0 && right.altitude < 0) record("Set", "altitude", a, b);
      // East crosses from positive to negative at the upper meridian, in either hemisphere.
      if (left.east >= 0 && right.east < 0) record("Transit", "east", a, b);
    }
    events.sort((a, b) => a.day - b.day);
    const knots = [...new Set([...times, ...events.map(event => event.day)])].sort((a, b) => a - b);
    return { curve: knots.map(day => ({ day, altitude: sample(day).altitude })), events };
  }

  const api = { sites, targets, degrees, celestialNorth, observerAt, horizontal, observe, chartPoint,
    localDate, dayWindow, dayPlan };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).sky = api;
})(globalThis);
