'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const R = require('../js/roster');

const specialistDeck = ['tender', 'splitpin', 'ram', 'wasp'];
function arena() {
  const s = B.create({deck:specialistDeck, ai:false, opening:false});
  s.phase = 'playing';
  return s;
}

test('a hand has four distinct known cards and every match owns a copy', () => {
  const bad = [null, {}, 'wasp', [], ['ram','ram','ram','ram'], ['ram','wasp','tender'], ['ram','wasp','tender','carrier'],
    ['ram','wasp','tender','constructor'], ['ram','wasp','tender', ['splitpin']], ['ram','wasp',,'tender']];
  for (const input of bad) {
    assert.equal(R.validDeck(input), false);
    assert.deepEqual(B.create({deck:input}).deck, R.DEFAULT_DECK);
  }
  const input = [...specialistDeck], match = B.create({deck:input});
  input.reverse();
  assert.deepEqual(match.deck, specialistDeck);
  assert.deepEqual(R.deckOrDefault(), ['strider','ram','wasp','mortar']);
  for (const mode of ['unknown', 'constructor', ['watch']]) assert.equal(B.create({mode}).mode, 'standard');
});

test('equipping a reserve replaces one slot and equipping a teammate swaps two slots', () => {
  const hand = R.deckOrDefault();
  assert.ok(R.equip(hand, 1, 'tender'));
  assert.deepEqual(hand, ['strider','tender','wasp','mortar']);
  assert.ok(R.equip(hand, 3, 'strider'));
  assert.deepEqual(hand, ['mortar','tender','wasp','strider']);
  const unchanged = [...hand];
  assert.ok(R.equip(hand, 1, 'tender'));
  for (const [slot, id] of [[-1,'ram'], [4,'ram'], [.5,'ram'], [1,'toString'], [1,['ram']]]) {
    assert.equal(R.equip(hand, slot, id), false);
  }
  assert.deepEqual(hand, unchanged);
});

test('both commanders and AI pay for and choose cards from the equipped hand', () => {
  const s = arena();
  for (const team of [0,1]) {
    const before = JSON.stringify(s);
    assert.equal(B.deploy(s,team,0,'mortar').error, 'Card outside this deck');
    assert.equal(JSON.stringify(s), before);
  }
  s.locks[1] = {ram:100, wasp:100, splitpin:100};
  assert.deepEqual(B.aiChoice(s).id, 'tender');
  s.ai = true;
  s.aiIn = 0;
  B.tick(s);
  assert.equal(s.units.at(-1).cardId, 'tender');
  assert.ok(s.energy[1] > 4 && s.energy[1] < 4.1);
  assert.equal(B.aiChoice(s), null);
});

test('a twin deployment buys and locks one card while both scouts have separate tracks, HP and attacks', () => {
  for (const team of [0,1]) {
    const s = arena();
    const {units:pair, unit} = B.deploy(s, team, 1, 'splitpin');
    assert.equal(pair.length, 2);
    assert.equal(unit, pair[0]);
    assert.notEqual(pair[0].id, pair[1].id);
    assert.equal(pair[0].x, pair[1].x);
    assert.ok(pair[0].z < B.LANES[1] && pair[1].z > B.LANES[1]);
    assert.equal(s.energy[team], 4);
    assert.equal(s.deployed[team], 1);
    assert.equal(s.emitted[team][1], 1);
    const before = JSON.stringify(s);
    assert.equal(B.deploy(s, team, 0, 'splitpin').error, 'Card recharging');
    assert.equal(JSON.stringify(s), before);
    const enemy = B.spawn(s, 1-team, 1, 'ram', 0);
    for (const scout of pair) { scout.x = .36; scout.cooldown = 0; }
    pair[0].hp = 1;
    B.tick(s);
    assert.equal(enemy.hp, enemy.maxHp - 2 * R.CARD.splitpin.damage);
    assert.equal(pair[1].hp, pair[1].maxHp);
    assert.equal(s.effects.filter(e => e.kind === 'strike').length, 2);
  }
});

test('a tender picks the lowest health fraction in reach and same-tick ties use actor ID', () => {
  const s = arena(), tender = B.spawn(s,0,0,'tender',0);
  const ally = B.spawn(s,0,0,'strider',1.7), other = B.spawn(s,0,0,'strider',.3);
  const tank = B.spawn(s,0,0,'ram',1);
  ally.hp = other.hp = 27;
  tank.hp = 80; // More missing HP but a higher fraction.
  tender.hp = 1;
  const excluded = [B.spawn(s,0,1,'ram',.02), B.spawn(s,0,0,'ram',3.1), B.spawn(s,1,0,'ram',.1)];
  excluded.forEach(u => { u.hp = 1; });
  const tower = s.towers[0];
  tower.x = -.1;
  tower.hp = 1;
  for (const u of s.units) u.cooldown = 99;
  tender.cooldown = 0;
  s.units.reverse();
  B.tick(s);
  assert.equal(ally.hp, 51);
  assert.equal(other.hp, 27);
  assert.equal(tank.hp, 80);
  assert.ok(excluded.every(u => u.hp === 1) && tower.hp === 1 && tender.hp === 1);
  assert.deepEqual(s.repaired, [24,0]);
  assert.ok(s.effects.some(e => e.kind === 'mend' && e.tx === ally.x));
  assert.equal(s.shots.length, 0);
  B.tick(s);
  assert.equal(ally.hp, 51);
});

test('overlapping tethers cap actual repairs and incoming lethal damage wins on the same tick', () => {
  for (const lethal of [false, true]) {
    const s = arena(), unit = B.spawn(s,0,1,'ram',0);
    unit.hp = lethal ? 9 : unit.maxHp - 7;
    for (const x of [-1.7,-.8]) B.spawn(s,0,1,'tender',x).cooldown = 0;
    if (lethal) B.spawn(s,1,1,'strider',.4).cooldown = 0;
    B.tick(s);
    assert.equal(unit.hp, lethal ? 0 : unit.maxHp);
    assert.equal(s.units.includes(unit), !lethal);
    assert.equal(s.repaired[0], lethal ? 0 : 7);
    assert.equal(s.effects.filter(e => e.kind === 'mend').length, lethal ? 0 : 1);
  }
});

test('a tender without a repair target fights with its printed short-range pulse', () => {
  const s = arena(), tender = B.spawn(s,1,1,'tender',1), enemy = B.spawn(s,0,1,'ram',0);
  tender.hp = 15;
  tender.cooldown = 0;
  enemy.cooldown = 40;
  B.tick(s);
  assert.equal(s.shots[0].type, 'pulse');
  assert.equal(s.shots[0].targetId, enemy.id);
  B.tick(s, .2);
  assert.equal(tender.hp,15);
  assert.equal(enemy.hp,enemy.maxHp - R.CARD.tender.damage);
});

test('a scout leaving the far edge on the repair tick cannot earn phantom repair credit', () => {
  const s = arena(), scout = B.spawn(s,0,0,'splitpin',9.74);
  s.towers.find(t => t.team === 1 && t.lane === 0).hp = 0;
  scout.hp = 13;
  B.spawn(s,0,0,'tender',8.9).cooldown = 0;
  B.tick(s);
  assert.equal(s.units.includes(scout),false);
  assert.equal(s.repaired[0],0);
  assert.ok(s.effects.every(e => e.kind !== 'mend'));
});

test('deployment previews match every formation slot for either side and never spend or advance the match', () => {
  const s = arena();
  for (const team of [0,1]) for (const lane of [0,1]) {
    for (let i = 0; i < 15; i++) {
      const id = i % 2 ? 'tender' : 'splitpin';
      s.energy[team] = B.MAX_ENERGY;
      s.locks[team] = {};
      const before = JSON.stringify(s), sites = B.deploymentSites(s,team,lane,id);
      assert.equal(JSON.stringify(s),before);
      const {units} = B.deploy(s,team,lane,id);
      assert.deepEqual(units.map(u => [u.x,u.z]),sites.map(p => [p.x,B.LANES[lane]+p.offset]));
      assert.deepEqual(B.deploymentSites(s,team,1-lane,id),[]);
    }
  }
  assert.deepEqual(B.deploymentSites(s,0,2,'tender'),[]);
  s.energy[0] = 0;
  assert.deepEqual(B.deploymentSites(s,0,0,'tender'),[]);
});
