'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {boot, deps} = require('./harness/page');
const {recordingGL} = require('./harness/gl');

function storage(initial = null) {
  return {value:initial, getItem() { return this.value; }, setItem(key, value) { this.value = value; }};
}
function chooseFormat(p, mode) {
  const menu = p.byId('setup-mode');
  menu.value = mode;
  menu.emit('change');
}
function rosterButton(p, id) { return p.byId('setup-roster').children.find(b => b.dataset.card === id); }
function hand(p) { return p.byId('cards').children.map(b => b.dataset.card); }
function startDrill(p, mode) {
  p.click('match-setup');
  chooseFormat(p,mode);
  p.click('dialog-done');
  p.frame();
}
function scrub(p, position) {
  const seek = p.byId('replay-seek');
  seek.value = String(position);
  seek.emit('input');
  p.frame();
}

test('setup previews edits, swaps keys, cancels or applies atomically and remembers the chosen hand', () => {
  const saved = storage(), p = boot({storage:saved});
  p.key('3');
  p.click('match-setup');
  assert.equal(p.byId('setup-slots').children[2].getAttribute('aria-pressed'),'true');
  assert.equal(p.key('q').defaultPrevented,false);
  rosterButton(p,'tender').click();
  chooseFormat(p,'watch');
  p.click('setup-cancel');
  assert.deepEqual(hand(p),deps.roster.DEFAULT_DECK);
  assert.equal(p.byId('time').textContent,'03:00');
  assert.equal(saved.value,null);
  p.click('match-setup');
  p.byId('setup-slots').children[0].click();
  rosterButton(p,'splitpin').click();
  p.byId('setup-slots').children[3].click();
  rosterButton(p,'ram').click();
  assert.match(p.byId('setup-intel').textContent,/Slot 4 · Kiln Ram/);
  chooseFormat(p,'escort');
  assert.match(p.byId('setup-brief').textContent,/green arch/);
  p.click('dialog-done');
  p.frame();
  const expected = ['splitpin','mortar','wasp','ram'];
  assert.deepEqual(hand(p),expected);
  assert.deepEqual(JSON.parse(saved.value),expected);
  assert.equal(p.match.mode,'escort');
  assert.equal(p.byId('objective-strip').hidden,false);
  assert.equal(p.byId('time').textContent,'00:55');
  assert.equal(p.byId('deploy-name').textContent,'Splitpin Pair');
  p.byId('lane-a').emit('focus');
  assert.equal(p.renderer.hover,0);
  assert.equal(p.renderer.previewCard,'splitpin');
  p.byId('lane-a').emit('blur');
  assert.equal(p.renderer.hover,null);
  p.key('1');
  p.key('e');
  assert.equal(p.match.units.filter(u => u.cardId === 'splitpin').length,2);
  assert.equal(p.byId('energy-number').textContent,'4');
  assert.equal(p.byId('match-setup').disabled,true);
  p.click('match-setup');
  assert.ok(!p.byId('dialog').open);
  p.key('4');
  assert.equal(p.byId('deploy-name').textContent,'Kiln Ram');
  p.key('p');
  p.click('overlay-second');
  p.frame();
  assert.deepEqual(hand(p),expected);
  assert.equal(p.match.phase,'ready');
  assert.equal(p.match.mode,'escort');
  const next = boot({storage:saved});
  assert.deepEqual(hand(next),expected);
  assert.equal(next.match.mode,'standard');
});

test('invalid or inaccessible file storage still allows editing, cancelling with Escape and playing', () => {
  for (const store of [storage('{bad'),storage('["ram","ram","wasp","mortar"]'),
    {getItem(){throw Error('denied');}, setItem(){throw Error('denied');}}]) {
    const p = boot({storage:store});
    assert.deepEqual(hand(p),deps.roster.DEFAULT_DECK);
    p.click('match-setup');
    rosterButton(p,'tender').click();
    p.byId('dialog').close(); // Native Escape closes the dialog through the same event.
    assert.deepEqual(hand(p),deps.roster.DEFAULT_DECK);
    p.click('match-setup');
    rosterButton(p,'tender').click();
    p.click('dialog-done');
    p.key('q');
    p.frame();
    assert.equal(p.match.phase,'playing');
    assert.equal(p.match.units.at(-1).cardId,'tender');
  }
});

test('a finished drill can be scrubbed, played from a chosen tick, retried and returned to its original result', () => {
  const p = boot();
  startDrill(p,'watch');
  p.key('q');
  p.advance(110,250);
  assert.equal(p.byId('overlay-title').textContent,'Drill lost');
  assert.equal(p.match.reason,'Watch relay fell');
  const finished = p.match, record = JSON.stringify(finished);
  p.click('watch-replay');
  p.click('replay-speed');
  p.click('replay-speed');
  assert.equal(p.byId('replay-speed').textContent,'4×');
  const length = Number(p.byId('replay-seek').max);
  scrub(p,length);
  assert.equal(p.byId('take-over').disabled,true);
  scrub(p,60);
  assert.equal(p.byId('phase-text').textContent,'REPLAY PAUSED');
  assert.equal(p.renderer.previewCard,null);
  const atFork = JSON.stringify(p.match), firstHP = p.match.towers[1].hp;
  p.key('x');
  p.key('e');
  assert.equal(JSON.stringify(p.match),atFork);
  assert.equal(p.byId('take-over').disabled,false);
  p.click('take-over');
  p.frame();
  assert.equal(JSON.stringify(p.match),atFork);
  assert.equal(p.byId('phase-text').textContent,'PRACTICE');
  assert.equal(p.byId('deploy-strip').hidden,false);
  assert.equal(p.byId('return-original').hidden,false);
  p.key('2');
  p.key('e');
  p.key('x');
  p.advance(4);
  assert.equal(p.match.units.at(-1).cardId,'ram');
  assert.ok(deps.battle.isGuarded(p.match,0,1));
  p.click('history-button');
  assert.match(p.byId('dialog-content').textContent,/You guarded Lane B/);
  p.click('dialog-done');
  p.key('p');
  assert.equal(p.byId('overlay-second').textContent,'Retry position');
  p.click('overlay-second');
  p.frame();
  assert.equal(JSON.stringify(p.match),atFork);
  p.advance(110,250);
  assert.equal(p.byId('overlay-main').textContent,'Retry position');
  p.click('watch-replay');
  assert.equal(p.byId('take-over').hidden,true);
  p.click('return-original');
  p.frame();
  assert.equal(p.byId('return-original').hidden,true);
  assert.equal(p.byId('phase-text').textContent,'REPLAY PAUSED');
  assert.equal(p.byId('replay-seek').value,'60');
  assert.equal(p.byId('replay-speed').textContent,'4×');
  assert.equal(p.match.towers[1].hp,firstHP);
  assert.equal(JSON.stringify(p.match),atFork);
  p.advance(10);
  assert.equal(JSON.stringify(p.match),atFork);
  p.click('exit-replay');
  p.frame();
  assert.equal(p.match,finished);
  assert.equal(JSON.stringify(finished),record);
});

test('graphics interruptions and tab changes pause a practice run without consuming the source replay', () => {
  const p = boot(), field = p.byId('field');
  startDrill(p,'watch');
  p.key('q');
  p.advance(100,250);
  p.click('watch-replay');
  scrub(p,100);
  p.click('take-over');
  p.frame();
  p.click('help-button');
  field.emit('webglcontextlost');
  p.click('dialog-done');
  assert.equal(p.byId('phase-text').textContent,'OFFLINE');
  field.emit('webglcontextrestored');
  p.frame();
  assert.equal(p.byId('phase-text').textContent,'PRACTICE PAUSED');
  const age = p.match.age;
  p.key('p');
  p.doc.hidden = true;
  p.doc.emit('visibilitychange');
  p.frame(5000);
  p.doc.hidden = false;
  p.doc.emit('visibilitychange');
  p.frame();
  assert.equal(p.match.age,age);
  p.click('return-original');
  p.frame();
  assert.equal(p.byId('replay-seek').value,'100');
  assert.equal(p.byId('phase-text').textContent,'REPLAY PAUSED');
});

test('a configured escort runs through the real local entry point after a WebGL retry', () => {
  const options = {entry:true}, p = boot(options);
  p.click('match-setup');
  rosterButton(p,'tender').click();
  chooseFormat(p,'escort');
  p.click('dialog-done');
  assert.equal(p.byId('overlay-title').textContent,'WebGL is unavailable');
  assert.equal(p.byId('lane-a').disabled,true);
  options.gl = recordingGL().gl;
  p.click('overlay-main');
  p.frame();
  assert.equal(p.byId('objective-name').textContent,'Parcel Run');
  assert.match(p.byId('objective-detail').textContent,/185 carrier HP/);
  assert.ok(p.byId('cards').children[0].querySelector('img').src.startsWith('data:image/png'));
  p.key('q');
  p.advance(3);
  assert.match(p.byId('feed-message').textContent,/Loom Tender in Lane A/);
  assert.equal(p.byId('phase-text').textContent,'LIVE MATCH');
});
