(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, clamp, mix } = common ? require("./math.js") : root.Isobar.math;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const STAGES = [
    { name: "Formation", start: 0, end: 16, from: 1, to: 4 },
    { name: "Deepening", start: 16, end: 34, from: 4, to: 10 },
    { name: "Peak", start: 34, end: 42, from: 10, to: 10 },
    { name: "Decay", start: 42, end: 60, from: 10, to: 2 }
  ];
  const DURATION = STAGES.at(-1).end;

  function at(seconds) {
    if (!Number.isFinite(seconds)) return null;
    const time = clamp(seconds, 0, DURATION);
    let integratedStrength = 0;
    for (const stage of STAGES) {
      const duration = stage.end - stage.start;
      const u = clamp((time - stage.start) / duration, 0, 1);
      const from = storm.normalized(stage.from), to = storm.normalized(stage.to);
      // Integral of smoothstep(u) = u³ - u⁴/2. Seeking and playback
      // therefore land on the same cloud phase and rain travel in one step.
      integratedStrength += duration * (from * u + (to - from) * u ** 3 * (1 - 0.5 * u));
      if (time < stage.end || stage.end === DURATION) {
        const strength = mix(from, to, u * u * (3 - 2 * u));
        const average = time ? integratedStrength / time : 0;
        return { stage, time, strength, signal: Math.round(1 + 9 * strength),
          phase: storm.spinRate(average) * time % TAU, rainTravel: storm.fallRate(average) * time };
      }
    }
  }

  function readingsAt(time) {
    const pose = at(time);
    return pose && storm.readings(pose.strength, pose.time);
  }

  const api = { STAGES, DURATION, at, readingsAt };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).lifecycle = api;
})(globalThis);
