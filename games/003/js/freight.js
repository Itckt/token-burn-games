(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./coils.js') : root.Rift.coils);
  if (common) module.exports = api;
  else (root.Rift = root.Rift || {}).freight = api;
})(globalThis, function (Coils) {
  'use strict';

  const DOCK = 4.8, REACH = 1.8, RELOAD = 4, TARGET = 2, MAX_ESCORTS = 3;
  const EPSILON = 1e-8;
  function create() {
    const carts = [0, 1].map(() => ({x:0, prevX:0, escorts:[0, 0], returnAt:null}));
    return {carts, score:[0, 0]};
  }
  function advance(s, from, to, onDelivery) {
    const {carts, score} = s.objective;
    carts.forEach((cart, lane) => {
      let start = from;
      cart.prevX = cart.x;
      if (cart.returnAt !== null) {
        if (to < cart.returnAt - EPSILON) return;
        start = Math.max(from, cart.returnAt);
        cart.prevX = cart.x = 0;
        cart.returnAt = null;
      }
      cart.escorts.fill(0);
      for (const u of s.units) {
        if (u.hp > 0 && u.lane === lane && !Coils.isSnared(u, to) && Math.abs(u.x - cart.x) <= REACH + EPSILON) {
          cart.escorts[u.team] = Math.min(MAX_ESCORTS, cart.escorts[u.team] + 1);
        }
      }
      const push = cart.escorts[0] - cart.escorts[1];
      if (!push) return;
      const speed = .85 + .25 * (Math.abs(push) - 1);
      cart.x += Math.sign(push) * speed * Math.max(0, to - start);
      if (Math.abs(cart.x) < DOCK - EPSILON) return;
      const team = push > 0 ? 0 : 1;
      cart.x = team === 0 ? DOCK : -DOCK;
      cart.returnAt = to + RELOAD;
      cart.escorts.fill(0);
      score[team]++;
      onDelivery(s, team, lane);
    });
  }
  function outcome(s) {
    const [you, rival] = s.objective.score;
    const delivered = Math.max(you, rival) >= TARGET;
    if (!delivered && s.time > 0) return null;
    const winner = you === rival ? null : you > rival ? 0 : 1;
    return {winner, reason:delivered ? 'Freight delivered' : 'Freight time limit'};
  }
  function status(cart, age) {
    if (cart.returnAt !== null) return 'Reload ' + Math.max(0, Math.ceil(cart.returnAt - age - EPSILON)) + 's';
    const [you, rival] = cart.escorts;
    if (you === rival) return you ? 'Contested' : 'Idle';
    return you > rival ? 'You push' : 'Vanta pushes';
  }
  return {DOCK, REACH, RELOAD, TARGET, MAX_ESCORTS, create, advance, outcome, status};
});
