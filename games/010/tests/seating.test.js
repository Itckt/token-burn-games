'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const M=require('../js/math'), sim=require('../js/simulation'), seating=require('../js/seating');
const world=require('../js/world'), mesh=require('../js/mesh'), sightlines=require('../js/sightlines');
const {rasterize}=require('./support/raster');
const {openPage,key,ticks,tap,pointer,surface}=require('./support/page');
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,a+' vs '+b);

test('perspective maps the near and far planes and makes equally sized distant objects smaller',()=>{
  const m=M.perspective(Math.PI/2,2,.1,12);
  near(M.project([0,0,-.1],m,800,400).depth,-1);
  near(M.project([0,0,-12],m,800,400).depth,1);
  near(M.project([2,1,-1],m,800,400).x,800);
  near(M.project([0,1,-1],m,800,400).y,0);
  near(M.project([1,0,-2],m,800,400).x-400,(M.project([1,0,-1],m,800,400).x-400)/2);
  for (const args of [[0,1,.1,3],[Math.PI,1,.1,3],[1,0,.1,3],[1,2,0,3],[1,2,3,3],[1,NaN,1,2],[1,2,1,Infinity]]) {
    assert.throws(()=>M.perspective(...args),RangeError);
  }
});

test('each seat looks at its own table or counter from a fixed eye in portrait and landscape',()=>{
  assert.equal(seating.sit('constructor'),null);
  for (const p of seating.places) {
    const seat=seating.sit(p.id);
    for (const [w,h] of [[270,432],[860,400]]) {
      const camera=seating.camera(seat,w,h), subject=M.project(p.look,camera.matrix,w,h);
      near(subject.x,w/2,.001); near(subject.y,h/2,.001);
      near(M.dot(camera.right,camera.direction),0); assert.ok(subject.depth>0 && subject.depth<1);
    }
    seating.turn(seat,152000,-1e6); sim.zoomBy(seat,10); sim.settle(seat);
    const c=seating.camera(seat,180,340);
    assert.deepEqual(c.eye,p.eye); assert.ok(c.matrix.every(Number.isFinite));
    assert.ok(seat.pitch>0 && seat.pitch<Math.PI/2);
    seating.turn(seat,-12,1e6); sim.settle(seat); assert.ok(seat.pitch<0 && seat.pitch>-Math.PI/2);
  }
});

test('the reference raster clips a triangle crossing the seated eye before perspective division',()=>{
  const m=M.perspective(1.1,1,.1,10);
  function batch(points,indices,id) {
    const vertices=new Float32Array(points.length*mesh.STRIDE);
    points.forEach((p,i)=>{ vertices.set(p,i*mesh.STRIDE); vertices[i*mesh.STRIDE+11]=id; });
    return {vertices,indices};
  }
  const floor=[[-1,-1,-1],[1,-1,-1]], triangle=batch([...floor,[0,1,.2]],[0,1,2],8);
  const manual=batch([...floor,[.25,.5,-.1],[-.25,.5,-.1]],[0,1,2,0,2,3],8);
  const back=batch([[-1,-1,1],[0,1,1],[1,-1,1]],[0,1,2],1);
  const expected=rasterize([manual],m,64,64), actual=rasterize([triangle,back],m,64,64);
  assert.equal(expected.at(32,32),8); assert.deepEqual(actual.ids,expected.ids);
  assert.ok(rasterize([back],m,64,64).ids.every(id=>id===-1));
});

test('looking and zooming at a seat preserves the parked diorama, with working touch and keyboard exits',()=>{
  const p=openPage({reduced:true});
  key(p,'ArrowLeft'); key(p,'+'); ticks(p,100);
  const before=surface(p).u_camera;
  key(p,'v'); key(p,'V',{repeat:true}); key(p,'v',{metaKey:true}); p.win.tick();
  assert.equal(p.$('seat-view').value,'booth'); assert.ok(p.$('orbit').hidden);
  assert.equal(p.$('turn-hint').textContent,'Drag to look around');
  const initial=surface(p).u_camera, eye=surface(p).u_eye;
  pointer(p,'pointerdown',100,240); pointer(p,'pointerup',160,242);
  key(p,'+'); ticks(p,100);
  assert.notDeepEqual(surface(p).u_camera,initial); assert.deepEqual(surface(p).u_eye,eye);
  p.$('stand-up').focus(); p.$('stand-up').click(); p.win.tick();
  assert.deepEqual(surface(p).u_camera,before); assert.equal(p.doc.activeElement,p.$('scene'));
  for (const id of ['booth','counter','table','']) { key(p,'v'); assert.equal(p.$('seat-view').value,id); }
  p.$('seat-view').value='counter'; p.$('seat-view').emit('change'); p.win.tick();
  assert.deepEqual(surface(p).u_eye,seating.places[1].eye);
  key(p,' '); p.win.tick(); assert.deepEqual(surface(p).u_camera,before);
  assert.equal(p.win.frames.size,0);
});

test('a booth guest can pick the radio at a real projected pixel and photograph it from the same seat',()=>{
  const p=openPage({reduced:true,rasterPick:true,compact:true});
  p.doc.rect.width=324; p.doc.rect.height=450; p.$('stage').resize();
  key(p,'v'); key(p,'w'); p.win.tick();
  const {left,top,width,height}=p.doc.rect, note=world.notes.at(-1);
  const expected=seating.camera(seating.sit('booth'),width,height).matrix;
  const point=M.project(note.closeup.center,expected,width,height);
  tap(p,left+point.x,top+point.y);
  assert.equal(p.$('note-title').textContent,'Booth radio'); assert.ok(!p.$('radio-panel').hidden);
  assert.equal(p.$('field-title').textContent,note.title); assert.equal(p.gl.reads,1);
  key(p,'p');
  assert.deepEqual(surface(p).u_camera,Array.from(expected));
  assert.ok(p.$('postcard-print').paper.texts.includes('WINDOW BOOTH  /  SHOWER'));
  p.$('postcard-close').click(); key(p,'c'); p.win.tick();
  assert.equal(p.$('seat-view').value,''); assert.equal(p.$('lens').getAttribute('aria-pressed'),'true');
  key(p,'v'); p.$('brew-toggle').click(); p.win.tick();
  assert.equal(p.$('seat-view').value,''); assert.equal(p.$('note-title').textContent,'House milk tea');
  assert.equal(p.$('lens-label').textContent,'Wide view');
});

test('seated pins observe furniture between the eye and the subject and cost no GPU readbacks',()=>{
  const scene=world.makeScene(), visible=sightlines.build(scene.batches);
  const seat=seating.sit('table'), bun=world.notes[2], clock=world.notes[3];
  assert.equal(visible(seat.place.eye,bun.closeup.center,bun.id),false);
  assert.equal(visible(seat.place.eye,clock.closeup.center,clock.id),true);
  assert.equal(visible(seating.places[0].eye,bun.closeup.center,bun.id),true);
  assert.equal(sim.exposed([0,1,0],[-1,0,0],1),true);
  const p=openPage({reduced:true});
  p.$('seat-view').value='table'; p.$('seat-view').emit('change'); p.$('pins').click(); p.win.tick();
  const {width,height}=p.doc.rect;
  const image=rasterize(scene.batches,surface(p).u_camera,width,height);
  const shown=p.$('markers').children.flatMap((m,i)=>m.hidden ? [] : [world.notes[i]]);
  assert.ok(shown.length>=3);
  for (const n of shown) {
    const at=M.project(n.seatedAnchor||n.closeup.center,surface(p).u_camera,width,height);
    assert.equal(image.at(at.x,at.y),n.id,n.title);
  }
  ticks(p,15); assert.equal(p.gl.reads,0); assert.equal(p.win.frames.size,0);
});

test('sight lines pass through clear clock corners, stop at the dial and end at the chosen pin',()=>{
  const batch=new mesh.Batcher();
  batch.add(mesh.panel(2,2),M.identity(),'#ffffff',4,.1,require('../js/art').regions.clock);
  const visible=sightlines.build(batch.finish());
  assert.equal(visible([0,0,1],[0,0,-1],3),false);
  assert.equal(visible([.92,.92,1],[.92,.92,-1],3),true);
  assert.equal(visible([0,0,1],[0,0,.1],3),true);
  assert.equal(visible([0,0,-1],[0,0,.1],4),true);
});

test('the chosen seat survives graphics recovery and reset or close-up restores the right camera controls',()=>{
  const p=openPage({reduced:true});
  key(p,'c'); key(p,'v'); key(p,'v'); p.win.tick();
  assert.ok(p.$('lens-next').hidden); assert.ok(!p.$('stand-up').hidden);
  const before=surface(p).u_camera;
  p.$('seat-view').focus(); p.$('scene').emit('webglcontextlost');
  assert.ok(p.$('seat-view').disabled); assert.equal(p.doc.activeElement,p.$('object-list').children[0]);
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored');
  assert.deepEqual(surface(p).u_camera,before); assert.equal(p.$('seat-view').value,'counter');
  key(p,'Home'); p.win.tick(); assert.equal(p.$('seat-view').value,''); assert.ok(!p.$('orbit').hidden);
  assert.deepEqual(surface(p).u_camera,Array.from(sim.camera(sim.HOME,810,455).matrix));
});
