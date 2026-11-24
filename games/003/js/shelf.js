(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api = factory(load('replay'), load('roster'), load('drills'), load('battle'), load('coils'));
  if (common) module.exports = api;
  else root.Rift.shelf = api;
})(globalThis, function (Replay, Roster, Drills, B, Coils) {
  'use strict';

  // A rules change that affects playback needs a new film version.
  const KEY = 'rift-relay.shelf.v1', LIMIT = 3;
  function valid(entry) {
    if (!entry || entry.version !== 1) return false;
    const {setup, ticks, winner, orders} = entry;
    if (!setup || typeof setup.mode !== 'string' || !Object.hasOwn(Drills.FORMATS, setup.mode) ||
        !Roster.validDeck(setup.deck) || typeof setup.ai !== 'boolean' || typeof setup.opening !== 'boolean' ||
        !Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > 0xffffffff) return false;
    if (!Number.isInteger(ticks) || ticks <= 0 || ticks > Math.ceil(Drills.FORMATS[setup.mode].duration / B.STEP) ||
        ![0, 1, null].includes(winner) || !Array.isArray(orders) || !orders.length || orders.length > 256 ||
        orders[0]?.step !== 0 || orders[0]?.kind !== 'deploy') return false;
    let previous = 0;
    for (const order of orders) {
      if (!order || !Number.isInteger(order.step) || order.step < previous || order.step >= ticks || ![0, 1].includes(order.lane)) return false;
      if (order.kind === 'deploy') {
        if (!setup.deck.includes(order.card)) return false;
      } else if (order.kind === 'coil') {
        if (!Number.isInteger(order.socket) || order.socket < 0 || order.socket >= Coils.SOCKETS.length) return false;
      } else if (order.kind !== 'guard') return false;
      previous = order.step;
    }
    return true;
  }
  function pack(tape) {
    if (!tape.setup || tape.match.phase !== 'ended') return null;
    return {version:1, setup:{...tape.setup, deck:[...tape.setup.deck]}, ticks:tape.length, winner:tape.match.winner,
      orders:tape.orders.map(order => ({...order}))};
  }
  function rebuild(entry) {
    if (!valid(entry)) return null;
    const tape = new Replay.Recording(entry.setup);
    let cursor = 0;
    while (tape.length < entry.ticks) {
      while (entry.orders[cursor]?.step === tape.length) {
        const order = entry.orders[cursor++];
        if (!tape.order(order.kind, order.lane, order.kind === 'coil' ? order.socket : order.card).ok) return null;
      }
      if (tape.match.phase !== 'playing') return null;
      tape.advance();
    }
    return tape.match.phase === 'ended' && tape.match.winner === entry.winner ? tape : null;
  }
  function read(storage) {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 128 * 1024) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter(valid).slice(0, LIMIT) : [];
    } catch { return []; }
  }
  function create(getStorage) {
    let storage, entries = [];
    try { storage = getStorage(); entries = read(storage); }
    catch { storage = null; }
    return {
      get entries() { return entries; },
      get persistent() { return Boolean(storage); },
      keep(tape) {
        const entry = pack(tape);
        if (!entry) return;
        if (storage) {
          // Preserve matches finished in another tab since this shelf was opened.
          try { entries = read(storage); } catch { storage = null; }
        }
        entries = [entry, ...entries].slice(0, LIMIT);
        if (storage) {
          try { storage.setItem(KEY, JSON.stringify(entries)); }
          catch { storage = null; }
        }
      }
    };
  }
  return {KEY, LIMIT, create, pack, rebuild};
});
