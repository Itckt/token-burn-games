'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');
const {Graphics} = require('./support/graphics.cjs');
const L = require('../js/lesson.js');

const click = (p,id) => p.byId(id).emit('click');
const text = (p,id) => p.byId(id).textContent;
const chapter = (p,i) => p.byId('chapters').children[i].children[0];
function seek(p,seconds) {
  const slider = p.byId('scrubber');
  slider.value = String(seconds);
  slider.emit('input');
}
function tags(p) {
  return p.byId('callouts').children.filter(el => el.tagName==='G' && el.style.display!=='none')
    .map(g => g.children.at(-1).textContent);
}

test('local classic scripts initialize a captioned, paused and labeled cutaway', () => {
  const p = createPage();
  assert.equal(p.frame(0),1);
  assert.equal(p.warnings.length,0);
  assert.equal(p.byId('model-error').hidden,true);
  assert.equal(p.byId('scene').tabIndex,0);
  assert.equal(text(p,'step-title'),L.steps[0].title);
  assert.equal(text(p,'step-caption'),L.steps[0].caption);
  assert.equal(text(p,'play-text'),'Play lesson');
  assert.equal(text(p,'duration'),'0:45');
  assert.equal(p.byId('chapters').children.length,5);
  assert.deepEqual(tags(p),['Cup wall','Noodle block','Air gap']);
  assert.ok(p.byId('previous').disabled && !p.byId('next').disabled);
  assert.equal(chapter(p,0).getAttribute('aria-current'),'step');
  assert.match(p.byId('diagram').getAttribute('aria-label'),/air gap/);
  assert.equal(p.frames.size,0,'a paused, settled model should sleep');
});

test('chapter buttons, digit shortcuts and transport arrows agree on caption, diagram and playhead', () => {
  const p = createPage({noGL:true});
  for (const [i,step] of L.steps.entries()) {
    chapter(p,i).emit('click');
    assert.equal(text(p,'step-title'),step.title);
    assert.equal(text(p,'step-caption'),step.caption);
    assert.equal(Number(p.byId('scrubber').value),step.start);
    assert.equal(text(p,'elapsed'),L.formatTime(step.start));
    assert.equal(text(p,'play-text'),'Play lesson');
    for (let j=0; j<L.steps.length; j++) {
      assert.equal(chapter(p,j).getAttribute('aria-current'),i===j ? 'step' : null);
      assert.equal(p.ticks[j].classes.has('on'),j<=i);
    }
    assert.ok(chapter(p,i).getAttribute('aria-label').includes(step.name));
    assert.ok(p.byId('diagram').getAttribute('aria-label').length>30);
  }
  assert.ok(p.byId('next').disabled);
  click(p,'previous');
  assert.equal(text(p,'step-title'),L.steps[3].title);
  p.key('ArrowLeft');
  assert.equal(text(p,'step-title'),L.steps[2].title);
  p.key('1');
  click(p,'next');
  p.key('ArrowRight');
  assert.equal(text(p,'step-title'),L.steps[2].title);
  assert.equal(p.byId('diagram').ink.stackDepth,0);
});

test('the player pauses on the current frame, seeks both ways, ends and replays at zero', () => {
  const p = createPage({noGL:true});
  p.frame(0);
  click(p,'play');
  p.frame(100);
  p.frame(2350);
  assert.equal(text(p,'elapsed'),'0:02');
  assert.equal(text(p,'play-text'),'Pause lesson');
  assert.equal(p.byId('play-icon').getAttribute('href'),'#i-pause');
  seek(p,32.5);
  assert.equal(text(p,'step-title'),L.steps[3].title);
  p.key(' ');
  p.frame(5000);
  assert.equal(p.frames.size,0);
  assert.equal(Number(p.byId('scrubber').value),32.5);
  seek(p,8);
  assert.equal(text(p,'step-title'),L.steps[1].title);
  p.key(' ');
  seek(p,44.8);
  p.frame(5100);
  p.frame(5600);
  assert.equal(text(p,'play-text'),'Replay lesson');
  assert.equal(text(p,'elapsed'),'0:45');
  assert.equal(p.byId('scrubber').getAttribute('aria-valuetext'),'0:45 of 0:45');
  assert.equal(p.byId('scrubber').style['--progress'],'100.00%');
  click(p,'play');
  assert.equal(text(p,'elapsed'),'0:00');
  assert.equal(text(p,'play-text'),'Pause lesson');
  assert.ok(Number(p.byId('scrubber').value)===0);
});

test('opening help suspends the clock and returning resumes at the same frame', () => {
  const p = createPage({noGL:true});
  p.key(' ');
  p.frame(0);
  p.frame(1200);
  p.key('?');
  assert.ok(p.byId('help').open && p.byId('help-close').focused);
  p.frame(60000);
  assert.equal(text(p,'elapsed'),'0:01');
  assert.equal(p.frames.size,0);
  assert.ok(!p.key('4').defaultPrevented);
  p.byId('help').emit('click',{clientX:30,clientY:30});
  assert.ok(p.byId('help').open);
  click(p,'help-close');
  p.frame(90000);
  assert.equal(text(p,'elapsed'),'0:01');
  p.frame(91000);
  assert.equal(text(p,'elapsed'),'0:02');
  click(p,'help-open');
  p.byId('help').emit('click',{clientX:-2,clientY:-1});
  assert.ok(!p.byId('help').open);
});

test('switching away cancels frames and time spent in the background is excluded', () => {
  const p = createPage({noGL:true});
  click(p,'play');
  p.frame(500);
  p.frame(2500);
  p.document.hidden = true;
  p.document.emit('visibilitychange');
  assert.equal(p.frame(100000),0);
  p.document.hidden = false;
  p.document.emit('visibilitychange');
  p.frame(115000);
  assert.equal(text(p,'elapsed'),'0:02');
  p.frame(116500);
  assert.equal(text(p,'elapsed'),'0:03');
});

test('shortcuts preserve native inputs, editable text, buttons and modified keystrokes', () => {
  const p = createPage({noGL:true});
  for (const props of [{target:p.byId('scrubber')},{altKey:true},{ctrlKey:true},{metaKey:true},
    {target:{tagName:'SPAN',isContentEditable:true}}]) {
    assert.ok(!p.key('4',props).defaultPrevented);
  }
  assert.ok(!p.key(' ',{target:p.byId('play')}).defaultPrevented);
  assert.ok(!p.key('z').defaultPrevented);
  assert.equal(text(p,'step-title'),L.steps[0].title);
  assert.ok(p.key('4').defaultPrevented);
  assert.equal(text(p,'step-title'),L.steps[3].title);
});

test('cutaway and exterior controls change geometry and labels, including on narrow screens', () => {
  const p = createPage({reduced:true});
  p.frame(0);
  click(p,'exterior');
  p.frame(16);
  assert.deepEqual(tags(p),['Printed sleeve','Rolled rim']);
  assert.equal(p.byId('exterior').getAttribute('aria-pressed'),'true');
  assert.equal(p.byId('cutaway').getAttribute('aria-pressed'),'false');
  p.key('c');
  p.resize(316,327);
  p.frame(32);
  assert.deepEqual(tags(p),['Noodle block','Air gap']);
  assert.equal(p.byId('cutaway').getAttribute('aria-pressed'),'true');
  for (const group of p.byId('callouts').children.filter(el => el.tagName==='G')) {
    const rect = group.children[2], x = Number(rect.getAttribute('x')), width = Number(rect.getAttribute('width'));
    assert.ok(x>=0 && x+width<=316);
  }
  seek(p,25);
  p.frame(48);
  assert.ok(!tags(p).includes('Water level') && !tags(p).includes('Hot water'));
  seek(p,27);
  p.frame(64);
  assert.deepEqual(tags(p),['Hot water','Water level']);
  seek(p,35.9);
  p.frame(80);
  assert.deepEqual(tags(p),['Water level']);
});

test('drag, keyboard orbit and reset use the model camera; manual framing survives a step change', () => {
  const p = createPage({reduced:true}), c = p.byId('scene');
  p.frame(0);
  const home = p.gl.uniforms.uEye;
  c.emit('pointerdown',{pointerId:1,button:2,clientX:0,clientY:0});
  assert.ok(!c.classes.has('dragging'));
  c.emit('pointerdown',{pointerId:1,button:0,clientX:20,clientY:20});
  assert.ok(c.focused && c.classes.has('dragging'));
  c.emit('pointermove',{pointerId:1,clientX:100,clientY:36});
  p.frame(16);
  const manual = p.gl.uniforms.uEye;
  assert.notDeepEqual(manual,home);
  c.emit('pointercancel',{pointerId:1});
  assert.ok(!c.classes.has('dragging'));
  p.key('2');
  p.frame(32);
  assert.deepEqual(p.gl.uniforms.uEye,manual);
  click(p,'reset');
  p.frame(48);
  assert.notDeepEqual(p.gl.uniforms.uEye,manual);
  p.key('1');
  p.key('r');
  p.frame(64);
  assert.deepEqual(p.gl.uniforms.uEye,home);
  p.key('D');
  p.key('W');
  p.frame(80);
  assert.notDeepEqual(p.gl.uniforms.uEye,home);
});

test('wheel, two-pointer pinch and keyboard zoom change scale without changing the eye angle', () => {
  const p = createPage({touch:true,reduced:true}), c = p.byId('scene');
  p.frame(0);
  assert.equal(p.zoomHint.textContent,'Pinch to zoom');
  const home = p.gl.uniforms.uVP, eye = p.gl.uniforms.uEye;
  assert.ok(c.emit('wheel',{deltaMode:1,deltaY:-3}).defaultPrevented);
  p.frame(16);
  assert.ok(p.gl.uniforms.uVP[0]>home[0]);
  click(p,'reset');
  p.frame(32);
  c.emit('pointerdown',{pointerId:2,button:0,clientX:0,clientY:0});
  c.emit('pointerdown',{pointerId:3,button:0,clientX:40,clientY:0});
  c.emit('pointermove',{pointerId:3,clientX:60,clientY:0});
  p.frame(48);
  assert.ok(Math.abs(p.gl.uniforms.uVP[0]/home[0]-1.5)<1e-6);
  assert.deepEqual(p.gl.uniforms.uEye,eye);
  c.emit('lostpointercapture',{pointerId:2});
  c.emit('pointerup',{pointerId:3});
  assert.ok(!c.classes.has('dragging'));
  p.key('r');
  p.key('-');
  p.frame(64);
  assert.ok(p.gl.uniforms.uVP[0]<home[0]);
  p.key('+');
  p.frame(80);
  assert.ok(Math.abs(p.gl.uniforms.uVP[0]-home[0])<1e-6);
});

test('camera easing converges while paused and reduced motion snaps to the requested view', () => {
  const p = createPage();
  p.frame(0);
  const home = p.gl.uniforms.uEye;
  p.key('d');
  p.frame(16);
  p.frame(32);
  const early = p.gl.uniforms.uEye;
  assert.notDeepEqual(early,home);
  for (let t=48; t<2000; t+=16) p.frame(t);
  assert.equal(p.frames.size,0);
  assert.notDeepEqual(p.gl.uniforms.uEye,early);
  p.reduce.matches = true;
  p.reduce.emit('change');
  p.key('r');
  p.frame(2000);
  assert.deepEqual(p.gl.uniforms.uEye,home);
  assert.equal(p.frames.size,0);
});

test('missing WebGL or shader failure leaves every caption, diagram and lesson control usable', () => {
  for (const options of [{noGL:true},{failCompile:true},{failLink:true}]) {
    const p = createPage(options);
    p.frame(0);
    assert.ok(!p.byId('model-error').hidden);
    assert.match(text(p,'error-detail'),/WebGL/);
    assert.equal(p.byId('scene').tabIndex,-1);
    for (const id of ['cutaway','exterior','reset']) assert.ok(p.byId(id).disabled);
    for (let i=0; i<5; i++) {
      p.key(String(i+1));
      assert.equal(text(p,'step-caption'),L.steps[i].caption);
      assert.ok(p.byId('diagram').ink.text.length>0);
    }
    click(p,'play');
    p.frame(200);
    p.frame(10000);
    assert.equal(text(p,'play-text'),'Replay lesson');
  }
});

test('a restored graphics context rebuilds the model at the current lesson position', () => {
  const p = createPage({reduced:true}), c = p.byId('scene');
  p.frame(0);
  assert.ok(c.emit('webglcontextlost').defaultPrevented);
  assert.ok(!p.byId('model-error').hidden);
  assert.match(text(p,'error-detail'),/interrupted/);
  seek(p,39);
  p.frame(16);
  const restored = new Graphics();
  c.getContext = () => restored;
  c.emit('webglcontextrestored');
  p.frame(32);
  assert.ok(p.byId('model-error').hidden && !p.byId('cutaway').disabled);
  assert.ok(restored.uploads>0 && restored.draws.length>0);
  assert.equal(restored.uniforms.uTime,39);
  assert.ok(restored.uniforms.uSoft>0);
  assert.equal(text(p,'step-title'),L.steps[4].title);
  assert.ok(tags(p).includes('Broth'));
});

test('orbiting behind the cup updates the orientation and fades occluded annotations', () => {
  const p = createPage({reduced:true}), c = p.byId('scene');
  p.frame(0);
  c.emit('pointerdown',{pointerId:1,button:0,clientX:0,clientY:0});
  c.emit('pointermove',{pointerId:1,clientX:Math.PI/0.008,clientY:0});
  c.emit('pointerup',{pointerId:1});
  p.frame(16);
  assert.equal(text(p,'orientation'),'Rear view');
  assert.equal(Number(p.byId('callouts').style.opacity),0);
  click(p,'reset');
  p.frame(32);
  assert.equal(text(p,'orientation'),'Front view');
  assert.equal(Number(p.byId('callouts').style.opacity),1);
});

test('a complete 60 Hz playback visits every chapter in order and goes idle at the end', () => {
  const p = createPage(), titles = [];
  const uploads = p.gl.uploads;
  click(p,'play');
  for (let i=0; i<=L.duration*60+1; i++) {
    p.frame(i*1000/60);
    const title = text(p,'step-title');
    if (titles.at(-1)!==title) titles.push(title);
  }
  assert.deepEqual(titles,L.steps.map(s => s.title));
  assert.equal(text(p,'elapsed'),'0:45');
  assert.equal(text(p,'play-text'),'Replay lesson');
  assert.equal(p.frames.size,0);
  assert.equal(p.gl.uploads,uploads);
});
