(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath, node ? require("./track.js") : root.FoundryTrack);
  if (node) module.exports = api;
  else root.FoundryHeat = api;
})(globalThis, function (M, T) {
  "use strict";
  const GAP = 2, GATE_WAIT = 4;

  function lineup(speed, firstColor, colorCount) {
    if (!Number.isFinite(speed) || !Number.isInteger(colorCount) || colorCount < 3 ||
        !Number.isInteger(firstColor) || firstColor < 0 || firstColor >= colorCount) return [];
    const base = M.clamp(speed, 0, T.MAX_LAUNCH_SPEED);
    return [-2, 0, 2].map((offset, lane) => ({
      lane, speed: M.clamp(base + offset, 0, T.MAX_LAUNCH_SPEED), color: (firstColor + lane) % colorCount
    }));
  }

  class PaceHeat {
    constructor(plan, now) {
      this.entries = plan.map(entry => ({...entry, gateState: "queued", ball: null, releasedAt: null}));
      this.next = 0;
      this.due = now;
    }
    get pending() { return this.next < this.entries.length; }
    get active() { return this.pending || this.entries.some(entry => entry.ball?.run.state === "rolling"); }

    // Called at release and at fixed-step boundaries. A busy gate delays the
    // schedule from the actual release, keeping the following pair spaced too.
    dispatch(now, release) {
      if (!this.pending || now + 1e-9 < this.due) return;
      const entry = this.entries[this.next];
      entry.ball = release(entry.speed, entry.color);
      if (entry.ball) {
        entry.releasedAt = now;
        entry.gateState = "released";
      }
      else if (now + 1e-9 < this.due + GATE_WAIT) {
        entry.gateState = "waiting";
        return;
      } else entry.gateState = "blocked";
      this.next++;
      this.due = now + GAP;
    }

    standings() {
      const rows = this.entries.map(entry => {
        const run = entry.ball?.run;
        return {lane: entry.lane, color: entry.color, speed: entry.speed,
          state: run ? run.state : entry.gateState, split: run?.split ?? null,
          millis: run?.state === "finished" ? Math.round(run.time * 1000) : null, place: null};
      });
      rows.sort((a, b) => {
        if (a.millis === b.millis) return a.lane - b.lane;
        return (a.millis ?? Infinity) - (b.millis ?? Infinity);
      });
      for (let i = 0; i < rows.length && rows[i].millis !== null; i++) {
        rows[i].place = rows[i].millis === rows[i - 1]?.millis ? rows[i - 1].place : i + 1;
      }
      return rows;
    }
  }
  return {GAP, GATE_WAIT, lineup, PaceHeat};
});
