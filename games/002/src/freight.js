(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const Pickup = node ? require("./pickup.js") : Slipwake.pickup;
  const RULES = Object.freeze({target: 2, terminal: 8.4, radius: 2.05, speed: 1.65, extraSpeed: 0.3, resetTime: 2});

  function create() {
    return {x: 0, z: 0, owner: null, escorts: 0, contested: false, resetLeft: 0};
  }
  function advance(cart, actors, dt) {
    if (dt < 0 || !Number.isFinite(dt)) return null;
    if (cart.resetLeft > 0) {
      const wait = Math.min(dt, cart.resetLeft);
      cart.resetLeft -= wait;
      if (cart.resetLeft > 1e-8) return null;
      Object.assign(cart, create());
      dt -= wait;
      if (dt < 1e-8) dt = 0;
    }
    const claim = Pickup.claim(actors, cart, RULES.radius);
    cart.owner = claim.runner?.team ?? null;
    cart.escorts = claim.contested ? 0 : claim.count;
    cart.contested = claim.contested;
    if (cart.owner === null || dt === 0) return null;

    const direction = cart.owner === 0 ? 1 : -1;
    const speed = RULES.speed + (cart.escorts-1)*RULES.extraSpeed;
    const distance = RULES.terminal - direction*cart.x;
    if (speed*dt < distance-1e-8) {
      cart.x += direction*speed*dt;
      return null;
    }
    const escorts = actors.filter(a => Pickup.inReach(a, cart, RULES.radius)).map(a => a.id);
    cart.x = direction*RULES.terminal;
    cart.resetLeft = RULES.resetTime;
    return {team: cart.owner, escorts, x: cart.x, z: cart.z};
  }
  // Each crew approaches from its own end and occupies separate spots around the hopper.
  const berths = [[-0.8,0], [0.25,-1.1], [0.25,1.1]];
  function destination(cart, actor) {
    const [x,z] = berths[actor.id % 3], direction = actor.team === 0 ? 1 : -1;
    return {x: (cart.resetLeft > 0 ? 0 : cart.x) + direction*x, z: direction*z};
  }
  const api = {RULES, create, advance, destination};
  if (node) module.exports = api;
  else (globalThis.Slipwake ||= {}).freight = api;
})();
