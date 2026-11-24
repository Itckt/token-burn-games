'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');
const {Graphics} = require('./support/graphics.cjs');
const L = require('../js/lesson.js');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');

const click = (p,id) => p.byId(id).emit('click');
const text = (p,id) => p.byId(id).textContent;
const pressed = (p,id) => p.byId(id).getAttribute('aria-pressed')==='true';
const value = (p,id) => Number(p.byId(id).value);
function input(p,id,next,event='input') {
  p.byId(id).value=String(next);
  p.byId(id).emit(event);
}

test('the opening chapter leads from an empty slice to real contours without losing the running lesson', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads, diagram=p.byId('bench-diagram');
  input(p,'scrubber',2); click(p,'exterior'); p.key('d'); click(p,'play');
  p.frame(0); p.frame(1000);
  const eye=p.gl.uniforms.uEye;
  click(p,'step-investigate'); p.frame(2000);
  assert.ok(pressed(p,'mode-packing') && pressed(p,'tool-scan') && pressed(p,'cutaway'));
  assert.ok(p.byId('scan-height').focused && !p.byId('scan-controls').hidden && p.byId('pour-controls').hidden);
  assert.equal(text(p,'scan-value'),'17 mm');
  assert.equal(text(p,'bench-support'),'Air pocket');
  const gold=()=>diagram.ink.strokes.find(s=>s.color==='#ffcb7b').points;
  assert.equal(gold().length,0);
  click(p,'scan-block'); p.frame(2100);
  assert.equal(value(p,'scan-height'),51);
  assert.equal(text(p,'bench-support'),'Noodle contours');
  assert.ok(gold().length>100 && diagram.ink.text.includes('20 mm'));
  const original=JSON.stringify(gold()), clears=diagram.ink.clears;
  p.key('d'); p.frame(2200);
  assert.equal(diagram.ink.clears,clears);
  input(p,'diameter',94); p.frame(2300);
  assert.equal(text(p,'bench-support'),'Air pocket');
  assert.equal(gold().length,0);
  input(p,'diameter',88); p.frame(2400); assert.equal(JSON.stringify(gold()),original);
  assert.equal(p.gl.uniforms.uScanY,G.FLOOR+51/P.mmPerUnit);
  assert.equal(p.gl.uploads,uploads);
  assert.equal(p.frames.size,0);
  click(p,'mode-lesson'); p.frame(90000);
  assert.ok(pressed(p,'exterior'));
  assert.equal(p.gl.uniforms.uScanY,-1);
  assert.equal(p.gl.uniforms.uTime,3);
  assert.deepEqual(p.gl.uniforms.uEye,eye);
  p.frame(91000); assert.equal(p.gl.uniforms.uTime,4);
});

test('meter detents, the fractional end stop, a fixed dose across fits, and a floor-seated block', () => {
  const p=createPage({reduced:true});
  p.key('4'); click(p,'step-investigate'); p.frame(10);
  assert.ok(pressed(p,'tool-pour') && p.byId('dose').focused);
  assert.equal(text(p,'bench-gap'),'148.9 mL');
  assert.equal(text(p,'bench-support'),'12.5 mm');
  assert.equal(text(p,'dose-value'),'50 mL');
  assert.equal(Number(p.byId('dose').max),149);
  const first=p.gl.uniforms.uWater;
  input(p,'diameter',94); p.frame(30);
  assert.equal(p.gl.uniforms.uWater,first);
  assert.equal(text(p,'bench-gap'),'243.1 mL');
  input(p,'dose',243); p.frame(40);
  assert.match(text(p,'bench-result'),/Less than 0.1 mm/);
  input(p,'dose',244); p.frame(50);
  assert.equal(text(p,'dose-value'),'243.1 mL');
  assert.match(text(p,'bench-result'),/just touches/);
  const full=p.gl.uniforms.uWater;
  click(p,'pour-empty'); p.frame(60); assert.equal(p.gl.uniforms.uWater,0);
  click(p,'pour-full'); p.frame(70); assert.equal(p.gl.uniforms.uWater,full);
  input(p,'diameter',77); p.frame(80);
  assert.equal(text(p,'dose-value'),'6.9 mL');
  assert.equal(text(p,'bench-support'),'1.8 mm');
  assert.ok(p.byId('bench-diagram').ink.text.includes('First contact'));
  input(p,'diameter',72); p.frame(90);
  assert.equal(text(p,'bench-gap'),'0.0 mL');
  assert.ok(p.byId('dose').disabled && p.byId('pour-full').disabled && p.byId('pour-empty').disabled);
  assert.equal(value(p,'dose'),0); assert.equal(p.gl.uniforms.uWater,0);
  assert.match(text(p,'bench-result'),/floor/);
  input(p,'diameter',88); click(p,'tool-fit'); p.frame(100);
  assert.equal(text(p,'bench-gap'),'34.0 mm');
  click(p,'tool-pour'); p.frame(110);
  assert.ok(!p.byId('dose').disabled && !p.byId('pour-full').disabled);
  assert.equal(text(p,'dose-value'),'0 mL');
  assert.equal(p.frames.size,0);
});

test('losing and restoring WebGL preserves the selected instrument, height and dose', () => {
  const p=createPage({reduced:true}), canvas=p.byId('scene'), diagram=p.byId('bench-diagram');
  p.key('b'); click(p,'tool-scan'); input(p,'scan-height',62); p.frame(0);
  canvas.emit('webglcontextlost'); p.frame(100);
  assert.equal(diagram.parentNode,p.byId('fallback-section'));
  assert.ok(diagram.ink.text.includes('Side view') && diagram.getAttribute('aria-label').includes('Noodle contours'));
  input(p,'scan-height',100);
  assert.match(diagram.getAttribute('aria-label'),/100 mm.*Above the block/);
  click(p,'tool-pour'); click(p,'pour-full'); p.frame(200);
  assert.ok(diagram.ink.text.includes('First contact'));
  const restored=new Graphics(); canvas.getContext=()=>restored;
  canvas.emit('webglcontextrestored'); p.frame(300);
  assert.equal(diagram.parentNode,p.byId('bench-inset'));
  assert.equal(restored.uniforms.uWaterBase,G.FLOOR);
  assert.equal(restored.uniforms.uScanY,-1); assert.ok(restored.uniforms.uWater>0);
  click(p,'tool-scan'); p.frame(400);
  assert.equal(value(p,'scan-height'),100); assert.equal(restored.uniforms.uWater,0);
  assert.ok(Math.abs(restored.uniforms.uScanY-G.HEIGHT)<1e-9);
  click(p,'tool-pour'); p.frame(500);
  assert.equal(text(p,'dose-value'),'148.9 mL');
  assert.equal(p.frames.size,0);
});

test('the plan and pool keep readable measurements when Canvas 2D is unavailable, with and without WebGL', () => {
  for (const noGL of [false,true]) {
    const p=createPage({no2D:true,noGL,reduced:true});
    p.frame(0);
    assert.equal(p.byId('model-error').hidden,!noGL);
    if (!noGL) {
      assert.equal(p.warnings.length,0);
      assert.equal(p.gl.texture.image.pixels.length,32);
      assert.ok(!p.byId('lesson-reading').hidden && p.gl.draws.length>0);
    }
    click(p,'step-investigate');
    const reading=noGL ? 'fallback-reading' : 'bench-reading';
    assert.ok(!p.byId(reading).hidden);
    assert.match(text(p,reading),/17 mm.*Air pocket/);
    click(p,'scan-block');
    assert.match(text(p,reading),/51 mm.*Noodle contours/);
    input(p,'diameter',72); input(p,'scan-height',0);
    assert.match(text(p,reading),/Floor contact/);
    assert.ok(p.byId('scan-gap').disabled);
    click(p,'tool-pour'); input(p,'diameter',88); click(p,'pour-full');
    assert.match(text(p,reading),/first contact.*148.9 mL/i);
    p.frame(100); assert.equal(p.frames.size,0);
  }
});

test('chapter repetition follows explicit seeks, carries overshoot, and replays the last step', () => {
  const p=createPage({noGL:true});
  p.key('3'); p.key('l'); click(p,'play');
  input(p,'speed',0.5,'change'); p.frame(0); p.frame(17000);
  assert.ok(pressed(p,'repeat'));
  assert.equal(value(p,'scrubber'),17.5);
  assert.equal(text(p,'step-title'),L.steps[2].title);
  input(p,'speed',2,'change'); p.frame(18000); p.frame(18500);
  assert.equal(value(p,'scrubber'),18.5);
  p.key('4'); p.frame(20000); p.frame(25500);
  assert.equal(value(p,'scrubber'),25);
  assert.equal(text(p,'step-title'),L.steps[3].title);
  p.key('l'); p.frame(31000);
  assert.equal(value(p,'scrubber'),36);
  p.key('l'); input(p,'scrubber',45);
  assert.equal(text(p,'play-text'),'Replay step');
  click(p,'play'); p.frame(32000); p.frame(36500);
  assert.equal(value(p,'scrubber'),36);
  assert.equal(text(p,'step-title'),L.steps[4].title);
  p.key('l'); p.frame(41000);
  assert.equal(text(p,'play-text'),'Replay lesson');
  assert.equal(p.frames.size,0);
});

test('quarter-speed bump study frames the cutaway and holds through help, background and bench work', () => {
  const p=createPage({reduced:true});
  p.key('3'); click(p,'exterior'); p.key('d'); p.frame(0);
  click(p,'step-investigate'); p.frame(1000); p.frame(5000);
  assert.equal(p.gl.uniforms.uTime,18); assert.ok(pressed(p,'repeat') && pressed(p,'cutaway'));
  assert.equal(value(p,'speed'),0.25); assert.ok(p.byId('play').focused);
  p.key('?'); p.frame(10000);
  p.document.hidden=true; p.document.emit('visibilitychange');
  p.document.hidden=false; p.document.emit('visibilitychange');
  click(p,'help-close'); p.frame(40000);
  assert.equal(p.gl.uniforms.uTime,18);
  p.key('b'); click(p,'tool-scan'); p.frame(50000);
  assert.equal(p.frames.size,0);
  p.key('b'); p.frame(80000); p.frame(84000);
  assert.equal(p.gl.uniforms.uTime,19); assert.ok(pressed(p,'repeat'));
  assert.ok(!p.key('l',{target:p.byId('speed')}).defaultPrevented);
  assert.ok(p.key('l',{repeat:true}).defaultPrevented && pressed(p,'repeat'));
  click(p,'play'); p.frame(90000); assert.equal(p.frames.size,0);
});

test('the displayed playhead stays inside a repeating chapter until its caption changes', () => {
  const p=createPage({noGL:true});
  p.key('3'); p.key('l'); click(p,'play'); p.frame(0); p.frame(7990);
  assert.equal(text(p,'step-title'),L.steps[2].title);
  assert.equal(value(p,'scrubber'),24.95);
  p.frame(8010);
  assert.equal(value(p,'scrubber'),17);
  p.key('4'); input(p,'scrubber',44.99);
  assert.equal(value(p,'scrubber'),44.95);
  input(p,'scrubber',45); assert.equal(value(p,'scrubber'),45);
});

test('the fit question opens its own experiment after a scanner or meter visit', () => {
  const p=createPage({noGL:true});
  click(p,'step-investigate'); click(p,'tool-pour');
  p.byId('check-options').children[0].emit('click'); click(p,'check-evidence'); p.frame(0);
  assert.ok(pressed(p,'tool-fit') && p.byId('scan-controls').hidden && p.byId('pour-controls').hidden);
  assert.equal(text(p,'bench-support'),'Cup floor'); assert.equal(value(p,'diameter'),72);
  assert.ok(p.byId('diameter').focused);
  p.key('2'); click(p,'step-investigate');
  assert.ok(pressed(p,'tool-scan') && p.byId('scan-height').focused);
  assert.equal(value(p,'diameter'),88); assert.equal(value(p,'scan-height'),51);
});
