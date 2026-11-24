(() => {
  "use strict";
  const RULES = Object.freeze({
    capacity: 6, initial: 4, chargeTime: 3, repair: 32, repairRadius: 3.8,
    boltDamage: 18, spread: 0.19, netRadius: 2.25, netTime: 3.2,
    bankDamage: 34, bankLife: 1.15, haulReach: 7, haulDistance: 2.8
  });
  const cards = Object.freeze({
    fork: {name: "Fork coil", cost: 3, help: "Fire three bolts in a fan along your aim."},
    patch: {name: "Patch reel", cost: 2, help: "Restore up to 32 health to you and nearby crewmates in sight.", denied: "No injured crewmate in reach"},
    net: {name: "Catch net", cost: 3, help: "Anchor a field at your feet that catches incoming enemy bolts for 3.2 seconds."},
    bank: {name: "Bank lens", cost: 3, help: "Fire a 34-damage bolt that reflects once off cargo or cover."},
    haul: {name: "Haul line", cost: 2, help: "Pull the first exposed rival on your aim line toward you. A miss keeps the card.", denied: "No exposed rival on the line"}
  });
  const starter = Object.freeze(["fork", "patch", "net"]);
  function valid(loadout) {
    return Array.isArray(loadout) && loadout.length === 3 && new Set(loadout).size === 3 &&
      Array.from(loadout).every(id => typeof id === "string" && Object.hasOwn(cards,id));
  }
  function create(loadout) {
    const [first,second,reserve] = valid(loadout) ? loadout : starter;
    return {hand: [first,second], reserve, energy: RULES.initial, charge: 0};
  }
  function arrange(loadout, slot, card) {
    if (!valid(loadout) || !Number.isInteger(slot) || slot < 0 || slot > 2 ||
        typeof card !== "string" || !Object.hasOwn(cards,card)) return loadout;
    const next = loadout.slice(), oldSlot = next.indexOf(card);
    if (oldSlot >= 0) next[oldSlot] = next[slot];
    next[slot] = card;
    return next;
  }
  function recharge(deck, dt) {
    if (deck.energy >= RULES.capacity || !(dt > 0) || !Number.isFinite(dt)) return;
    deck.charge += dt;
    const units = Math.floor((deck.charge + 1e-8) / RULES.chargeTime);
    deck.energy = Math.min(RULES.capacity, deck.energy + units);
    deck.charge = deck.energy === RULES.capacity ? 0 : Math.max(0, deck.charge - units * RULES.chargeTime);
  }
  // Commit the exchange only after the card's effect succeeds.
  function play(deck, slot, apply) {
    if (slot !== 0 && slot !== 1) return "Choose a card slot";
    const card = deck.hand[slot], cost = cards[card].cost;
    if (deck.energy < cost) return "Need " + cost + " energy";
    if (!apply(card)) return cards[card].denied || "Card unavailable";
    deck.energy -= cost;
    deck.hand[slot] = deck.reserve;
    deck.reserve = card;
    return null;
  }
  const api = {RULES, cards, starter, create, arrange, recharge, play};
  if (typeof module === "object" && module.exports) module.exports = api;
  else (globalThis.Slipwake ||= {}).deck = api;
})();
