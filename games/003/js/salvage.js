(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).salvage = api;
})(globalThis, function () {
  'use strict';

  const INTERVAL = 12, TARGET = 8, CAPACITY = 3, REACH = 1.25, EPSILON = 1e-8;

  function create() {
    return {
      piles:[0, 1].map(lane => ({lane, x:0, amount:2})),
      score:[0, 0], nextBankAt:INTERVAL
    };
  }
  function drop(s, unit) {
    s.objective.piles.push({lane:unit.lane, x:unit.x, amount:1 + (unit.cargo || 0)});
    unit.cargo = 0;
  }
  function collect(pile, units) {
    const crew = [];
    let side = null;
    for (const unit of units) {
      if (unit.hp <= 0 || unit.lane !== pile.lane || Math.abs(unit.x - pile.x) > REACH + EPSILON) continue;
      if (side !== null && side !== unit.team) return;
      side = unit.team;
      if ((unit.cargo || 0) < CAPACITY) crew.push(unit);
    }
    crew.sort((a, b) => Math.abs(a.x - pile.x) - Math.abs(b.x - pile.x) || a.id - b.id);
    for (const unit of crew) {
      const amount = Math.min(pile.amount, CAPACITY - (unit.cargo || 0));
      unit.cargo = (unit.cargo || 0) + amount;
      pile.amount -= amount;
      if (!pile.amount) break;
    }
  }
  function carried(s) {
    const total = [0, 0];
    for (const unit of s.units) total[unit.team] += unit.cargo || 0;
    return total;
  }
  // Combat and pickups settle before either crew transmits, including at the horn.
  function advance(s, onBank) {
    const field = s.objective;
    for (const pile of field.piles) collect(pile, s.units);
    field.piles = field.piles.filter(pile => pile.amount > 0);
    if (field.nextBankAt === null || s.age + EPSILON < field.nextBankAt) return;
    const banked = carried(s);
    for (let team = 0; team < 2; team++) field.score[team] += banked[team];
    field.nextBankAt = s.time > 0 ? Math.min(s.duration, field.nextBankAt + INTERVAL) : null;
    if (banked[0] || banked[1]) onBank(s, banked);
    for (const unit of s.units) if (unit.cargo) unit.cargo = 0;
  }
  function outcome(s) {
    const [you, rival] = s.objective.score;
    if (s.time > 0 && (Math.max(you, rival) < TARGET || you === rival)) return null;
    return {winner:you === rival ? null : you > rival ? 0 : 1,
      reason:s.time <= 0 ? 'Final uplink' : 'Fuse target reached'};
  }
  function lanePriority(s, lane) {
    let value = 0;
    for (const pile of s.objective.piles) if (pile.lane === lane) value += .32 * pile.amount;
    for (const unit of s.units) if (unit.lane === lane && unit.cargo) value += .21 * unit.cargo;
    return Math.min(3, value);
  }
  function readout(s) {
    const field = s.objective;
    if (s.phase === 'ended') return {text:'Banked fuses · You ' + field.score[0] + ' / Vanta ' + field.score[1]};
    const remaining = Math.max(0, field.nextBankAt - s.age);
    return {text:'Next uplink in ' + Math.ceil(remaining - EPSILON) + 's · First to ' + TARGET,
      progress:Math.min(1, Math.max(0, 1 - remaining / INTERVAL))};
  }
  return {INTERVAL, TARGET, CAPACITY, REACH, create, drop, advance, carried, outcome, lanePriority, readout};
});
