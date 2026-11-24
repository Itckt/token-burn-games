"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const S = require("../js/simulation");
const M = require("../js/math");
const { contourSegments } = require("../js/cartography");
const flat = { surfaceAt: () => -12 };

function close(a, b, tolerance = 1e-6) {
  assert.ok(Math.abs(a - b) < tolerance, a + " differs from " + b);
}
function flight() {
  const c = S.homeCamera(T.PRESETS.alpine);
  S.setMode(c, "fly");
  c.position = [0, 80, 0];
  c.pitch = c.targetPitch = c.yaw = c.targetYaw = 0;
  return c;
}
function step(camera, codes, seconds, fps = 60) {
  const keys = new Set(codes);
  for (let i = 0; i < Math.round(seconds * fps); i++) S.stepCamera(camera, keys, 1 / fps, flat);
}

test("home cameras face the same survey focus and keep their state independent", () => {
  for (const style of Object.values(T.PRESETS)) {
    const c = S.homeCamera(style);
    const expected = M.normalize(M.subtract(c.focus, c.position)), actual = M.direction(c.yaw, c.pitch);
    assert.equal(c.mode, "orbit");
    assert.deepEqual(c.position, style.start);
    assert.notEqual(c.position, style.start);
    expected.forEach((v, i) => close(v, actual[i]));
    S.stepCamera(c, new Set(), 1 / 60, flat);
    c.position.forEach((v, i) => close(v, style.start[i]));
  }
});

test("orbit eases towards its turn and zoom targets and keeps the pivot fixed", () => {
  const c = S.homeCamera(T.PRESETS.alpine), originalYaw = c.yaw, originalDistance = c.distance;
  const pivot = c.focus.slice();
  S.turn(c, 0.8, -0.18);
  S.zoom(c, -400);
  S.stepCamera(c, new Set(), 1 / 60, flat);
  assert.ok(c.yaw > originalYaw && c.yaw < c.targetYaw);
  assert.ok(c.distance < originalDistance && c.distance > c.targetDistance);
  step(c, [], 2);
  close(c.yaw, originalYaw + 0.8);
  close(Math.hypot(...M.subtract(c.position, pivot)), c.targetDistance);
  S.turn(c, 0, 50);
  S.zoom(c, -100000);
  assert.ok(c.targetPitch < 0);
  assert.equal(c.targetDistance, 28);
  S.zoom(c, 100000);
  assert.equal(c.targetDistance, 235);
  S.turn(c, 0, -50);
  assert.ok(c.targetPitch > -Math.PI / 2);
});

test("keyboard look and keyboard zoom work without a pointing device", () => {
  const c = S.homeCamera(T.PRESETS.fjord), yaw = c.yaw, pitch = c.pitch, distance = c.distance;
  step(c, ["Equal", "ArrowLeft", "ArrowDown"], 0.25);
  assert.ok(c.yaw < yaw && c.pitch < pitch && c.distance < distance);
  step(c, ["NumpadSubtract", "ArrowRight", "ArrowUp"], 0.75);
  assert.ok(c.yaw > yaw && c.distance > distance);
});

test("a complete orbit clears mountain crests while keeping the focus centred", () => {
  const world = T.createWorld(), grid = T.buildGrid(world), c = S.homeCamera(world.style);
  const keys = new Set(["ArrowRight"]);
  let lifted = false;
  for (let frame = 0; frame < 440; frame++) {
    S.stepCamera(c, keys, 1 / 60, grid);
    const [x, y, z] = c.position;
    assert.ok(y >= Math.max(0, grid.surfaceAt(x, z)) + 2 - 1e-6);
    const forward = M.direction(c.yaw, c.pitch), aim = M.normalize(M.subtract(c.focus, c.position));
    close(M.dot(forward, aim), 1);
    if (y > world.style.start[1] + 10) lifted = true;
  }
  assert.ok(lifted);
  const direction = M.direction(c.yaw, c.pitch);
  S.setMode(c, "fly");
  S.stepCamera(c, new Set(), 1 / 60, grid);
  close(M.dot(direction, M.direction(c.yaw, c.pitch)), 1);
});

test("switching to fly preserves the view and returning to orbit anchors at the current position", () => {
  const c = S.homeCamera(T.PRESETS.canyon), start = c.position.slice(), yaw = c.yaw, pitch = c.pitch;
  S.setMode(c, "fly");
  assert.deepEqual(c.position, start);
  assert.equal(c.yaw, yaw); assert.equal(c.pitch, pitch);
  const distance = c.targetDistance;
  S.zoom(c, -1500);
  assert.equal(c.targetDistance, distance);
  step(c, ["KeyW"], 0.75);
  const end = c.position.slice();
  S.setMode(c, "orbit");
  S.stepCamera(c, new Set(), 1 / 60, flat);
  c.position.forEach((v, i) => close(v, end[i]));
  assert.deepEqual(c.velocity, [0, 0, 0]);
  assert.throws(() => S.setMode(c, "rail"), RangeError);
});

test("flight follows the view, normalises diagonal speed and damps on release", () => {
  const straight = flight(), diagonal = flight(), start = straight.position.slice();
  step(straight, ["KeyW"], 1);
  step(diagonal, ["KeyW", "KeyD"], 1);
  const axisDistance = Math.hypot(...M.subtract(straight.position, start));
  close(Math.hypot(...M.subtract(diagonal.position, start)), axisDistance);
  assert.ok(diagonal.position[0] > 0 && diagonal.position[2] < 0);
  const speed = Math.hypot(...straight.velocity), z = straight.position[2];
  step(straight, [], 0.25);
  assert.ok(straight.position[2] < z && Math.hypot(...straight.velocity) < speed * 0.2);
  const ascent = flight();
  ascent.pitch = ascent.targetPitch = Math.PI / 5;
  ascent.yaw = ascent.targetYaw = Math.PI / 2;
  step(ascent, ["KeyW"], 0.5);
  assert.ok(ascent.position[0] > 0 && ascent.position[1] > 80);
  close(ascent.position[2], 0);
  const still = flight();
  step(still, ["KeyA", "KeyD", "KeyS", "KeyW", "KeyE", "KeyQ"], 1);
  assert.deepEqual(still.position, start);
});

test("integrated velocity gives equal travel at 30, 60 and 120 Hz, with a working boost", () => {
  const positions = [30, 60, 120].map(rate => {
    const c = flight();
    step(c, ["KeyW", "ShiftRight", "KeyE"], 1, rate);
    step(c, [], 0.5, rate);
    return c.position;
  });
  for (const p of positions) p.forEach((v, i) => close(v, positions[0][i]));
  const normal = flight();
  step(normal, ["KeyW", "KeyE"], 1);
  assert.ok(Math.abs(positions[0][2]) > Math.abs(normal.position[2]) * 2);
});

test("camera boundaries, altitude and active water surface constrain flight", () => {
  const c = flight(), keys = new Set(["KeyD", "ShiftLeft"]);
  c.position = [T.HALF - 3, -7, -2 * T.HALF];
  S.stepCamera(c, keys, 1 / 60, flat, false);
  assert.deepEqual(c.position, [T.HALF - 3, -7, 3 - T.HALF]);
  assert.equal(c.velocity[0], 0);
  S.stepCamera(c, new Set(), 0, flat, true);
  assert.equal(c.position[1], T.WATER + 2);
  const ridge = { surfaceAt: () => 73.4 };
  S.stepCamera(c, new Set(), 0, ridge);
  close(c.position[1], 75.4);
  c.position[1] = 235;
  S.stepCamera(c, new Set(["Space"]), 0.1, flat);
  assert.equal(c.position[1], 235);
  assert.equal(c.velocity[1], 0);
  const delayed = flight(), short = flight();
  S.stepCamera(delayed, new Set(["KeyW"]), 40, flat);
  S.stepCamera(short, new Set(["KeyW"]), 0.1, flat);
  assert.deepEqual(delayed.position, short.position);
});

test("day and night wrap at midnight, pause exactly and display every slider minute", () => {
  close(S.advanceClock(19.25, S.DAY_SECONDS, true), 19.25);
  close(S.advanceClock(23, S.DAY_SECONDS / 8, true), 2);
  close(S.advanceClock(12.4, 200, false), 12.4);
  assert.equal(S.formatHour(S.START_HOUR), "16:30");
  assert.equal(S.formatHour(24), "00:00");
  assert.equal(S.formatHour(-1 / 60), "23:59");
  for (let minute = 0; minute < 1440; minute++) {
    assert.equal(S.minuteOfDay(minute / 60), minute);
    assert.equal(S.formatHour(minute / 60), [Math.floor(minute / 60), minute % 60].map(v => String(v).padStart(2, "0")).join(":"));
  }
});

test("lighting varies continuously, with a low sun at dawn and a brighter sky at noon", () => {
  const night = S.lighting(0), dawn = S.lighting(6), day = S.lighting(12), dusk = S.lighting(18);
  assert.equal(night.day, 0); assert.equal(day.day, 1);
  assert.ok(night.sun[1] < 0 && day.sun[1] > 0);
  close(dawn.sun[1], 0); close(dusk.sun[1], 0);
  assert.ok(dawn.sun[0] < dusk.sun[0] && dawn.warmth > day.warmth);
  assert.ok(day.high.every((v, i) => v > night.high[i]));
  for (let i = 0; i <= 288; i++) {
    const h = i / 12, a = S.lighting(h), b = S.lighting(h + 1 / 600);
    close(Math.hypot(...a.sun), 1);
    for (const color of [a.high, a.low]) assert.ok(color.every(v => v >= 0 && v <= 1));
    close(a.day, b.day, 0.003);
    assert.deepEqual(a, S.lighting(h + 24));
  }
});

test("compass bearings match the camera and north-up map conventions", () => {
  for (const [yaw, degrees, cardinal] of [[0, 0, "N"], [Math.PI / 4, 45, "NE"], [Math.PI, 180, "S"],
    [-Math.PI / 2, 270, "W"], [-M.TAU * 2.125, 315, "NW"], [M.TAU - 0.001, 0, "N"]]) {
    assert.deepEqual(S.heading(yaw), { degrees, cardinal });
  }
});

test("marching squares emits the correct number of finite segments in all 16 cases", () => {
  for (let mask = 0; mask < 16; mask++) {
    const field = [0, 1, 2, 3].map(bit => (mask >>> bit) & 1);
    const edges = contourSegments(field, 2, 2, 0.5);
    const expected = [0, 15].includes(mask) ? 0 : [6, 9].includes(mask) ? 2 : 1;
    assert.equal(edges.length, expected);
    for (const [a, b] of edges) {
      assert.notDeepEqual(a, b);
      assert.ok([...a, ...b].every(v => [0, 0.5, 1].includes(v)));
    }
  }
});

test("contours join across cell boundaries and separate saddle corners using the centre height", () => {
  const ramp = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
  assert.deepEqual(contourSegments(ramp, 3, 3, 0.25), [
    [[1.25, 0], [1.25, 1]], [[1.25, 1], [1.25, 2]]
  ]);
  assert.deepEqual(contourSegments(ramp, 3, 3, 0), [[[1, 0], [1, 1]], [[1, 1], [1, 2]]]);
  const lowCentre = contourSegments([1, -3, -3, 1], 2, 2, 0);
  assert.deepEqual(lowCentre[0], [[0.25, 0], [0, 0.25]]);
  const highCentre = contourSegments([3, -1, -1, 3], 2, 2, 0);
  assert.deepEqual(highCentre[0], [[0.75, 0], [1, 0.25]]);
});

test("manual flight clears raised and lowered lake surfaces and can descend to the exposed bed", () => {
  const g = { surfaceAt: () => -12 };
  const camera = S.homeCamera(T.PRESETS.alpine);
  S.setMode(camera, "fly");
  for (const [visible, level, floor] of [[true, 8, 10], [true, -6, -4], [false, 8, -10]]) {
    camera.position[1] = -20;
    camera.velocity[1] = -19;
    S.stepCamera(camera, new Set(), 0, g, visible, level);
    assert.equal(camera.position[1], floor);
    assert.equal(camera.velocity[1], 0);
  }
  g.surfaceAt = () => 14;
  S.stepCamera(camera, new Set(), 0, g, true, 8);
  assert.equal(camera.position[1], 16);
});
