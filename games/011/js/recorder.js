(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const cycle = common ? require("./lifecycle.js") : root.Isobar.lifecycle;
  const LIMIT_SECONDS = 120, EPSILON = 1e-9;

  function append(log, pose) {
    const { wind, rain, pressure } = field.sample(pose, log.point);
    const previous = log.samples.at(-1);
    const elapsed = pose.time - log.start;
    const depth = previous ? previous.depth + (previous.rain + rain) / 2 * (elapsed - previous.elapsed) / 3600 : 0;
    log.samples.push({ time: pose.time, elapsed, signal: pose.signal, wind, rain, pressure, depth });
    log.peakWind = Math.max(log.peakWind, wind);
    log.lowPressure = Math.min(log.lowPressure, pressure);
  }

  function start(state, point) {
    if (!field.inRange(point)) throw new RangeError("Place the station within the instrument range");
    const log = { point: { x: point.x, z: point.z }, start: state.time, samples: [],
      peakWind: 0, lowPressure: Infinity, reason: null };
    append(log, state);
    return log;
  }

  function advance(log, before, until, inCycle) {
    if (log.reason || !Number.isFinite(until) || until <= before.time) return;
    // Whole seconds are numbered from release, even if release was between
    // clock ticks. Reconstruct the pose at each tick instead of sampling RAFs.
    let time = log.start + log.samples.length;
    while (time <= until + EPSILON) {
      let pose;
      if (inCycle) {
        pose = cycle.at(time);
      } else {
        pose = { ...before, playing: true, speed: 1 };
        storm.advance(pose, Math.max(0, time - before.time));
        pose.time = time;
      }
      append(log, pose);
      if (log.samples.length === LIMIT_SECONDS + 1) {
        log.reason = "Two-minute limit reached";
        break;
      }
      time = log.start + log.samples.length;
    }
  }

  function finish(log, state, reason = "Stopped") {
    if (log.reason) return;
    if (state.time - log.samples.at(-1).time > EPSILON) append(log, state);
    log.reason = reason;
  }

  function csv(log) {
    const east = (log.point.x * field.KM_PER_UNIT).toFixed(4);
    const north = (-log.point.z * field.KM_PER_UNIT).toFixed(4);
    const lines = ["model_s,elapsed_s,east_km,north_km,signal,wind_kmh,rain_mm_h,pressure_hpa,accumulated_mm"];
    for (const s of log.samples) {
      lines.push([s.time.toFixed(6), s.elapsed.toFixed(6), east, north, s.signal,
        s.wind.toFixed(3), s.rain.toFixed(3), s.pressure.toFixed(3), s.depth.toFixed(6)].join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  const api = { LIMIT_SECONDS, start, advance, finish, csv };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).recorder = api;
})(globalThis);
