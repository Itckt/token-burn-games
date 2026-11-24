(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath, node ? require("./replay.js") : root.FoundryReplay);
  if (node) module.exports = api;
  else root.FoundryTrials = api;
})(globalThis, function (M, Replay) {
  "use strict";
  const TIME_LIMIT = 90, RECENT_LIMIT = 3;

  // Intersect the swept centre of the marble with the finite optical gate.
  function crossing(gate, from, to) {
    const a = M.dot(M.sub(from, gate.p), gate.t);
    const b = M.dot(M.sub(to, gate.p), gate.t);
    if (a > 0 || b < 0 || b <= a) return null;
    const fraction = -a / (b - a);
    const offset = M.sub(M.lerp(from, to, fraction), gate.p);
    const height = M.dot(offset, gate.n);
    return height > 0 && height < (gate.clearance ?? 1.15) && Math.abs(M.dot(offset, gate.b)) < 0.90 ? fraction : null;
  }

  function attempt(origin, velocity = [0,0,0]) {
    return {state: "rolling", time: 0, split: null, ...Replay.trace(origin, velocity)};
  }

  class TimingBoard {
    constructor(course) {
      this.course = course;
      this.clock = 0;
      this.completed = 0;
      this.recent = [];
      this.best = null;
      this.latest = null;
      this.opponent = null;
      this.lastReplay = null;
    }
    release(ball) {
      this.latest = ball;
      this.opponent = this.best;
    }
    update(ball, dt) {
      this.advance([ball], dt);
    }
    advance(balls, dt) {
      this.clock += dt;
      for (const ball of balls) this.readGates(ball,dt);
    }
    finishTime(ball, dt) {
      const run = ball.run;
      const start = ball.age - dt;
      if (run.split === null) {
        const split = crossing(this.course.split, ball.prev, ball.p);
        if (split !== null && start + split * dt <= TIME_LIMIT) run.split = start + split * dt;
      }
      const finish = run.split === null ? null : crossing(this.course.finish, ball.prev, ball.p);
      const finishTime = finish === null ? null : start + finish * dt;
      return finishTime !== null && finishTime >= run.split && finishTime <= TIME_LIMIT ? finishTime : null;
    }
    readGates(ball, dt) {
      const run = ball.run;
      if (run.state !== "rolling") return;
      const finish = ball.onTable ? null : this.finishTime(ball, dt);
      run.time = finish ?? Math.min(ball.age, TIME_LIMIT);
      if (ball.onTable) run.state = "off-track";
      else if (finish !== null) run.state = "finished";
      else if (ball.age >= TIME_LIMIT) run.state = "timed-out";
      const terminal = run.state !== "rolling";
      Replay.recordStep(ball, dt, terminal);
      if (!terminal) return;

      const crossedAt = this.clock - (ball.age - run.time);
      const result = {number: ball.number, color: ball.color, time: run.time, split: run.split, crossedAt};
      const previous = this.lastReplay;
      if (!previous || crossedAt > previous.crossedAt || (crossedAt === previous.crossedAt && ball.number > previous.number)) {
        this.lastReplay = {...result, state: run.state, path: run.path, rotations: run.rotations, speeds: run.speeds};
      }
      if (finish !== null) {
        ball.finished = true;
        this.score(result, run.path);
      }
      run.path = run.rotations = run.speeds = null;
    }
    score(result, path) {
      this.completed++;
      this.recent.push(result);
      this.recent.sort((a,b) => b.crossedAt - a.crossedAt || b.number - a.number);
      if (this.recent.length > RECENT_LIMIT) this.recent.pop();
      if (!this.best || result.time < this.best.time || (result.time === this.best.time && result.crossedAt < this.best.crossedAt)) {
        this.best = {...result, path};
      }
    }
  }
  return {SAMPLE_HZ: Replay.SAMPLE_HZ, TIME_LIMIT, RECENT_LIMIT, crossing, attempt, ghostPosition: Replay.position, TimingBoard};
});
