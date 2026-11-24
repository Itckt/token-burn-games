'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const Signal = require('../js/signal');

test('a cache clips opening time, resets on vacancy or contest and grants a single claim', () => {
  const c = Signal.create(), at = c.opensAt;
  const ally = {hp:1, team:0, lane:0, x:Signal.REACH};
  const enemy = {hp:2, team:1, lane:0, x:0};
  const bystanders = [{...enemy,hp:0}, {...enemy,lane:1}, {...enemy,x:Signal.REACH+.01}];
  function move(from, to, ...units) { return Signal.advance(c, [...units,...bystanders], at+from, at+to, 180); }
  move(-1,0,ally);
  assert.equal(c.held,0);
  move(0,1,ally);
  assert.equal(c.held,1);
  move(1,1.1,ally,enemy);
  assert.equal(c.contested,true);
  assert.equal(c.holder,null);
  assert.equal(c.held,0);
  move(1.1,2.1,enemy);
  move(2.1,2.2);
  assert.equal(c.held,0);
  move(2.2,3.2,enemy);
  move(3.2,4.2,ally);
  assert.equal(c.held,1);
  assert.deepEqual(move(4.2,5.2,ally), {team:0,lane:0});
  assert.equal(move(5.2,5.3,ally),null);
  assert.equal(c.phase,'claimed');
  move(5.3,12);
  assert.equal(c.phase,'incoming');
  assert.equal(c.lane,1);
  assert.equal(c.opensAt,at+Signal.INTERVAL);
});

test('a hold can finish on the closing tick and the last scheduled cache retires cleanly', () => {
  const c = Signal.create(1,38), ally = {hp:1, team:0, lane:1, x:0};
  Signal.advance(c,[ally],48,49.99,55);
  assert.deepEqual(Signal.advance(c,[ally],49.99,50,55), {team:0,lane:1});
  assert.equal(c.phase,'done');
  assert.equal(Signal.advance(c,[ally],50,55,55),null);
  const shortened = Signal.create(1,38);
  Signal.advance(shortened,[ally],43.5,44.9,45);
  assert.equal(Signal.advance(shortened,[ally],44.9,45,45),null);
  assert.equal(shortened.phase,'done');
});

test('the real cache awards at most ten energy and captures only with surviving machines', () => {
  const s = B.create({ai:false, opening:false});
  s.phase = 'playing';
  s.age = 9.98;
  Object.assign(s.cache,{holder:0, held:1.98, phase:'open'});
  s.energy = [9.6,3];
  B.spawn(s,0,0,'ram',0);
  B.spawn(s,1,0,'strider',.1).hp = 0;
  B.tick(s);
  assert.equal(s.energy[0],10);
  assert.deepEqual(s.captures,[1,0]);
  assert.ok(s.effects.some(e => e.kind === 'cache'));
  assert.match(s.log[0].message,/You secured the Lane A/);
  B.tick(s,1);
  assert.deepEqual(s.captures,[1,0]);
});

test('guard halves hits on its lane, expires on time and shares one recharge across both lanes', () => {
  const s = B.create({ai:false,opening:false});
  assert.equal(B.guard(s,0,1).ok,false);
  s.phase = 'playing';
  assert.ok(B.guard(s,0,1).ok);
  assert.equal(B.isGuarded(s,0,0),false);
  assert.equal(B.isGuarded(s,1,1),false);
  for (const t of s.towers) {
    s.shots.push({id:s.nextId++,team:1-t.team,lane:t.lane,type:'pulse',targetId:t.id,x:0,z:t.z,y:1,tx:t.x,tz:t.z,ty:1,age:0,duration:B.STEP,damage:21});
  }
  B.tick(s);
  assert.deepEqual(s.towers.map(t => t.maxHp-t.hp),[21,11,21,21]);
  assert.equal(s.guards[0].blocked,10);
  B.pause(s);
  B.tick(s,40);
  assert.equal(s.age,B.STEP);
  B.pause(s);
  B.tick(s,B.GUARD_TIME-s.age);
  assert.equal(B.isGuarded(s,0,1),false);
  assert.equal(B.guard(s,0,0).ok,false);
  B.tick(s,B.GUARD_RECHARGE-s.age);
  assert.equal(B.guard(s,0,0).ok,true);
  assert.deepEqual(s.energy,[10,10]);
});

test('simultaneous guarded hits credit only surviving HP, independent of impact order', () => {
  for (const health of [30,22,10]) for (const amounts of [[24,8],[8,24]]) {
    const s = B.create({ai:false,opening:false}), target = s.towers[0];
    target.hp = health;
    s.phase = 'playing';
    B.guard(s,0,0);
    for (const damage of amounts) s.shots.push({id:s.nextId++,team:1,lane:0,type:'pulse',targetId:target.id,
      x:0,y:1,z:target.z,tx:target.x,tz:target.z,ty:1,age:0,duration:B.STEP,damage});
    B.tick(s);
    assert.equal(target.hp, Math.max(0,health-16));
    assert.equal(s.guards[0].blocked, target.hp);
  }
});

test('extreme playback rates stay within a one-second frame budget and preserve fractional carry', () => {
  const clock = new B.FixedClock(), deltas = [];
  clock.advance(B.STEP/2,dt => deltas.push(dt));
  clock.advance(.25,dt => deltas.push(dt), Number.MAX_VALUE);
  assert.equal(deltas.length,30);
  assert.ok(deltas.every(dt => dt === B.STEP));
  assert.ok(Math.abs(clock.alpha - .5) < 1e-8);
  for (const rate of [0,-1,NaN,Infinity]) clock.advance(1,dt => deltas.push(dt),rate);
  assert.equal(deltas.length,30);
});
