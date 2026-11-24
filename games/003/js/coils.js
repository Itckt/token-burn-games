(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).coils = api;
})(globalThis, function () {
  'use strict';

  const SOCKETS = Object.freeze([-3.6, 0, 3.6]);
  const NAMES = Object.freeze(['Home', 'Center', 'Away']);
  const COST = 2, RECHARGE = 14, ARM = .6, WINDOW = 6, REACH = 1.3, HOLD = 2, DAMAGE = 18;
  const EPSILON = 1e-8;

  function create() {
    return {fields:[null, null], readyAt:[0, 0], caught:[0, 0]};
  }
  function nearestSocket(x) {
    if (!Number.isFinite(x)) return null;
    if (x < SOCKETS[0] / 2) return 0;
    if (x > SOCKETS[2] / 2) return 2;
    return 1;
  }
  function canPlace(s, team, lane, socket) {
    if ((team !== 0 && team !== 1) || (lane !== 0 && lane !== 1) ||
        !Number.isInteger(socket) || socket < 0 || socket >= SOCKETS.length) return 'Invalid coil position';
    if (s.phase !== 'playing') return s.phase === 'ready' ? 'Deploy a card first' : 'Coil requires a live match';
    if (s.age < s.coils.readyAt[team] - EPSILON) return 'Coil recharging';
    if (s.energy[team] + EPSILON < COST) return 'Need ' + COST + ' energy';
    return '';
  }
  function place(s, team, lane, socket) {
    const error = canPlace(s, team, lane, socket);
    if (error) return {ok:false, error};
    const armAt = s.age + ARM;
    s.coils.fields[team] = {lane, socket, armAt, expiresAt:armAt + WINDOW};
    s.coils.readyAt[team] = s.age + RECHARGE;
    s.energy[team] = Math.max(0, s.energy[team] - COST);
    return {ok:true};
  }
  function inField(unit, team, lane, socket) {
    return unit.hp > 0 && unit.team !== team && unit.lane === lane &&
      Math.abs(unit.x - SOCKETS[socket]) <= REACH + EPSILON;
  }
  function isSnared(unit, age) { return unit.snaredUntil > age + EPSILON; }
  function advance(s, damage, discharge) {
    for (let team = 0; team < 2; team++) {
      const field = s.coils.fields[team];
      if (!field || s.age < field.armAt - EPSILON) continue;
      if (s.age >= field.expiresAt - EPSILON) {
        s.coils.fields[team] = null;
        continue;
      }
      let count = 0;
      for (const unit of s.units) {
        if (!inField(unit, team, field.lane, field.socket)) continue;
        unit.snaredUntil = Math.max(unit.snaredUntil || 0, s.age + HOLD);
        damage.push({target:unit, amount:DAMAGE});
        count++;
      }
      if (count) {
        s.coils.fields[team] = null;
        s.coils.caught[team] += count;
        discharge(s, team, field, count);
      }
    }
  }
  function aiPlacement(s) {
    // Keep a cheap reinforcement in reserve. Spend a coil only on a group.
    if (s.energy[1] < COST + 2 || canPlace(s, 1, 0, 0)) return null;
    let choice = null, best = 1;
    for (let lane = 0; lane < 2; lane++) {
      for (let socket = SOCKETS.length - 1; socket >= 0; socket--) {
        let count = 0;
        for (const unit of s.units) if (inField(unit, 1, lane, socket)) count++;
        if (count > best) { best = count; choice = {lane, socket}; }
      }
    }
    return choice;
  }
  return {SOCKETS, NAMES, COST, RECHARGE, ARM, WINDOW, REACH, HOLD, DAMAGE,
    create, nearestSocket, canPlace, place, isSnared, advance, aiPlacement};
});
