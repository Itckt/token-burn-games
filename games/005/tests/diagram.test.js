'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');
const L = require('../js/lesson.js');
const G = require('../js/meshes.js');

test('the traced cross section clips submerged curls at the very same height as its water surface', () => {
  const p=createPage({rendererOnly:true}), canvas=p.byId('diagram'), ink=canvas.ink;
  const paint=(t,trace=true) => p.context.CupDiagram.draw(canvas,L.scene(t),trace);
  const height=t => {
    paint(t);
    const surface=ink.strokes.find(line => line.color==='#217a74' && line.points.length===2 && line.width===1.5);
    assert.ok(surface);
    const [[,leftY],[,rightY]]=surface.points;
    const clip=ink.clips.at(-1)[0];
    assert.ok(Math.abs(leftY-clip[1])<1e-10 && leftY===rightY);
    assert.ok(ink.strokes.some(line=>line.color==='#217a74' && line.points.length>20));
    assert.equal(ink.stackDepth,0);
    return leftY;
  };
  paint(25);
  assert.ok(ink.text.includes('Dry pocket'));
  assert.equal(ink.clips.length,1);
  const low=height(27); assert.ok(ink.text.includes('Below block'));
  const mid=height(L.timeAtWaterline((G.BLOCK_BOTTOM+G.BLOCK_TOP)/2));
  assert.ok(mid<low && ink.text.includes('At lower curls'));
  assert.ok(height(35)<mid && ink.text.includes('Block covered'));
  assert.equal(height(27),low);
  paint(27,false);
  assert.equal(ink.clips.length,1);
  assert.ok(!ink.strokes.some(line=>line.color==='#217a74' && line.points.length>20));
});

test('the illustration samples lift, base flex and loosening during chapters, including backward seeks', () => {
  const p=createPage({rendererOnly:true}), c=p.byId('diagram');
  const draw=t=>{
    p.context.CupDiagram.draw(c,L.scene(t));
    return JSON.stringify(c.ink.strokes);
  };
  for (const [a,b] of [[8,11],[17,18.02],[36,44]]) {
    const first=draw(a);
    assert.notEqual(draw(b),first);
    assert.equal(draw(a),first);
  }
  draw(11); assert.ok(c.ink.text.includes('Lifted block'));
  draw(16.9); assert.ok(c.ink.text.includes('Wall contact'));
});

test('diagram caches follow dimensions, device scale and trace state and skip invisible or unchanged frames', () => {
  const p=createPage({rendererOnly:true,dpr:3}), c=p.byId('diagram');
  const draw=trace=>p.context.CupDiagram.draw(c,L.scene(30),trace);
  draw(false);
  const n=c.ink.clears;
  assert.equal(c.width,c.clientWidth*2);
  draw(false); assert.equal(c.ink.clears,n);
  draw(true); assert.equal(c.ink.clears,n+1);
  c.clientWidth=0; draw(true); assert.equal(c.ink.clears,n+1);
  c.clientWidth=484; draw(true); assert.equal(c.width,968);
  p.context.devicePixelRatio=1.25;
  draw(true); assert.equal(c.width,605);
  assert.equal(c.ink.stackDepth,0);
  const noCanvas=createPage({rendererOnly:true,no2D:true}), alt=noCanvas.byId('diagram');
  noCanvas.context.CupDiagram.draw(alt,L.scene(40),true);
  assert.match(alt.getAttribute('aria-label'),/loose strands and block covered/);
});

test('a cached elevation updates at a label transition even within one drawing increment', () => {
  const p=createPage({rendererOnly:true}), c=p.byId('diagram');
  const draw=scene=>p.context.CupDiagram.draw(c,scene);
  for (const stream of [0.0299,0.0301,0.0299]) {
    draw({...L.scene(25.08),stream});
    assert.equal(c.ink.text.includes('Pour stream'),stream>0.03);
    assert.equal(c.getAttribute('aria-label').includes('pour stream'),stream>0.03);
  }
  const dry=L.scene(8);
  for (const lift of [0.02999,0.03001,0.02999]) {
    draw({...dry,lift,bottom:dry.bottom+lift,top:dry.top+lift});
    assert.equal(c.ink.text.includes('Wall contact'),lift<0.03);
  }
});

test('the scanner ruler calibrates both the noodle contours and the sheet in side view', () => {
  const p=createPage({rendererOnly:true}), c=p.byId('bench-diagram'), ink=c.ink;
  const P=require('../js/packing.js'), S=require('../js/slices.js');
  const mesh=G.noodles(), fit=P.fit(P.measure(mesh),88);
  for (const mm of [0,51,100,51]) {
    const scan=S.scan(mesh,fit,mm);
    p.context.CupDiagram.draw(c,{...L.scene(0),fit,scan});
    const find=color=>ink.strokes.find(s=>s.color===color).points;
    const bar=find('#deeadf'), pixelsPerMM=(bar[2][0]-bar[1][0])/20;
    assert.ok(pixelsPerMM>0 && ink.text.includes('Plan view') && ink.text.includes('Side view'));
    const scale=pixelsPerMM*P.mmPerUnit, axis=find('#687381');
    const cx=(axis[1][0]+axis[0][0])/2, cy=axis[0][1];
    const gold=find('#ffcb7b');
    assert.equal(gold.length*2,scan.strokes.length);
    for (let i=0; i<gold.length; i++) {
      assert.ok(Math.abs((gold[i][0]-cx)/scale-scan.strokes[i*2])<1e-8);
      assert.ok(Math.abs((gold[i][1]-cy)/scale-scan.strokes[i*2+1])<1e-8);
    }
    const cup=find('#b6c7c1'), sheet=find('#d9baf4');
    assert.equal(sheet[0][1],sheet[1][1]);
    assert.ok(Math.abs((cup[1][1]-sheet[0][1])/pixelsPerMM-mm)<1e-8);
    assert.ok(Math.abs((cup[1][1]-cup[0][1])/pixelsPerMM-100)<1e-8);
    assert.equal(ink.stackDepth,0);
  }
});
