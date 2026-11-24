'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePage } = require('./support/page.js');

function tap(p, code) { p.key(code); p.key(code, 'keyup'); }
function until(p, predicate) {
  for (let i = 0; i < 950 && !predicate(); i++) p.run(1, 100);
  assert.ok(predicate(), 'reached the expected page state');
}
function choose(p, card) {
  const select = p.id('duty-select');
  select.value = card; select.fire('change');
}

test('the saloon button, key, free look and cab return move the eye and expose the bilingual caption', () => {
  const p = makePage(); p.run();
  const sample = () => p.samples.at(-1);
  assert.ok(p.id('saloon-caption').hidden);
  p.id('view-saloon').fire('click', { detail: 1 });
  assert.equal(p.doc.activeElement, p.scene);
  assert.equal(p.id('saloon-caption').hidden, false);
  assert.equal(p.id('saloon-english').textContent, 'At station · Kowloon Tong');
  assert.equal(p.id('saloon-chinese').textContent, '現在停靠 · 九龍塘');
  p.run(120); assert.equal(sample().camera.seat, 1); assert.equal(p.frames.size, 0);
  p.scene.fire('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
  p.scene.fire('pointermove', { pointerId: 3, clientX: 54, clientY: 22 });
  p.scene.fire('pointerup', { pointerId: 3 }); p.run(120);
  assert.equal(sample().camera.preset, 'free'); assert.equal(sample().camera.seat, 1);
  assert.equal(p.id('saloon-caption').hidden, false);
  tap(p, 'KeyV'); p.run(120);
  assert.equal(sample().camera.seat, 0); assert.ok(p.id('saloon-caption').hidden);
  tap(p, 'KeyI'); p.run(120);
  assert.equal(p.id('view-saloon').getAttribute('aria-pressed'), 'true');
  tap(p, 'KeyD'); until(p, () => p.id('door-state').textContent === 'Open');
  assert.match(p.id('saloon-english').textContent, /Doors open on right/);
  tap(p, 'KeyD'); assert.match(p.id('saloon-chinese').textContent, /關閉/);
  tap(p, 'KeyR'); p.run(120); assert.ok(p.id('saloon-caption').hidden);
  assert.equal(sample().camera.preset, 'front');
  const offline = makePage({ capture: false });
  assert.ok(offline.id('view-saloon').disabled && offline.id('duty-select').disabled);
  assert.match(offline.id('guide').textContent, /passenger|saloon/i);
});

test('a selected duty rides through a signal, pauses and graphics restoration, then follows the inspected run', () => {
  const p = makePage(); p.run();
  const selector = p.id('duty-select'), read = id => p.id(id).textContent;
  assert.equal(selector.children.length, 4); assert.equal(selector.value, 'free');
  selector.focus(); selector.fire('pointerdown'); choose(p, 'coast');
  assert.equal(p.doc.activeElement, p.scene);
  selector.focus(); selector.fire('keydown', { code: 'ArrowDown' }); choose(p, 'smooth');
  assert.equal(p.doc.activeElement, selector);
  assert.equal(p.key('ArrowUp').defaultPrevented, false); assert.equal(read('target-value'), '0');
  p.scene.focus(); tap(p, 'KeyI'); tap(p, 'KeyG');
  for (let i = 0; i < 5; i++) tap(p, 'KeyW');
  until(p, () => read('drive-state') === 'Signal hold');
  assert.ok(selector.disabled); assert.match(read('saloon-chinese'), /等候信號.*校園/);
  choose(p, 'mark'); assert.equal(selector.value, 'smooth');
  tap(p, 'KeyP'); const frozen = p.samples.at(-1);
  p.run(2, 60000); assert.equal(p.samples.at(-1), frozen);
  tap(p, 'KeyP'); p.run();
  const quality = p.samples.at(-1).ride.quality, swing = p.samples.at(-1).ride.swing;
  p.scene.fire('webglcontextlost'); assert.ok(p.id('saloon-caption').hidden);
  p.run(2, 60000); p.scene.fire('webglcontextrestored'); p.run();
  assert.deepEqual(p.samples.at(-1).ride.quality, quality);
  assert.deepEqual(p.samples.at(-1).ride.swing, swing);
  assert.equal(p.samples.at(-1).camera.seat, 1); assert.ok(selector.disabled);
  until(p, () => read('saloon-english').startsWith('Arriving'));
  assert.match(read('duty-live'), /Peak brake.*sideways/);
  until(p, () => !p.id('duty-result').hidden);
  assert.match(read('duty-result'), /Campus Gate/); assert.equal(selector.disabled, false);
  const first = p.samples.at(-1).ride.sheet.entries[0];
  const outcome = first.duty.passed ? 'Completed' : 'Missed';
  assert.ok(read('duty-result').startsWith(outcome));
  assert.equal(read('review-duty'), 'Steady carriage · ' + outcome);
  assert.equal(read('review-forces'), first.duty.detail);
  choose(p, 'free'); assert.ok(p.id('duty-result').hidden);
  until(p, () => p.id('sheet-rows').children.length === 2);
  assert.ok(p.id('review-duty').hidden);
  const recorded = p.id('trace-leg'); recorded.value = '1'; recorded.fire('change');
  assert.equal(p.id('review-duty').hidden, false);
  assert.equal(read('review-forces'), first.duty.detail);
});

test('a held look key can sleep at the physical head stop and pan back on release of an opposing key', () => {
  const p = makePage(); p.run(); tap(p, 'KeyI'); p.run(120);
  for (const [out, back, limit] of [['ArrowRight','ArrowLeft',Math.PI], ['ArrowLeft','ArrowRight',-Math.PI]]) {
    p.key(out); p.run(420);
    assert.equal(p.samples.at(-1).camera.yaw, limit);
    assert.equal(p.frames.size, 0);
    p.key(back); p.run(4); assert.equal(p.frames.size, 0);
    p.key(out, 'keyup'); p.run(10);
    assert.ok(Math.abs(p.samples.at(-1).camera.yaw) < Math.PI);
    p.key(back, 'keyup'); p.run(120);
  }
});
