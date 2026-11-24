'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/battle');
const {Recording, Playback} = require('../js/replay');
const {FORMATS} = require('../js/drills');

const state = match => [JSON.stringify(match), match.random.state()];
function advance(tape, steps) {
  for (let i = 0; i < steps; i++) tape.advance();
}

test('seeking across a checkpoint reproduces AI, same-tick orders, projectiles and the RNG cursor', () => {
  const tape = new Recording({mode:'escort', deck:['ram','wasp','tender','splitpin']});
  tape.order('deploy',0,'tender');
  tape.order('deploy',0,'ram');
  const expected = new Map();
  while (tape.match.phase === 'playing') {
    if (tape.length === 450) {
      assert.ok(tape.order('guard',0).ok);
      assert.ok(tape.order('deploy',0,'splitpin').ok);
      const count = tape.orders.length;
      assert.equal(tape.order('deploy',1,'splitpin').ok,false);
      assert.equal(tape.orders.length,count);
    }
    if ([0,1,149,379,449,450,451].includes(tape.length)) expected.set(tape.length, state(tape.match));
    tape.advance();
  }
  expected.set(tape.length, state(tape.match));
  assert.ok(tape.length > 451, 'fixture must cross the 15-second checkpoint');
  const replay = new Playback(tape);
  for (const step of [tape.length,450,1,449,450,451,149,0,379,tape.length]) {
    replay.seek(step);
    assert.deepEqual(state(replay.match), expected.get(step), 'step ' + step);
  }
  replay.seek(Infinity);
  assert.ok(replay.atEnd);
  assert.equal(replay.takeOver(), null);
  replay.seek(-100);
  assert.equal(replay.position,0);
  replay.seek(450.7);
  assert.equal(replay.position,451);
  replay.seek(tape.length + 200);
  assert.ok(replay.atEnd);
});

test('takeover copies the whole position, runs independently and can replay its own first orders', () => {
  const tape = new Recording({seed:918, deck:['ram','tender','splitpin','mortar']});
  tape.order('deploy',1,'ram');
  advance(tape,150);
  tape.order('guard',1);
  tape.order('deploy',1,'tender');
  advance(tape,24);
  const point = tape.length, originalPoint = state(tape.match);
  advance(tape,100);
  const later = state(tape.match);
  while (tape.match.phase === 'playing') tape.advance();
  const final = state(tape.match), orders = JSON.stringify(tape.orders);
  const replay = new Playback(tape);
  replay.seek(point);
  const branch = replay.takeOver(), alternative = replay.takeOver();
  assert.deepEqual(state(branch.match), originalPoint);
  assert.notEqual(branch.match.units, replay.match.units);
  assert.notEqual(branch.match.guards[0], replay.match.guards[0]);
  assert.equal(branch.length,0);
  assert.deepEqual(branch.orders,[]);
  assert.equal(B.isGuarded(branch.match,0,1),true);
  advance(branch,100);
  assert.deepEqual(state(branch.match),later, 'AI must make the same moves when the player does');
  assert.ok(alternative.order('deploy',0,'splitpin').ok);
  const newOpening = state(alternative.match);
  advance(alternative,100);
  assert.notDeepEqual(state(alternative.match),later);
  const altReplay = new Playback(alternative);
  assert.deepEqual(state(altReplay.match),newOpening);
  altReplay.seek(100);
  assert.deepEqual(state(altReplay.match),state(alternative.match));
  assert.deepEqual(state(replay.match),originalPoint);
  assert.deepEqual(state(tape.match),final);
  assert.equal(JSON.stringify(tape.orders),orders);
});

test('a branch at the start of a drill can finish and replay all waves on its own clock', () => {
  const tape = new Recording({mode:'watch'});
  tape.order('deploy',0,'strider');
  while (tape.match.phase === 'playing') tape.advance();
  assert.equal(tape.match.reason,'Watch relay fell');
  const replay = new Playback(tape), branch = replay.takeOver();
  assert.equal(branch.match.mode,'watch');
  assert.equal(branch.match.age,0);
  assert.deepEqual(branch.match.deployed,[1,0]);
  branch.order('deploy',1,'ram');
  while (branch.match.phase === 'playing') {
    if (branch.length % 15 === 0) {
      const id = ['wasp','strider','ram'].find(id => !B.canDeploy(branch.match,0,1,id));
      if (id) branch.order('deploy',1,id);
      if (branch.length >= 150) branch.order('guard',1);
    }
    branch.advance();
  }
  assert.equal(branch.match.winner,0);
  assert.equal(branch.match.objective.wave,3);
  const watch = new Playback(branch);
  watch.seek(branch.length);
  assert.deepEqual(state(watch.match),state(branch.match));
  replay.seek(tape.length);
  assert.equal(replay.match.winner,1);
});

test('standby and pauses never record idle steps or rejected orders', () => {
  const tape = new Recording();
  advance(tape,5);
  assert.equal(new Playback(tape).takeOver(),null);
  assert.equal(tape.order('guard',0).ok,false);
  assert.equal(tape.order('unknown',0).ok,false);
  assert.equal(tape.order('deploy',0,'carrier').ok,false);
  assert.equal(tape.length,0);
  assert.equal(tape.orders.length,0);
  tape.order('deploy',0,'ram');
  B.pause(tape.match);
  advance(tape,100);
  assert.equal(tape.length,0);
  assert.equal(tape.order('guard',0).ok,false);
  B.pause(tape.match);
  tape.advance();
  const replay = new Playback(tape);
  replay.advance();
  assert.deepEqual(state(replay.match),state(tape.match));
});

function* hands(ids, size, start = 0) {
  if (size === 0) { yield []; return; }
  for (let i = start; i <= ids.length - size; i++) {
    for (const tail of hands(ids, size - 1, i + 1)) yield [ids[i], ...tail];
  }
}
test('all 35 four-card hands finish and replay tick-for-tick in all five formats', () => {
  const ids = B.CARDS.map(card => card.id);
  let matches = 0;
  for (const deck of hands(ids, 4)) {
    for (const mode of Object.keys(FORMATS)) {
      const tape = new Recording({mode,deck,seed:317 + matches++});
      tape.order('deploy',0,deck[0]);
      const limit = Math.round(tape.match.duration / B.STEP);
      for (let tick = 0; tick < limit && tape.match.phase === 'playing'; tick++) {
        if (tick % 75 === 0) {
          const turn = tick / 75, lane = turn % 2;
          tape.order('deploy',lane,deck[turn % deck.length]);
          tape.order('guard',lane);
          if (turn % 3 === 0) tape.order('coil',1-lane,turn % 2 ? 0 : 2);
        }
        tape.advance();
      }
      const s = tape.match;
      assert.equal(s.phase,'ended',mode + ' / ' + deck.join(','));
      assert.ok(s.energy.every(e => Number.isFinite(e) && e >= 0 && e <= B.MAX_ENERGY));
      assert.ok([...s.units,...s.towers].every(u => u.hp >= 0 && u.hp <= u.maxHp));
      const replay = new Playback(tape);
      // Use only advance so the final checkpoint cannot mask any divergence.
      while (!replay.atEnd) replay.advance();
      assert.deepEqual(state(replay.match),state(s));
    }
  }
  assert.equal(matches,175);
});

test('a key play survives feed eviction and seeking or branching never duplicates its entry', () => {
  const tape = new Recording({ai:false,opening:false});
  tape.order('deploy',0,'strider');
  tape.order('guard',1);
  assert.equal(tape.order('guard',0).ok,false);
  while (tape.match.phase === 'playing') {
    if (tape.length % 120 === 0) tape.order('deploy',0,'strider');
    tape.advance();
  }
  assert.equal(tape.match.log.length,30);
  assert.ok(tape.match.log.every(e => e.kind !== 'guard'));
  assert.deepEqual(tape.moments.slice(0,2).map(e => [e.step,e.kind]),[[0,'opening'],[0,'guard']]);
  assert.equal(tape.moments.at(-1).step,tape.length);
  const fall = tape.moments.find(e => e.kind === 'relay');
  assert.ok(fall);
  const replay = new Playback(tape), original = JSON.stringify(tape.moments);
  for (let i = 0; i < 2; i++) {
    replay.seek(fall.step-1);
    assert.equal(replay.match.destroyed[0],0);
    replay.advance();
    assert.equal(replay.match.destroyed[0],1);
    assert.equal(replay.match.log[0].message,fall.message);
    const practice = replay.takeOver();
    assert.deepEqual(practice.moments,[{step:0,kind:'opening',message:'Practice position'}]);
    practice.order('guard',1);
    assert.equal(practice.moments[1].step,0);
    replay.seek(tape.length);
  }
  assert.equal(JSON.stringify(tape.moments),original);
});

test('a freight checkpoint preserves an armed coil, reloading carts and independent practice clocks', () => {
  const tape = new Recording({mode:'freight',ai:false});
  tape.order('deploy',1,'strider');
  advance(tape,450);
  assert.equal(tape.match.phase,'playing');
  assert.ok(tape.order('coil',0,1).ok);
  assert.ok(tape.order('guard',0).ok);
  const before = state(tape.match);
  advance(tape,30);
  const later = state(tape.match);
  const replay = new Playback(tape);
  replay.seek(450);
  assert.deepEqual(state(replay.match),before);
  assert.ok(replay.match.objective.carts.every(cart => cart.returnAt > replay.match.age));
  const branch = replay.takeOver();
  assert.notEqual(branch.match.coils.fields[0],replay.match.coils.fields[0]);
  assert.notEqual(branch.match.objective.carts[1],replay.match.objective.carts[1]);
  advance(branch,30);
  assert.deepEqual(state(branch.match),later);
  assert.ok(branch.match.objective.carts.every(cart => cart.returnAt === null));
  assert.deepEqual(state(replay.match),before);
  assert.ok(tape.orders.some(order => order.kind === 'coil' && order.socket === 1));
});

test('a playback at the current end observes later orders added on the same tick', () => {
  const tape = new Recording({seed:8}), replay = new Playback(tape);
  tape.order('deploy',1,'ram');
  replay.seek(0);
  assert.deepEqual(state(replay.match),state(tape.match));
  tape.order('coil',1,2);
  tape.advance();
  const branch = replay.takeOver();
  assert.equal(branch.match.coils.fields[0].socket,2);
  replay.advance();
  assert.deepEqual(state(replay.match),state(tape.match));
});

test('jumping to a discharge and taking command preserves the snare and its exact release tick', () => {
  const C = require('../js/coils'), tape = new Recording({mode:'freight',ai:false});
  tape.order('deploy',0,'ram');
  tape.order('coil',1,1);
  advance(tape,150);
  const moment = tape.moments.find(m => m.kind === 'snare');
  assert.ok(moment && moment.step > 0);
  const replay = new Playback(tape);
  replay.seek(moment.step-1);
  assert.ok(replay.match.coils.fields[0]);
  replay.advance();
  const branch = replay.takeOver();
  const caught = branch.match.units.find(u => C.isSnared(u,branch.match.age));
  assert.ok(caught);
  assert.equal(branch.match.coils.fields[0],null);
  advance(branch,59);
  assert.ok(C.isSnared(caught,branch.match.age));
  branch.advance();
  assert.ok(!C.isSnared(caught,branch.match.age));
  replay.seek(moment.step+60);
  assert.deepEqual(state(branch.match),state(replay.match));
  assert.deepEqual(branch.moments.map(e => e.kind),['opening']);
});
