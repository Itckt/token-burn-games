(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const M = node ? require("./math.js") : Slipwake.math;
  const G = node ? require("./game.js") : Slipwake.game;
  const Relay = node ? require("./relay.js") : Slipwake.relay;
  const interval = 0.2, trailTime = 2, epsilon = 1e-8;

  // Keep just the data drawn on the tactical chart. Bot paths, effects and the RNG stay in the live match.
  function snapshot(g) {
    const actors = g.actors.map(({id, team, x, z, hp, yaw, deaths, vaneLeft}) =>
      ({id, team, x, z, hp, yaw, deaths, vaneLeft}));
    const copy = value => value && {...value};
    let relay = null;
    if (g.relay) {
      const {state,x,z,carrier,flight} = g.relay;
      relay = {state,x,z,carrier,flight:flight && {dx:flight.dx,dz:flight.dz,endX:flight.landing.x,endZ:flight.landing.z}};
    }
    return {time:g.elapsed, scores:g.scores.slice(), actors, relay, freight:copy(g.freight),
      signal:copy(g.signal), supply:copy(g.supply), net:copy(g.net), rally:copy(g.rally), focus:copy(g.focus)};
  }
  function playText(g,e) {
    switch (e.type) {
      case "ko": return g.actors[e.source].name + " knocked out " + g.actors[e.victim].name;
      case "delivery": return g.actors[e.source].name + " delivered the core";
      case "relayCatch": return g.actors[e.source].name + (e.intercepted ? " intercepted the pass" : " caught the pass");
      case "signalPoint": return G.TEAMS[e.team] + " scored at " + e.name;
      case "signalShift": return "Station moved to " + e.name;
      case "freightDock": return G.TEAMS[e.team] + " docked at the " + (e.team ? "west" : "east") + " depot";
      case "boltReturn": return g.actors[e.source].name + " returned a bolt";
      default: return null;
    }
  }
  function indexAt(entries,time) {
    let first = 0, end = entries.length;
    while (first < end) {
      const mid = Math.floor((first + end)/2);
      if (entries[mid].time <= time+epsilon) first = mid+1;
      else end = mid;
    }
    return first-1;
  }
  function interpolate(a,b,time) {
    if (!b || time <= a.time+epsilon) return a;
    const t = (time-a.time)/(b.time-a.time);
    const actors = a.actors.map((actor,i) => {
      const next = b.actors[i];
      // A fallen runner can finish the approach to its knockout. A respawn starts a new path.
      if (!actor.hp || (next.hp && actor.deaths !== next.deaths)) return actor;
      return {...actor,x:M.mix(actor.x,next.x,t),z:M.mix(actor.z,next.z,t),yaw:M.angleMix(actor.yaw,next.yaw,t)};
    });
    let relay = a.relay, freight = a.freight;
    if (relay && relay.carrier !== null) {
      const {x,z} = actors[relay.carrier];
      relay = {...relay,x,z};
    } else if (relay?.flight) {
      // A short pass can be caught between two regular samples. Trace its recorded flight up to the catch.
      const f = relay.flight, range = Math.hypot(f.endX-relay.x,f.endZ-relay.z);
      const travel = Math.min(range,(time-a.time)*Relay.RULES.passSpeed);
      relay = {...relay,x:relay.x+f.dx*travel,z:relay.z+f.dz*travel};
    }
    if (freight && !freight.resetLeft) freight = {...freight,x:M.mix(freight.x,b.freight.x,t)};
    return {...a,time,actors,relay,freight};
  }

  class Recorder {
    constructor(g) {
      this.frames = [snapshot(g)];
      this.marks = [];
      this.sequence = g.sequence;
      this.finished = false;
    }
    get duration() { return this.frames.at(-1).time; }
    capture(g) {
      if (this.finished || g.phase === "paused" || g.phase === "ready") return;
      let immediate = g.phase === "ended";
      this.sequence = G.eventsSince(g,this.sequence,e => {
        const label = playText(g,e);
        if (label) {
          const last = this.marks.at(-1);
          if (last && Math.abs(last.time-e.time) < epsilon) {
            if (!last.plays.includes(label)) last.plays.push(label);
            last.x = e.x; last.z = e.z;
          } else this.marks.push({time:e.time, x:e.x, z:e.z, plays:[label]});
        }
        if (label || e.type === "respawn" || e.type === "freightReset" || e.type.startsWith("relay")) immediate = true;
      });
      if (immediate || g.elapsed-this.duration >= interval-epsilon) {
        const frame = snapshot(g);
        if (Math.abs(frame.time-this.duration) < epsilon) this.frames[this.frames.length-1] = frame;
        else this.frames.push(frame);
      }
      this.finished = g.phase === "ended";
    }
    read(position) {
      const time = M.clamp(Number.isFinite(position) ? position : 0, this.frames[0].time, this.duration);
      const i = indexAt(this.frames,time), frame = interpolate(this.frames[i],this.frames[i+1],time);
      const first = Math.max(0,indexAt(this.frames,time-trailTime));
      const trail = this.frames.slice(first,i+1);
      if (frame !== this.frames[i]) trail.push(frame);
      const j = indexAt(this.marks,time), mark = this.marks[j];
      const previous = mark && time-mark.time > epsilon ? mark : this.marks[j-1];
      return {time,frame,trail,mark,previous,next:this.marks[j+1]};
    }
  }
  const api = {Recorder, interval, trailTime};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).tape = api;
})();
