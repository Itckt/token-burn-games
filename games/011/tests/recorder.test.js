"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const storm = require("../js/storm");
const field = require("../js/field");
const cycle = require("../js/lifecycle");
const recorder = require("../js/recorder");
const { createPage } = require("./support/page");
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);

function csvRows(page) {
  const a = page.get("station-export");
  assert.equal(a.hidden, false);
  assert.match(a.getAttribute("download"), /\.csv$/);
  const href = a.getAttribute("href"), prefix = "data:text/csv;charset=utf-8,";
  assert.ok(href.startsWith(prefix));
  const lines = decodeURIComponent(href.slice(prefix.length)).trimEnd().split("\r\n");
  const columns = lines.shift().split(",");
  return lines.map(line => {
    const cells = line.split(",");
    assert.equal(cells.length, columns.length);
    const values = cells.map(Number);
    assert.ok(values.every(Number.isFinite));
    return Object.fromEntries(columns.map((key, i) => [key, values[i]]));
  });
}

function changeTime(p, time) {
  const slider = p.get("cycle-time"); slider.value = String(time); slider.fire("input");
}

test("manual station samples land on exact seconds during signal transitions at different frame rates and speeds", () => {
  const durations = [2.35, 1.8, 3.37], levels = [10, 2, 8];
  const point = { x: 1.4, z: -1.9 };
  function record(fps, speed) {
    const state = storm.makeState();
    storm.advance(state, 2.375); state.speed = speed;
    const log = recorder.start(state, point);
    for (const [i, duration] of durations.entries()) {
      storm.setSignal(state, levels[i]);
      const count = Math.ceil(duration * fps / speed);
      const dt = duration / count / speed;
      for (let frame = 0; frame < count; frame++) {
        recorder.advance(log, state, state.time + dt * speed, false);
        storm.advance(state, dt);
      }
    }
    recorder.finish(log, state);
    return log;
  }
  const reference = record(60, 1);
  assert.equal(reference.samples.length, 9);
  for (const [fps, speed] of [[12, 2], [30, 0.5], [144, 1]]) {
    const log = record(fps, speed);
    assert.equal(recorder.csv(log), recorder.csv(reference));
    for (const [i, sample] of log.samples.entries()) {
      close(sample.time, 2.375 + (i < 8 ? i : 7.52));
      for (const key of ["wind", "pressure", "rain", "depth"]) close(sample[key], reference.samples[i][key]);
    }
  }
  for (const sample of reference.samples) {
    const pose = storm.makeState(); storm.advance(pose, 2.375);
    for (const [i, duration] of durations.entries()) {
      if (pose.time >= sample.time) break;
      storm.setSignal(pose, levels[i]); storm.advance(pose, Math.min(duration, sample.time - pose.time));
    }
    const expected = field.sample(pose, point);
    for (const key of ["rain", "wind", "pressure"]) close(sample[key], expected[key]);
  }
});

test("rain totals use trapezoidal mm/h integration including a fractional last interval, and extrema use local samples", () => {
  const pose = cycle.at(31.35), point = field.preset("wall", pose);
  const log = recorder.start(pose, point), end = cycle.at(36.9);
  recorder.advance(log, pose, end.time, true); recorder.finish(log, end);
  assert.equal(log.samples.length, 7);
  let depth = 0, previous;
  for (const sample of log.samples) {
    const expected = field.sample(cycle.at(sample.time), point);
    for (const key of ["wind", "rain", "pressure"]) close(sample[key], expected[key]);
    if (previous) depth += (sample.time - previous.time) * (expected.rain + previous.rain) / 7200;
    close(sample.depth, depth);
    previous = sample;
  }
  assert.ok(depth > 0);
  close(log.peakWind, Math.max(...log.samples.map(s => s.wind)));
  close(log.lowPressure, Math.min(...log.samples.map(s => s.pressure)));
  const csv = recorder.csv(log);
  recorder.advance(log, end, 50, true); recorder.finish(log, cycle.at(50));
  assert.equal(recorder.csv(log), csv);
});

test("the recorder pins its initial position and caps long runs at 121 rows including release", () => {
  const state = storm.makeState(), point = { x: 0, z: 0 }, log = recorder.start(state, point);
  point.x = 10;
  for (const until of [NaN, Infinity, -1, 0]) recorder.advance(log, state, until, false);
  assert.equal(log.samples.length, 1);
  recorder.advance(log, state, 10000, false);
  assert.equal(log.samples.length, 121); assert.equal(log.samples.at(-1).elapsed, recorder.LIMIT_SECONDS);
  assert.match(log.reason, /limit/); assert.equal(log.samples.at(-1).depth, 0);
  assert.ok(log.samples.every(s => s.rain === 0));
  for (const invalid of [null, { x: 0, z: 12.1 }, { x: 0, z: Infinity }]) {
    assert.throws(() => recorder.start(state, invalid), RangeError);
  }
  const one = recorder.start(state, { x: 0, z: -12 });
  recorder.finish(one, state); assert.equal(one.samples.length, 1);
  assert.equal(one.samples[0].depth, 0);
});

test("the fixed station holds through probing, hidden tabs and context loss and exports only elapsed model time", () => {
  const p = createPage({ reducedMotion: true });
  p.step();
  const point = field.preset("wall", p.last());
  const record = p.get("station-record"), link = p.get("station-export");
  record.click(); assert.equal(p.get("station-sheet").hidden, false); assert.ok(link.hidden);
  assert.match(p.get("station-status").textContent, /Waiting for playback.*Eyewall/);
  p.key("p"); p.data("probe", "eye").click();
  p.data("speed", "2").click(); p.key(" "); p.step(2000); p.run(13, 50);
  close(p.last().time, 1.3);
  assert.equal(p.get("station-elapsed").textContent, "1.0 s · 2 samples");
  p.doc.hidden = true; p.doc.fire("visibilitychange"); p.step(8000);
  p.doc.hidden = false; p.doc.fire("visibilitychange"); p.step(8000);
  const canvas = p.get("storm-canvas");
  canvas.fire("webglcontextlost"); p.step(8000);
  assert.match(p.get("station-status").textContent, /Waiting for graphics/);
  assert.equal(record.disabled, false);
  canvas.fire("webglcontextrestored"); p.step(8000);
  close(p.last().time, 1.3);
  p.run(9, 50); p.key(" "); p.step(4000); record.click();
  const rows = csvRows(p);
  assert.deepEqual(rows.map(row => row.elapsed_s), [0, 1, 2, 2.2]);
  assert.equal(p.get("station-elapsed").textContent, "2.2 s · 4 samples");
  let total = 0, lastRain = 0, lastTime = 0;
  for (const row of rows) {
    const pose = storm.makeState();
    storm.advance(pose, row.model_s);
    const local = field.sample(pose, point);
    close(row.east_km, point.x * 10, 0.000051);
    close(row.north_km, -point.z * 10, 0.000051);
    close(row.wind_kmh, local.wind, 0.00051); close(row.rain_mm_h, local.rain, 0.00051);
    close(row.pressure_hpa, local.pressure, 0.00051); assert.equal(row.signal, pose.signal);
    total += (row.elapsed_s - lastTime) * (local.rain + lastRain) / 7200;
    close(row.accumulated_mm, total, 0.00000051);
    lastRain = local.rain; lastTime = row.elapsed_s;
  }
  assert.equal(p.get("station-total").textContent, total.toFixed(3));
  assert.equal(p.get("station-rate").textContent, lastRain.toFixed(1));
  assert.match(p.get("station-status").textContent, /^Stopped.*Eyewall/);
  assert.equal(record.textContent, "New log at probe");
  record.click(); assert.equal(link.hidden, true); record.click();
  assert.equal(csvRows(p).length, 1); assert.match(p.get("station-status").textContent, /Eye · 0.0 km/);
});

test("life-cycle completion includes the last partial second and a later seek leaves the completed download intact", () => {
  const p = createPage({ reducedMotion: true });
  changeTime(p, 58.35); p.step(); p.get("station-record").click();
  p.get("cycle-play").click(); p.step(); p.run(30, 70);
  const rows = csvRows(p);
  assert.deepEqual(rows.map(row => row.model_s), [58.35, 59.35, 60]);
  assert.equal(p.frames.size, 0);
  assert.match(p.get("station-status").textContent, /Life cycle finished/);
  const before = p.get("station-export").getAttribute("href");
  changeTime(p, 0); p.step(); assert.equal(p.get("station-export").getAttribute("href"), before);
});

test("scrubbing and notebook inspection finish recordings at the outgoing instant without splicing time", () => {
  const p = createPage({ reducedMotion: true });
  changeTime(p, 16.4); p.step(); p.data("capture", "A").click();
  for (const action of [() => changeTime(p, 2), () => p.data("recall", "A").click()]) {
    changeTime(p, 35.6); p.get("station-record").click(); p.get("cycle-play").click();
    p.step(); p.run(5, 40); close(p.last().time, 35.8);
    action(); p.step();
    assert.deepEqual(csvRows(p).map(row => row.model_s), [35.6, 35.8]);
    assert.match(p.get("station-status").textContent, /before time change/);
    assert.equal(p.frames.size, 0);
  }
});

test("a recorder cannot start without WebGL and a paused log can be stopped while the context is lost", () => {
  const offline = createPage({ noWebGL: true });
  assert.equal(offline.get("station-record").disabled, true);
  offline.get("station-record").click(); assert.ok(offline.get("station-sheet").hidden);
  const p = createPage({ reducedMotion: true });
  p.get("station-record").click(); p.get("storm-canvas").fire("webglcontextlost");
  p.get("station-record").click(); assert.equal(csvRows(p).length, 1);
  assert.equal(p.get("station-record").disabled, true);
  p.get("storm-canvas").fire("webglcontextrestored");
  assert.equal(p.get("station-record").disabled, false);
});

test("a full two-minute log becomes downloadable while the storm continues playing", () => {
  const p = createPage();
  p.key("p"); p.data("probe", "eye").click(); p.get("station-record").click();
  p.data("speed", "2").click(); p.step(); p.run(755, 80);
  const rows = csvRows(p);
  assert.equal(rows.length, 121); assert.equal(rows.at(-1).elapsed_s, 120);
  assert.equal(rows.at(-1).accumulated_mm, 0);
  assert.match(p.get("station-status").textContent, /Two-minute limit reached/);
  assert.equal(p.get("status-text").textContent, "Simulation running");
  const finished = p.get("station-export").getAttribute("href");
  p.run(40); assert.equal(p.get("station-export").getAttribute("href"), finished);
});
