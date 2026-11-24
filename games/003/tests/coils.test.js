'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const C = require('../js/coils');

function arena() {
  const s = B.create({ai:false, opening:false});
  s.phase = 'playing';
  s.towers.forEach(t => { t.cooldown = s.duration; });
  return s;
}
function rejected(s, team, lane, socket) {
  const before = JSON.stringify(s);
  assert.equal(B.placeCoil(s, team, lane, socket).ok, false);
  assert.equal(JSON.stringify(s), before);
}

test('a coil orders one field, pays once and shares its exact recharge boundary across lanes', () => {
  const s = arena();
  for (const args of [[2,0,0],[0,2,1],[1,0,3],[0,1,-1],[1,1,1.1],[0,0,'1'],[0,0,NaN]]) rejected(s, ...args);
  for (const phase of ['ready','paused','ended']) {
    s.phase = phase;
    rejected(s, 0, 0, 1);
  }
  s.phase = 'playing';
  s.energy = [C.COST, C.COST - .01];
  rejected(s, 1, 1, 1);
  assert.ok(B.placeCoil(s, 0, 1, 2).ok);
  assert.equal(s.energy[0], 0);
  assert.deepEqual(s.deployed, [0,0]);
  assert.deepEqual(s.locks, [{},{}]);
  assert.deepEqual(s.coils.fields[0], {lane:1, socket:2, armAt:C.ARM, expiresAt:C.ARM+C.WINDOW});
  s.energy[0] = B.MAX_ENERGY;
  rejected(s, 0, 0, 0);
  B.tick(s, C.RECHARGE - B.STEP);
  rejected(s, 0, 0, 0);
  B.tick(s);
  assert.ok(B.placeCoil(s, 0, 0, 0).ok);
  assert.equal(s.energy[0], B.MAX_ENERGY - C.COST);
  assert.ok(B.placeCoil(s, 1, 0, 0).ok, 'opposing fields can share a socket');
});

test('the arming tick catches only live enemy machines inside the lane band, including its edge', () => {
  const s = arena(), socket = 1, lane = 0;
  B.placeCoil(s, 0, lane, socket);
  B.tick(s, C.ARM - B.STEP);
  const ally = B.spawn(s,0,lane,'strider',0);
  const edge = B.spawn(s,1,lane,'ram',C.REACH,.44);
  const inner = B.spawn(s,1,lane,'wasp',-.7);
  const outside = B.spawn(s,1,lane,'strider',C.REACH+.01);
  const across = B.spawn(s,1,1,'ram',0);
  B.spawn(s,1,lane,'strider',0).hp = 0;
  const tower = s.towers[2];
  tower.x = .1;
  B.guard(s,1,lane);
  B.tick(s);
  assert.equal(s.coils.fields[0], null);
  assert.deepEqual(s.coils.caught, [2,0]);
  for (const u of [edge,inner]) {
    assert.equal(u.hp, u.maxHp - Math.ceil(C.DAMAGE / 2));
    assert.ok(C.isSnared(u, s.age));
  }
  for (const u of [ally,across,outside,tower]) {
    assert.equal(u.hp, u.maxHp);
    assert.equal(C.isSnared(u, s.age), false);
  }
  assert.equal(s.guards[1].blocked,C.DAMAGE);
  assert.equal(s.effects.filter(e => e.kind === 'snare').length,1);
  B.tick(s,.2);
  assert.equal(s.coils.caught[0],2);
});

test('snared machines can still fire and repair, but resume walking only at release', () => {
  const s = arena(), ram = B.spawn(s,1,0,'ram',0);
  const victim = B.spawn(s,0,0,'ram',.5), tender = B.spawn(s,1,0,'tender',.4);
  ram.hp -= 60;
  s.age = 1;
  ram.snaredUntil = tender.snaredUntil = s.age + C.HOLD;
  ram.cooldown = tender.cooldown = 0;
  B.tick(s);
  assert.equal(victim.hp, victim.maxHp - B.CARD.ram.damage);
  assert.equal(ram.hp, ram.maxHp - 60 + B.CARD.tender.repair);
  s.units = [ram];
  B.tick(s, C.HOLD - 2*B.STEP);
  assert.equal(ram.x,0);
  B.pause(s);
  const frozen = JSON.stringify(s);
  B.tick(s, 40);
  assert.equal(JSON.stringify(s), frozen);
  B.pause(s);
  B.tick(s);
  assert.ok(!C.isSnared(ram, s.age) && ram.x < 0);
});

test('opposing coils discharge together and lethal hits resolve through the ordinary damage queue', () => {
  const s = arena();
  for (const team of [0,1]) {
    B.placeCoil(s,team,1,1);
    const unit = B.spawn(s,team,1,'ram',0);
    unit.hp = C.DAMAGE;
    unit.cooldown = 10;
  }
  B.tick(s, C.ARM - B.STEP);
  assert.equal(s.units.length,2);
  B.tick(s);
  assert.deepEqual(s.coils.caught,[1,1]);
  assert.deepEqual(s.coils.fields,[null,null]);
  assert.deepEqual(s.units,[]);
  assert.equal(s.effects.filter(e => e.kind === 'wreck').length,2);
});

test('an unused field expires before accepting a catch on the closing tick and pause freezes the fuse', () => {
  for (const expires of [false, true]) {
    const s = arena();
    B.placeCoil(s, 1, 1, 0);
    B.tick(s, C.ARM / 2);
    B.pause(s);
    const frozen = JSON.stringify(s);
    B.tick(s, 30);
    assert.equal(JSON.stringify(s), frozen);
    B.pause(s);
    const close = s.coils.fields[1].expiresAt;
    B.tick(s, close - s.age - (expires ? 1 : 2) * B.STEP);
    const intruder = B.spawn(s,0,1,'strider',C.SOCKETS[0]);
    B.tick(s);
    assert.equal(s.coils.fields[1],null);
    assert.equal(s.coils.caught[1],expires ? 0 : 1);
    assert.equal(intruder.hp,intruder.maxHp - (expires ? 0 : C.DAMAGE));
  }
});

test('the competitive AI funds a coil at a threatened socket and leaves a single enemy alone', () => {
  const s = arena();
  s.ai = true;
  s.aiIn = 0;
  s.energy[1] = 4;
  for (const id of s.deck) s.locks[1][id] = 30;
  B.spawn(s,0,1,'ram',C.SOCKETS[2]-.4);
  assert.equal(C.aiPlacement(s),null);
  B.spawn(s,0,1,'wasp',C.SOCKETS[2]-.8);
  assert.deepEqual(C.aiPlacement(s),{lane:1,socket:2});
  B.tick(s);
  assert.ok(Math.abs(s.energy[1] - (4-C.COST+B.STEP*B.ENERGY_RATE)) < 1e-8);
  assert.equal(s.coils.fields[1].socket,2);
  assert.equal(s.coils.readyAt[1],s.age+C.RECHARGE);
  assert.equal(C.aiPlacement(s),null);
  B.tick(s,C.ARM);
  assert.deepEqual(s.coils.caught,[0,2]);
});

test('invalid card identifiers reject before converting an object to a property key', () => {
  const s = arena(), before = JSON.stringify(s);
  const id = {toString() { throw new Error('Unexpected conversion'); }};
  for (const bad of [id, Object.create(null), ['strider']]) {
    assert.equal(B.deploy(s,0,0,bad).error,'Invalid deployment');
    assert.deepEqual(B.deploymentSites(s,0,1,bad),[]);
  }
  assert.equal(JSON.stringify(s),before);
});
