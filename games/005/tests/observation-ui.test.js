'use strict';
const {before,test} = require('node:test');
const assert = require('node:assert/strict');
const {createPage,html} = require('./support/page.cjs');
const {Graphics} = require('./support/graphics.cjs');
const M = require('../js/math.js');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const D = require('../js/design.js');
const L = require('../js/lesson.js');
const O = require('../js/observations.js');
const close = (a,b,eps=1e-7) => assert.ok(Math.abs(a-b)<=eps,a+' versus '+b);
const text = (p,id) => p.byId(id).textContent;
const pressed = (p,id) => p.byId(id).getAttribute('aria-pressed')==='true';
const material = (gl,id) => gl.draws.filter(d=>d.uniforms.uMaterial===id);
const arrows = p => p.byId('callouts').children.filter(n=>n.getAttribute('class')?.includes('force-arrow'));
let profile, stops;
before(() => { profile=P.measure(G.noodles()); stops=O.forSpecimen(profile); });

test('the force diagram projects the same reactions on the stage and switches support at floor contact', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads;
  assert.equal(p.click('try-forces'),false);
  p.key('2'); p.click('exterior'); p.click('play'); p.frame(0); p.frame(1000);
  let stamp=2000;
  p.click('try-forces'); p.frame(stamp);
  assert.ok(pressed(p,'cutaway') && pressed(p,'tool-forces') && p.byId('block-mass').focused);
  for (const [width,taper,mass] of [[88,100,80],[88,100,40],[94,50,100],[94,0,40],[72,100,20]]) {
    p.input('diameter',width); p.input('taper',taper); p.input('block-mass',mass); p.frame(stamp+=100);
    const fit=P.fit(profile,width,taper/100), f=D.supportForces(fit,mass);
    assert.equal(text(p,'mass-value'),mass+' g');
    assert.equal(text(p,'bench-gap'),f.weightN.toFixed(2)+' N');
    assert.equal(text(p,'bench-support'),f.reactionN.toFixed(2)+' N');
    assert.equal(text(p,'reading-two'),fit.onFloor ? 'Floor reaction' : 'Push from each wall');
    const diagram=p.byId('bench-diagram'), paths=arrows(p), stage=p.byId('scene');
    assert.equal(paths.length,f.arrows.length);
    assert.ok(diagram.ink.text.includes(f.inwardN.toFixed(2)+' N'));
    assert.ok(diagram.getAttribute('aria-label').includes(f.upN.toFixed(2)+' N upward'));
    const bars=diagram.ink.strokes.filter(s=>s.color==='#216c65' && s.width===5);
    const axis=diagram.ink.strokes.find(s=>s.width===0.8 && s.points.length===4).points;
    const fullWidth=axis[2][0]-axis[1][0], maxN=parseFloat(diagram.ink.text.at(-2));
    assert.equal(bars.length,2);
    for (const [i,n] of [f.upN,f.inwardN].entries()) {
      close((bars[i].points[1][0]-bars[i].points[0][0])/fullWidth*maxN,n);
    }
    f.arrows.forEach(({tail,tip,kind},i)=>{
      assert.equal(paths[i].getAttribute('class'),'force-arrow '+kind);
      const coords=paths[i].getAttribute('d').split(/\s+/).filter(s=>s!=='M' && s!=='L').map(Number);
      assert.ok(coords.every(Number.isFinite));
      for (const [point,start] of [[tail,0],[tip,2]]) {
        const [x,y]=M.project(p.gl.uniforms.uVP,point,stage.clientWidth,stage.clientHeight);
        close(coords[start],x); close(coords[start+1],y);
      }
    });
    assert.equal(p.gl.uniforms.uGuidedSeat,0); assert.equal(p.frames.size,0);
  }
  p.click('exterior'); p.frame(stamp+=100); assert.equal(arrows(p).length,0);
  p.click('cutaway'); p.frame(stamp+=100); assert.equal(arrows(p).length,2);
  p.click('tool-fit'); p.frame(stamp+=100); assert.equal(arrows(p).length,0);
  p.key('b'); p.frame(stamp+=100);
  assert.equal(p.gl.uniforms.uGuidedSeat,1); assert.equal(p.gl.uploads,uploads);
  assert.ok(pressed(p,'exterior')); close(p.gl.uniforms.uTime,9);
  p.frame(stamp+1000); close(p.gl.uniforms.uTime,10);
});

test('the packed-gap reference stays fixed against the moving strands, trace and calibrated diagram', () => {
  const p=createPage({reduced:true}), diagram=p.byId('diagram'), uploads=p.gl.uploads;
  p.key('5'); p.click('exterior'); p.input('strand-choice','gap','change'); p.click('trace');
  assert.ok(pressed(p,'cutaway') && !p.byId('gap-key').hidden && !p.byId('gap-half').hidden);
  let originalLine;
  for (const [id,time] of [['strand-packed',36],['gap-half',stops[4].time],['strand-loose',L.looseTime],['gap-half',stops[4].time]]) {
    p.click(id); p.frame(100);
    const s=L.scene(time,profile), g=L.gapReading(profile,s.bottom);
    close(p.gl.uniforms.uTime,time);
    const [curl,topping]=material(p.gl,3);
    close(curl.uniforms.uPackedY,profile.bottom); close(curl.uniforms.uSoft,s.soft);
    assert.equal(curl.uniforms.uGuidedSeat,1); assert.equal(curl.uniforms.uTrace,1);
    close(material(p.gl,7)[0].uniforms.uPackedY,profile.bottom);
    assert.equal(topping.uniforms.uPackedY,-1); assert.equal(topping.uniforms.uTrace,0);
    assert.ok(text(p,'strand-reading').includes(g.reachedMM.toFixed(1)+' mm into'));
    const datum=diagram.ink.strokes.find(a=>a.color==='#693e53' && a.width===1.3).points;
    if (originalLine) assert.deepEqual(datum,originalLine);
    originalLine=datum;
    const bracket=diagram.ink.strokes.find(a=>a.color==='#693e53' && a.width===1.1).points;
    const shell=diagram.ink.strokes.find(a=>a.color==='#4d6355' && a.points.length===4).points;
    const pxPerMM=(shell[1][1]-shell[0][1])/100;
    close((bracket[1][1]-datum[0][1])/pxPerMM,g.reachedMM);
    close((shell[1][1]-bracket[1][1])/pxPerMM,g.remainingMM);
    const clip=diagram.ink.clips.at(-1)[0];
    close(clip[1],datum[0][1]);
    assert.ok(diagram.getAttribute('aria-label').includes('Remaining clearance '+g.remainingMM.toFixed(1)+' mm'));
    assert.ok(p.byId('callouts').classes.has('gap-study'));
    assert.equal(p.frames.size,0);
  }
  p.input('scrubber',37.25); p.frame(200); close(p.gl.uniforms.uSoft,L.scene(37.25).soft);
  p.input('strand-choice','lower','change'); p.frame(300);
  assert.ok(p.byId('gap-half').hidden && p.byId('gap-key').hidden);
  assert.ok(material(p.gl,3).some(d=>d.uniforms.uHighlight));
  assert.ok(material(p.gl,3).every(d=>d.uniforms.uPackedY===-1));
  p.input('strand-choice','gap','change'); p.key('4'); p.frame(400);
  assert.equal(material(p.gl,7)[0].uniforms.uPackedY,-1);
  p.key('5'); p.frame(500); assert.equal(material(p.gl,7)[0].uniforms.uPackedY,profile.bottom);
  assert.equal(p.gl.uploads,uploads);
  const [vert,frag]=p.gl.shaders.map(s=>s.source);
  assert.match(vert,/p\.xz=radial\*limit/);
  assert.ok(vert.indexOf('p.xz=radial*limit')<vert.indexOf('p=mix(p,aWetPosition,uSoft)'));
  assert.match(frag,/vPosition\.y<uPackedY/);
  assert.match(frag,/abs\(vLocal\.y-uPackedY\)/);
});

test('the stop marker, running clock and evidence caption agree across all five chapters', () => {
  const p=createPage({reduced:true});
  assert.ok(p.byId('observation').hidden && p.byId('observation-mark').hidden);
  assert.ok(p.key('o').defaultPrevented && pressed(p,'observe'));
  assert.equal(p.key('o',{target:p.byId('speed')}).defaultPrevented,false);
  p.key('o',{repeat:true}); assert.ok(pressed(p,'observe'));
  p.input('speed',2,'change');
  let stamp=0;
  for (const [i,stop] of stops.entries()) {
    p.click('play'); p.frame(stamp); stamp+=60000; p.frame(stamp);
    assert.equal(text(p,'step-title'),L.steps[i].title);
    assert.equal(text(p,'stop-title'),stop.title); assert.equal(text(p,'stop-note'),stop.note);
    close(p.gl.uniforms.uTime,stop.time);
    close(parseFloat(p.byId('observation-mark').style.left),100*stop.time/L.duration);
    assert.ok(!p.byId('stop-note').hidden && p.byId('visit-stop').disabled);
    assert.equal(text(p,'play-text'),'Continue lesson'); assert.equal(p.frames.size,0);
  }
  p.click('play'); p.frame(stamp); p.frame(stamp+60000);
  assert.equal(text(p,'play-text'),'Replay lesson'); assert.equal(text(p,'stop-note'),'');
  p.click('visit-stop'); p.frame(stamp+61000);
  close(p.gl.uniforms.uTime,stops[4].time);
  p.key('o'); p.frame(stamp+62000);
  assert.ok(p.byId('observation').hidden && p.byId('observation-mark').hidden);
  assert.equal(text(p,'play-text'),'Play lesson'); assert.equal(p.frames.size,0);
});

test('a 60 Hz steep with both overlays visits the crossing once and then sleeps at the final pose', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads, textures=p.gl.textureUploads;
  p.resize(320,327); p.key('5'); p.input('strand-choice','gap','change'); p.click('trace');
  p.key('o'); p.click('play');
  let visits=0, frames=0, previous=36;
  for (let i=0; i<600; i++) {
    if (!p.frame(i*1000/60)) break;
    frames++;
    const food=material(p.gl,3)[0].uniforms;
    assert.ok(food.uTime>=previous); previous=food.uTime;
    assert.equal(food.uPackedY,profile.bottom); assert.equal(food.uTrace,1);
    assert.ok(p.gl.draws.length<=16);
    if (text(p,'play-text')==='Continue lesson') {
      close(food.uTime,stops[4].time); visits++; p.click('play');
    }
  }
  assert.equal(visits,1); assert.ok(frames>=540 && frames<550);
  assert.equal(previous,45); assert.equal(text(p,'play-text'),'Replay lesson');
  assert.match(text(p,'strand-reading'),/29\.7 mm into.*4\.6 mm/);
  assert.equal(p.gl.uploads,uploads); assert.equal(p.gl.textureUploads,textures);
  assert.equal(p.frames.size,0);
});

test('seeking and repeating revisit the chapter observation while the bench, help and a hidden tab hold time', () => {
  const p=createPage({reduced:true});
  p.key('3'); p.key('o'); p.click('repeat'); p.click('visit-stop'); p.frame(0);
  close(p.gl.uniforms.uTime,L.bumpTime); assert.ok(p.byId('visit-stop').disabled);
  p.click('play'); p.frame(100); p.frame(1100); close(p.gl.uniforms.uTime,L.bumpTime+1);
  p.key('?'); p.frame(10000); close(p.gl.uniforms.uTime,L.bumpTime+1);
  p.click('help-close'); p.key('b'); p.click('tool-forces'); p.frame(40000);
  assert.equal(p.key('o').defaultPrevented,false); assert.ok(pressed(p,'observe'));
  p.document.hidden=true; p.document.emit('visibilitychange');
  p.document.hidden=false; p.document.emit('visibilitychange'); p.key('b'); p.frame(90000);
  close(p.gl.uniforms.uTime,L.bumpTime+1);
  p.frame(100000); close(p.gl.uniforms.uTime,L.bumpTime);
  assert.equal(text(p,'play-text'),'Continue lesson');
  p.input('scrubber',35); assert.equal(text(p,'stop-title'),stops[3].title);
  assert.equal(text(p,'stop-note'),''); assert.ok(!p.byId('visit-stop').disabled);
  p.click('play'); p.frame(110000); p.frame(112000);
  close(p.gl.uniforms.uTime,26);
  p.frame(120000); close(p.gl.uniforms.uTime,stops[3].time);
  p.input('scrubber',25); assert.ok(!p.byId('visit-stop').disabled);
  p.click('visit-stop'); p.frame(121000);
  assert.equal(text(p,'stop-note'),stops[3].note);
});

test('new instruments keep their evidence and readings during graphics loss and in a text-only page', () => {
  for (const noGL of [false,true]) {
    const p=createPage({noGL,no2D:true,reduced:true}), canvas=p.byId('scene');
    p.key('5'); p.input('strand-choice','gap','change'); p.key('o'); p.click('visit-stop'); p.frame(0);
    if (!noGL) { canvas.emit('webglcontextlost'); p.frame(10); }
    assert.ok(!p.byId('model-error').hidden);
    assert.equal(p.byId('diagram').parentNode,p.byId('fallback-section'));
    assert.match(text(p,'fallback-reading'),/17\.2 mm into the original gap/);
    assert.equal(text(p,'stop-note'),stops[4].note);
    p.key('b'); p.click('tool-forces'); p.input('taper',0); p.input('block-mass',100); p.frame(20);
    assert.match(text(p,'fallback-reading'),/100 g block.*Floor reaction 0\.98 N/);
    p.input('taper',100); p.frame(30);
    assert.match(text(p,'fallback-reading'),/Each wall reaction.*0\.49 N upward/);
    if (!noGL) {
      const fresh=new Graphics(); canvas.getContext=()=>fresh; canvas.emit('webglcontextrestored'); p.frame(40);
      assert.equal(arrows(p).length,3); assert.equal(p.byId('bench-diagram').parentNode,p.byId('bench-inset'));
      assert.ok(!p.byId('bench-reading').hidden); assert.match(text(p,'bench-reading'),/Each wall reaction/);
      p.key('b'); p.frame(50); close(fresh.uniforms.uTime,stops[4].time);
      close(material(fresh,7)[0].uniforms.uPackedY,profile.bottom);
    } else {
      p.key('b'); p.frame(50);
      assert.equal(text(p,'fallback-reading'),p.byId('diagram').getAttribute('aria-label'));
    }
    assert.equal(text(p,'play-text'),'Continue lesson'); assert.equal(p.frames.size,0);
  }
});

test('the scanner can enter sub-millimetre pockets and the wall map distinguishes near contact from contact', () => {
  const p=createPage({reduced:true});
  p.key('b'); p.click('tool-scan');
  for (const [width,taper,step] of [[78,95,0.01],[86,65,0.1],[88,100,1]]) {
    p.input('taper',taper); p.input('diameter',width); p.click('scan-gap'); p.frame(0);
    const fit=P.fit(profile,width,taper/100), mm=Number(p.byId('scan-height').value);
    assert.ok(mm>0 && mm<fit.gapMM); close(mm,Math.round(fit.gapMM/2/step)*step);
    assert.equal(Number(p.byId('scan-height').step),step);
    assert.equal(text(p,'bench-support'),'Air pocket');
    assert.equal(text(p,'scan-value'),mm+' mm');
    close(p.gl.uniforms.uScanY,G.FLOOR+mm/P.mmPerUnit);
  }
  p.click('tool-fit'); p.click('wall-map'); p.input('taper',80); p.input('diameter',82); p.frame(10);
  assert.equal(text(p,'bench-gap'),'<0.1 mm');
  assert.match(p.byId('bench-diagram').getAttribute('aria-label'),/Closest curl <0\.1 mm/);
  assert.match(text(p,'bench-result'),/floor supports/);
  p.click('tool-press'); p.input('taper',65); p.input('diameter',86); p.input('press-travel',0.2); p.frame(20);
  assert.equal(text(p,'bench-gap'),'<0.1 mm');
  assert.match(p.byId('bench-diagram').getAttribute('aria-label'),/with <0\.1 mm clearance left/);
  p.input('taper',95); p.input('diameter',78); p.input('press-travel',0.1); p.frame(30);
  assert.equal(text(p,'bench-support'),'<0.1 mm');
  assert.ok(p.byId('bench-diagram').ink.text.includes('Lift <0.1 mm'));
});

test('on-screen help covers the new controls and the mass range matches the simulation', () => {
  const help=html.match(/<dialog\b[\s\S]*?<\/dialog>/)[0];
  for (const word of ['Observation stops','<kbd>O</kbd>','Support forces','Original air gap','Half the gap']) {
    assert.ok(help.includes(word));
  }
  const mass=html.match(/<input id="block-mass"[^>]*>/)[0];
  assert.ok(mass.includes('min="'+D.minMassG+'"') && mass.includes('max="'+D.maxMassG+'"'));
  assert.ok(mass.includes('value="'+D.defaultMassG+'"'));
  assert.match(html,/<p id="stop-note" role="status"/);
});
