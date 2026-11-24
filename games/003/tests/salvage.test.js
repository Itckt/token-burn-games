'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const S = require('../js/salvage');
const D = require('../js/drills');

function field() {
  const s = B.create({mode:'salvage', ai:false});
  s.phase = 'playing';
  s.units = [];
  s.objective.piles = [];
  s.towers.forEach(t => { t.cooldown = 100; });
  return s;
}
function beforeUplink(s, at) {
  s.age = at - B.STEP;
  s.time = s.duration - s.age;
  s.objective.nextBankAt = at;
}
function bolt(s, target, damage) {
  s.shots.push({id:s.nextId++, team:1-target.team, lane:target.lane, type:'pulse', targetId:target.id,
    x:target.x-.1, y:1, z:target.z, tx:target.x, ty:1, tz:target.z, age:0, duration:B.STEP, damage});
}

test('Salvage Circuit starts with mirrored patrols and two unclaimed fuses per bridge', () => {
  const s = B.create({mode:'salvage'});
  const initial = JSON.stringify(s);
  B.tick(s,20);
  assert.equal(JSON.stringify(s),initial);
  assert.equal(s.duration,72);
  assert.deepEqual(s.objective.piles,[{lane:0,x:0,amount:2},{lane:1,x:0,amount:2}]);
  assert.equal(s.cache.phase,'done');
  assert.deepEqual(S.carried(s),[0,0]);
  assert.equal(s.objective.nextBankAt,12);
  assert.match(D.readout(s).text,/uplink in 12s/);
  for (const u of s.units.filter(u => u.team === 0)) {
    assert.ok(s.units.some(v => v.team === 1 && v.lane === u.lane && v.cardId === u.cardId && v.x === -u.x));
  }
  assert.ok(B.deploy(s,0,1,'ram').ok);
});

test('a full carrier still contests a pile and dead, distant or opposite-lane machines cannot claim it', () => {
  const s = field(), pile = {lane:0,x:0,amount:2};
  s.objective.piles = [pile];
  const ally = B.spawn(s,0,0,'strider',-S.REACH);
  const foe = B.spawn(s,1,0,'strider',S.REACH);
  foe.cargo = S.CAPACITY;
  B.spawn(s,1,1,'strider',0);
  B.spawn(s,1,0,'ram',S.REACH+.0001);
  S.advance(s);
  assert.equal(pile.amount,2);
  assert.equal(ally.cargo,undefined);
  foe.hp = 0;
  S.advance(s);
  assert.equal(ally.cargo,2);
  assert.deepEqual(s.objective.piles,[]);
});

test('pickups go to the closest crew with room, break exact ties by ID and leave overflow on the ground', () => {
  const s = field(), pile = {lane:1,x:2,amount:6};
  const near = B.spawn(s,0,1,'ram',2), older = B.spawn(s,0,1,'strider',1.5), newer = B.spawn(s,0,1,'strider',2.5);
  near.cargo = 2;
  s.units.reverse();
  s.objective.piles = [pile];
  S.advance(s);
  assert.deepEqual([near.cargo,older.cargo,newer.cargo],[3,3,2]);
  s.objective.piles.push({lane:1,x:2,amount:4});
  S.advance(s);
  assert.equal(newer.cargo,3);
  assert.deepEqual(s.objective.piles,[{lane:1,x:2,amount:3}]);
  assert.deepEqual(S.carried(s),[9,0]);
});

test('a wreck spills hull and cargo exactly once and the surviving crew can bank it on the same tick', () => {
  const s = field(), victim = B.spawn(s,0,1,'ram',.3), collector = B.spawn(s,1,1,'strider',.4);
  victim.cargo = 3;
  bolt(s,victim,999);
  bolt(s,victim,999);
  bolt(s,s.towers[0],999); // Relays have no salvage cargo.
  beforeUplink(s,12);
  B.tick(s);
  assert.deepEqual(s.objective.score,[0,3]);
  assert.deepEqual(s.objective.piles,[{lane:1,x:.3,amount:1}]);
  assert.equal(collector.cargo,0);
  assert.equal(s.effects.filter(e => e.kind === 'transmit').length,1);
  assert.equal(s.log.filter(e => e.kind === 'uplink').length,1);
  assert.match(s.log[0].message,/Vanta banked 3 fuses/);
  B.tick(s);
  assert.equal(collector.cargo,1);
  assert.equal(s.objective.nextBankAt,24);
  assert.deepEqual(s.objective.score,[0,3]);
});

test('mutual knockouts release both loads and nobody banks a fuse posthumously', () => {
  const s = field();
  for (const team of [0,1]) {
    const scout = B.spawn(s,team,0,'strider',team ? .2 : -.2);
    scout.hp = scout.cargo = 2;
    scout.cooldown = 0;
  }
  beforeUplink(s,12);
  B.tick(s);
  assert.deepEqual(s.units,[]);
  assert.deepEqual(s.objective.score,[0,0]);
  assert.deepEqual(s.objective.piles.map(p => p.amount),[3,3]);
  assert.equal(s.effects.some(e => e.kind === 'uplink'),false);
});

test('a tied target plays on, both banks settle before victory and a tied final uplink draws', () => {
  for (const [at, pending, winner, ended] of [[12,[1,1],null,false],[12,[1,2],1,true],
    [72,[2,1],0,true],[72,[1,1],null,true],[72,[0,0],null,true]]) {
    const s = field();
    s.objective.score = [7,7];
    for (const team of [0,1]) B.spawn(s,team,team,'ram',0).cargo = pending[team];
    beforeUplink(s,at);
    B.pause(s);
    const paused = JSON.stringify(s);
    B.tick(s,2);
    assert.equal(JSON.stringify(s),paused);
    B.pause(s);
    B.tick(s);
    assert.equal(s.phase === 'ended',ended);
    assert.equal(s.winner,winner);
    assert.deepEqual(s.objective.score,pending.map(x => 7+x));
    assert.deepEqual(S.carried(s),[0,0]);
    if (at === 72) assert.equal(s.objective.nextBankAt,null);
  }
});

test('salvage crews hold a fallen relay and can still transmit their cargo there', () => {
  const s = field();
  for (const t of s.towers) t.hp = 0;
  for (const team of [0,1]) {
    const end = team ? -B.TOWER_X : B.TOWER_X;
    B.spawn(s,team,team,'strider',end*.998).cargo = 2;
  }
  B.tick(s,12);
  assert.deepEqual(s.units.map(u => u.x),[B.TOWER_X,-B.TOWER_X]);
  assert.deepEqual(s.objective.score,[2,2]);
  assert.equal(s.phase,'playing');
});

test('Vanta values a fuse pile or loaded carrier on a quiet bridge', () => {
  const s = field();
  s.random = () => .5;
  for (const lane of [0,1]) {
    s.units = [];
    s.objective.piles = [{lane,x:0,amount:3}];
    assert.equal(B.aiChoice(s).lane,lane);
    s.objective.piles = [];
    B.spawn(s,1,lane,'ram',0).cargo = S.CAPACITY;
    assert.equal(B.aiChoice(s).lane,lane);
  }
});
