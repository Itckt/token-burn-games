(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const M = node ? require("./math.js") : Slipwake.math;
  const A = node ? require("./arena.js") : Slipwake.arena;
  const Deck = node ? require("./deck.js") : Slipwake.deck;
  const padding = 0.06;

  // Cover and the net win ties with runners. A shield absorbs the bolt and a dash lets it through.
  function contact(match, shot, dx, dz, time, spent, radius) {
    const hit = A.firstSolid(shot.x,shot.z,dx,dz,padding,shot.bankWall);
    hit.kind = hit.block ? "cover" : "edge";
    const net = match.net;
    if (net && net.team !== shot.team) {
      const t = M.segmentCircle(shot.x,shot.z,dx,dz,net.x,net.z,Deck.RULES.netRadius);
      if (t < hit.fraction && spent+t*time < net.remaining) {
        hit.fraction = t;
        hit.kind = "net";
      }
    }
    for (const actor of match.actors) {
      if (actor.team === shot.team || actor.hp <= 0) continue;
      // Start this aim-line test when the target's dodge ends. A bolt may
      // already have cleared the runner, or still be inside the hit circle.
      const start = Math.max(0, (actor.dashLeft-spent)/time);
      const t = M.segmentCircle(shot.x,shot.z,dx,dz,actor.x,actor.z,radius,start);
      if (t < hit.fraction) {
        hit.fraction = t;
        hit.victim = actor;
        hit.shielded = spent+t*time < Math.max(actor.shield, actor.shieldAtStart);
        hit.kind = !hit.shielded && spent+t*time < actor.vaneLeft ? "vane" : "runner";
      }
    }
    return hit;
  }
  function reflect(shot, wall) {
    const gapX = Math.abs(Math.abs(shot.x-wall.x) - (wall.w/2+padding));
    const gapZ = Math.abs(Math.abs(shot.z-wall.z) - (wall.d/2+padding));
    if (gapX <= gapZ+1e-8) shot.vx = -shot.vx;
    if (gapZ <= gapX+1e-8) shot.vz = -shot.vz;
    shot.yaw = Math.atan2(shot.vx,shot.vz);
    // The reflected ray is straight and points out of this convex box.
    shot.bankWall = wall;
  }
  function advance(match, shot, dt, rules, hurt, emit) {
    const travel = Math.min(dt,shot.life);
    let time = travel;
    while (time > 0) {
      const dx = shot.vx*time, dz = shot.vz*time;
      const hit = contact(match,shot,dx,dz,time,travel-time,rules.hitRadius);
      const t = Math.min(1,hit.fraction);
      shot.x += dx*t;
      shot.z += dz*t;
      if (hit.fraction === Infinity) break;
      const at = {x:shot.x, z:shot.z, team:shot.team};
      if (hit.kind === "cover" && shot.bank && !shot.bankWall) {
        reflect(shot,hit.block);
        emit(match,"ricochet",at);
        time *= 1-t;
      } else if (hit.kind === "vane" && !shot.returned) {
        const defender = hit.victim;
        shot.returned = true;
        shot.team = defender.team;
        shot.owner = defender.id;
        shot.vx = -shot.vx;
        shot.vz = -shot.vz;
        shot.yaw = Math.atan2(shot.vx,shot.vz);
        shot.bank = false;
        shot.bankWall = null;
        defender.returns++;
        emit(match,"boltReturn",{...at,team:defender.team,source:defender.id});
        time *= 1-t;
      } else {
        if (hit.kind === "net") emit(match,"intercept",{...at,team:match.net.team});
        else if (hit.kind !== "edge") emit(match,"impact",at);
        if (hit.kind === "runner" && !hit.shielded) hurt(match,match.actors[shot.owner],hit.victim,shot.damage ?? rules.shotDamage);
        return false;
      }
    }
    shot.life -= travel;
    return shot.life > 1e-7;
  }
  function step(match, dt, rules, hurt, emit) {
    let kept = 0;
    for (const shot of match.shots) {
      if (match.phase !== "playing" || advance(match,shot,dt,rules,hurt,emit)) {
        match.shots[kept++] = shot;
      }
    }
    match.shots.length = kept;
  }
  const api = {step};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).bolts = api;
})();
