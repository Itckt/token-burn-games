(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const M = node ? require("./math.js") : Slipwake.math;
  const A = node ? require("./arena.js") : Slipwake.arena;
  const Relay = node ? require("./relay.js") : Slipwake.relay;
  const Signal = node ? require("./signal.js") : Slipwake.signal;
  const Freight = node ? require("./freight.js") : Slipwake.freight;
  const Supply = node ? require("./supply.js") : Slipwake.supply;

  function chooseEnemy(match, actor) {
    let best = Infinity, target = -1;
    for (const foe of match.actors) {
      if (foe.team === actor.team || foe.hp <= 0) continue;
      const visible = A.clearLine(actor.x, actor.z, foe.x, foe.z, 0.08);
      const cost = Math.hypot(foe.x - actor.x, foe.z - actor.z) + (visible ? 0 : 4)
        + (foe.shield > 0 ? 3 : 0) - (match.relay?.carrier === foe.id ? 5 : 0);
      if (cost < best) { best = cost; target = foe.id; }
    }
    return target;
  }
  function nextWaypoint(actor) {
    while (actor.path.length > 1 && A.clearLine(actor.x, actor.z, actor.path[1].x, actor.path[1].z, A.radius + 0.012)) {
      actor.path.shift();
    }
    const next = actor.path[0];
    if (Math.hypot(next.x - actor.x, next.z - actor.z) < 0.18) actor.path.shift();
    return next;
  }
  function intent(match, actor, dt) {
    const rally = actor.team === 0 && match.relay?.carrier !== actor.id ? match.rally : null;
    const supply = !rally && Supply.destination(match, actor);
    const station = match.signal && Signal.stations[match.signal.station];
    const fixedGoal = rally || supply || station;
    const objective = fixedGoal || (match.freight && Freight.destination(match.freight, actor))
      || (match.relay && Relay.destination(match.relay, match.actors, actor));
    // The order object changes on each new ping. A pickup or drop also changes the route immediately.
    const task = fixedGoal || match.freight || (match.relay ? match.relay.flight ?? match.relay.carrier ?? "loose" : null);
    const focus = actor.team === 0 ? match.focus?.target ?? null : null;
    actor.think -= dt;
    actor.stepChange -= dt;
    if (actor.think <= 0 || (actor.target >= 0 && !match.actors[actor.target].hp) ||
        actor.task !== task || actor.lastFocus !== focus) {
      actor.task = task;
      actor.lastFocus = focus;
      actor.target = focus ?? chooseEnemy(match, actor);
      actor.think = 0.38 + match.random() * 0.25;
      const goal = objective || match.actors[actor.target];
      actor.path = goal && !A.clearLine(actor.x, actor.z, goal.x, goal.z, A.radius + 0.03)
        ? A.route(actor.x, actor.z, goal.x, goal.z) : [];
      actor.spread = (match.random() - 0.5) * 0.25;
    }
    const foe = match.actors[actor.target];
    if (!foe && !objective) return null;
    const goal = objective || foe, dx = goal.x - actor.x, dz = goal.z - actor.z;
    const aimX = foe ? foe.x - actor.x : dx, aimZ = foe ? foe.z - actor.z : dz;
    const distance = Math.hypot(aimX, aimZ) || 1;
    const visible = foe && A.clearLine(actor.x, actor.z, foe.x, foe.z, 0.07);
    if (actor.stepChange <= 0) { actor.strafe *= -1; actor.stepChange = 0.75 + match.random() * 1.4; }
    let mx = dx, mz = dz, pace = 1, followingPath = false;
    if (!objective && visible && distance < 8.3) {
      const towards = distance < 3 ? -0.65 : distance > 6 ? 0.55 : 0;
      mx = (towards * dx + actor.strafe * dz) / distance;
      mz = (towards * dz - actor.strafe * dx) / distance;
      pace = 0.63;
    } else if (actor.path.length) {
      followingPath = true;
      const next = nextWaypoint(actor);
      mx = next.x - actor.x;
      mz = next.z - actor.z;
    } else if (objective && Math.hypot(dx, dz) < 0.3) {
      mx = mz = 0;
    }
    // Keep the clearance of a planned detour. Separation can otherwise pin a bot
    // against the corner when a crewmate is standing beside its next waypoint.
    if (!followingPath) {
      for (const ally of match.actors) {
        if (ally === actor || !ally.hp || ally.team !== actor.team) continue;
        const ax = actor.x - ally.x, az = actor.z - ally.z, d = Math.hypot(ax, az);
        if (d > 0 && d < 1.3) { mx += ax / d * (1.3 - d) * 2; mz += az / d * (1.3 - d) * 2; }
      }
    }
    const aim = Math.atan2(aimX, aimZ) + (foe ? actor.spread : 0);
    const yaw = M.angleMix(actor.yaw, aim, 1 - Math.exp(-12 * dt));
    return {mx, mz, pace, yaw, fire: visible && distance < 12.2 && Math.cos(yaw - aim) > 0.96,
      pulse: visible && distance < 2.55 && actor.id % 3 === 2};
  }
  const api = {intent};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).bots = api;
})();
