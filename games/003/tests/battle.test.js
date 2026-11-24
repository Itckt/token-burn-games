'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const Roster = require('../js/roster');

function empty(options = {}) {
  return B.create({ai: false, opening: false, ...options});
}
function playing(options) {
  const s = empty(options);
  s.phase = 'playing';
  return s;
}
function steps(s, count) {
  for (let i=0; i<count; i++) B.tick(s);
}
function near(a,b,epsilon = 1e-7) {
  assert.ok(Math.abs(a-b) < epsilon, a + ' differs from ' + b);
}

test('opening patrols, towers and reserves are equal, and the clock waits for the player', () => {
  const s = B.create();
  assert.equal(s.phase, 'ready');
  assert.equal(s.time, 180);
  assert.deepEqual(s.energy, [7,7]);
  assert.deepEqual(s.destroyed, [0,0]);
  for (const team of [0,1]) {
    assert.deepEqual(s.units.filter(u => u.team === team).map(u => u.cardId).sort(), ['ram','strider','wasp']);
    for (const lane of [0,1]) {
      const t = s.towers.find(t => t.team === team && t.lane === lane);
      assert.equal(t.hp, B.TOWER_HP);
      assert.equal(t.z, B.LANES[lane]);
      assert.equal(t.x, team ? B.TOWER_X : -B.TOWER_X);
    }
  }
  const before = JSON.stringify(s);
  assert.equal(B.deploy(s,1,0,'ram').ok, false);
  steps(s,300);
  assert.equal(JSON.stringify(s), before);
});

test('each card deploys on the selected lane at the same cost for either side', () => {
  assert.equal(new Set(B.CARDS.map(c => c.id)).size, B.CARDS.length);
  for (const card of B.CARDS) for (const lane of [0,1]) {
    const deck = Roster.deckOrDefault();
    Roster.equip(deck, 0, card.id);
    const s = empty({deck});
    const left = B.deploy(s,0,lane,card.id), right = B.deploy(s,1,lane,card.id);
    assert.ok(left.ok && right.ok);
    assert.equal(s.phase, 'playing');
    assert.deepEqual(s.energy, [7-card.cost,7-card.cost]);
    assert.deepEqual(s.deployed, [1,1]);
    near(left.units.reduce((sum, u) => sum + u.z, 0) / left.units.length, B.LANES[lane]);
    assert.equal(left.unit.x, -right.unit.x);
    assert.ok(left.unit.x > -B.TOWER_X && left.unit.x < -5);
    assert.equal(left.unit.hp, card.hp);
    assert.equal(left.unit.x, left.unit.prevX);
    assert.equal(s.effects.filter(e => e.kind === 'deploy').length, 2 * (card.count || 1));
    assert.match(s.log[0].message, new RegExp(card.name + ' in Lane ' + B.laneName(lane)));
  }
});

test('invalid inputs and insufficient energy leave the entire state untouched', () => {
  const s = empty();
  s.energy[0] = 1.99;
  for (const [team,lane,id] of [[0,0,'strider'],[2,0,'ram'],[0,-1,'wasp'],[0,2,'ram'],[0,1,'???'],[0,1,'__proto__']]) {
    const before = JSON.stringify(s);
    const result = B.deploy(s,team,lane,id);
    assert.ok(!result.ok && result.error.length > 0);
    assert.equal(JSON.stringify(s), before);
  }
});

test('a card recharges across lanes while other cards remain playable', () => {
  const s = empty();
  assert.ok(B.deploy(s,0,0,'strider').ok);
  assert.equal(B.deploy(s,0,1,'strider').error, 'Card recharging');
  assert.ok(B.deploy(s,0,1,'ram').ok);
  steps(s,23);
  assert.equal(B.canDeploy(s,0,1,'strider'), 'Card recharging');
  B.tick(s);
  assert.ok(B.deploy(s,0,1,'strider').ok);
  assert.ok(s.energy[0] >= 0);
  assert.deepEqual(s.emitted[0], [1,2]);
});

test('energy regenerates continuously while playing and caps independently at ten', () => {
  const s = playing();
  s.energy = [0,9.9];
  steps(s,60);
  near(s.energy[0], B.ENERGY_RATE*2);
  assert.equal(s.energy[1], 10);
  steps(s,800);
  assert.deepEqual(s.energy, [10,10]);
});

test('pause restores either standby or play and freezes all combat and regeneration', () => {
  for (const initial of ['ready','playing']) {
    const s = empty();
    if (initial === 'playing') B.deploy(s,0,0,'ram');
    assert.ok(B.pause(s));
    const before = JSON.stringify(s);
    steps(s,150);
    assert.equal(B.deploy(s,0,0,'wasp').ok, false);
    assert.equal(JSON.stringify(s), before);
    assert.ok(B.pause(s));
    assert.equal(s.phase, initial);
  }
  const s = playing();
  for (const dt of [-1,0,NaN,Infinity]) B.tick(s,dt);
  assert.equal(s.age, 0);
});

test('units advance in opposite directions with interpolation history and stay in lane', () => {
  const s = playing();
  const a = B.spawn(s,0,0,'ram',-3), b = B.spawn(s,1,1,'ram',3);
  steps(s,30);
  near(a.x, -3+B.CARD.ram.speed);
  near(a.x, -b.x);
  near(a.prevX, a.x-B.CARD.ram.speed*B.STEP);
  assert.equal(a.z, B.LANES[0]);
  assert.equal(b.z, B.LANES[1]);
  assert.equal(s.shots.length, 0);
});

test('a backliner holds a firing position and queues allies in the same track', () => {
  const s = playing();
  const back = B.spawn(s,0,0,'strider',-.65), front = B.spawn(s,0,0,'mortar',0);
  B.spawn(s,1,0,'ram',3);
  for (const u of s.units) u.cooldown = 99;
  steps(s,18);
  near(front.x, 0);
  near(front.x-back.x, .64);
  assert.equal(front.moving, false);
  assert.equal(s.shots.length, 0);
});

test('targeting prioritizes the nearest living enemy unit in the same lane, then its tower', () => {
  const s = playing(), attacker = B.spawn(s,0,1,'wasp',5.8);
  B.spawn(s,0,1,'ram',5.9);
  B.spawn(s,1,0,'ram',5.82);
  B.spawn(s,1,1,'ram',6.1).hp = 0;
  const far = B.spawn(s,1,1,'ram',7.3), nearUnit = B.spawn(s,1,1,'ram',6.6);
  assert.equal(B.targetFor(s,attacker,3), nearUnit);
  nearUnit.hp = 0;
  assert.equal(B.targetFor(s,attacker,3), far);
  far.hp = 0;
  assert.equal(B.targetFor(s,attacker,3), s.towers[3]);
  s.towers[3].hp = 0;
  assert.equal(B.targetFor(s,attacker,3), null);
});

test('simultaneous melee strikes can eliminate both attackers on the same step', () => {
  const s = playing();
  for (const team of [0,1]) {
    const u = B.spawn(s,team,0,'strider',team ? .25 : -.25);
    u.hp = B.CARD.strider.damage;
    u.cooldown = 0;
  }
  B.tick(s);
  assert.equal(s.units.length, 0);
  assert.deepEqual(s.effects.map(e => e.kind).sort(), ['strike','strike','wreck','wreck']);
  assert.equal(s.shots.length, 0);
  steps(s,25);
  assert.equal(s.effects.length, 0);
});

test('a ram lunges, deals its printed damage and waits its full attack interval', () => {
  const s = playing(), ram = B.spawn(s,0,0,'ram',-.45), foe = B.spawn(s,1,0,'ram',.45);
  ram.cooldown = 0;
  foe.cooldown = 20;
  B.tick(s);
  assert.equal(ram.fire, 1);
  assert.equal(foe.hit, 1);
  assert.equal(foe.hp, foe.maxHp-B.CARD.ram.damage);
  steps(s,35);
  assert.equal(foe.hp, foe.maxHp-B.CARD.ram.damage);
  B.tick(s);
  assert.equal(foe.hp, foe.maxHp-2*B.CARD.ram.damage);
});

test('a ranged pulse tracks its moving target and deals damage on arrival exactly once', () => {
  const s = playing(), shooter = B.spawn(s,0,1,'wasp',-1.3), target = B.spawn(s,1,1,'ram',1.2);
  shooter.cooldown = 0;
  B.tick(s);
  const shot = s.shots[0];
  assert.equal(shot.type, 'pulse');
  assert.equal(shot.targetId, target.id);
  assert.equal(target.hp, target.maxHp);
  const following = target.x;
  B.tick(s);
  near(shot.tx, following);
  steps(s,18);
  assert.equal(s.shots.length, 0);
  assert.equal(target.hp, target.maxHp-B.CARD.wasp.damage);
});

test('artillery arcs above its endpoints and splash is restricted to nearby enemies', () => {
  const s = playing(), shooter = B.spawn(s,0,0,'mortar',-2.2);
  const target = B.spawn(s,1,0,'ram',.3), close = B.spawn(s,1,0,'ram',1.05);
  const far = B.spawn(s,1,0,'ram',3), friend = B.spawn(s,0,0,'ram',.93), across = B.spawn(s,1,1,'ram',.35);
  for (const u of s.units) u.cooldown = 99;
  shooter.cooldown = 0;
  B.tick(s);
  const p = s.shots[0];
  assert.equal(p.type, 'shell');
  assert.deepEqual(B.shotPoint(p,-4), [p.x,p.y,p.z]);
  assert.ok(B.shotPoint(p,.5)[1] > Math.max(p.y,p.ty)+1);
  near(B.shotPoint(p,2)[1], p.ty);
  steps(s,20);
  assert.equal(target.hp, target.maxHp-46);
  assert.equal(close.hp, close.maxHp-25);
  for (const u of [far,friend,across]) assert.equal(u.hp, u.maxHp);
  assert.ok(s.effects.some(e => e.kind === 'blast'));
});

test('a projectile can finish after its target is destroyed without damaging allies or reviving it', () => {
  const s = playing(), shooter = B.spawn(s,0,0,'wasp',-1), target = B.spawn(s,1,0,'strider',1);
  shooter.cooldown = 0;
  B.tick(s);
  const lastX = s.shots[0].tx;
  s.units = [shooter];
  steps(s,6);
  assert.equal(s.shots.length, 0);
  assert.equal(shooter.hp, shooter.maxHp);
  assert.ok(!s.units.includes(target));
  assert.ok(s.effects.some(e => e.kind === 'impact' && e.x === lastX));
});

test('each relay protects its own lane and a destroyed relay cannot fire', () => {
  const s = playing(), intruder = B.spawn(s,1,0,'ram',-5);
  s.towers.forEach(t => { t.cooldown = 0; });
  B.tick(s);
  assert.equal(s.shots.length, 1);
  const shot = s.shots[0];
  assert.deepEqual([shot.type,shot.team,shot.lane,shot.targetId], ['relay',0,0,intruder.id]);
  steps(s,10);
  assert.equal(intruder.hp, intruder.maxHp-24);
  s.towers[0].hp = 0;
  steps(s,38);
  assert.equal(intruder.hp, intruder.maxHp-24);
});

test('AI reinforces a threatened lane and pays the same cost and per-card lock as the player', () => {
  const s = playing({ai:true,seed:125});
  for (let i=0; i<5; i++) B.spawn(s,0,1,'strider',2+i*.5,i*.12);
  s.energy[1] = 3;
  s.locks[1] = {strider:10,wasp:10,mortar:10};
  s.aiIn = 0;
  B.tick(s);
  assert.deepEqual(s.deployed, [0,1]);
  const unit = s.units.find(u => u.team === 1);
  assert.deepEqual([unit.lane,unit.cardId], [1,'ram']);
  near(s.energy[1], B.STEP*B.ENERGY_RATE);
  near(s.locks[1].ram, s.age+B.CARD_LOCK);
  assert.equal(B.aiChoice(s), null);
});

test('both final relays can fall simultaneously and final scores and logs are stable', () => {
  const s = playing();
  s.towers[0].hp = s.towers[3].hp = 18;
  s.towers[1].hp = s.towers[2].hp = 0;
  B.spawn(s,1,0,'strider',-B.TOWER_X+.7).cooldown = 0;
  B.spawn(s,0,1,'strider',B.TOWER_X-.7).cooldown = 0;
  B.tick(s);
  assert.equal(s.phase, 'ended');
  assert.equal(s.reason, 'Relay destruction');
  assert.equal(s.winner, null);
  assert.deepEqual(s.destroyed,[2,2]);
  const final = JSON.stringify(s);
  assert.equal(B.pause(s), false);
  assert.equal(B.deploy(s,0,0,'ram').ok, false);
  B.checkEnd(s);
  steps(s,60);
  assert.equal(JSON.stringify(s), final);
});

test('at exactly three minutes, standing relays take priority over health, then ties draw', () => {
  for (const [hp,winner] of [[[1,1,620,0],0],[[200,210,205,211],1],[[620,0,0,620],null]]) {
    const s = playing();
    s.towers.forEach((t,i) => { t.hp = hp[i]; });
    steps(s,Math.round(B.DURATION/B.STEP));
    assert.equal(s.phase, 'ended');
    assert.equal(s.time, 0);
    assert.equal(s.age, B.DURATION);
    assert.equal(s.winner, winner);
    assert.equal(s.reason, 'Time limit');
  }
  assert.equal(B.formatTime(180), '03:00');
  assert.equal(B.formatTime(60.00000000002), '01:00');
  assert.equal(B.formatTime(59.02), '01:00');
  assert.equal(B.formatTime(2.01), '00:03');
  assert.equal(B.formatTime(-1), '00:00');
});

test('fixed steps agree across frame rates and discard excessive catch-up after a stall', () => {
  const results = [30,60,144].map(fps => {
    const s = playing(), clock = new B.FixedClock();
    B.deploy(s,0,1,'strider');
    for (let i=0; i<fps*6; i++) clock.advance(1/fps, dt => B.tick(s,dt));
    near(clock.alpha, 0);
    return JSON.stringify(s);
  });
  assert.equal(new Set(results).size, 1);
  const clock = new B.FixedClock(), deltas = [];
  for (const dt of [NaN,-.5,0,Infinity,10]) clock.advance(dt, d => deltas.push(d));
  assert.equal(deltas.length, 7);
  assert.ok(deltas.every(dt => dt === B.STEP));
  near(clock.alpha, .5);
});

test('seeded full matches reach a valid result, respect live bounds and replay deterministically', () => {
  function play(seed) {
    const s = B.create({seed});
    B.deploy(s,0,1,'strider');
    for (let i=0; i<5500 && s.phase === 'playing'; i++) {
      if (i % 90 === 0) {
        const turn = i/90;
        B.deploy(s,0,turn%2,B.CARDS[turn%4].id);
      }
      B.tick(s);
      if (i % 30 === 0) {
        assert.ok(s.energy.every(v => v >= 0 && v <= B.MAX_ENERGY));
        assert.ok(s.units.every(u => u.hp > 0 && u.hp <= u.maxHp && Math.abs(u.x) < 9.75));
        assert.ok(s.towers.every(t => t.hp >= 0 && t.hp <= t.maxHp));
        const ids = [...s.units,...s.towers,...s.effects,...s.shots,...s.log].map(o => o.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(s.log.length <= 30);
      }
    }
    assert.equal(s.phase, 'ended');
    assert.ok(s.deployed.every(n => n >= 2));
    assert.ok(s.log.every((e,i) => !i || s.log[i-1].id > e.id));
    return JSON.stringify(s);
  }
  const first = play(408);
  assert.equal(first, play(408));
  assert.notEqual(first, play(178));
});
