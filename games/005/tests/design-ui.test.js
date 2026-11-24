'use strict';
const {before,test} = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');
const {Graphics} = require('./support/graphics.cjs');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const D = require('../js/design.js');
const L = require('../js/lesson.js');
const S = require('../js/strands.js');
const close = (a,b,epsilon=1e-7) => assert.ok(Math.abs(a-b)<epsilon,a+' vs '+b);
const pressed = (p,id) => p.byId(id).getAttribute('aria-pressed')==='true';
const text = (p,id) => p.byId(id).textContent;
const material = (gl,id) => gl.draws.filter(d=>d.uniforms.uMaterial===id);
let mesh, profile;
before(() => { mesh=G.noodles(); profile=P.measure(mesh); });

test('straightening the wall from the snug-fit chapter changes the cup and preserves the running lesson', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads;
  assert.equal(p.click('try-walls'),false);
  p.key('2'); p.click('exterior'); p.click('play'); p.frame(0); p.frame(1000);
  const eye=p.gl.uniforms.uEye;
  assert.ok(p.click('try-walls')); p.frame(5000);
  assert.ok(pressed(p,'mode-packing') && pressed(p,'cutaway') && p.byId('taper').focused);
  assert.equal(text(p,'bench-support'),'Cup floor'); assert.equal(text(p,'taper-value'),'0.0°');
  assert.equal(p.gl.uniforms.uWallSlope,0);
  for (const m of [1,7]) assert.ok(material(p.gl,m).every(d=>d.uniforms.uReshapeShell===1));
  for (const m of [2,3,5]) assert.ok(material(p.gl,m).every(d=>d.uniforms.uReshapeShell===0));
  assert.ok(!p.key('ArrowLeft',{target:p.byId('taper')}).defaultPrevented);
  p.input('taper',75); p.frame(6000);
  assert.equal(text(p,'bench-gap'),'18.5 mm');
  assert.equal(text(p,'bench-support'),'Sloping wall');
  close(p.gl.uniforms.uWallSlope,G.wallSlope*0.75);
  p.click('mode-lesson'); p.frame(30000);
  assert.ok(pressed(p,'exterior')); assert.equal(p.gl.uniforms.uTime,9);
  assert.deepEqual(p.gl.uniforms.uEye,eye); assert.equal(p.gl.uniforms.uWallSlope,G.wallSlope);
  assert.equal(material(p.gl,7)[0].uniforms.uSeatY,profile.contact[1]);
  p.frame(31000); assert.equal(p.gl.uniforms.uTime,10);
  p.key('b'); assert.equal(Number(p.byId('taper').value),75);
  p.key('b'); p.click('step-investigate'); p.frame(32000);
  assert.ok(pressed(p,'tool-scan')); assert.equal(Number(p.byId('taper').value),100);
  assert.equal(text(p,'bench-support'),'Noodle contours'); assert.equal(p.gl.uploads,uploads);
});

test('wall dye, projected labels and the 24 measured arcs switch together without mesh uploads', () => {
  const p=createPage({reduced:true}), diagram=p.byId('bench-diagram'), uploads=p.gl.uploads;
  p.key('b'); p.click('exterior'); p.click('wall-map');
  for (const [width,percent] of [[88,100],[94,50],[88,0]]) {
    p.input('diameter',width); p.input('taper',percent); p.frame(10);
    const expected=D.wallMap(mesh,P.fit(profile,width,percent/100));
    assert.ok(pressed(p,'wall-map') && pressed(p,'cutaway'));
    const arcs=diagram.ink.strokes.filter(s=>s.width===9 && s.arcs.length);
    assert.equal(arcs.length,D.sectors);
    arcs.forEach((s,i)=>{
      assert.equal(s.color,expected.gaps[i]<=0.5 ? '#b34327' : expected.gaps[i]<=2 ? '#edab4d' : '#4d7a75');
      assert.ok(s.arcs[0].end>s.arcs[0].start);
    });
    assert.equal(text(p,'bench-gap'),expected.closestMM.toFixed(1)+' mm');
    assert.equal(text(p,'bench-support'),expected.closeCount+' of 24 arcs');
    const draws=material(p.gl,3);
    assert.equal(draws.length,1); assert.equal(draws[0].uniforms.uGapMap,1);
    assert.ok(diagram.getAttribute('aria-label').includes(text(p,'bench-support')));
    const labels=p.byId('callouts').children.map(g=>g.children.at(-1)?.textContent);
    assert.ok(labels.includes(percent===0 ? 'Closest curl' : 'Wall contact'));
  }
  const clears=diagram.ink.clears;
  p.key('d'); p.frame(100); assert.equal(diagram.ink.clears,clears);
  p.click('wall-map'); p.frame(200);
  assert.equal(material(p.gl,3).length,2); assert.equal(p.gl.uniforms.uGapMap,0);
  assert.equal(text(p,'bench-support'),'Cup floor');
  assert.equal(p.gl.uploads,uploads); assert.equal(p.frames.size,0);
});

test('the finder plots calibrated target boundaries, applies an actual diameter and handles impossible briefs', () => {
  const p=createPage({reduced:true}), ink=p.byId('bench-diagram').ink;
  p.key('b'); p.click('tool-finder'); p.frame(0);
  assert.equal(text(p,'fit-matches'),'85–88 mm match');
  assert.match(text(p,'bench-result'),/88 mm block meets both/);
  const axis=ink.strokes.find(s=>s.points.length===3 && s.width===1.1).points;
  const [[left,top],[,bottom],[right]]=axis, plotX=ml=>left+(right-left)*ml/250, plotY=mm=>bottom+(top-bottom)*mm/100;
  close(ink.lastRect.x,plotX(100)); close(ink.lastRect.y+ink.lastRect.h,plotY(30));
  assert.equal(ink.lastRect.color,'#d2e4d0');
  assert.ok(p.click('apply-fit')); p.frame(100);
  assert.equal(Number(p.byId('diameter').value),85);
  const fit=P.fit(profile,85), food=material(p.gl,3)[0].uniforms.uModel;
  close(food[5],fit.scale); close(food[13],fit.offsetY);
  const dot=ink.fills.flatMap(f=>f.arcs).find(a=>a.r===4.1);
  close(dot.x,plotX(P.volumeBelow(fit.bottom))); close(dot.y,plotY((G.HEIGHT-fit.top)*P.mmPerUnit));
  p.input('pocket-goal',250); assert.ok(p.byId('apply-fit').disabled);
  assert.equal(text(p,'fit-matches'),'No matching sizes'); assert.equal(p.click('apply-fit'),false);
  assert.equal(Number(p.byId('diameter').value),85);
  p.input('pocket-goal',0); p.input('room-goal',0);
  assert.equal(text(p,'fit-matches'),'72–94 mm match'); p.click('apply-fit');
  assert.equal(Number(p.byId('diameter').value),72);
  p.input('pocket-goal',100); p.input('room-goal',30); p.input('taper',50);
  assert.equal(text(p,'fit-matches'),'93–94 mm match'); p.click('apply-fit'); p.frame(200);
  const capacity=text(p,'bench-gap');
  p.click('tool-pour'); p.click('pour-full'); p.frame(300);
  assert.equal(text(p,'bench-gap'),capacity); assert.equal(text(p,'dose-value'),capacity);
  close(p.gl.uniforms.uWater,P.fit(profile,93,0.5).bottom-G.FLOOR);
  p.click('tool-finder'); assert.match(text(p,'bench-result'),/93 mm block meets both/);
  p.input('room-goal',100); assert.equal(text(p,'fit-matches'),'No matching sizes');
  p.frame(400); assert.equal(p.frames.size,0);
});

test('the scanner, dose and both transit pads follow the altered wall and first contact', () => {
  const p=createPage({reduced:true}), diagram=p.byId('bench-diagram');
  p.key('3'); assert.ok(p.click('try-press')); p.frame(0);
  assert.ok(p.byId('press-touch').disabled && p.byId('press-travel').focused);
  p.input('diameter',77); const fit=P.fit(profile,77);
  assert.ok(p.click('press-touch')); p.frame(100);
  close(material(p.gl,9)[0].uniforms.uPadRise,fit.gapMM/P.mmPerUnit,1e-12);
  assert.match(text(p,'bench-result'),/First contact/); assert.equal(text(p,'bench-support'),'0.0 mm');
  p.click('press-peak'); p.frame(200);
  close(material(p.gl,3)[0].uniforms.uModel[13],fit.offsetY+(8-fit.gapMM)/P.mmPerUnit);
  p.input('taper',0); p.frame(300);
  assert.ok(diagram.ink.text.includes('Lift 8.0 mm'));
  assert.equal(text(p,'bench-support'),'8.0 mm');
  assert.match(diagram.getAttribute('aria-label'),/Floor fit lifts 8.0 mm.*77 mm test block lifts 8.0 mm/);
  p.click('press-rest'); p.frame(400); assert.equal(p.gl.uniforms.uPadRise,0);
  p.click('tool-scan'); p.input('scan-height',0); p.frame(500);
  const fullWidth=text(p,'bench-gap');
  assert.equal(text(p,'bench-support'),'Floor contact');
  p.input('scan-height',100); assert.equal(text(p,'bench-gap'),fullWidth);
  const cup=diagram.ink.strokes.find(s=>s.color==='#b6c7c1').points;
  close(cup[0][0],cup[1][0]); close(cup[2][0],cup[3][0]);
  p.click('tool-pour'); p.frame(600); assert.equal(text(p,'bench-gap'),'0.0 mL');
  assert.ok(p.byId('dose').disabled && !material(p.gl,4).length);
  p.input('taper',100); p.click('pour-full'); p.frame(700);
  assert.ok(!p.byId('dose').disabled && material(p.gl,4).length);
  close(p.gl.uniforms.uWater,fit.bottom-G.FLOOR);
});

test('map and finder survive loss, resizing, text-only operation and a fresh graphics context', () => {
  for (const no2D of [false,true]) {
    const p=createPage({no2D,reduced:true}), c=p.byId('scene'), diagram=p.byId('bench-diagram');
    p.key('b'); p.input('taper',50); p.click('wall-map'); p.frame(0);
    c.emit('webglcontextlost'); p.resize(290,325); p.frame(100);
    assert.equal(diagram.parentNode,p.byId('fallback-section'));
    assert.match(diagram.getAttribute('aria-label'),/Closest curl/);
    p.click('tool-finder'); p.click('apply-fit'); p.frame(200);
    assert.match(diagram.getAttribute('aria-label'),/2 of 23 diameters.*93 mm/);
    if (no2D) {
      assert.equal(text(p,'fallback-reading'),diagram.getAttribute('aria-label'));
      assert.ok(!p.byId('fallback-reading').hidden);
    } else assert.ok(diagram.ink.text.includes('93 mm'));
    const restored=new Graphics(); c.getContext=()=>restored;
    c.emit('webglcontextrestored'); p.frame(300);
    assert.equal(diagram.parentNode,p.byId('bench-inset'));
    assert.equal(restored.uniforms.uWallSlope,G.wallSlope/2);
    assert.equal(text(p,'fit-matches'),'93–94 mm match');
    assert.ok(pressed(p,'tool-finder')); assert.equal(p.frames.size,0);
    p.click('tool-fit'); p.frame(400); assert.equal(restored.uniforms.uGapMap,1);
    p.key('b'); p.frame(500);
    assert.equal(restored.uniforms.uGapMap,0); assert.equal(restored.uniforms.uWallSlope,G.wallSlope);
  }
});

test('the half-length stop and tracked curls agree with the drawn tube ranges while scrubbing and seeking', () => {
  const p=createPage({reduced:true}), uploads=p.gl.uploads;
  p.key('4'); p.click('trace'); p.frame(0);
  assert.equal(p.byId('immersion-meter').getAttribute('aria-valuetext'),'0% of strand length submerged');
  p.click('play'); p.click('water-half'); p.frame(100);
  assert.equal(text(p,'play-text'),'Play lesson'); assert.equal(text(p,'immersion-value'),'50%');
  close(p.byId('immersion-meter').value,50);
  const h=S.heightAtFraction(S.immersionProfile(mesh.strands),0.5);
  close(p.gl.uniforms.uTime,L.timeAtWaterline(h));
  p.key('5');
  for (const strand of mesh.strands.filter(s=>s.key)) {
    p.input('strand-choice',strand.key,'change'); p.click('strand-packed'); p.frame(200);
    const selected=material(p.gl,3).find(d=>d.uniforms.uHighlight===1);
    assert.equal(selected.offset,strand.firstIndex*2); assert.equal(selected.count,strand.indexCount);
    const parts=p.gl.draws.filter(d=>d.indices===selected.indices);
    let end=0;
    for (const part of parts) { assert.equal(part.offset,end*2); end+=part.count; }
    assert.equal(end,mesh.indices.length); assert.equal(selected.uniforms.uSoft,0);
    assert.match(text(p,'strand-reading'),/at its packed height/);
    p.click('strand-loose'); p.frame(300);
    assert.equal(p.gl.uniforms.uSoft,1);
    assert.ok(text(p,'strand-reading').includes(S.track(strand,1).heightMM.toFixed(1)+' mm'));
    p.input('scrubber',37); p.frame(400);
    const height=S.track(strand,L.scene(37).soft).heightMM;
    assert.ok(text(p,'strand-reading').includes(height.toFixed(1)+' mm'));
    assert.ok(p.byId('diagram').ink.text.includes('Current mark'));
  }
  p.key('4'); p.frame(500);
  assert.ok(p.byId('strand-tools').hidden && !material(p.gl,3).some(d=>d.uniforms.uHighlight));
  p.key('5'); p.input('strand-choice','','change'); p.frame(600);
  assert.ok(p.byId('strand-inspection').hidden && !material(p.gl,3).some(d=>d.uniforms.uHighlight));
  assert.equal(p.gl.uploads,uploads); assert.equal(p.frames.size,0);
});
