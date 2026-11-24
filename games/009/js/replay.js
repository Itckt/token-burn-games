(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath);
  if (node) module.exports = api;
  else root.FoundryReplay = api;
})(globalThis, function (M) {
  "use strict";
  const SAMPLE_HZ = 30;

  function trace(origin, velocity) {
    return {path: [origin.slice()], rotations: [[0,0,0,1]], speeds: [M.length(velocity)]};
  }
  function recordStep(ball, dt, terminal) {
    const run = ball.run;
    let next = run.path.length / SAMPLE_HZ;
    if (next > run.time && !terminal) return;
    const start = ball.age - dt, speed = M.length(ball.v);
    function sample(time) {
      const fraction = M.clamp((time - start) / dt, 0, 1);
      run.path.push(M.lerp(ball.prev, ball.p, fraction));
      run.rotations.push(M.mixRotation(ball.prevQ, ball.q, fraction));
      run.speeds.push(ball.prevSpeed + (speed - ball.prevSpeed)*fraction);
    }
    while (next <= run.time) {
      sample(next);
      next = run.path.length / SAMPLE_HZ;
    }
    if (terminal && (run.path.length - 1) / SAMPLE_HZ < run.time) sample(run.time);
  }

  // The last sample may be a fraction of an interval past the regular grid.
  function sampleInterval(record, time) {
    if (!record || !Number.isFinite(time) || time < 0 || time > record.time) return null;
    const i = Math.min(Math.floor(time*SAMPLE_HZ), record.path.length - 1);
    const j = Math.min(i + 1, record.path.length - 1);
    const start = i/SAMPLE_HZ, end = Math.min(j/SAMPLE_HZ, record.time);
    return {i, j, t: end > start ? (time-start)/(end-start) : 0};
  }
  function position(record, time) {
    const at = sampleInterval(record, time);
    return at && M.lerp(record.path[at.i], record.path[at.j], at.t);
  }
  function pose(record, time) {
    const at = sampleInterval(record, time);
    if (!at) return null;
    const {i, j, t} = at;
    return {p: M.lerp(record.path[i], record.path[j], t), q: M.mixRotation(record.rotations[i], record.rotations[j], t),
      speed: record.speeds[i] + (record.speeds[j]-record.speeds[i])*t, color: record.color, number: record.number};
  }

  class Player {
    constructor() { this.close(); }
    open(record) {
      this.record = record;
      this.time = 0;
      this.playing = record.time > 0;
    }
    close() {
      this.record = null;
      this.time = 0;
      this.playing = false;
    }
    toggle() {
      if (!this.record || this.record.time === 0) return;
      if (this.time === this.record.time) this.time = 0;
      this.playing = !this.playing;
    }
    seek(time) {
      if (!this.record || !Number.isFinite(time)) return;
      this.time = M.clamp(time, 0, this.record.time);
      this.playing = false;
    }
    advance(seconds) {
      if (!this.playing || !Number.isFinite(seconds) || seconds <= 0) return;
      this.time = Math.min(this.record.time, this.time + seconds);
      if (this.time === this.record.time) this.playing = false;
    }
  }
  return {SAMPLE_HZ, trace, recordStep, position, pose, Player};
});
