(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).roster = api;
})(globalThis, function () {
  'use strict';

  const CARDS = Object.freeze([
    {id:'strider', name:'Arc Strider', role:'Skirmisher', color:'#54eedf', cost:2, hp:108, speed:1.17, range:.92, damage:18, cycle:.66, shot:'arc', height:.91, scale:.53, label:1.85,
      info:'Fast twin blades close the gap on ranged units.'},
    {id:'ram', name:'Kiln Ram', role:'Vanguard', color:'#ff9b69', cost:3, hp:248, speed:.68, range:1.03, damage:31, cycle:1.18, shot:'ram', height:.82, scale:.59, label:1.47,
      info:'Heavy front armor absorbs fire for a backline push.'},
    {id:'wasp', name:'Prism Wasp', role:'Marksman', color:'#c399ff', cost:3, hp:88, speed:.88, range:3.15, damage:21, cycle:1.1, shot:'pulse', height:1.08, scale:.55, label:1.44,
      hover:true, info:'A hovering marksman fires from behind your frontline.'},
    {id:'mortar', name:'Coil Mortar', role:'Artillery', color:'#efcd73', cost:5, hp:156, speed:.53, range:4, damage:46, cycle:2.05, shot:'shell', height:1.08, scale:.56, label:1.67,
      info:'Long-range shells deal splash damage to clustered units.'},
    {id:'tender', name:'Loom Tender', role:'Repair crew', color:'#aff29d', cost:3, hp:102, speed:.89, range:1.85, damage:9, cycle:1.15, shot:'pulse', height:1.02, scale:.57, label:1.44, repair:24, repairRange:2.65,
      info:'Stitches 24 HP onto the most wounded nearby ally in its lane. Fires a short pulse when the crew is free.'},
    {id:'splitpin', name:'Splitpin Pair', role:'Twin scouts', color:'#91baff', cost:3, hp:62, speed:1.26, range:.76, damage:11, cycle:.70, shot:'arc', height:.58, scale:.51, label:1.08, count:2,
      info:'One card sends two light scouts down separate tracks. Each has 62 HP and its own attack.'},
    {id:'skiff', name:'Pleat Skiff', role:'Interceptor', color:'#ffc990', cost:4, hp:118, speed:.82, range:2.15, damage:13, cycle:1.15, shot:'pulse', height:1.12, scale:.55, label:1.59,
      hover:true, screenRange:1.6, screenRecharge:4,
      info:'Its folding screen catches one enemy shot within 1.6 units every 4s, including a whole mortar shell. Its own pulse fires independently.'}
  ].map(Object.freeze));
  const CARD = Object.freeze(Object.fromEntries(CARDS.map(card => [card.id, card])));
  const UNIT = Object.freeze({...CARD, carrier:Object.freeze({
    id:'carrier', hp:185, speed:.64, range:.84, damage:0, height:.92, scale:.59, label:1.46
  })});
  const DEFAULT_DECK = Object.freeze(['strider', 'ram', 'wasp', 'mortar']);

  function validDeck(deck) {
    return Array.isArray(deck) && deck.length === DEFAULT_DECK.length &&
      new Set(deck).size === deck.length && Array.from(deck).every(id => typeof id === 'string' && Object.hasOwn(CARD, id));
  }
  function deckOrDefault(deck) {
    return [...(validDeck(deck) ? deck : DEFAULT_DECK)];
  }
  function equip(deck, slot, id) {
    if (!validDeck(deck) || !Number.isInteger(slot) || slot < 0 || slot >= deck.length || typeof id !== 'string' || !Object.hasOwn(CARD, id)) return false;
    const previous = deck.indexOf(id);
    if (previous !== -1) deck[previous] = deck[slot];
    deck[slot] = id;
    return true;
  }
  return {CARDS, CARD, UNIT, DEFAULT_DECK, validDeck, deckOrDefault, equip};
});
