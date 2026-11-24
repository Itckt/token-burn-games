'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');
const {Graphics} = require('./support/graphics.cjs');
const P = require('../js/packing.js');
const G = require('../js/meshes.js');
const L = require('../js/lesson.js');

const click = (p,id) => p.byId(id).emit('click');
const text = (p,id) => p.byId(id).textContent;
const pressed = (p,id) => p.byId(id).getAttribute('aria-pressed')==='true';
function input(p,id,value) {
  const control=p.byId(id);
  control.value=String(value); control.emit('input');
}
function choose(p,id,index) { p.byId(id).children[index].emit('click'); }
function visibleLabels(p) {
  return p.byId('callouts').children.filter(el=>el.tagName==='G' && el.style.display!=='none')
    .map(g=>g.children.at(-1).textContent);
}

test('the bench isolates a dry specimen and restores the running lesson, framing, trace and exterior', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads;
  input(p,'scrubber',30);
  p.key('t'); click(p,'exterior'); p.key('d'); click(p,'play');
  p.frame(0); p.frame(750);
  const eye=p.gl.uniforms.uEye, time=p.gl.uniforms.uTime;
  assert.ok(time===30.75 && pressed(p,'trace'));
  click(p,'mode-packing'); p.frame(10750);
  assert.ok(pressed(p,'mode-packing') && p.byId('lesson-panel').hidden && !p.byId('packing-panel').hidden);
  assert.ok(pressed(p,'cutaway') && !pressed(p,'exterior'));
  assert.equal(p.gl.uniforms.uTime,0); assert.equal(p.gl.uniforms.uWater,0);
  assert.equal(text(p,'bench-gap'),'34.0 mm');
  assert.deepEqual(visibleLabels(p),['Wall contact','34.0 mm gap']);
  input(p,'diameter',72); p.frame(11000);
  assert.equal(text(p,'bench-support'),'Cup floor');
  assert.equal(text(p,'bench-gap'),'0.0 mm');
  assert.ok(visibleLabels(p).includes('Cup floor'));
  assert.match(p.byId('bench-diagram').getAttribute('aria-label'),/floor support/);
  input(p,'diameter',94); p.key('a'); p.frame(12000);
  assert.equal(p.byId('diameter').getAttribute('aria-valuetext'),'94 mm, 51.5 mm clearance');
  assert.equal(p.frames.size,0);
  assert.equal(p.gl.uploads,uploads);
  p.key('b'); p.frame(60000);
  assert.ok(pressed(p,'mode-lesson') && pressed(p,'exterior') && pressed(p,'trace'));
  assert.deepEqual(p.gl.uniforms.uEye,eye);
  assert.equal(p.gl.uniforms.uTime,time);
  p.frame(61000); assert.equal(p.gl.uniforms.uTime,time+1);
  p.key('b'); p.frame(62000); assert.equal(text(p,'diameter-value'),'94 mm');
});

test('the bench and help can hold the clock across a hidden tab; native slider keys keep their meaning', () => {
  const p=createPage({noGL:true});
  click(p,'play'); p.frame(0); p.frame(2300);
  p.key('b');
  const before=text(p,'step-title');
  for (const k of ['ArrowRight','4','t','b']) assert.ok(!p.key(k,{target:p.byId('diameter')}).defaultPrevented);
  assert.ok(!p.key(' ').defaultPrevented);
  p.key('?'); p.frame(5400);
  p.document.hidden=true; p.document.emit('visibilitychange');
  p.document.hidden=false; p.document.emit('visibilitychange');
  click(p,'help-close'); p.frame(60000);
  assert.equal(text(p,'step-title'),before);
  assert.equal(text(p,'elapsed'),'0:02');
  assert.equal(p.frames.size,0);
  p.key('b'); p.frame(70000); p.frame(71000);
  assert.equal(text(p,'elapsed'),'0:03');
  p.key(' '); p.key('b'); p.key('4'); p.frame(72000);
  assert.ok(pressed(p,'mode-lesson') && !p.byId('water-tools').hidden);
  assert.equal(text(p,'play-text'),'Play lesson');
  assert.equal(Number(p.byId('scrubber').value),25);
});

test('a context interruption cancels an active drag and enlarges the right live diagram until restoration', () => {
  const p=createPage({reduced:true}), c=p.byId('scene'), slot=p.byId('fallback-section');
  p.frame(0); p.key('b'); input(p,'diameter',72); p.frame(16);
  c.emit('pointerdown',{button:0,pointerId:8,clientX:20,clientY:10});
  c.emit('webglcontextlost');
  assert.ok(!c.classes.has('dragging') && c.tabIndex===-1);
  assert.ok(!p.byId('model-error').hidden && p.byId('bench-inset').hidden);
  assert.deepEqual(slot.children,[p.byId('fallback-reading'),p.byId('bench-diagram')]);
  input(p,'diameter',94); p.frame(32);
  assert.ok(p.byId('bench-diagram').ink.text.includes('51.5 mm gap'));
  click(p,'mode-lesson'); p.frame(48);
  assert.deepEqual(slot.children,[p.byId('fallback-reading'),p.byId('diagram')]);
  assert.equal(p.byId('bench-diagram').parentNode,p.byId('bench-inset'));
  click(p,'mode-packing'); p.frame(64);
  c.getContext=()=>null; c.emit('webglcontextrestored'); p.frame(80);
  assert.equal(p.byId('bench-diagram').parentNode,slot);
  const restored=new Graphics(); c.getContext=()=>restored;
  c.emit('webglcontextrestored'); p.frame(96);
  assert.ok(p.byId('model-error').hidden && !p.byId('bench-inset').hidden);
  assert.equal(p.byId('bench-diagram').parentNode,p.byId('bench-inset'));
  assert.deepEqual(slot.children,[p.byId('fallback-reading')]);
  assert.deepEqual(visibleLabels(p),['Wall contact','51.5 mm gap']);
  c.emit('pointermove',{pointerId:8,clientX:-99,clientY:250});
  assert.equal(p.frames.size,0);
});

test('waterline buttons pause on actual strand heights and tracing survives scrubbing and toggles', () => {
  const p=createPage({reduced:true}), profile=P.measure(G.noodles());
  p.frame(0);
  assert.ok(p.byId('water-tools').hidden && !p.key('t').defaultPrevented);
  p.key('5'); click(p,'exterior'); click(p,'play');
  for (const [id,y,label] of [['water-top',profile.top,'Block covered'],['water-bottom',profile.bottom,'At lower curls']]) {
    click(p,id); p.frame(1000);
    assert.ok(pressed(p,'trace') && pressed(p,'cutaway') && !p.byId('trace-legend').hidden);
    assert.equal(text(p,'play-text'),'Play lesson');
    assert.equal(text(p,'step-title'),L.steps[3].title);
    assert.ok(Math.abs(p.gl.uniforms.uTime-L.timeAtWaterline(y))<1e-10);
    assert.ok(Math.abs(p.gl.uniforms.uWater+G.FLOOR+0.01-y)<1e-10);
    assert.ok(p.byId('diagram').ink.text.includes(label));
  }
  assert.ok(p.key('t',{repeat:true}).defaultPrevented && pressed(p,'trace'));
  p.key('t'); p.frame(1100); assert.equal(p.gl.uniforms.uTrace,0);
  assert.ok(p.byId('trace-legend').hidden);
  click(p,'trace'); input(p,'scrubber',25); p.frame(1200);
  assert.ok(p.byId('diagram').ink.text.includes('Dry pocket'));
  input(p,'scrubber',19); p.frame(1300);
  assert.ok(p.byId('water-tools').hidden);
  assert.equal(p.gl.uniforms.uTrace,0);
  input(p,'scrubber',42); p.frame(1400);
  assert.equal(p.gl.uniforms.uTrace,1);
  assert.ok(!p.byId('trace-legend').hidden && p.frames.size===0);
});

test('field answers give specific feedback, retain attempts by topic, score once and reset', () => {
  const p=createPage({noGL:true}), topics=p.byId('check-topics'), options=p.byId('check-options');
  p.frame(0);
  assert.equal(options.children.length,3); assert.equal(topics.children.length,3);
  assert.ok(p.byId('check-evidence').hidden);
  choose(p,'check-options',1);
  const hint=text(p,'check-feedback'); assert.match(hint,/Try again.*seating line/);
  choose(p,'check-topics',1); assert.equal(text(p,'check-feedback'),'');
  choose(p,'check-topics',0); assert.equal(text(p,'check-feedback'),hint);
  choose(p,'check-options',2); assert.notEqual(text(p,'check-feedback'),hint);
  choose(p,'check-options',0);
  assert.match(text(p,'check-feedback'),/^Correct/); assert.equal(text(p,'check-count'),'1 of 3 correct');
  choose(p,'check-options',1);
  assert.equal(options.children[0].getAttribute('aria-pressed'),'true');
  assert.equal(options.children[1].getAttribute('aria-disabled'),'true');
  click(p,'check-next');
  assert.ok(topics.children[1].focused && /Kowloon Tong/.test(text(p,'check-question')));
  choose(p,'check-options',1); click(p,'check-next'); choose(p,'check-options',2);
  assert.equal(text(p,'check-count'),'3 of 3 correct');
  assert.ok(!p.byId('check-restart').hidden && p.byId('check-next').hidden);
  click(p,'check-restart');
  assert.equal(text(p,'check-count'),'0 of 3 correct');
  assert.equal(text(p,'check-feedback'),''); assert.ok(p.byId('check-evidence').hidden);
  assert.ok(options.children.every(b=>b.getAttribute('aria-disabled')==='false'));
  assert.ok(topics.children.every(b=>b.dataset.solved==='false'));
});

test('all three evidence buttons open the stated experiment or frozen observation without graphics', () => {
  const p=createPage({noGL:true}), fallback=p.byId('fallback-section');
  for (const i of [0,2,1]) {
    choose(p,'check-topics',i); choose(p,'check-options',i); click(p,'check-evidence'); p.frame(1000);
    if (i===0) {
      assert.ok(pressed(p,'mode-packing') && p.byId('diameter').focused);
      assert.equal(Number(p.byId('diameter').value),P.minDiameter);
      assert.equal(p.byId('bench-diagram').parentNode,fallback);
      assert.ok(p.byId('bench-diagram').ink.text.includes('Floor support'));
    } else {
      assert.ok(pressed(p,'mode-lesson') && p.byId('scrubber').focused);
      assert.equal(text(p,'play-text'),'Play lesson');
      if (i===2) {
        assert.equal(p.byId('diagram').parentNode,fallback);
        assert.ok(pressed(p,'trace') && p.byId('diagram').ink.text.includes('At lower curls'));
      } else {
        const time=Number(p.byId('scrubber').value);
        assert.ok(L.scene(time).baseFlex>0.11);
        assert.equal(text(p,'step-title'),L.steps[2].title);
      }
    }
    assert.equal(p.frames.size,0);
  }
  assert.equal(text(p,'check-count'),'3 of 3 correct');
});

test('when both graphics APIs are unavailable, the stage gives live text readings in both modes', () => {
  const p=createPage({noGL:true,no2D:true});
  p.frame(0);
  assert.ok(!p.byId('model-error').hidden && !p.byId('fallback-reading').hidden);
  assert.match(text(p,'error-detail'),/WebGL/);
  assert.match(text(p,'fallback-reading'),/air gap/);
  p.key('b'); input(p,'diameter',72);
  assert.match(text(p,'fallback-reading'),/floor support and 0.0 mm gap/);
  p.key('4'); click(p,'water-top'); p.frame(16);
  assert.match(text(p,'fallback-reading'),/block covered/);
  assert.equal(text(p,'step-title'),L.steps[3].title);
  assert.equal(p.frames.size,0);
});
