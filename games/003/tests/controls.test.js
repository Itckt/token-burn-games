'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {boot,deps} = require('./harness/page');
const {battle:B} = deps;

test('the opening screen exposes four selectable cards, ten energy cells, lane labels and relay health', () => {
  const p = boot(), cards = p.byId('cards').children;
  assert.deepEqual(cards.map(b => b.dataset.card), [...deps.roster.DEFAULT_DECK]);
  assert.deepEqual(cards.map(b => b.getAttribute('aria-pressed')), ['true','false','false','false']);
  assert.ok(cards.every(b => b.querySelector('img').src.startsWith('data:image/png')));
  assert.equal(p.byId('energy-meter').children.length, 10);
  assert.equal(p.byId('energy-number').textContent, '7');
  assert.equal(p.byId('time').textContent, '03:00');
  assert.equal(p.byId('world-labels').children.length, 6);
  assert.match(p.byId('field').getAttribute('aria-label'), /Your A 620 HP/);
  p.advance(60);
  assert.equal(p.match.phase, 'ready');
  assert.equal(p.match.age, 0);
  assert.equal(p.byId('overlay').hidden, true);
});

test('card clicks, hotkeys and lane buttons agree on the selection, placement, bill and cooldown', () => {
  const p = boot();
  p.byId('cards').children[3].click();
  assert.equal(p.byId('deploy-name').textContent, 'Coil Mortar');
  assert.equal(p.byId('unit-info').textContent, B.CARD.mortar.info);
  p.click('lane-b');
  assert.equal(p.match.phase, 'playing');
  assert.equal(p.byId('phase-text').textContent, 'LIVE MATCH');
  assert.equal(p.byId('energy-number').textContent, '2');
  assert.equal(p.match.units.at(-1).lane, 1);
  assert.equal(p.byId('lane-a').disabled, true);
  p.key('e');
  assert.match(p.byId('notice').textContent, /Need 5 energy/);
  p.key('1');
  assert.equal(p.byId('lane-a').disabled, false);
  p.key('Q');
  assert.deepEqual(p.match.deployed, [2,0]);
  assert.match(p.byId('feed-message').textContent, /Arc Strider in Lane A/);
  assert.equal(p.byId('energy-number').textContent, '0');
  p.advance(300);
  assert.ok(p.match.deployed[1] > 0);
  assert.equal(p.byId('lane-a').disabled, false);
  assert.equal(p.byId('notice').hidden, true);
});

test('pointer picking deploys from the home end in both cameras and ignores the divider and city', () => {
  const p = boot(), field = p.byId('field');
  field.emit('click',p.point(0,0));
  field.emit('click',p.point(12,-2));
  assert.equal(p.match.phase, 'ready');
  field.emit('pointermove',p.point(5,B.LANES[1]));
  assert.equal(p.renderer.hover, 1);
  assert.ok(field.classList.contains('aiming'));
  field.emit('click',p.point(5,B.LANES[1]));
  const first = p.match.units.at(-1);
  assert.equal(first.lane, 1);
  assert.ok(first.x < -5);
  p.key('v');
  p.frame();
  assert.equal(p.byId('camera-button').querySelector('span').textContent, 'CAM 02');
  p.key('2');
  field.emit('click',p.point(-3,B.LANES[0]));
  assert.equal(p.match.units.at(-1).lane, 0);
  assert.equal(p.match.units.at(-1).cardId, 'ram');
  field.emit('pointerleave');
  assert.equal(p.renderer.hover, null);
  assert.equal(p.renderer.pointer, 0);
  assert.ok(!field.classList.contains('aiming'));
  p.byId('lane-b').emit('pointerenter');
  assert.equal(p.renderer.hover, 1);
  p.byId('lane-b').emit('pointerleave');
  assert.equal(p.renderer.hover, null);
});

test('modifiers, held keys and unrelated keys cannot trigger accidental deployments', () => {
  const p = boot();
  for (const opts of [{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true}]) {
    assert.equal(p.key('e',opts).defaultPrevented, false);
  }
  assert.equal(p.key('Tab').defaultPrevented, false);
  assert.equal(p.match.phase, 'ready');
  assert.equal(p.key('q').defaultPrevented, true);
  assert.equal(p.match.deployed[0], 1);
});

test('pause freezes simulation and animation until the player resumes or restarts', () => {
  const p = boot();
  p.key('q');
  p.advance(61);
  p.key('p');
  const time = p.match.time, scene = p.renderer.sceneTime;
  assert.equal(p.byId('overlay-title').textContent, 'Match paused');
  assert.ok(!p.byId('overlay').hidden && p.byId('lane-b').disabled);
  p.advance(120);
  assert.equal(p.match.time, time);
  assert.equal(p.renderer.sceneTime, scene);
  p.click('overlay-main');
  p.advance(20);
  assert.ok(p.match.time < time);
  p.click('pause-button');
  p.click('overlay-second');
  p.frame();
  assert.equal(p.match.phase, 'ready');
  assert.equal(p.match.time, 180);
  assert.deepEqual(p.match.deployed, [0,0]);
});

test('controls and history suspend a live match and preserve a preexisting pause', () => {
  const p = boot(), dialog = p.byId('dialog');
  p.key('?');
  assert.equal(dialog.open, true);
  assert.match(p.byId('dialog-content').textContent, /first deployment starts/);
  p.click('dialog-done');
  assert.equal(p.match.phase, 'ready');
  p.key('e');
  p.click('history-button');
  assert.equal(p.match.phase, 'paused');
  assert.match(p.byId('dialog-content').textContent, /Arc Strider in Lane B/);
  assert.equal(p.key('q').defaultPrevented, false);
  p.advance(90);
  assert.equal(p.match.age, 0);
  p.click('close-dialog');
  assert.equal(p.match.phase, 'playing');
  p.key('p');
  p.click('help-button');
  dialog.close();
  assert.equal(p.match.phase, 'paused');
});

test('backgrounding stops the animation loop and requires an explicit resume without time catch-up', () => {
  const p = boot();
  p.key('q');
  p.advance(20);
  p.click('help-button');
  p.doc.hidden = true;
  p.doc.emit('visibilitychange');
  p.click('dialog-done');
  assert.equal(p.frames.size, 0);
  const age = p.match.age;
  p.frame(30000);
  p.doc.hidden = false;
  p.doc.emit('visibilitychange');
  p.frame();
  assert.equal(p.match.phase, 'paused');
  assert.equal(p.match.age, age);
  p.key('p');
  p.advance(4);
  assert.ok(p.match.age > age && p.match.age < age+.1);
});

test('context loss preserves the match and restoration resumes with a single paused render loop', () => {
  const p = boot(), field = p.byId('field');
  p.key('e');
  p.advance(45);
  const state = p.match, before = state.time;
  assert.ok(field.emit('webglcontextlost').defaultPrevented);
  assert.equal(p.frames.size, 0);
  assert.equal(p.byId('overlay-title').textContent, 'Graphics interrupted');
  assert.equal(p.byId('overlay-main').hidden, true);
  p.frame(1000);
  field.emit('webglcontextrestored');
  assert.equal(p.frames.size, 1);
  p.frame();
  assert.equal(p.match,state);
  assert.equal(state.time,before);
  assert.equal(p.byId('overlay-title').textContent, 'Match paused');
  p.click('overlay-main');
  p.advance(10);
  assert.ok(state.time < before);
});

test('win, loss and draw screens expose the final score, history and a playable rematch', () => {
  for (const [falls,title] of [[[2,3],'You win'],[[0,1],'Vanta wins'],[[0,1,2,3],'Match drawn']]) {
    const p = boot();
    p.key('q');
    for (const index of falls) p.match.towers[index].hp = 0;
    p.advance(4);
    assert.equal(p.match.phase,'ended');
    assert.equal(p.byId('overlay-title').textContent,title);
    assert.equal(p.byId('pause-button').disabled,true);
    assert.equal(p.byId('score-player').textContent,String(p.match.destroyed[0]));
    assert.equal(p.byId('score-rival').textContent,String(p.match.destroyed[1]));
    p.click('overlay-second');
    assert.equal(p.byId('dialog').open,true);
    p.click('dialog-done');
    p.click('overlay-main');
    p.frame();
    assert.equal(p.match.phase,'ready');
    p.click('lane-a');
    assert.equal(p.match.phase,'playing');
  }
});

test('fullscreen toggles the complete console and sound starts only after explicit input', () => {
  const notes = [];
  class Audio {
    constructor() { this.state = 'running'; this.currentTime = 0; }
    param() { return {setValueAtTime(){},exponentialRampToValueAtTime(){}}; }
    createOscillator() { return {frequency:this.param(),connect(){},start(){notes.push(true);},stop(){}}; }
    createGain() { return {gain:this.param(),connect(){}}; }
  }
  const p = boot({AudioContext:Audio});
  p.click('expand-button');
  assert.equal(p.doc.fullscreenElement,p.doc.documentElement);
  assert.equal(p.byId('expand-button').getAttribute('aria-pressed'),'true');
  p.click('expand-button');
  assert.equal(p.doc.fullscreenElement,null);
  p.key('q');
  p.advance(2);
  assert.equal(notes.length,0);
  p.key('m');
  assert.equal(p.byId('sound-button').getAttribute('aria-pressed'),'true');
  p.key('2');
  p.key('e');
  p.frame();
  assert.ok(notes.length >= 3);
  p.key('m');
  const last = notes.length;
  p.key('3');
  p.advance(80);
  assert.equal(notes.length,last);
  assert.equal(boot().byId('sound-button').disabled,true);
});
