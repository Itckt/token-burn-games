'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {html, loadPage} = require('./support/page.js');
const F = require('../js/flight.js');
const H = require('../js/timehouse.js');
const W = require('../js/cableway.js');
const M = require('../js/math.js');

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, a + ' vs ' + b);
const views = p => p.gl.draws.filter(d => d.uniforms.uTime);
const live = p => views(p).findLast(d => d.uniforms.uMirror[0] === 1).uniforms;
const uploads = p => [...p.gl.buffers, ...p.gl.textures].map(handle => handle.uploads);
function choose(p, id) {
  const menu = p.id('lookout');
  menu.value = id; menu.emit('change'); p.tick(0);
}

test('the optical stops magnify both axes, ease an interrupted change and scale the look controls', () => {
  for (const aspect of [0.48, 1, 21/9]) {
    const base = F.lensFor(51, aspect);
    near(base[0]/base[1], aspect);
    for (const power of [1, 2, 4])
      F.lensFor(51, aspect, power).forEach((n,i) => near(n * power, base[i]));
  }
  const a = F.createFlight(), b = F.createFlight();
  F.cycleGlass(a); F.cycleGlass(b);
  F.advance(a, 0.1);
  for (let i = 0; i < 6; i++) F.advance(b, 1/60);
  const mid = a.magnification;
  assert.ok(mid > 1 && mid < 2);
  near(mid, b.magnification);
  F.cycleGlass(a);
  assert.equal(a.magnification, mid);
  F.advance(a, 0.1);
  assert.ok(a.magnification > mid && a.magnification < 4);
  for (let i = 0; i < 80; i++) F.advance(a, 1/60);
  assert.equal(a.magnification, 4);
  F.look(a, 0.24, -0.12);
  near(a.targetYaw, 0.06); near(a.targetPitch, -0.03);
  a.playing = false; F.cycleGlass(a);
  assert.equal(a.magnification, 1);
  const reduced = F.createFlight(true);
  reduced.playing = true; F.cycleGlass(reduced);
  assert.equal(reduced.magnification, 2);
});

test('chart taps hit the nearest painted marker in CSS pixels on small and wide charts', () => {
  const p = loadPage({reduced:true, dpr:2}); p.ready(); p.tick();
  const chart = p.id('chart'), menu = p.id('lookout');
  for (const [width,height] of [[145,49], [268,72]]) {
    const left = 83.5, top = 121.75;
    chart.getBoundingClientRect = () => ({left,top,width,height});
    for (const id of F.lookouts.filter(id => id !== 'route')) {
      const [x,,z] = F.lookoutPoint(id, 0);
      const point = {clientX:left+(84+x*0.8)*width/168, clientY:top+(24+z*0.4)*height/68};
      chart.emit('pointermove', {...point, pointerType:'mouse'});
      assert.equal(p.id('chart-caption').textContent, menu.options.find(o => o.value === id).label);
      chart.emit('click', point);
      p.tick(0);
      assert.equal(menu.value, id);
      assert.equal(p.frames.size, 0);
      const u = live(p), direction = M.normalize(M.subtract(F.lookoutPoint(id,0), u.uEye));
      u.uForward.forEach((n,i) => near(n,direction[i]));
    }
    for (const [x,y] of [[width-1,height-1], [width+1,0], [-1,height/2], [NaN,0]]) {
      chart.emit('click', {clientX:left+x, clientY:top+y});
      assert.equal(p.frames.size, 0);
      assert.equal(menu.value, 'timehouse');
    }
  }
  chart.emit('pointerleave');
  assert.equal(p.id('chart-caption').textContent, 'Harbour chart');
  chart.getBoundingClientRect = () => ({left:0,top:0,width:0,height:0});
  chart.emit('click', {clientX:0, clientY:0});
  assert.equal(p.frames.size, 0);
  assert.ok(html.includes('<kbd>B</kbd>') && html.includes('Tap chart to track'));
});

test('the chart picks the last painted cable car, including just before the next chart refresh', () => {
  const p = loadPage({width:600, height:360}); p.ready(); p.tick();
  const chart = p.id('chart'), ink = chart.ink;
  // Spread the chart over a large CSS rectangle so a short movement exceeds the hit radius.
  const width = 16800, height = 6800;
  chart.getBoundingClientRect = () => ({left:0, top:0, width,height});
  const painted = ink.arcs.find(([x,y,r]) => r === 2 && x > 80);
  assert.ok(painted);
  p.tick(80);
  const car = W.car(live(p).uTime[0]);
  assert.ok(Math.hypot(84+car.x*0.8-painted[0], 24+car.z*0.4-painted[1])*100 > 9);
  chart.emit('click', {clientX:painted[0]*100, clientY:painted[1]*100});
  assert.equal(p.id('lookout').value, 'cableway');
});

test('magnification changes the reflected and direct camera together and survives a paused postcard and restoration', () => {
  const p = loadPage({reduced:true, width:420, height:700, address:'#seed=852'});
  p.ready(); p.tick(); choose(p, 'timehouse');
  const original = live(p), assets = uploads(p), button = p.id('glass');
  for (const [key,power] of [['B',2], [null,4]]) {
    if (key) p.key(key); else button.emit('click');
    p.tick(); p.ready();
    assert.equal(p.id('glass-power').textContent, power+'×');
    assert.match(button.getAttribute('aria-label'), new RegExp(power+'×'));
    assert.ok(p.document.body.classList.contains('magnified'));
    const passes = views(p);
    assert.equal(passes.length, 2);
    for (const pass of passes) {
      const u = pass.uniforms;
      assert.equal(u.uTime[0], 0);
      assert.deepEqual(u.uForward, original.uForward);
      u.uLens.forEach((v,i) => near(v*power, original.uLens[i]));
      const solids = p.gl.draws.filter(d => d.target === pass.target && d.uniforms.uModel);
      const aim = F.lookoutPoint('timehouse', 0), basis = M.cameraBasis(u.uEye, aim);
      // Rays through both right frustum edges must agree with the mesh projection.
      const point = M.add(u.uEye, M.scale(M.add(basis.forward, M.scale(basis.right,u.uLens[0])), 77));
      const clip = M.transform(solids[0].uniforms.uProjection, [...point,1]);
      near(clip[0]/clip[3], 1, 1e-5);
      near(u.uPixel[0], 2*u.uLens[1]/pass.viewport[3]);
    }
    assert.equal(p.frames.size, 0);
    assert.deepEqual(uploads(p), assets);
  }
  const shot = live(p);
  p.key('p'); assert.ok(p.id('postcard-dialog').open && !p.id('save-postcard').hidden);
  assert.deepEqual(live(p), shot);
  p.key('b'); p.id('postcard-dialog').close(); p.tick();
  assert.deepEqual(live(p), shot);
  p.key('g'); p.win.emit('hashchange'); p.tick();
  p.canvas.emit('webglcontextlost'); p.key('b');
  assert.ok(button.disabled);
  p.canvas.emit('webglcontextrestored'); p.tick(); p.ready();
  assert.deepEqual(live(p), shot);
  assert.equal(button.disabled, false);
  p.key('b', {target:p.id('lookout')}); p.key('b', {altKey:true}); p.key('b', {repeat:true});
  assert.equal(p.frames.size, 0);
  p.key('b'); p.tick();
  assert.deepEqual(live(p).uLens, original.uLens);
  assert.equal(p.document.body.classList.contains('magnified'), false);
});

test('event jumps, deck scrubs and both render passes share the dial hands, signal ball and moving doors', () => {
  const p = loadPage({reduced:true, address:'#seed=852'}); p.ready(); p.tick();
  const initial = uploads(p);
  function check(time) {
    const expected = H.reading(time);
    for (const pass of views(p)) {
      assert.equal(pass.uniforms.uTime[0], time);
      const solids = p.gl.draws.filter(d => d.target === pass.target && d.uniforms.uModel);
      const turn = W.sheaveAngle(W.car(time).fraction);
      const world = solids.filter(d => d.uniforms.uModel.every(n => n === 0));
      assert.ok(world.length > 0);
      for (const d of world) assert.deepEqual(d.uniforms.uWheel, [Math.cos(turn), Math.sin(turn), 0]);
      for (const {uniforms:u} of solids) {
        assert.deepEqual(u.uHands, expected.hands);
        assert.deepEqual(u.uBallLift, [expected.lift]);
        near(u.uDialPixel, pass.uniforms.uPixel[0] / H.dialRadius);
      }
      const cars = [false,true].map((returning, i) => {
        const car = W.car(time, returning), model = [car.x,car.y,car.z,car.angle];
        const draw = solids.find(d => d.uniforms.uModel.every((v,k) => v === model[k]));
        assert.ok(draw);
        assert.deepEqual(draw.uniforms.uCabin, [car.doors*0.71,i]);
        return draw;
      });
      assert.equal(cars[0].indexBuffer, cars[1].indexBuffer);
      assert.ok(solids.filter(d => !cars.includes(d)).every(d => d.uniforms.uCabin.every(v => v === 0)));
    }
    assert.deepEqual(uploads(p), initial);
  }
  choose(p, 'timehouse');
  assert.equal(p.id('lookout-call').textContent, '23:58 · Raising');
  p.key('n'); p.tick(0); check(8);
  assert.equal(p.id('lookout-call').textContent, '00:00 · Dropping');
  choose(p, 'cableway');
  assert.equal(p.id('event-label').textContent, 'Next platform');
  p.id('next-event').emit('click'); p.tick(0); check(28);
  assert.equal(p.id('lookout-call').textContent, 'At Porcelain Rise');
  p.key('4');
  const timeline = p.id('timeline');
  timeline.value = 125; timeline.emit('input'); p.tick(0); check(30);
  p.key('n'); p.tick(0); check(72);
  assert.equal(p.id('lookout-call').textContent, 'At Eave Street');
  assert.equal(p.id('elapsed').textContent, '01:12');
  p.key(' '); p.tick(0); p.tick(100); check(72.1);
  p.key(' '); p.tick(0); check(72.1);
  assert.equal(p.frames.size, 0);
});
