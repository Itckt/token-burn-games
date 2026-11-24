'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scenes, createScene, readCheckpoint } = require('../scenes.js');
const { World, TICK } = require('../physics.js');
const { near } = require('./helpers.js');

// Execute the actual page scripts in HTML order, with a manual frame clock
// and a recording canvas. This needs neither a display nor a browser process.
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script defer src="([^"]+)"/g), ([, name]) =>
  new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name }));

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  fire(type, fields = {}) {
    const event = {
      target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...fields
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

function page({ reducedMotion = false, canvasSupport = true } = {}) {
  const elements = new Map();
  for (const [, tag, attrs] of html.matchAll(/<([a-z]\w*)\b([^>]*)>/gi)) {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    assert.ok(!elements.has(id), 'duplicate ID ' + id);
    const el = new Element(tag);
    el.value = attrs.match(/\bvalue="([^"]+)"/)?.[1] || '';
    el.checked = /\bchecked\b/.test(attrs);
    elements.set(id, el);
  }
  function get(id) {
    assert.ok(elements.has(id), 'missing HTML element ' + id);
    return elements.get(id);
  }
  const document = new Element('document');
  document.hidden = false;
  document.getElementById = get;
  document.createElement = tag => new Element(tag);
  const window = new Element('window');
  window.devicePixelRatio = 2;
  window.matchMedia = () => ({ matches: reducedMotion });
  const frames = [];
  let frameNumber = 0;
  window.requestAnimationFrame = callback => {
    frames.push(callback);
    return ++frameNumber;
  };

  const canvas = get('court');
  const rect = { left: 30, top: 40, width: 420, height: 240 };
  canvas.getBoundingClientRect = () => rect;
  const captures = new Set();
  canvas.setPointerCapture = id => captures.add(id);
  canvas.hasPointerCapture = id => captures.has(id);
  canvas.releasePointerCapture = id => captures.delete(id);
  const ops = [];
  const ctx = { canvas, globalAlpha: 1 };
  for (const name of [
    'fillRect', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc',
    'stroke', 'fill', 'fillText', 'setLineDash'
  ]) {
    ctx[name] = (...args) => {
      for (const n of args.flat().filter(v => typeof v === 'number')) assert.ok(Number.isFinite(n));
      if (name === 'arc') assert.ok(args[2] >= 0, 'negative arc radius');
      ops.push({ name, args, alpha: ctx.globalAlpha });
    };
  }
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  canvas.getContext = kind => kind === '2d' && canvasSupport ? ctx : null;
  const context = vm.createContext({ window, document });
  for (const script of scripts) script.runInContext(context);

  function frame(timestamp) {
    assert.equal(frames.length, 1, 'one coalesced animation-frame request');
    ops.length = 0;
    frames.shift()(timestamp);
  }
  function pointer(type, x, y, pointerId = 1, button = 0) {
    const [width, height] = get('surface').style.aspectRatio.split('/').map(Number);
    return canvas.fire(type, {
      pointerId, button, clientX: rect.left + x / width * rect.width,
      clientY: rect.top + y / height * rect.height
    });
  }
  function change(id, value, type = 'input') {
    get(id).value = value;
    get(id).fire(type);
  }
  function label(id) {
    const text = String(id).padStart(2, '0');
    const label = ops.find(op => op.name === 'fillText' && op.args[0] === text);
    assert.ok(label, 'ball ' + id + ' is drawn with its ID');
    return { x: label.args[1], y: label.args[2] - 0.5 };
  }
  return {
    get, canvas, rect, frames, ops, frame, pointer, change, label, document, window,
    click: id => get(id).fire('click'), text: id => get(id).textContent
  };
}

test('page assets are local files and each explicit label targets a form control', () => {
  const p = page({ reducedMotion: true });
  for (const [, asset] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    assert.match(asset, /^[\w.-]+$/);
    assert.ok(fs.statSync(path.join(root, asset)).isFile());
  }
  for (const [, id] of html.matchAll(/<label for="([^"]+)"/g)) {
    assert.ok(['INPUT', 'SELECT', 'TEXTAREA'].includes(p.get(id).tagName));
  }
});

test('the live canvas and measurements match an independent headless run', () => {
  const p = page();
  const expected = createScene();
  p.frame(0);
  assert.equal(p.text('run-state'), 'Running');
  assert.equal(p.text('play-label'), 'Pause');
  assert.deepEqual(p.get('scene').children.map(option => option.value), Object.keys(scenes));
  assert.equal(p.text('scene-name'), 'Kowloon Six');
  for (let i = 1; i <= 60; i++) p.frame(i * 50);
  for (let i = 0; i < 360; i++) expected.step();
  assert.equal(p.text('sim-time'), '3.000 s');
  assert.equal(p.text('ball-hits'), String(expected.ballHits));
  assert.equal(p.text('wall-hits'), String(expected.wallHits));
  assert.equal(p.text('ball-count'), String(expected.balls.length));
  assert.equal(p.text('energy'), Math.round(expected.kineticEnergy).toLocaleString('en-US'));
  for (const ball of expected.balls) {
    const drawn = p.label(ball.id);
    assert.ok(Math.hypot(drawn.x - ball.x, drawn.y - ball.y) < 1e-9);
  }
});

test('reduced motion starts paused and resuming excludes idle time', () => {
  const p = page({ reducedMotion: true });
  p.frame(0);
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.frames.length, 0);
  p.click('single-step');
  p.frame(7000);
  assert.equal(p.text('sim-time'), '0.008 s');
  assert.equal(p.frames.length, 0);
  p.click('toggle-play');
  p.frame(12000);
  p.frame(12050);
  assert.equal(p.text('sim-time'), '0.058 s');
  p.click('toggle-play');
  p.frame(18000);
  assert.equal(p.text('sim-time'), '0.058 s');
  assert.equal(p.frames.length, 0);
});

test('scene, speed and elasticity controls affect live physics and reset restores the preset', () => {
  const p = page();
  p.change('elasticity', '0.5');
  p.change('speed', '2');
  p.change('scene', 'mass-mismatch', 'change');
  p.frame(0);
  assert.equal(p.text('scene-name'), 'Mass mismatch');
  assert.equal(p.text('ball-count'), '2');
  assert.equal(p.text('speed-value'), '2×');
  assert.equal(p.text('elasticity-value'), '0.50');
  for (let i = 1; i <= 10; i++) p.frame(i * 100);
  const expected = createScene('mass-mismatch', 0.5);
  for (let i = 0; i < 240; i++) expected.step();
  assert.equal(p.text('sim-time'), '2.000 s');
  assert.equal(p.text('ball-hits'), '1');
  assert.equal(p.label(1).x, expected.balls[0].x);
  p.click('add-ball');
  p.frame(1000);
  assert.equal(p.text('ball-count'), '3');
  p.click('reset');
  p.frame(1100);
  assert.equal(p.text('ball-count'), '2');
  assert.equal(p.text('ball-hits'), '0');
  assert.equal(p.text('sim-time'), '0.000 s');
  assert.equal(p.text('run-state'), 'Running');
  assert.equal(p.get('elasticity').value, '0.5');
  assert.equal(p.get('speed').value, '2');
});

test('click places a stationary ball and dragging sets velocity in court coordinates', () => {
  const p = page({ reducedMotion: true });
  p.pointer('pointerdown', 420, 400);
  p.pointer('pointerup', 420, 400);
  p.frame(0);
  assert.equal(p.text('feedback'), 'Ball 7 placed.');
  assert.deepEqual(p.label(7), { x: 420, y: 400 });
  p.pointer('pointerdown', 550, 360);
  p.pointer('pointermove', 565, 350);
  p.frame(1);
  assert.ok(p.canvas.hasPointerCapture(1));
  p.pointer('pointerup', 580, 340);
  p.click('single-step');
  p.frame(2);
  assert.equal(p.text('feedback'), 'Ball 8 launched.');
  assert.equal(p.text('ball-count'), '8');
  assert.deepEqual(p.label(7), { x: 420, y: 400 });
  assert.deepEqual(p.label(8), { x: 550 + 90 * TICK, y: 360 - 60 * TICK });
  assert.ok(!p.canvas.hasPointerCapture(1));
});

test('long drags cap launch speed and release outside the canvas succeeds', () => {
  const p = page({ reducedMotion: true });
  p.pointer('pointerdown', 420, 400);
  p.pointer('pointerup', 1000, 400);
  p.click('single-step');
  p.frame(0);
  assert.deepEqual(p.label(7), { x: 420 + 480 * TICK, y: 400 });
});

test('occupied starts, edge starts, cancelled drags and secondary pointers are safe', () => {
  const p = page({ reducedMotion: true });
  for (const [x, y] of [[151, 111], [8, 80]]) {
    p.pointer('pointerdown', x, y);
    assert.match(p.text('feedback'), /clear spot/);
    assert.ok(!p.canvas.hasPointerCapture(1));
  }
  for (const cancel of ['pointercancel', 'lostpointercapture']) {
    p.pointer('pointerdown', 420, 400);
    p.pointer('pointerdown', 540, 420, 2);
    p.pointer('pointerup', 540, 420, 2);
    assert.ok(p.canvas.hasPointerCapture(1));
    p.pointer(cancel, 420, 400);
    p.pointer('pointerup', 420, 400);
    assert.ok(!p.canvas.hasPointerCapture(1));
  }
  p.pointer('pointerdown', 420, 400, 1, 2);
  p.pointer('pointerup', 420, 400, 1, 2);
  p.frame(0);
  assert.equal(p.text('ball-count'), '6');
});

test('a ball moving into a pending launch position prevents overlap on release', () => {
  const p = page();
  p.change('scene', 'mass-mismatch', 'change');
  p.frame(0);
  p.pointer('pointerdown', 260, 240);
  for (let i = 1; i <= 3; i++) p.frame(i * 100);
  p.pointer('pointerup', 300, 240);
  p.frame(300);
  assert.equal(p.text('ball-count'), '2');
  assert.match(p.text('feedback'), /moved into that spot/);
});

test('overlay switches update rendered paths while the world is paused', () => {
  const p = page({ reducedMotion: true });
  p.frame(0);
  assert.ok(p.ops.some(op => op.name === 'stroke' && op.alpha < 1));
  p.get('trails').checked = false;
  p.get('trails').fire('change');
  p.frame(1);
  assert.ok(p.ops.every(op => op.name !== 'stroke' || op.alpha === 1));
  const base = p.ops.filter(op => op.name === 'lineTo').length;
  p.get('vectors').checked = true;
  p.get('vectors').fire('change');
  p.frame(2);
  assert.ok(p.ops.filter(op => op.name === 'lineTo').length > base);
  assert.equal(p.text('sim-time'), '0.000 s');
});

test('keyboard transport respects native controls, modified keys and repeat events', () => {
  const p = page({ reducedMotion: true });
  p.frame(0);
  for (const extra of [{ target: p.get('scene') }, { ctrlKey: true }, { repeat: true }, { altKey: true }]) {
    const event = p.document.fire('keydown', { key: ' ', ...extra });
    assert.ok(!event.defaultPrevented);
    assert.equal(p.frames.length, 0);
  }
  assert.ok(p.document.fire('keydown', { key: ' ' }).defaultPrevented);
  assert.equal(p.text('run-state'), 'Running');
  p.document.fire('keydown', { key: '.' });
  p.frame(8000);
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.text('sim-time'), '0.008 s');
});

test('resizing redraws at device resolution while preserving world coordinates', () => {
  const p = page({ reducedMotion: true });
  p.frame(0);
  assert.deepEqual([p.canvas.width, p.canvas.height], [840, 480]);
  const pos = p.label(1);
  p.rect.width = 630;
  p.rect.height = 360;
  p.window.fire('resize');
  p.frame(1);
  assert.deepEqual([p.canvas.width, p.canvas.height], [1260, 720]);
  assert.deepEqual(p.label(1), pos);
  assert.deepEqual(p.ops.find(op => op.name === 'setTransform').args, [1.5, 0, 0, 1.5, 0, 0]);
});

test('delayed frames cap catch-up and hidden time is excluded on resume', () => {
  const p = page();
  p.frame(0);
  p.frame(60000);
  assert.equal(p.text('sim-time'), '0.100 s');
  p.document.hidden = true;
  p.document.fire('visibilitychange');
  p.frame(65000);
  assert.equal(p.frames.length, 0);
  p.document.hidden = false;
  p.document.fire('visibilitychange');
  p.frame(120000);
  p.frame(120050);
  assert.equal(p.text('sim-time'), '0.150 s');
});

test('a missing canvas context points to the working terminal entry point', () => {
  const p = page({ canvasSupport: false });
  assert.match(p.text('feedback'), /node simulate\.js/);
  assert.equal(p.frames.length, 0);
});

test('slalom posts are drawn in place, block launches and have their own live counter', () => {
  const p = page({ reducedMotion: true });
  p.change('scene', 'turnstile-slalom', 'change');
  p.frame(0);
  const posts = p.ops.filter(op => op.name === 'fillText' && /^B\d+$/.test(op.args[0]));
  assert.deepEqual(posts.map(op => op.args), [['B1', 295, 175], ['B2', 430, 322], ['B3', 585, 204]]);
  assert.equal(p.get('bumper-reading').hidden, false);
  p.pointer('pointerdown', 430, 322);
  assert.match(p.text('feedback'), /clear spot/);
  assert.ok(!p.canvas.hasPointerCapture(1));
  p.click('next-impact');
  p.frame(1);
  assert.equal(p.text('bumper-hits'), '1');
  assert.equal(p.text('ball-hits'), '0');
  assert.equal(p.text('sim-time'), '0.284 s');
  assert.equal(p.text('ball-count'), '3');
  assert.equal(p.get('impact-log').children[0].children[1].textContent, 'Ball 3 hit bumper 2');
  p.change('scene', 'mass-mismatch', 'change');
  p.frame(2);
  assert.equal(p.get('bumper-reading').hidden, true);
  assert.equal(p.get('impact-log').children.length, 0);
  assert.ok(p.ops.every(op => op.name !== 'fillText' || !/^B/.test(op.args[0])));
});

test('next impact pauses a running pair exactly at contact and stepping continues from there', () => {
  const p = page();
  p.change('scene', 'mass-mismatch', 'change');
  p.frame(0);
  p.frame(100);
  p.pointer('pointerdown', 400, 400);
  p.click('next-impact');
  p.frame(5000);
  const time = 356 / 234;
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.frames.length, 0);
  assert.equal(p.get('impact-panel').open, true);
  assert.equal(p.text('sim-time'), time.toFixed(3) + ' s');
  assert.ok(Math.abs(p.label(1).x - (188 + 198 * time)) < 1e-9);
  assert.equal(p.text('ball-hits'), '1');
  assert.equal(p.get('impact-log').children[0].children[1].textContent, 'Ball 1 hit ball 2');
  assert.ok(!p.canvas.hasPointerCapture(1));
  p.click('single-step');
  p.frame(6000);
  assert.equal(p.text('sim-time'), (time + TICK).toFixed(3) + ' s');
  assert.equal(p.text('ball-hits'), '1');
});

test('the impact history retains the six latest contacts and a preset reset clears it', () => {
  const p = page();
  p.frame(0);
  for (let i = 1; i <= 100; i++) p.frame(i * 100);
  const log = p.get('impact-log').children;
  assert.equal(log.length, 6);
  const expected = createScene();
  const events = [];
  for (let i = 0; i < 1200; i++) expected.step(TICK, events);
  assert.ok(events.length > 6);
  assert.deepEqual(log.map(li => li.children[0].textContent),
    events.slice(-6).reverse().map(e => e.time.toFixed(3) + ' s'));
  assert.equal(p.get('impact-empty').hidden, true);
  p.click('reset');
  p.frame(10100);
  assert.equal(p.get('impact-log').children.length, 0);
  assert.equal(p.get('impact-empty').hidden, false);
});

test('a captured canvas checkpoint restores the scene, settings and counters and continues exactly', () => {
  const p = page({ reducedMotion: true });
  p.change('scene', 'turnstile-slalom', 'change');
  p.change('elasticity', '0.65');
  p.click('next-impact');
  p.click('capture-checkpoint');
  const saved = p.get('checkpoint-json').value;
  const { scene, world } = readCheckpoint(saved);
  assert.equal(scene, 'turnstile-slalom');
  assert.equal(world.bumperHits, 1);
  p.change('scene', 'mass-mismatch', 'change');
  p.change('elasticity', '1');
  p.click('toggle-play');
  p.pointer('pointerdown', 400, 400);
  p.click('restore-checkpoint');
  p.frame(5000);
  assert.ok(!p.canvas.hasPointerCapture(1));
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.get('scene').value, scene);
  assert.equal(p.text('elasticity-value'), '0.65');
  assert.equal(p.text('bumper-hits'), '1');
  assert.equal(p.get('impact-log').children.length, 0);
  assert.equal(p.text('sim-time'), world.time.toFixed(3) + ' s');
  p.click('single-step');
  p.click('capture-checkpoint');
  world.step();
  assert.deepEqual(JSON.parse(p.get('checkpoint-json').value), { scene, ...world.snapshot() });
});

test('imported custom courts preserve dimensions, tiny balls, simultaneous events and reset positions', () => {
  const p = page();
  const w = new World({ width: 200, height: 100, restitution: 0.735 });
  w.addBall({ x: 195, y: 5, radius: 2, vx: 30, vy: -30 });
  w.step(2);
  // Use nonzero saved counters and a corner hit at the very next instant.
  const state = w.snapshot();
  Object.assign(state.balls[0], { x: 198, y: 2, vx: 30, vy: -30 });
  p.get('checkpoint-json').value = JSON.stringify(state);
  p.click('restore-checkpoint');
  p.click('restore-checkpoint');
  p.frame(0);
  assert.equal(p.get('scene').children.filter(option => option.value === 'custom').length, 1);
  assert.equal(p.text('scene-name'), 'Imported court');
  assert.equal(p.text('dimensions'), '200 × 100 u');
  assert.equal(p.get('surface').style.aspectRatio, '200 / 100');
  assert.equal(p.get('elasticity').value, '0.735');
  assert.equal(p.get('elasticity').step, 'any');
  assert.equal(p.text('wall-hits'), String(state.wallHits));
  p.click('next-impact');
  p.frame(1);
  assert.deepEqual(p.get('impact-log').children.map(li => li.children[1].textContent),
    ['Ball 1 hit the right wall', 'Ball 1 hit the top wall']);
  assert.equal(p.text('sim-time'), '2.000 s');
  p.click('reset');
  p.frame(2);
  assert.equal(p.text('sim-time'), '0.000 s');
  assert.equal(p.text('wall-hits'), '0');
  assert.deepEqual(p.label(1), { x: 198, y: 2 });
  assert.equal(p.text('run-state'), 'Paused');
  p.pointer('pointerdown', 40, 50);
  p.pointer('pointerup', 40, 50);
  p.frame(3);
  assert.deepEqual(p.label(2), { x: 40, y: 50 });
});

test('a resting checkpoint has no next impact and a rejected restore leaves the live court intact', () => {
  const p = page();
  p.frame(0);
  p.frame(100);
  p.click('capture-checkpoint');
  const before = p.get('checkpoint-json').value;
  const damaged = JSON.parse(before);
  Object.assign(damaged.balls[0], { x: damaged.balls[1].x, y: damaged.balls[1].y });
  for (const bad of ['{broken', JSON.stringify(damaged)]) {
    p.get('checkpoint-json').value = bad;
    p.click('restore-checkpoint');
    assert.match(p.text('checkpoint-status'), /valid JSON|clear spot/);
    assert.equal(p.text('run-state'), 'Running');
    p.click('capture-checkpoint');
    assert.equal(p.get('checkpoint-json').value, before);
  }
  const still = new World();
  still.addBall({ x: 100, y: 100 });
  still.step(4);
  p.get('checkpoint-json').value = JSON.stringify(still.snapshot());
  p.click('restore-checkpoint');
  p.click('next-impact');
  p.frame(20000);
  assert.match(p.text('feedback'), /at rest/);
  assert.equal(p.text('sim-time'), '4.000 s');
  assert.equal(p.get('impact-log').children.length, 0);
  assert.equal(p.frames.length, 0);
});

test('a collapsed court safely cancels a captured launch on release', () => {
  const p = page({ reducedMotion: true });
  p.pointer('pointerdown', 420, 400);
  assert.ok(p.canvas.hasPointerCapture(1));
  p.rect.width = 0;
  p.pointer('pointerup', 450, 400);
  assert.ok(!p.canvas.hasPointerCapture(1));
  assert.match(p.text('feedback'), /cancelled/);
  p.frame(0);
  assert.equal(p.text('ball-count'), '6');
});

test('keyboard shortcuts leave checkpoint editing and disclosure controls to their native handlers', () => {
  const p = page({ reducedMotion: true });
  p.frame(0);
  for (const target of [p.get('checkpoint-json'), new Element('summary')]) {
    for (const key of [' ', '.']) {
      assert.ok(!p.document.fire('keydown', { target, key }).defaultPrevented);
      assert.equal(p.frames.length, 0);
    }
  }
});

function capture(p) {
  p.click('capture-checkpoint');
  return JSON.parse(p.get('checkpoint-json').value);
}

function restore(p, state) {
  p.get('checkpoint-json').value = JSON.stringify(state);
  p.click('restore-checkpoint');
}

test('the rail tool previews, places and saves a bank, and the same rail blocks a ball launch', () => {
  const p = page({ reducedMotion: true });
  const w = new World({ width: 200, height: 120 });
  w.addBall({ x: 25, y: 60, vx: 120, radius: 5 });
  restore(p, w.snapshot());
  p.change('draw-tool', 'rail', 'change');
  assert.match(p.text('tool-hint'), /rail/);
  p.pointer('pointerdown', 100, 20);
  p.pointer('pointermove', 100, 100);
  p.frame(0);
  assert.ok(p.canvas.hasPointerCapture(1));
  assert.ok(p.ops.some(op => op.name === 'lineTo' && op.args[0] === 100 && op.args[1] === 100));
  assert.equal(capture(p).rails, undefined);
  p.pointer('pointerup', 100, 100);
  p.frame(1);
  assert.equal(p.canvas.hasPointerCapture(1), false);
  assert.equal(p.text('feedback'), 'Rail R1 placed.');
  assert.ok(p.ops.some(op => op.name === 'fillText' && op.args[0] === 'R1'));
  assert.equal(p.get('rail-reading').hidden, false);
  assert.ok(p.get('pause-on').children.some(option => option.value === 'rail:1'));
  const saved = capture(p);
  assert.deepEqual(saved.rails, [{ id: 1, x1: 100, y1: 20, x2: 100, y2: 100, radius: 8 }]);
  p.change('draw-tool', 'ball', 'change');
  p.pointer('pointerdown', 100, 60);
  assert.match(p.text('feedback'), /clear spot/);
  assert.equal(p.canvas.hasPointerCapture(1), false);
  p.click('next-impact');
  p.frame(2);
  assert.equal(p.text('rail-hits'), '1');
  assert.deepEqual(p.label(1), { x: 87, y: 60 });
  assert.match(p.text('feedback'), /Ball 1 hit rail 1/);
  const hitState = capture(p);
  p.click('reset');
  assert.equal(capture(p).rails, undefined);
  restore(p, hitState);
  p.click('reset');
  assert.equal(capture(p).railHits, 0);
  assert.deepEqual(capture(p).rails, saved.rails);
});

test('a rail draft can be cancelled and checks its whole path and moving balls on release', () => {
  const p = page();
  const w = new World({ width: 200, height: 120 });
  w.addBall({ x: 25, y: 60, vx: 100, radius: 8 });
  restore(p, w.snapshot());
  p.change('draw-tool', 'rail', 'change');
  for (const [x2, y2] of [[25, 20], [25, 100], [25, 119]]) {
    p.pointer('pointerdown', 25, 20);
    p.pointer('pointerup', x2, y2);
    assert.match(p.text('feedback'), /distinct points/);
    assert.equal(capture(p).rails, undefined);
  }
  p.pointer('pointerdown', 80, 20);
  p.change('draw-tool', 'ball', 'change');
  assert.equal(p.canvas.hasPointerCapture(1), false);
  p.pointer('pointerup', 80, 100);
  assert.equal(capture(p).balls.length, 1);
  p.change('draw-tool', 'rail', 'change');
  p.pointer('pointerdown', 80, 20);
  p.pointer('pointermove', 80, 100);
  p.click('toggle-play');
  p.frame(0);
  for (let i = 1; i <= 5; i++) p.frame(i * 100);
  p.pointer('pointerup', 80, 100);
  assert.match(p.text('feedback'), /clear path/);
  assert.equal(capture(p).rails, undefined);
});

test('a watched corner face pauses before the next tick and playback resumes without leftover frame time', () => {
  const p = page();
  const w = new World({ width: 120, height: 120 });
  w.addBall({ x: 109.5, y: 10.5, radius: 10, vx: 120, vy: -120 });
  restore(p, w.snapshot());
  p.change('pause-on', 'wall:top', 'change');
  p.click('toggle-play');
  p.frame(0);
  p.frame(100);
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.frames.length, 0);
  assert.equal(p.get('impact-panel').open, true);
  assert.equal(p.text('wall-hits'), '2');
  assert.match(p.text('feedback'), /hit the top wall/);
  assert.deepEqual(p.label(1), { x: 110, y: 10 });
  assert.equal(capture(p).time, 1 / 240);
  p.click('toggle-play');
  p.frame(9000);
  p.frame(9050);
  assert.equal(p.text('sim-time'), '0.054 s');
  p.click('reset');
  assert.equal(p.get('pause-on').value, 'wall:top');
  p.click('single-step');
  p.frame(9100);
  assert.equal(capture(p).time, TICK);
  p.change('scene', 'bank-shot', 'change');
  assert.equal(p.get('pause-on').value, '');
  assert.deepEqual(p.get('pause-on').children.filter(o => o.value.startsWith('rail:')).map(o => o.value),
    ['rail:1', 'rail:2']);
});

test('practice deals, drag edits and checkpoint restoration keep the same seed and reset positions', () => {
  const p = page({ reducedMotion: true });
  p.change('scene', 'practice-draw', 'change');
  assert.equal(p.get('seed-controls').hidden, false);
  p.change('draw-seed', '0');
  p.click('deal-court');
  p.change('drag', '0.35');
  const w = createScene('practice-draw', 1, { seed: 0, drag: 0.35 });
  const initial = capture(p);
  assert.deepEqual(initial, { scene: 'practice-draw', seed: 0, ...w.snapshot() });
  p.change('draw-seed', '-1');
  p.click('deal-court');
  assert.match(p.text('feedback'), /Seed/);
  assert.deepEqual(capture(p), initial);
  p.click('single-step');
  w.step();
  const saved = capture(p);
  assert.deepEqual(saved.balls, w.snapshot().balls);
  p.change('scene', 'bank-shot', 'change');
  assert.equal(p.get('seed-controls').hidden, true);
  restore(p, saved);
  assert.equal(p.get('draw-seed').value, '0');
  assert.equal(p.text('drag-value'), '0.35 /s');
  p.click('reset');
  assert.deepEqual(capture(p), initial);
});

test('a forecast draws the predicted rail path while paused, clears after edits and handles an empty court', () => {
  const p = page();
  p.change('scene', 'bank-shot', 'change');
  p.change('forecast-ball', '2', 'change');
  const before = capture(p);
  const path = World.fromSnapshot(before).forecast(2);
  p.click('predict-path');
  p.frame(0);
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.get('clear-forecast').disabled, false);
  assert.match(p.text('forecast-status'), /Ball 2 reaches/);
  assert.deepEqual(capture(p), before);
  for (const point of path.points.slice(1)) {
    assert.ok(p.ops.some(op => op.name === 'lineTo' && op.args[0] === point.x && op.args[1] === point.y));
  }
  p.change('drag', '0.5');
  assert.equal(p.text('forecast-status'), '');
  assert.equal(p.get('clear-forecast').disabled, true);
  p.click('predict-path');
  p.click('clear-forecast');
  assert.equal(p.get('clear-forecast').disabled, true);
  restore(p, new World().snapshot());
  p.frame(1);
  assert.equal(p.get('predict-path').disabled, true);
  assert.match(p.text('forecast-status'), /Add a ball/);
});

test('a timing gate can be drawn across an occupied lane and reports speed, direction and checkpoint totals', () => {
  const p = page({ reducedMotion: true });
  const w = new World({ width: 200, height: 100 });
  w.addBall({ x: 50, y: 50, radius: 10, vx: 120 });
  restore(p, w.snapshot());
  p.change('draw-tool', 'gate', 'change');
  assert.match(p.text('tool-hint'), /forward/);
  for (const [x, y] of [[50, 50], [201, 80]]) {
    p.pointer('pointerdown', 50, 50);
    assert.ok(p.canvas.hasPointerCapture(1));
    p.pointer('pointerup', x, y);
    assert.match(p.text('feedback'), /distinct points/);
    assert.equal(capture(p).gates, undefined);
  }
  p.pointer('pointerdown', 90, 0);
  p.pointer('pointermove', 90, 100);
  p.frame(0);
  assert.ok(p.ops.some(op => op.name === 'lineTo' && op.args[0] === 90 && op.args[1] === 100));
  assert.equal(capture(p).gates, undefined);
  p.pointer('pointerup', 90, 100);
  p.frame(1);
  assert.equal(p.get('gate-panel').open, true);
  assert.equal(p.get('gate-panel').hidden, false);
  assert.ok(p.ops.some(op => op.name === 'fillText' && op.args[0] === 'G1'));
  p.click('next-impact');
  p.frame(2);
  const row = p.get('gate-log').children[0];
  assert.deepEqual(row.children.map(c => c.textContent), ['0.333 s', 'Ball 1 crossed G1 forward at 120.00 u/s']);
  assert.equal(p.get('impact-log').children.length, 1);
  const saved = capture(p);
  assert.deepEqual(saved.gates[0].counts, { forward: 1, reverse: 0 });
  restore(p, saved);
  p.frame(3);
  assert.equal(p.get('gate-totals').children[0].textContent, 'G1 · 1 forward / 0 reverse');
  assert.equal(p.get('gate-log').children.length, 0);
  p.click('next-impact');
  p.frame(4);
  assert.match(p.get('gate-log').children[0].children[1].textContent, /reverse/);
  p.click('reset');
  p.frame(5);
  assert.deepEqual(capture(p).gates[0].counts, { forward: 0, reverse: 0 });
  assert.equal(p.get('gate-log').children.length, 0);
  p.change('scene', 'mass-mismatch', 'change');
  assert.equal(p.get('gate-panel').hidden, true);
});

test('gate placement on a ball preserves its forecast and starting on the new gate produces no reading', () => {
  const p = page({ reducedMotion: true });
  p.change('scene', 'return-lanes', 'change');
  p.click('predict-path');
  const forecast = p.text('forecast-status');
  p.change('draw-tool', 'gate', 'change');
  p.pointer('pointerdown', 180, 150);
  p.pointer('pointerup', 180, 300);
  assert.equal(capture(p).gates.length, 2);
  assert.equal(p.text('forecast-status'), forecast);
  p.click('toggle-play');
  p.frame(0);
  for (let i = 1; i <= 40; i++) p.frame(i * 100);
  assert.deepEqual(capture(p).gates.map(g => g.counts), [{ forward: 2, reverse: 2 }, { forward: 0, reverse: 1 }]);
  assert.equal(p.get('gate-log').children.length, 5);
  assert.match(p.get('gate-totals').children[1].textContent, /0 forward \/ 1 reverse/);
});

test('surface selection, validation and inheritance change the rebound used by the forecast and solver', () => {
  const p = page({ reducedMotion: true });
  p.change('scene', 'return-lanes', 'change');
  assert.deepEqual(p.get('material-surface').children.map(c => c.value),
    ['wall:left', 'wall:right', 'wall:top', 'wall:bottom', 'rail:1', 'rail:2']);
  p.change('material-surface', 'rail:2', 'change');
  assert.equal(p.get('surface-value').value, '0.5');
  p.change('forecast-ball', '2', 'change');
  p.click('predict-path');
  const before = capture(p);
  p.change('surface-value', '1.1');
  p.click('apply-surface');
  assert.match(p.text('surface-status'), /between 0 and 1/);
  assert.deepEqual(capture(p), before);
  assert.ok(p.text('forecast-status'));
  p.change('surface-value', '0.25');
  p.click('apply-surface');
  assert.equal(p.text('forecast-status'), '');
  p.click('next-impact');
  assert.equal(capture(p).balls[1].vx, -60);
  p.change('elasticity', '0.8');
  p.change('surface-value', '');
  p.click('apply-surface');
  assert.equal(capture(p).surfaceRestitution, undefined);
  assert.match(p.get('surface-value').placeholder, /0\.8/);
  p.click('reset');
  assert.deepEqual(capture(p).surfaceRestitution, { 'rail:2': 0.5 });
  assert.equal(capture(p).restitution, 0.8);
});

test('the impulse editor pauses at the current instant, clears stale predictions and rejects incomplete edits', () => {
  const p = page();
  p.change('scene', 'mass-mismatch', 'change');
  p.frame(0);
  p.frame(50);
  p.change('impulse-ball', '2', 'change');
  p.change('impulse-x', '80');
  p.change('impulse-y', '');
  const initial = capture(p);
  p.click('apply-impulse');
  assert.match(p.text('impulse-status'), /finite numbers/);
  assert.deepEqual(capture(p), initial);
  assert.equal(p.text('run-state'), 'Running');
  p.change('impulse-y', '-20');
  p.click('apply-impulse');
  p.frame(250);
  assert.equal(p.text('run-state'), 'Paused');
  assert.equal(p.frames.length, 0);
  const edited = capture(p);
  assert.deepEqual([edited.time, edited.balls[1].x, edited.balls[1].vx, edited.balls[1].vy],
    [initial.time, initial.balls[1].x, -16, -5]);
  assert.match(p.text('impulse-status'), /Ball 2 velocity \(-16.00, -5.00\)/);
  p.click('predict-path');
  p.click('apply-impulse');
  assert.equal(p.text('forecast-status'), '');
  p.click('single-step');
  const moved = capture(p).balls[1];
  near(moved.x, edited.balls[1].x + 4 * TICK);
  near(moved.y, edited.balls[1].y - 10 * TICK);
  restore(p, new World().snapshot());
  assert.equal(p.get('apply-impulse').disabled, true);
  p.click('add-ball');
  assert.equal(p.get('apply-impulse').disabled, false);
  assert.equal(p.get('impulse-ball').value, '1');
});
