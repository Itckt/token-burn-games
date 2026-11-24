'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const P = require('../js/projectiles');

function field() {
  const s = B.create({ai:false,opening:false,deck:['skiff','ram','strider','mortar']});
  s.phase = 'playing';
  s.towers.forEach(t => { t.cooldown = 99; });
  return s;
}
function shot(s, target, props = {}) {
  const item = {id:s.nextId++, type:'pulse', team:1-target.team, lane:target.lane, targetId:target.id,
    x:target.x+.8, y:1, z:target.z, tx:target.x, ty:.6, tz:target.z, age:0, duration:.3, damage:21, ...props};
  s.shots.push(item);
  return item;
}

test('a skiff catches an entire shell for either team before direct, splash or guard damage is booked', () => {
  for (const team of [0,1]) {
    const s = field(), skiff = B.spawn(s,team,1,'skiff',0);
    const victim = B.spawn(s,team,1,'ram',.7), wing = B.spawn(s,team,1,'strider',.42);
    B.guard(s,team,1);
    shot(s,victim,{type:'shell',duration:B.STEP,damage:46});
    B.tick(s);
    assert.equal(s.shots.length,0);
    assert.ok([skiff,victim,wing].every(u => u.hp === u.maxHp));
    assert.equal(s.guards[team].blocked,0);
    assert.equal(s.intercepted[team],1);
    assert.equal(skiff.screenReadyAt,s.age+4);
    assert.equal(s.log[0].kind,'intercept');
    assert.match(s.log[0].message,/mortar shell in Lane B/);
    assert.ok(s.effects.some(e => e.kind === 'intercept' && Number.isFinite(e.ty)));
    assert.ok(s.effects.every(e => e.kind !== 'blast'));
  }
});

test('a screen sweeps a whole flight segment and ignores shots just outside its lateral edge', () => {
  for (const [distance,caught] of [[1.6,true],[1.601,false]]) {
    const s = field(), skiff = B.spawn(s,0,0,'skiff',0);
    const victim = B.spawn(s,0,0,'ram',3,distance);
    shot(s,victim,{type:'relay',x:-3,duration:B.STEP});
    B.tick(s);
    assert.equal(s.intercepted[0],Number(caught));
    assert.equal(victim.hp,victim.maxHp-(caught ? 0 : 21));
    if (caught) {
      const flash = s.effects.find(e => e.kind === 'intercept');
      assert.equal(flash.tx,0);
      assert.ok(Math.abs(flash.tz-skiff.z-distance) < 1e-8);
      assert.match(s.log[0].message,/relay bolt/);
    }
  }
});

test('one screen takes the most urgent shot, then the lowest shot ID, regardless of array order', () => {
  for (const reverse of [false,true]) {
    const s = field(), skiff = B.spawn(s,0,0,'skiff',0);
    const later = shot(s,skiff,{duration:1});
    const first = shot(s,skiff,{duration:.5});
    const tied = shot(s,skiff,{duration:.5});
    if (reverse) s.shots.reverse();
    B.tick(s);
    assert.equal(s.intercepted[0],1);
    assert.ok(!s.shots.includes(first) && s.shots.includes(later) && s.shots.includes(tied));
  }
});

test('overlapping skiffs spend each screen at most once and assign a shared shot to the older machine', () => {
  const s = field(), first = B.spawn(s,0,1,'skiff',0), second = B.spawn(s,0,1,'skiff',.3);
  s.units.reverse();
  shot(s,second);
  B.tick(s);
  assert.equal(P.ready(first,s.age),false);
  assert.equal(P.ready(second,s.age),true);
  shot(s,first);
  shot(s,first);
  B.tick(s);
  assert.equal(s.intercepted[0],2);
  assert.equal(s.shots.length,1);
  assert.equal(P.ready(second,s.age),false);
});

test('snared skiffs still fire and screen, while friendly fire lanes, melee and coil discharges keep their usual rules', () => {
  const s = field(), skiff = B.spawn(s,0,0,'skiff',0), enemy = B.spawn(s,1,0,'strider',.4);
  const otherLane = B.spawn(s,0,1,'ram',0);
  skiff.snaredUntil = 9;
  skiff.cooldown = enemy.cooldown = 0;
  const friendly = shot(s,enemy);
  shot(s,otherLane,{duration:B.STEP});
  B.tick(s);
  assert.equal(s.intercepted[0],0);
  assert.ok(s.shots.includes(friendly));
  assert.ok(s.shots.some(p => p.team === 0 && p !== friendly && p.targetId === enemy.id));
  assert.equal(skiff.hp,skiff.maxHp-B.CARD.strider.damage);
  assert.equal(otherLane.hp,otherLane.maxHp-21);
  const hp = skiff.hp;
  s.coils.fields[1] = {lane:0,socket:1,armAt:0,expiresAt:5};
  shot(s,skiff);
  B.tick(s);
  assert.equal(s.intercepted[0],1);
  assert.equal(skiff.hp,hp-18);
  assert.equal(skiff.x,0);
});

test('recharge freezes while paused and becomes available on the exact boundary', () => {
  const s = field(), skiff = B.spawn(s,0,1,'skiff',0);
  shot(s,skiff);
  B.tick(s);
  const recharge = skiff.screenReadyAt;
  B.pause(s);
  const before = JSON.stringify(s);
  B.tick(s,10);
  assert.equal(JSON.stringify(s),before);
  B.pause(s);
  skiff.snaredUntil = 99;
  B.tick(s,recharge-s.age-2*B.STEP);
  shot(s,skiff,{duration:B.STEP});
  B.tick(s);
  assert.equal(skiff.hp,skiff.maxHp-21);
  shot(s,skiff,{duration:B.STEP});
  B.tick(s);
  assert.equal(skiff.hp,skiff.maxHp-21);
  assert.equal(s.intercepted[0],2);
});

test('a dead skiff cannot intercept and Vanta can buy a skiff to counter a ranged push', () => {
  const s = field(), wreck = B.spawn(s,0,0,'skiff',0), ally = B.spawn(s,0,0,'mortar',1);
  wreck.hp = 0;
  shot(s,ally,{duration:B.STEP});
  B.tick(s);
  assert.equal(s.intercepted[0],0);
  assert.equal(ally.hp,ally.maxHp-21);
  s.random = () => .5;
  const move = B.aiChoice(s);
  assert.deepEqual(move,{lane:0,id:'skiff'});
  B.deploy(s,1,move.lane,move.id);
  assert.ok(s.energy[1] < 3.1);
});
