(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const A = node ? require("./arena.js") : Slipwake.arena;
  const M = node ? require("./math.js") : Slipwake.math;
  const Pickup = node ? require("./pickup.js") : Slipwake.pickup;
  const {eligible} = Pickup;
  const RULES = Object.freeze({
    target: 3, pickupRadius: 0.95, gateRadius: 1.65, carrySpeed: 0.82,
    dropLock: 0.5, resetLock: 1.25, returnTime: 8,
    passRange: 8, passSpeed: 12, catchRadius: 0.7, coreRadius: A.radius-1e-7
  });
  const gates = A.homes.map(([[x, z]]) => ({x: x - Math.sign(x) * 1.4, z}));

  function create() {
    return {state: "center", x: 0, z: 0, carrier: null, flight: null, contested: false, lock: 0, returnIn: 0};
  }
  function reset(core) {
    Object.assign(core, create(), {lock: RULES.resetLock});
  }
  function land(core, x, z) {
    Object.assign(core, {state: "dropped", carrier: null, flight: null, x, z,
      contested: false, lock: RULES.dropLock, returnIn: RULES.returnTime});
  }
  function drop(core, actor) {
    if (core.carrier !== actor.id) return null;
    land(core,actor.x,actor.z);
    return {type: "relayDrop", source: actor.id, team: actor.team, x: core.x, z: core.z};
  }
  function carry(core, actor) {
    Object.assign(core, {state:"carried", carrier:actor.id, x:actor.x, z:actor.z, flight:null, contested:false, returnIn:0, lock:0});
  }
  function trace(actors, thrower, x, z, dx, dz, travelTime=0, catchDelays) {
    const solid = A.firstSolid(x,z,dx,dz,RULES.coreRadius);
    let fraction = solid.fraction, receiver = null;
    for (const actor of actors) {
      if (actor === thrower || !actor.hp || (!catchDelays && !eligible(actor))) continue;
      const start = catchDelays && travelTime>0 ? catchDelays[actor.id]/travelTime : 0;
      const t = M.segmentCircle(x,z,dx,dz,actor.x,actor.z,RULES.catchRadius,start);
      if (t === Infinity || t > fraction) continue;
      // A solid face wins an exact tie. A defender wins a simultaneous catch.
      if (t === fraction && (!receiver || receiver.team !== thrower.team || actor.team === thrower.team)) continue;
      if (!A.clearLine(x+t*dx,z+t*dz,actor.x,actor.z)) continue;
      fraction = t;
      receiver = actor;
    }
    const t = Math.min(1,fraction);
    return {x:x+dx*t, z:z+dz*t, receiver, blocked:!receiver && solid.fraction !== Infinity};
  }
  function pass(core, actor, yaw) {
    if (core.carrier !== actor.id || !actor.hp || !Number.isFinite(yaw)) return null;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const landing = trace([],actor,actor.x,actor.z,dx*RULES.passRange,dz*RULES.passRange);
    Object.assign(core, {state:"flight", x:actor.x, z:actor.z, carrier:null,
      flight:{thrower:actor.id, team:actor.team, dx, dz, distance:0, landing:{x:landing.x,z:landing.z}}});
    return {type:"relayPass", source:actor.id, team:actor.team, x:actor.x, z:actor.z};
  }
  function advancePass(core, actors, dt, catchDelays) {
    const f = core.flight, thrower = actors[f.thrower];
    const distance = Math.min(RULES.passRange-f.distance, dt*RULES.passSpeed);
    const hit = trace(actors,thrower,core.x,core.z,f.dx*distance,f.dz*distance,distance/RULES.passSpeed,catchDelays);
    f.distance += Math.hypot(hit.x-core.x,hit.z-core.z);
    core.x = hit.x;
    core.z = hit.z;
    if (hit.receiver) {
      const receiver = hit.receiver;
      carry(core,receiver);
      return {type:"relayCatch", source:receiver.id, passer:thrower.id, intercepted:receiver.team !== thrower.team,
        team:receiver.team, x:receiver.x, z:receiver.z};
    }
    if (!hit.blocked && f.distance < RULES.passRange-1e-8) return null;
    land(core,core.x,core.z);
    return {type:"relayLand", source:thrower.id, team:thrower.team, x:core.x, z:core.z};
  }
  // Under pressure, look for an open teammate who can shorten the route to goal.
  function outlet(actors, carrier) {
    if (!actors.some(a => a.team !== carrier.team && eligible(a) && Math.hypot(a.x-carrier.x,a.z-carrier.z) < 3.6)) return null;
    const gate = gates[1-carrier.team];
    let bestDistance = Math.hypot(carrier.x-gate.x,carrier.z-gate.z)-2, best = null;
    for (const ally of actors) {
      if (ally === carrier || ally.team !== carrier.team || !eligible(ally)) continue;
      const dx = ally.x-carrier.x, dz = ally.z-carrier.z, range = Math.hypot(dx,dz);
      const toGate = Math.hypot(ally.x-gate.x,ally.z-gate.z);
      if (range > RULES.passRange || toGate >= bestDistance) continue;
      if (trace(actors,carrier,carrier.x,carrier.z,dx,dz).receiver === ally) {
        best = ally;
        bestDistance = toGate;
      }
    }
    return best;
  }
  function delivery(core, actors) {
    if (core.carrier === null) return null;
    const runner = actors[core.carrier];
    core.x = runner.x;
    core.z = runner.z;
    const gate = gates[1 - runner.team];
    if (Math.hypot(runner.x - gate.x, runner.z - gate.z) > RULES.gateRadius) return null;
    reset(core);
    return {type: "delivery", source: runner.id, team: runner.team, x: gate.x, z: gate.z};
  }
  function advance(core, actors, dt, catchDelays) {
    if (core.flight) return advancePass(core,actors,dt,catchDelays);
    if (core.carrier !== null) return delivery(core,actors);
    if (core.state === "dropped") {
      core.returnIn -= dt;
      if (core.returnIn <= 1e-8) {
        reset(core);
        return {type: "relayReturn", x: 0, z: 0};
      }
    }
    core.lock = Math.max(0, core.lock - dt);
    if (core.lock > 1e-8) return null;
    const {runner,contested} = Pickup.claim(actors,core,RULES.pickupRadius);
    core.contested = contested;
    if (!runner) return null;
    carry(core,runner);
    return {type: "relayPickup", source: runner.id, team: runner.team, x: core.x, z: core.z};
  }
  // The carrier runs the gate. Its escorts take flanking positions and opponents cut across its route.
  function destination(core, actors, runner) {
    if (core.flight) return core.flight.landing;
    if (core.carrier === null) return core;
    const carrier = actors[core.carrier], gate = gates[1 - carrier.team];
    if (carrier === runner) return gate;
    const dx = gate.x - carrier.x, dz = gate.z - carrier.z;
    const distance = Math.hypot(dx, dz) || 1;
    const lead = Math.min(distance, carrier.team === runner.team ? 1.5 : 0.85);
    const side = carrier.team === runner.team ? (runner.id % 2 ? 1.4 : -1.4) : 0;
    const x = carrier.x + (dx * lead - dz * side) / distance;
    const z = carrier.z + (dz * lead + dx * side) / distance;
    return A.walkable(x, z) ? {x, z} : carrier;
  }
  const api = {RULES, gates, create, drop, advance, delivery, destination, pass, trace, outlet};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).relay = api;
})();
