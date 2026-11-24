(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).signal = api;
})(globalThis, function () {
  'use strict';

  const FIRST = 8, INTERVAL = 30, WINDOW = 12, HOLD = 2, REWARD = 2, REACH = 1.6;
  const EPSILON = 1e-8;

  function create(lane = 0, opensAt = FIRST) {
    return {lane, opensAt, phase: 'incoming', holder: null, held: 0, contested: false};
  }

  // The battle supplies one fixed step and the units that survived it. Clip the
  // interval so the opening tick never awards time spent waiting for the cache.
  function advance(cache, units, from, to, matchEnd) {
    if (cache.phase === 'done' || to < cache.opensAt - EPSILON) return null;
    const closesAt = Math.min(cache.opensAt + WINDOW, matchEnd);
    if (cache.phase === 'incoming') cache.phase = 'open';
    let claim = null;
    if (cache.phase === 'open') {
      let presence = 0;
      for (const unit of units) {
        if (unit.hp > 0 && unit.lane === cache.lane && Math.abs(unit.x) <= REACH) {
          presence |= 1 << unit.team;
        }
      }
      const holder = presence === 1 ? 0 : presence === 2 ? 1 : null;
      cache.contested = presence === 3;
      if (holder !== cache.holder || holder === null) cache.held = 0;
      cache.holder = holder;
      if (holder !== null) {
        cache.held += Math.max(0, Math.min(to, closesAt) - Math.max(from, cache.opensAt));
        if (cache.held >= HOLD - EPSILON) {
          cache.held = HOLD;
          cache.phase = 'claimed';
          claim = {team: holder, lane: cache.lane};
        }
      }
    }
    if (to >= closesAt - EPSILON) {
      const next = create(1 - cache.lane, cache.opensAt + INTERVAL);
      if (next.opensAt >= matchEnd) next.phase = 'done';
      Object.assign(cache, next);
    }
    return claim;
  }

  return {FIRST, INTERVAL, WINDOW, HOLD, REWARD, REACH, create, advance};
});
