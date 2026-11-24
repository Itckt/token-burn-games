'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const D = require('../js/drills');

test('each drill waits on the opening card and resets its own seed, objective and clock', () => {
  for (const mode of ['escort','watch']) {
    const s = B.create({mode}), copy = B.create({mode});
    assert.equal(s.time, D.FORMATS[mode].duration);
    assert.equal(s.random.state(), copy.random.state());
    assert.equal(JSON.stringify(s), JSON.stringify(copy));
    const before = JSON.stringify(s);
    B.tick(s, 10);
    assert.equal(JSON.stringify(s), before);
    assert.ok(D.subject(s).hp > 0);
    assert.equal(B.deploy(s,0,0,'ram').ok, true);
    B.tick(s,.5);
    assert.ok(Math.abs(s.age - .5) < 1e-8);
    assert.ok(Math.abs(s.time - (s.duration - .5)) < 1e-8);
    assert.equal(copy.phase, 'ready');
    assert.ok(D.readout(s).text.includes('HP'));
  }
});

test('the parcel carrier waits at a roadblock, never attacks, and lets an escort overtake it', () => {
  const s = B.create({mode:'escort',ai:false}), carrier = D.subject(s);
  s.phase = 'playing';
  s.units = [carrier];
  s.towers.forEach(tower => { tower.cooldown = 90; });
  const scout = B.spawn(s,0,0,'strider',carrier.x - .12,-.57);
  B.tick(s,.5);
  assert.ok(scout.x > carrier.x);
  const obstacle = B.spawn(s,1,0,'ram',carrier.x + .47,-.57);
  s.units = [carrier, obstacle];
  carrier.cooldown = 0;
  obstacle.cooldown = 99;
  const heldAt = carrier.x;
  B.tick(s,.5);
  assert.equal(carrier.x, heldAt);
  assert.equal(obstacle.hp, obstacle.maxHp);
  assert.ok(!s.effects.some(e => e.kind === 'strike'));
});

test('delivery counts at the buzzer if the carrier survives that tick', () => {
  for (const lethal of [false, true]) {
    const s = B.create({mode:'escort',ai:false}), carrier = D.subject(s);
    s.units = [carrier];
    s.phase = 'playing';
    s.age = s.duration - B.STEP;
    carrier.x = D.GATE_X - .005;
    carrier.hp = 9;
    if (lethal) s.shots.push({id:s.nextId++, team:1, lane:0, type:'pulse', age:0, duration:B.STEP,
      targetId:carrier.id, damage:9, x:4, y:1, z:carrier.z, tx:carrier.x, ty:.7, tz:carrier.z});
    B.tick(s,15);
    assert.equal(s.age, s.duration);
    assert.equal(s.time, 0);
    assert.equal(s.winner, lethal ? 1 : 0);
    assert.equal(s.reason, lethal ? 'Parcel carrier lost' : 'Parcel delivered');
    assert.equal(D.readout(s).progress, 1);
    if (lethal) assert.match(D.readout(s).text, /Carrier lost/);
  }
});

test('drill objectives decide the outcome even when standard tower scoring would disagree', () => {
  const s = B.create({mode:'escort',ai:false});
  s.phase = 'playing';
  s.towers.filter(t => t.team === 1).forEach(t => { t.hp = 0; });
  B.checkEnd(s);
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.destroyed,[2,0]);
  s.age = s.duration - .005;
  const energy = s.energy[0];
  B.tick(s,3);
  assert.equal(s.reason, 'Delivery window closed');
  assert.equal(s.winner,1);
  assert.ok(Math.abs(s.energy[0] - energy - .005*B.ENERGY_RATE) < 1e-8);
});

test('watch waves arrive once at their scheduled times and pause freezes the warning', () => {
  const s = B.create({mode:'watch'});
  s.phase = 'playing';
  s.units = [];
  assert.equal(D.subject(s).hp,270);
  for (const [at, wave, cards] of [[5,1,2], [16,2,3], [28,3,4]]) {
    B.tick(s, at - s.age - B.STEP);
    assert.equal(s.objective.wave, wave-1);
    assert.match(D.readout(s).text, new RegExp('Wave ' + wave + '/3 in 1s'));
    B.pause(s);
    const before = JSON.stringify(s);
    B.tick(s, 60);
    assert.equal(JSON.stringify(s), before);
    B.pause(s);
    B.tick(s);
    assert.equal(s.objective.wave, wave);
    assert.equal(s.units.length, cards);
    assert.ok(s.units.every(u => u.team === 1 && u.lane === 1));
    assert.match(s.log[0].message, new RegExp('Wave ' + wave + ' entered'));
    B.tick(s);
    assert.equal(s.units.length, cards);
    s.units.length = 0;
  }
  assert.match(D.readout(s).text, /Final wave/);
  B.tick(s,90);
  assert.equal(s.winner,0);
  assert.equal(s.age,45);
  assert.equal(s.log.filter(e => e.message.startsWith('Wave')).length,3);
});

test('a last-tick strike on the watch relay is resolved before survival is awarded', () => {
  const s = B.create({mode:'watch'}), relay = D.subject(s);
  s.phase = 'playing';
  s.age = s.duration - B.STEP;
  relay.hp = 1;
  B.spawn(s,1,1,'strider',relay.x + .7).cooldown = 0;
  B.tick(s);
  assert.equal(s.time,0);
  assert.equal(s.winner,1);
  assert.equal(s.reason,'Watch relay fell');
  assert.match(D.readout(s).text,/Waves sent 0\/3/);
});

test('both seeded drills are winnable with the starter hand and punish an undefended objective', () => {
  for (const mode of ['watch','escort']) for (const defend of [false, true]) {
    const s = B.create({mode}), lane = mode === 'watch' ? 1 : 0;
    B.deploy(s,0,defend ? lane : 1-lane,'ram');
    if (defend) B.deploy(s,0,lane,'wasp');
    for (let i = 0; s.phase === 'playing' && i < s.duration/B.STEP + 1; i++) {
      if (defend && i % 15 === 0) {
        const id = ['strider','wasp','ram'].find(id => !B.canDeploy(s,0,lane,id));
        if (id) B.deploy(s,0,lane,id);
        const subject = D.subject(s);
        if (subject.hp < subject.maxHp * .88) B.guard(s,0,lane);
      }
      B.tick(s);
    }
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, defend ? 0 : 1, mode + ' / ' + s.reason);
    const final = JSON.stringify(s);
    B.tick(s,100);
    assert.equal(JSON.stringify(s), final);
  }
});
