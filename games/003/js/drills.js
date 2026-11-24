(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api = factory(load('freight'), load('salvage'));
  if (common) module.exports = api;
  else (root.Rift = root.Rift || {}).drills = api;
})(globalThis, function (Freight, Salvage) {
  'use strict';

  const FORMATS = Object.freeze({
    standard:{name:'Relay battle', duration:180, opening:'Opening move is yours. Deploy a card to start the clock.',
      brief:'Break both rival relays. When time expires, surviving relays decide the winner, then their combined health.'},
    freight:{name:'Freight Shift', duration:75, seed:1847, scoreTitles:['Your deliveries', 'Vanta deliveries'], opening:'The Kowloon Tong night canteen has two carts to fill. Deploy to push either cart.',
      brief:'Push either cart to the rival dock. The side with more nearby machines moves the cart. First to two deliveries wins. At 75 seconds the higher score wins and equal scores draw.'},
    salvage:{name:'Salvage Circuit', duration:72, seed:9317, scoreTitles:['Your banked fuses', 'Vanta banked fuses'],
      opening:'Two fuses on each bridge. Deploy a crew to collect them before the first uplink.',
      brief:'Collect loose fuses and protect your carriers. Every 12s both crews bank their loads. Wrecks spill their cargo and one extra fuse. Reach eight banked fuses with a lead, or lead at the final uplink.'},
    escort:{name:'Parcel Run', duration:55, seed:4213, drill:true, opening:'The HKBU studio model is packed. Deploy to escort the carrier on Lane A.',
      brief:'Escort the parcel carrier through the green arch on Lane A before time runs out. It waits behind enemies blocking its track.'},
    watch:{name:'Night Watch', duration:45, seed:8063, drill:true, opening:'The Lane B uplink is damaged. Deploy a card to begin the watch.',
      brief:'Keep your damaged Lane B relay online for 45 seconds. Three scheduled waves approach on that bridge.'}
  });
  const START_X = -4.8, GATE_X = 4.8, RELAY_HP = 270;
  const WAVES = [
    {at:5, cards:['ram', 'wasp']},
    {at:16, cards:['strider', 'mortar', 'strider']},
    {at:28, cards:['ram', 'wasp', 'splitpin', 'splitpin']}
  ];

  function prepare(s, spawn) {
    if (s.mode === 'freight') {
      s.objective = Freight.create();
      s.cache.phase = 'done';
      for (let team = 0; team < 2; team++) {
        const home = team === 0 ? -1 : 1;
        spawn(s, team, team, 'strider', home * 2.6, .16);
        spawn(s, team, 1 - team, 'ram', home * 2.4, -.16);
      }
    } else if (s.mode === 'salvage') {
      s.objective = Salvage.create();
      s.cache.phase = 'done';
      for (const team of [0, 1]) {
        const side = team === 0 ? -1 : 1;
        spawn(s, team, 0, 'strider', side * 2.15, side * .16);
        spawn(s, team, 1, 'ram', side * 2.55, side * .14);
      }
    } else if (s.mode === 'escort') {
      const carrier = spawn(s, 0, 0, 'carrier', START_X, -.57);
      s.objective = {carrierId:carrier.id};
      spawn(s, 0, 0, 'strider', -3.45, .19);
      spawn(s, 1, 0, 'ram', 1.8, .13);
      spawn(s, 1, 0, 'wasp', 4.1, -.28);
      spawn(s, 1, 1, 'strider', 2.4);
      spawn(s, 0, 0, 'ram', -2.5, -.18);
      s.aiIn = 9;
    } else if (s.mode === 'watch') {
      const relay = s.towers.find(t => t.team === 0 && t.lane === 1);
      relay.hp = RELAY_HP;
      s.objective = {relayId:relay.id, wave:0};
      spawn(s, 1, 1, 'ram', -.6, -.22);
      spawn(s, 1, 1, 'wasp', 1.3, .22);
      spawn(s, 0, 1, 'strider', -3.3);
    }
  }
  function sendWave(s, spawn) {
    if (s.mode !== 'watch') return 0;
    const wave = WAVES[s.objective.wave];
    if (!wave || s.age + 1e-8 < wave.at) return 0;
    wave.cards.forEach((id, i) => spawn(s, 1, 1, id, 5.2 + i * .48, i % 2 ? .32 : -.32));
    return ++s.objective.wave;
  }
  function subject(s) {
    if (s.mode === 'escort') return s.units.find(u => u.id === s.objective.carrierId);
    if (s.mode === 'watch') return s.towers.find(t => t.id === s.objective.relayId);
    return null;
  }
  function outcome(s) {
    if (s.mode === 'freight') return Freight.outcome(s);
    if (s.mode === 'salvage') return Salvage.outcome(s);
    const target = subject(s);
    if (s.mode === 'escort') {
      if (!target || target.hp <= 0) return {winner:1, reason:'Parcel carrier lost'};
      if (target.x >= GATE_X - 1e-8) return {winner:0, reason:'Parcel delivered'};
      if (s.time <= 0) return {winner:1, reason:'Delivery window closed'};
    } else if (s.mode === 'watch') {
      if (target.hp <= 0) return {winner:1, reason:'Watch relay fell'};
      if (s.time <= 0) return {winner:0, reason:'Watch complete'};
    }
    return null;
  }
  function readout(s) {
    if (s.mode === 'salvage') return Salvage.readout(s);
    if (s.mode === 'freight') {
      const [you, rival] = s.objective.score;
      return {text:'First to ' + Freight.TARGET + ' deliveries · You ' + you + ' / Vanta ' + rival};
    }
    const target = subject(s);
    if (s.mode === 'escort') {
      const x = target?.x ?? s.objective.lostAt ?? START_X;
      const progress = Math.min(1, Math.max(0, (x - START_X) / (GATE_X - START_X)));
      const condition = target ? target.hp + ' carrier HP' : 'Carrier lost';
      return {progress, text:'Lane A · ' + condition + ' · ' + Math.round(progress * 100) + '% of route'};
    }
    if (s.mode === 'watch') {
      const next = WAVES[s.objective.wave];
      let wave = 'Final wave sent';
      if (s.phase === 'ended') wave = 'Waves sent ' + s.objective.wave + '/' + WAVES.length;
      else if (next) wave = 'Wave ' + (s.objective.wave + 1) + '/' + WAVES.length + ' in ' + Math.max(0, Math.ceil(next.at - s.age - 1e-8)) + 's';
      return {progress:target.hp / target.maxHp, text:'Lane B · ' + target.hp + ' relay HP · ' + wave};
    }
    return null;
  }
  return {FORMATS, START_X, GATE_X, prepare, sendWave, subject, outcome, readout};
});
