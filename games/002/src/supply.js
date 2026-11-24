(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const Pickup = node ? require("./pickup.js") : Slipwake.pickup;
  const RULES = Object.freeze({
    firstWarning: 15, leadTime: 3, window: 10, period: 28, radius: 1.05,
    repair: 35, boostTime: 5, speedFactor: 1.28, retreatHealth: 70, detourRange: 7
  });
  const sites = [
    {name: "North hoist", x: 0, z: -3.65},
    {name: "South hoist", x: 0, z: 3.65}
  ];

  function create(seed) {
    return {state: "waiting", site: (seed >>> 0) % sites.length, nextAt: RULES.firstWarning, contested: false};
  }
  function scheduleNext(drop) {
    // nextAt is the closing time of this pickup window, including when claimed early.
    drop.nextAt += RULES.period - RULES.leadTime - RULES.window;
    drop.site = (drop.site + 1) % sites.length;
    drop.state = "waiting";
    drop.contested = false;
  }
  function advance(match, maxHealth, emit) {
    const drop = match.supply;
    while (match.elapsed + 1e-8 >= drop.nextAt) {
      const site = sites[drop.site];
      if (drop.state === "waiting") {
        drop.state = "incoming";
        drop.nextAt += RULES.leadTime;
        emit(match, "supplyInbound", site);
      } else if (drop.state === "incoming") {
        drop.state = "open";
        drop.nextAt += RULES.window;
        emit(match, "supplyLand", site);
      } else scheduleNext(drop);
    }
    if (drop.state !== "open") return;
    const site = sites[drop.site];
    const {runner, contested} = Pickup.claim(match.actors, site, RULES.radius);
    drop.contested = contested;
    if (!runner) return;
    const heal = Math.min(RULES.repair, maxHealth - runner.hp);
    runner.hp += heal;
    runner.boostLeft = RULES.boostTime;
    runner.supplies++;
    emit(match, "supplyCollect", {...site, source: runner.id, team: runner.team, heal});
    scheduleNext(drop);
  }
  function destination(match, actor) {
    if (match.supply.state === "waiting" || actor.hp > RULES.retreatHealth) return null;
    const site = sites[match.supply.site];
    let best = null, range = RULES.detourRange;
    // Keep one wounded bot on the detour so its crewmates can play the objective.
    for (const ally of match.actors) {
      if (ally.id === 0 || ally.team !== actor.team || ally.id === match.relay?.carrier ||
          ally.hp > RULES.retreatHealth || !Pickup.eligible(ally)) continue;
      const distance = Math.hypot(ally.x - site.x, ally.z - site.z);
      if (distance < range || (distance === range && (!best || ally.id < best.id))) {
        best = ally;
        range = distance;
      }
    }
    return best === actor ? site : null;
  }
  const api = {RULES, sites, create, advance, destination};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).supply = api;
})();
