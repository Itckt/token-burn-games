'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle'), F = require('../js/freight'), D = require('../js/drills');

function emptyRace() {
  const s = B.create({mode:'freight', ai:false});
  s.phase = 'playing';
  s.units = [];
  s.towers.forEach(t => { t.cooldown = s.duration; });
  return s;
}
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, a + ' vs ' + b);
function putAtDock(s, team, lane) {
  const x = (team === 0 ? 1 : -1) * (F.DOCK - .005);
  Object.assign(s.objective.carts[lane], {x, prevX:x});
  return B.spawn(s,team,lane,'ram',x);
}

test('Freight Shift opens with symmetric patrols, independent carts and a clock that waits for deployment', () => {
  const s = B.create({mode:'freight'});
  assert.equal(s.duration,75);
  assert.equal(s.cache.phase,'done');
  assert.deepEqual(s.objective.score,[0,0]);
  assert.notEqual(s.objective.carts[0].escorts,s.objective.carts[1].escorts);
  for (const u of s.units.filter(u => u.team === 0)) {
    assert.ok(s.units.some(v => v.team === 1 && v.lane !== u.lane && v.x === -u.x && v.cardId === u.cardId));
  }
  const before = JSON.stringify(s);
  B.tick(s,70);
  assert.equal(JSON.stringify(s),before);
  assert.match(D.readout(s).text,/First to 2 deliveries/);
  B.deploy(s,0,0,'strider');
  B.tick(s,2);
  assert.equal(s.phase,'playing');
  assert.deepEqual(s.captures,[0,0]);
});

test('only nearby unbound escorts count, with a cap of three per side and independent lane majorities', () => {
  const s = emptyRace(), [a,b] = s.objective.carts;
  const step = () => F.advance(s,0,1,() => assert.fail('early score'));
  for (let i = 0; i < 4; i++) B.spawn(s,0,0,'ram',F.REACH);
  for (let i = 0; i < 3; i++) B.spawn(s,1,0,'ram',-F.REACH);
  B.spawn(s,0,1,'wasp',-F.REACH - .01);
  B.spawn(s,0,1,'ram',0).snaredUntil = 2;
  B.spawn(s,0,1,'strider',0).hp = 0;
  B.spawn(s,1,1,'strider',0);
  step();
  assert.deepEqual(a.escorts,[3,3]);
  assert.equal(a.x,0);
  assert.equal(F.status(a,1),'Contested');
  assert.deepEqual(b.escorts,[0,1]);
  close(b.x,-.85);
  assert.equal(F.status(b,1),'Vanta pushes');
  s.units = s.units.filter(u => u.team === 0 && u.lane === 0);
  step();
  assert.deepEqual(a.escorts,[3,0]);
  close(a.x,1.35);
  assert.equal(b.prevX,b.x);
  s.units = [B.spawn(s,1,0,'ram',a.x)];
  step();
  close(a.prevX,1.35);
  close(a.x,.50);
});

test('a scored cart unloads once, returns at center and grants only time beyond its reload boundary', () => {
  const s = emptyRace(), cart = s.objective.carts[1];
  putAtDock(s,0,1);
  B.tick(s);
  assert.equal(s.objective.score[0],1);
  assert.equal(cart.x,F.DOCK);
  assert.equal(cart.returnAt,s.age + F.RELOAD);
  assert.match(s.log[0].message,/delivered the Lane B cart/);
  s.units = [B.spawn(s,1,1,'ram',0)];
  const end = cart.returnAt;
  F.advance(s,s.age,end-.1,() => assert.fail('duplicate score'));
  assert.equal(F.status(cart,end-.1),'Reload 1s');
  assert.equal(cart.x,F.DOCK);
  F.advance(s,end-.1,end+.1,() => assert.fail('instant redelivery'));
  assert.equal(cart.returnAt,null);
  assert.equal(cart.prevX,0);
  close(cart.x,-.085);
  assert.deepEqual(s.objective.score,[1,0]);
});

test('freight scores only surviving mobile escorts, even on the last simulation tick', () => {
  for (const blocks of ['lethal hit','coil','none']) {
    const s = emptyRace(), escort = putAtDock(s,0,0);
    s.age = s.duration - B.STEP;
    if (blocks === 'lethal hit') {
      s.shots.push({type:'pulse', id:s.nextId++, targetId:escort.id, team:1, lane:0,
        age:0, duration:B.STEP, damage:escort.hp, x:6, y:1, z:escort.z, tx:escort.x, ty:1, tz:escort.z});
    }
    if (blocks === 'coil') {
      B.placeCoil(s,1,0,2);
      s.coils.fields[1].armAt = s.duration;
    }
    B.tick(s,10);
    assert.equal(s.age,s.duration);
    assert.equal(s.phase,'ended');
    assert.equal(s.objective.score[0],blocks === 'none' ? 1 : 0);
    assert.equal(s.winner,blocks === 'none' ? 0 : null);
    assert.equal(s.reason,'Freight time limit');
  }
});

test('both lanes score before victory is checked and simultaneous second deliveries draw', () => {
  for (const starting of [[1,1],[1,0],[0,1]]) {
    const s = emptyRace();
    s.objective.score = [...starting];
    putAtDock(s,0,0);
    putAtDock(s,1,1);
    B.tick(s);
    assert.deepEqual(s.objective.score,starting.map(n => n+1));
    assert.equal(s.phase,'ended');
    assert.equal(s.reason,'Freight delivered');
    assert.equal(s.winner,starting[0] === starting[1] ? null : starting[0] > starting[1] ? 0 : 1);
    assert.deepEqual(s.log.slice(0,3).map(e => e.kind),['result','delivery','delivery']);
    const final = JSON.stringify(s);
    B.tick(s,100);
    assert.equal(JSON.stringify(s),final);
  }
});

test('freight ignores relay tiebreaks and pausing preserves a moving cart and its escorts', () => {
  const s = emptyRace();
  s.towers.filter(t => t.team === 0).forEach(t => { t.hp = 0; });
  B.spawn(s,0,0,'strider',0);
  B.tick(s);
  assert.equal(s.phase,'playing');
  assert.ok(s.objective.carts[0].x > 0);
  B.pause(s);
  const frozen = JSON.stringify(s);
  B.tick(s,20);
  assert.equal(JSON.stringify(s),frozen);
  B.pause(s);
  s.units = [];
  s.age = s.duration - B.STEP;
  B.tick(s);
  assert.equal(s.winner,null);
});

test('the starter deck can win the full seeded freight race and idle defense can lose it', () => {
  for (const reinforce of [false,true]) {
    const s = B.create({mode:'freight'});
    B.deploy(s,0,0,'ram');
    if (reinforce) B.deploy(s,0,0,'wasp');
    for (let tick = 0; s.phase === 'playing' && tick < 2250; tick++) {
      if (reinforce && tick % 20 === 0) {
        const lane = Math.floor(s.age/12) % 2;
        const card = ['strider','wasp','ram'].find(id => !B.canDeploy(s,0,lane,id));
        if (card) B.deploy(s,0,lane,card);
        if (s.age > 4) B.guard(s,0,lane);
      }
      B.tick(s);
    }
    assert.equal(s.phase,'ended');
    assert.equal(s.winner,reinforce ? 0 : 1);
    assert.equal(s.objective.score[s.winner],2);
  }
});

test('Vanta reinforces an advancing freight cart ahead of a lane that is reloading', () => {
  for (const lane of [0,1]) {
    const s = emptyRace();
    s.random = () => .5;
    Object.assign(s.objective.carts[lane],{x:3.1,escorts:[2,1]});
    s.objective.carts[1-lane].returnAt = F.RELOAD;
    const choice = B.aiChoice(s);
    assert.equal(choice.lane,lane);
    assert.ok(!B.canDeploy(s,1,lane,choice.id));
  }
});
