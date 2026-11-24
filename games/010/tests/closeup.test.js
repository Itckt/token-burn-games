'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../js/math'), sim=require('../js/simulation'), world=require('../js/world');
const {rasterize}=require('./support/raster');
const {openPage,ticks,key,surface}=require('./support/page');
const shots=world.notes.map(n=>n.closeup);
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,a+' vs '+b);
function sameMatrix(a,b) { for (let i=0;i<16;i++) near(a[i],b[i]); }

test('each close-up centers the visible model and its pin hits the same object in both orientations',()=>{
  const scene=world.makeScene();
  for (const [width,height] of [[460,300],[260,440]]) {
    const view=sim.createView(false);
    const overview=sim.camera(view,width,height);
    for (const note of scene.notes) {
      sim.focusOn(view,note.closeup,true);
      const camera=sim.camera(view,width,height);
      const image=rasterize(scene.batches,camera.matrix,width,height);
      const center=M.project(note.closeup.center,camera.matrix,width,height);
      near(center.x,width/2,.001); near(center.y,height/2,.001);
      assert.equal(image.at(width/2,height/2),note.id,note.title+' at the center');
      const pin=M.project(note.anchor,camera.matrix,width,height);
      assert.ok(sim.exposed(note.anchor,camera.direction));
      assert.equal(image.at(pin.x,pin.y),note.id,note.title+' at its pin');
      const pixels=image.ids.reduce((count,id)=>count+(id===note.id),0);
      assert.ok(pixels>width*height*.065,note.title+' occupies a readable area');
      const scale=m=>Math.hypot(m[0],m[4],m[8]);
      assert.ok(scale(camera.matrix)>scale(overview.matrix)*1.7);
    }
  }
});
test('close-ups take the short way around and retain the wide view through interrupted visits',()=>{
  const v=sim.createView(false);
  sim.rotate(v,-3810,40); sim.zoomBy(v,1.35); sim.settle(v);
  const original=sim.camera(v,850,430).matrix;
  for (const shot of [shots[0],shots[5],shots[3]]) {
    const before=sim.camera(v,850,430).matrix;
    sim.focusOn(v,shot);
    sameMatrix(sim.camera(v,850,430).matrix,before);
    assert.ok(Math.abs(v.targetYaw-v.yaw)<=Math.PI);
    const yaw=v.yaw;
    sim.step(v,1/60);
    assert.ok(Math.abs(v.targetYaw-v.yaw)<Math.abs(v.targetYaw-yaw));
    assert.ok(v.lens.mix>0 && v.lens.mix<1 && sim.cameraMoving(v));
  }
  sim.leaveFocus(v);
  sim.step(v,1/60);
  sim.focusOn(v,shots[2]);
  sim.rotate(v,42,-35); sim.zoomBy(v,1.25);
  sim.leaveFocus(v);
  for (let i=0;i<150;i++) sim.step(v,1/60);
  sameMatrix(sim.camera(v,850,430).matrix,original);
  assert.equal(sim.cameraMoving(v),false);
  assert.equal(v.lens.subject,null);
});
test('lens easing is time-based and reset during a flight clears its saved view',()=>{
  function sample(rate) {
    const v=sim.createView(); sim.focusOn(v,shots[4]);
    for (let i=0;i<rate/4;i++) sim.step(v,1/rate);
    sim.focusOn(v,shots[0]);
    for (let i=0;i<rate/4;i++) sim.step(v,1/rate);
    return v;
  }
  const a=sample(40), b=sample(120);
  sameMatrix(sim.camera(a,650,455).matrix,sim.camera(b,650,455).matrix);
  sim.leaveFocus(a,true);
  assert.equal(a.auto,true); near(a.yaw,sim.HOME.yaw);
  sim.resetView(b,false,true); sim.leaveFocus(b,true);
  assert.equal(b.lens.overview,null); assert.equal(b.lens.mix,0);
  assert.equal(sim.cameraMoving(b),false);
  sameMatrix(sim.camera(b,320,460).matrix,sim.camera(sim.HOME,320,460).matrix);
});
test('close-up buttons, selection, keyboard and resize use the same camera and restore the saved angle',()=>{
  const p=openPage({reduced:true,compact:true});
  key(p,'ArrowRight'); p.$('zoom-in').click(); ticks(p,100);
  const original=surface(p).u_camera;
  key(p,'6'); key(p,'C'); p.win.tick();
  assert.equal(p.$('lens').getAttribute('aria-pressed'),'true');
  assert.equal(p.$('lens-label').textContent,'Wide view'); assert.ok(!p.$('lens-next').hidden);
  assert.ok(!p.$('field-popover').hidden); assert.equal(p.$('field-title').textContent,'Shop cat');
  p.$('lens-next').click();
  assert.equal(p.$('note-title').textContent,'Counter fan');
  p.$('lens-next').click();
  assert.equal(p.$('note-title').textContent,'Booth radio');
  p.$('lens-next').click();
  assert.equal(p.$('note-title').textContent,'House milk tea');
  p.$('lens-prev').click(); p.$('object-list').children[3].click();
  p.doc.rect.width=320; p.doc.rect.height=470; p.$('stage').resize(); p.win.tick();
  const center=M.project(shots[3].center,surface(p).u_camera,320,470);
  near(center.x,160,.001); near(center.y,235,.001);
  key(p,'c',{repeat:true}); assert.equal(p.$('lens').getAttribute('aria-pressed'),'true');
  p.doc.rect.width=810; p.doc.rect.height=455; p.$('stage').resize();
  p.$('lens').click(); p.win.tick();
  assert.equal(p.$('lens-prev').hidden,true); assert.equal(p.$('field-popover').hidden,true);
  sameMatrix(surface(p).u_camera,original);
  assert.equal(p.$('orbit').getAttribute('aria-pressed'),'false');
  p.$('lens').click(); p.$('reset').click(); p.win.tick();
  assert.equal(p.$('lens').getAttribute('aria-pressed'),'false');
  sameMatrix(surface(p).u_camera,sim.camera(sim.HOME,810,455).matrix);
});
test('requesting reduced motion mid-flight settles the shot and retains a manually paused overview',()=>{
  const p=openPage();
  p.$('orbit').click(); key(p,'4'); key(p,'c'); ticks(p,2);
  p.win.motion.matches=true; p.win.motion.emit('change'); p.win.tick();
  const expected=sim.createView(false); sim.focusOn(expected,shots[3],true);
  sameMatrix(surface(p).u_camera,sim.camera(expected,810,455).matrix);
  assert.equal(p.win.frames.size,0);
  key(p,'c'); p.win.motion.matches=false; p.win.motion.emit('change');
  assert.equal(p.$('orbit').getAttribute('aria-pressed'),'false');
});
