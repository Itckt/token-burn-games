'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePage } = require('./support/page.js');

function tap(page, code) { page.key(code); page.key(code, 'keyup'); }
function until(page, predicate, frames = 800) {
  for (let i = 0; i < frames && !predicate(); i++) page.run(1, 100);
  assert.ok(predicate(), 'reached the requested instrument reading');
}

test('cab switches, keyboard, repeater and recorder work through a guarded, speed-limited night service', () => {
  const p = makePage(); p.run();
  const last = () => p.samples.at(-1).ride;
  p.id('shift-toggle').fire('click', { detail: 1 }); p.run();
  assert.equal(p.doc.activeElement, p.scene); assert.equal(p.id('service-clock').textContent, '23:58');
  assert.match(p.id('shift-toggle').getAttribute('aria-label'), /Last train/);
  p.id('limits-toggle').fire('click'); p.key('KeyZ', 'keydown', { repeat: true });
  assert.equal(p.id('limits-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(p.id('posted-speed').textContent, '80'); assert.match(p.id('limit-ahead').textContent, /40 km\/h in 148 m/);
  tap(p, 'KeyJ'); assert.ok(!p.id('guard-desk').hidden);
  for (let i = 0; i < 8; i++) tap(p, 'KeyW');
  p.run(8); assert.equal(p.id('drive-state').textContent, 'Guard hold');
  assert.ok(p.id('departure-bell').disabled); assert.equal(p.frames.size, 0);
  tap(p, 'KeyB'); assert.match(p.id('notice').textContent, /lock the doors/);
  p.button('doors').fire('click');
  until(p, () => p.id('guard-instruction').textContent.includes('complete'));
  assert.equal(p.frames.size, 0); assert.equal(p.id('door-state').textContent, 'Open');
  assert.equal(p.id('service-clock').textContent, '23:58');
  tap(p, 'KeyD'); until(p, () => !p.id('departure-bell').disabled);
  assert.equal(p.id('guard-instruction').dataset.lamp, '2');
  p.id('departure-bell').fire('click'); assert.equal(p.id('guard-instruction').dataset.lamp, '3');
  until(p, () => p.id('drive-state').textContent === 'Line brake');
  tap(p, 'KeyZ'); assert.match(p.id('notice').textContent, /berthed/);
  until(p, () => p.id('posted-speed').textContent === '40');
  assert.ok(p.id('posted-speed').classList.contains('restricted')); assert.equal(p.id('target-value').textContent, '80');
  assert.equal(p.id('drive-state').textContent, 'Line limit'); assert.equal(p.id('speed-value').textContent, '40');
  until(p, () => p.id('posted-speed').textContent === '80');
  until(p, () => !p.id('cab-recorder').hidden);
  assert.equal(last().sheet.entries[0].arrivalClock, '00:02');
  assert.equal(p.id('sheet-rows').children[0].children[7].textContent, '00:02');
  const points = last().sheet.entries[0].trace, slider = p.id('trace-sample');
  assert.ok(!p.id('trace-limit').hidden);
  p.id('run-sheet').open = true; p.id('run-sheet').fire('toggle');
  const curve = p.lines.find(line => line.ink === '#aebcf3');
  assert.deepEqual(curve.dash, [2, 3]);
  assert.equal(new Set(curve.points.map(point => point[1])).size, 2);
  slider.value = String(points.findIndex(point => point.limit === 40)); slider.fire('input');
  assert.match(slider.getAttribute('aria-valuetext'), /target 80 km\/h.*limit 40 km\/h/);
  assert.equal(p.id('guard-instruction').dataset.lamp, '1');
});

test('changing shift repaints a parked cab, and suspension freezes the clock and a guard crossing', () => {
  const p = makePage(); p.run(); const count = p.samples.length;
  tap(p, 'KeyN'); p.key('KeyN', 'keydown', { repeat: true }); p.run();
  assert.equal(p.samples.length, count + 1); assert.equal(p.frames.size, 0);
  assert.equal(p.id('shift-name').textContent, 'Last train'); assert.equal(p.samples.at(-1).ride.clock.shift, 1);
  tap(p, 'KeyN'); p.run(); assert.equal(p.id('shift-name').textContent, 'First train');
  p.id('guard-toggle').fire('click'); tap(p, 'KeyD');
  until(p, () => p.samples.at(-1).ride.car.call.crossing);
  for (const reason of ['guide', 'hidden', 'graphics', 'pause']) {
    const before = p.samples.at(-1).ride;
    if (reason === 'guide') tap(p, 'KeyH');
    if (reason === 'hidden') { p.doc.hidden = true; p.doc.fire('visibilitychange'); }
    if (reason === 'graphics') p.scene.fire('webglcontextlost');
    if (reason === 'pause') tap(p, 'KeyP');
    p.run(2, 60000); tap(p, 'KeyN');
    if (reason === 'guide') tap(p, 'Escape');
    if (reason === 'hidden') { p.doc.hidden = false; p.doc.fire('visibilitychange'); }
    if (reason === 'graphics') p.scene.fire('webglcontextrestored');
    if (reason === 'pause') tap(p, 'KeyP');
    p.run();
    const restored = p.samples.at(-1).ride;
    assert.deepEqual(restored.clock, before.clock, reason);
    assert.deepEqual(restored.car.call, before.car.call, reason);
    assert.deepEqual(restored.guard, before.guard, reason);
  }
  const offline = makePage({ capture: false });
  for (const id of ['limits-toggle','guard-toggle','departure-bell','shift-toggle']) assert.ok(offline.id(id).disabled);
  assert.match(offline.id('guide').textContent, /departure|dispatch/i);
});

test('run-sheet entries without recordings remain readable and a departure-only trace has a finite cursor', () => {
  const p = makePage({ app: false }), { service, runSheet } = p.api;
  const sheet = service.createSheet(), refresh = runSheet.bind(sheet);
  const add = options => {
    sheet.departedAt = 0; service.recordArrival(sheet, 0, 42, null, false, undefined, options); refresh();
  };
  add(); assert.equal(p.id('sheet-rows').children.length, 1); assert.ok(p.id('cab-recorder').hidden);
  add({ trace: [{ tick: 0, metres: 0, speed: 0, target: 0, power: 0 }] });
  add();
  assert.equal(p.id('trace-leg').value, '2'); assert.equal(p.id('trace-leg').children.length, 1);
  p.id('run-sheet').open = true; p.id('run-sheet').fire('toggle');
  assert.equal(p.id('trace-cursor').style.left, '0%'); assert.equal(p.id('trace-end').textContent, '0:00.0');
  assert.ok(p.lines.length > 0 && p.lines.every(line => line.points.flat().every(Number.isFinite)));
  for (let i = 0; i < 4; i++) add();
  assert.ok(p.id('cab-recorder').hidden); assert.equal(p.id('sheet-rows').children.length, 5);
});
