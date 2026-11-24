(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./math.js') : root.Rift.math, common ? require('./roster.js') : root.Rift.roster);
  if (common) module.exports = api;
  else root.Rift.projectiles = api;
})(globalThis, function (M, Roster) {
  'use strict';

  const EPSILON = 1e-8;
  function point(shot, progress) {
    const t = M.clamp(progress, 0, 1);
    const lift = shot.type === 'shell' ? Math.sin(Math.PI * t) * 1.55 : 0;
    return [M.lerp(shot.x, shot.tx, t), M.lerp(shot.y, shot.ty, t) + lift, M.lerp(shot.z, shot.tz, t)];
  }
  function ready(unit, age) {
    return unit.cardId === 'skiff' && unit.hp > 0 && (unit.screenReadyAt || 0) <= age + EPSILON;
  }
  function crossing(shot, unit, dt) {
    // Sweep the flight segment. A fast bolt can cross the edge of the screen between ticks.
    const dx = shot.tx - shot.x, dz = shot.tz - shot.z, lengthSquared = dx * dx + dz * dz;
    const start = Math.min(1, shot.age / shot.duration), end = Math.min(1, (shot.age + dt) / shot.duration);
    const nearest = lengthSquared ? ((unit.x - shot.x) * dx + (unit.z - shot.z) * dz) / lengthSquared : start;
    const t = M.clamp(nearest, start, end);
    if (Math.hypot(shot.x + dx * t - unit.x, shot.z + dz * t - unit.z) > Roster.CARD.skiff.screenRange + EPSILON) return null;
    return point(shot, t);
  }
  function intercept(s, dt, onIntercept) {
    const screens = s.units.filter(unit => ready(unit, s.age));
    if (!screens.length) return null;
    screens.sort((a, b) => a.id - b.id);
    const shots = [...s.shots].sort((a, b) => (a.duration - a.age) - (b.duration - b.age) || a.id - b.id);
    const caught = new Set();
    for (const shot of shots) {
      for (const unit of screens) {
        if (unit.team === shot.team || unit.lane !== shot.lane || !ready(unit, s.age)) continue;
        const hit = crossing(shot, unit, dt);
        if (!hit) continue;
        unit.screenReadyAt = s.age + Roster.CARD.skiff.screenRecharge;
        caught.add(shot);
        onIntercept(s, unit, shot, hit);
        break;
      }
    }
    return caught;
  }
  function advance(s, dt, damage, effect, onIntercept) {
    if (!s.shots.length) return;
    const actors = [...s.units, ...s.towers].filter(actor => actor.hp > 0);
    const targets = new Map(actors.map(actor => [actor.id, actor]));
    for (const shot of s.shots) {
      const target = targets.get(shot.targetId);
      if (target) { shot.tx = target.x; shot.tz = target.z; }
    }
    const caught = intercept(s, dt, onIntercept);
    s.shots = s.shots.filter(shot => {
      if (caught?.has(shot)) return false;
      shot.age += dt;
      if (shot.age < shot.duration - EPSILON) return true;
      const target = targets.get(shot.targetId), shell = shot.type === 'shell';
      if (target) damage.push({target, amount:shot.damage});
      if (shell) {
        for (const actor of actors) {
          if (actor !== target && actor.team !== shot.team && actor.lane === shot.lane && Math.hypot(actor.x - shot.tx, actor.z - shot.tz) < 1.16) {
            damage.push({target:actor, amount:Math.round(shot.damage * .55)});
          }
        }
      }
      effect(s, shell ? 'blast' : 'impact', shot.tx, shot.tz, shot.ty, shot.team, shell ? .52 : .24);
      return false;
    });
  }
  return {point, ready, advance};
});
