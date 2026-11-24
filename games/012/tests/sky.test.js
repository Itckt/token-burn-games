"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math.js");
const { byId, moon } = require("../js/catalog.js");
const { orbitalState, orbits, systemAt } = require("../js/physics.js");
const { AU_KM } = require("../js/observations.js");
const { AXIS_AU, TRACK, shape, lunarOrbit, moonMatrix, moonInScene } = require("../js/lunar.js");
const { START_DAYS, MIN_DAYS, MAX_DAYS, parseUTCMinute, inCalendar } = require("../js/time.js");
const { sites, targets, degrees, observerAt, horizontal, observe, chartPoint, localDate, dayWindow, dayPlan } = require("../js/sky.js");
const [kowloon, cape, dome] = sites;
function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + " differs from " + expected);
}
function vectorNear(actual, expected, tolerance) {
  expected.forEach((v, i) => near(actual[i], v, tolerance));
}
const sight = (id, day, site = kowloon) => observe(id, observerAt(day, site));
const planAt = (id, day, site = kowloon) => dayPlan(id, site, dayWindow(day, site));

test("the Moon follows an inclined eccentric geocentric orbit with regressing nodes and advancing apsides", () => {
  near(AXIS_AU * AU_KM, 384400);
  const perigee = -134.9634 / 13.064993, halfOrbit = 180 / 13.064993;
  near(Math.hypot(...lunarOrbit(perigee).relative) / AXIS_AU, 1 - shape.e);
  near(Math.hypot(...lunarOrbit(perigee + halfOrbit).relative) / AXIS_AU, 1 + shape.e);
  for (const day of [MIN_DAYS, -9000, 0, START_DAYS, MAX_DAYS]) {
    const { orbit, pole, relative } = lunarOrbit(day);
    near(M.dot(orbit.peri, orbit.tangent), 0);
    near(M.dot(pole, relative), 0);
    near(degrees(Math.acos(pole[1])), 5.145);
    assert.ok(Math.hypot(...relative) >= AXIS_AU*(1-shape.e) - 1e-12);
  }
  const a = lunarOrbit(0), b = lunarOrbit(365);
  near(degrees(Math.atan2(b.pole[0], b.pole[2]) - Math.atan2(a.pole[0], a.pole[2])), -0.0529538 * 365);
  assert.ok(M.dot(a.orbit.peri, b.orbit.peri) < 0.85);
});

test("the display ellipse is centered relative to Earth and the same lunar face always points home", () => {
  for (const day of [0, START_DAYS, START_DAYS + 7, START_DAYS - 900]) {
    const earth = systemAt(day).earth, lunar = lunarOrbit(day), rendered = moonInScene(day, earth);
    vectorNear(M.subtract(rendered.position, earth.position), M.scale(lunar.relative, TRACK/AXIS_AU));
    const unitX = M.dot(lunar.relative, lunar.orbit.peri) / AXIS_AU;
    const unitY = M.dot(lunar.relative, lunar.orbit.tangent) / AXIS_AU;
    vectorNear(M.transform(rendered.guide, [unitX, unitY, 0]), rendered.position, 1e-6);
    const toEarth = M.normalize(M.subtract(earth.position, rendered.position));
    vectorNear(M.transform(rendered.model, [0,0,1], 0), M.scale(toEarth, moon.radius), 1e-7);
    vectorNear(M.transform(moonMatrix(lunar, [0,0,0], 1), [0,1,0], 0), lunar.pole, 1e-7);
    vectorNear(rendered.light, M.normalize(M.scale(M.add(earth.positionAU, lunar.relative), -1)));
  }
});

test("surface observers have orthonormal east, north and zenith axes in the atlas world frame", () => {
  for (const place of sites) {
    const a = observerAt(0, place), b = observerAt(0.9972695663, place);
    vectorNear(M.cross(a.east, a.north), a.up);
    near(M.dot(a.east, a.north), 0);
    near(Math.hypot(...a.offset)*AU_KM, byId.earth.diameter/2);
    vectorNear(a.up, b.up, 2e-8);
    near(degrees(horizontal(a.up, a).altitude), 90);
    near(degrees(horizontal(M.scale(a.up, -1), a).altitude), -90);
    near(degrees(horizontal(a.east, a).azimuth), 90);
    near(degrees(horizontal(M.scale(a.north, -1), a).azimuth), 180);
  }
  const greenwich = observerAt(0, { latitude: 0, longitude: 0 });
  near(greenwich.up[0], Math.cos(M.radians(280.46061837)));
});

test("the overhead finder puts the horizon on the rim, zenith at center and east on the left", () => {
  for (const [angle, x, y] of [[0,0,-1],[90,-1,0],[180,0,1],[270,1,0]]) {
    const point = chartPoint(0, M.radians(angle));
    near(point.x, x); near(point.y, y);
  }
  near(chartPoint(M.radians(30), Math.PI/2).x, -2/3);
  near(Math.hypot(...Object.values(chartPoint(Math.PI/2, 2.6))), 0);
  assert.equal(chartPoint(-0.01, 0), null);
});

test("eyepiece angles and illuminated disk fractions match independent physical triangle measurements", () => {
  assert.equal(targets.length, 9);
  const day = START_DAYS, observer = observerAt(day, kowloon), station = M.add(observer.earth, observer.offset);
  for (const body of targets) {
    const view = observe(body.id, observer);
    near(Math.hypot(...view.eye), 1);
    near(Math.sin(view.diameter/2) * 2 * view.distance * AU_KM, body.diameter, 1e-6);
    if (body.id === "sun") {
      assert.equal(view.illuminated, null);
      assert.equal(view.elongation, 0);
      near(view.distance, Math.hypot(...station));
      continue;
    }
    const position = body === moon ? M.add(observer.earth, lunarOrbit(day).relative) : orbitalState(orbits[body.id], day).position;
    const r = Math.hypot(...position), delta = Math.hypot(...M.subtract(position, station)), earthSun = Math.hypot(...station);
    const cosPhase = (r*r + delta*delta - earthSun*earthSun)/(2*r*delta);
    const cosElongation = (earthSun*earthSun + delta*delta - r*r)/(2*earthSun*delta);
    near(view.distance, delta);
    near(view.illuminated, (1 + cosPhase)/2, 1e-10);
    near(Math.cos(view.elongation), cosElongation, 1e-10);
    assert.ok(view.illuminated >= 0 && view.illuminated <= 1);
  }
  for (const id of ["earth", "pluto", "constructor"]) assert.throws(() => observe(id, observer), RangeError);
});

test("the Moon passes from nearly full to nearly new and a crescent Venus appears larger", () => {
  assert.ok(sight("moon", START_DAYS + 3).illuminated > 0.98);
  assert.ok(sight("moon", START_DAYS + 18).illuminated < 0.02);
  assert.equal(sight("moon", START_DAYS).phaseName, "Waxing gibbous");
  assert.equal(sight("moon", START_DAYS + 3).phaseName, "Near full Moon");
  assert.equal(sight("moon", START_DAYS + 6).phaseName, "Waning gibbous");
  assert.equal(sight("moon", START_DAYS + 18).phaseName, "Near new Moon");
  const far = sight("venus", START_DAYS), nearVenus = sight("venus", START_DAYS + 310);
  assert.ok(far.illuminated > 0.98 && nearVenus.illuminated < 0.1);
  assert.ok(nearVenus.diameter > 5 * far.diameter);
});

test("Kowloon Tong's winter Sun rises in the southeast, transits near local noon and sets in the southwest", () => {
  const { events, curve } = planAt("sun", START_DAYS);
  assert.deepEqual(events.map(e => e.kind), ["Rise", "Transit", "Set"]);
  const [rise, transit, set] = events;
  assert.ok(degrees(rise.azimuth) > 110 && degrees(rise.azimuth) < 120);
  assert.ok(degrees(set.azimuth) > 240 && degrees(set.azimuth) < 250);
  assert.equal(localDate(transit.day, kowloon).getUTCHours(), 12);
  near(degrees(transit.azimuth), 180, 1e-6);
  near(degrees(transit.altitude), 44.6, 0.2);
  assert.ok(curve.every((p, i) => i === 0 || curve[i-1].day < p.day));
  const capeTransit = planAt("sun", START_DAYS, cape).events.find(e => e.kind === "Transit");
  near(Math.cos(capeTransit.azimuth), 1);
  assert.ok(capeTransit.altitude > transit.altitude);
});

test("the Moon's rise includes surface parallax and each event is bracketed in its physical direction", () => {
  for (const { kind, day } of planAt("moon", START_DAYS).events) {
    const before = sight("moon", day - 1/86400), after = sight("moon", day + 1/86400);
    if (kind === "Transit") { assert.ok(before.east > 0 && after.east < 0); continue; }
    near(sight("moon", day).altitude, 0, 1e-9);
    assert.equal(before.altitude < 0 && after.altitude > 0, kind === "Rise");
    assert.equal(before.altitude > 0 && after.altitude < 0, kind === "Set");
    const geocentric = horizontal(lunarOrbit(day).relative, observerAt(day, kowloon));
    assert.ok(degrees(geocentric.altitude) > 0.85 && degrees(geocentric.altitude) < 1.1);
  }
});

test("the day planner preserves polar daylight, polar night, a skipped moonrise and both transits in a day", () => {
  for (const [day, sign] of [[START_DAYS, 1],[parseUTCMinute("2026-06-21T12:00"), -1]]) {
    const plan = planAt("sun", day, dome);
    assert.deepEqual(plan.events.map(e => e.kind), ["Transit"]);
    assert.ok(plan.curve.every(p => sign*p.altitude > 0));
  }
  assert.deepEqual(planAt("moon", START_DAYS + 9).events.map(e => e.kind), ["Transit", "Set"]);
  const two = planAt("jupiter", START_DAYS + 15).events;
  assert.deepEqual(two.map(e => e.kind), ["Transit", "Set", "Rise", "Transit"]);
  assert.ok(two[3].day - two[0].day < 1 && two[3].day - two[0].day > 0.99);
});

test("a grazing rise entirely between quarter-hour samples still appears in the plotted curve and forecast", () => {
  const site = { ...kowloon, latitude: 66.96109 }, span = dayWindow(START_DAYS, site);
  for (let i = 0; i <= 96; i++) assert.ok(sight("sun", span.start + i/96, site).altitude < 0);
  const plan = dayPlan("sun", site, span);
  assert.deepEqual(plan.events.map(e => e.kind), ["Rise", "Transit", "Set"]);
  assert.ok((plan.events[2].day - plan.events[0].day)*1440 < 4);
  assert.ok(plan.curve.some(p => p.altitude > 0));
});

test("station midnights and calendar clipping preserve leap days, selectable minutes and in-range events", () => {
  const leap = parseUTCMinute("2024-02-29T15:59");
  const a = dayWindow(leap, kowloon), b = dayWindow(leap + 1/1440, kowloon);
  assert.equal(localDate(a.start, kowloon).toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(localDate(b.start, kowloon).toISOString(), "2024-03-01T00:00:00.000Z");
  near(a.end, b.start);
  assert.equal(dayWindow(MIN_DAYS, kowloon).firstMinute, 480);
  assert.equal(dayWindow(MAX_DAYS, kowloon).lastMinute, 479);
  for (const site of sites) for (const day of [MIN_DAYS, MAX_DAYS]) {
    const span = dayWindow(day, site);
    assert.ok(inCalendar(span.start) && inCalendar(span.end) && span.end > span.start);
    const plan = dayPlan("mars", site, span);
    for (const p of [...plan.events, ...plan.curve]) assert.ok(inCalendar(p.day) && Number.isFinite(p.altitude));
  }
});
