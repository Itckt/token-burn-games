(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const Arena = node ? require("./arena.js") : Slipwake.arena;

  function eligible(actor) {
    return actor.hp > 0 && actor.shield <= 0 && actor.dashLeft <= 0;
  }
  function inReach(actor, spot, radius) {
    return eligible(actor) && Math.hypot(actor.x - spot.x, actor.z - spot.z) <= radius &&
      Arena.clearLine(spot.x, spot.z, actor.x, actor.z);
  }
  // Both crews in range block collection. Crewmates resolve by distance, then runner ID.
  function claim(actors, spot, radius) {
    let nearest = null, best = Infinity, teams = 0, count = 0;
    for (const actor of actors) {
      if (!inReach(actor, spot, radius)) continue;
      count++;
      teams |= 1 << actor.team;
      const d = (actor.x - spot.x) ** 2 + (actor.z - spot.z) ** 2;
      if (d < best || (d === best && actor.id < nearest.id)) {
        nearest = actor;
        best = d;
      }
    }
    return {runner: teams === 3 ? null : nearest, contested: teams === 3, count};
  }
  // A continuous objective only gets the part of a tick after a runner's protection ends.
  function controlSlices(actors, delays, dt, advance) {
    let start = 0;
    while (start < dt) {
      let end = dt;
      const waiting = delays.some(time => time > start);
      if (!waiting) { advance(actors, dt-start); return; }
      for (const time of delays) if (time > start && time < end) end = time;
      const available = actors.filter(a => delays[a.id] <= start);
      if (advance(available, end-start) === false) return;
      start = end;
    }
    // An unlock exactly at the horn changes who is in the circle, with no extra travel or hold time.
    if (delays.some(time => time > 0 && Math.abs(time-dt) < 1e-8)) advance(actors,0);
  }
  const api = {eligible, inReach, claim, controlSlices};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).pickup = api;
})();
