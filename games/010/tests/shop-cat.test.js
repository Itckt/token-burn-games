'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const cat=require('../js/shop-cat'), M=require('../js/math'), sim=require('../js/simulation');
const world=require('../js/world'), {parts,STRIDE}=require('../js/mesh');
const {openPage,key,ticks,surface,tap}=require('./support/page');
const {rasterize}=require('./support/raster');
const {createRenderer}=require('../js/renderer'), fan=require('../js/fan'), tea=require('../js/tea');
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,a+' vs '+b);

test('the walk is time based through departure, footfalls and arrival at 30 and 120 fps',()=>{
  const a=cat.create(), b=cat.create(); cat.call(a,'booth'); cat.call(b,'booth');
  let walked=false;
  for (let i=0;i<270;i++) {
    cat.step(a,1/30);
    for (let j=0;j<4;j++) cat.step(b,1/120);
    for (const k of ['x','z','s','yaw','lift','stride']) near(a[k],b[k]);
    walked ||= Math.abs(a.stride)>.03 && a.lift>.02;
    // Keep clear of the counter stools, tea-table stools and window benches.
    assert.ok(a.x> -1.21 && a.x<4.04 && a.z>-.45 && a.z<2.95);
    for (const [x,z] of [[-.13,-.865],[1.47,-.865],[3.09,-.865],[1.76,.35],[1.20,2.75]]) {
      assert.ok(Math.hypot(a.x-x,a.z-z)>.56);
    }
  }
  assert.ok(walked); assert.equal(a.trip,null); assert.equal(a.destination.id,'booth');
  assert.equal(a.lift,0); assert.equal(a.stride,0);
  cat.call(a,'mat'); cat.step(a,90); assert.deepEqual(a,cat.create());
});

test('calling again from a turn or mid-stride preserves the current pose and ignores invalid or repeated calls',()=>{
  for (const elapsed of [.18,2.2,5.62]) {
    const pet=cat.create(); cat.call(pet,'booth'); cat.step(pet,elapsed);
    const originalTrip=pet.trip;
    cat.call(pet,'booth'); cat.call(pet,'constructor');
    for (const dt of [0,-1,Infinity,NaN]) cat.step(pet,dt);
    assert.equal(pet.trip,originalTrip); near(pet.trip.elapsed,elapsed);
    const pose=()=>[pet.x,pet.z,pet.yaw,pet.lift,pet.stride];
    const before=pose(); cat.call(pet,'mat');
    assert.deepEqual(pose(),before); cat.step(pet,.001);
    assert.ok(Math.hypot(pet.x-before[0],pet.z-before[1])<=.00136);
    cat.call(pet,'counter',true); assert.equal(pet.trip,null);
    assert.equal(pet.destination.id,'counter'); assert.equal(pet.yaw,pet.destination.yaw);
    cat.call(pet,'mat',true); assert.deepEqual(pet,cat.create());
  }
});

test('both mirrored ears face outward, the rug stays on the floor, and the four paws have diagonal stride tags',()=>{
  const ears=[];
  cat.build({group:(x,y,z,yaw,id,fn)=>fn(),oval(){},pipe(){},put:shape=>ears.push(shape)});
  assert.equal(ears.length,2);
  for (const {positions:p,normals:n} of ears) {
    const center=[0,1,2].map(axis=>p.filter((_,i)=>i%3===axis).reduce((a,b)=>a+b,0)/12);
    for (let i=0;i<p.length;i+=9) assert.ok(M.dot(n.slice(i,i+3),M.sub(p.slice(i,i+3),center))>0);
  }
  const found=new Set();
  for (const {vertices:v} of world.makeScene().batches) for (let i=0;i<v.length;i+=STRIDE) {
    if (v[i+11]===cat.id) {
      assert.ok([parts.catBody,parts.catLeft,parts.catRight].includes(v[i+13]));
      found.add(v[i+13]);
    }
    if (v[i+1]<.118 && v[i+1]>.05 && Math.hypot(v[i]-cat.home[0],v[i+2]-cat.home[1])<.48 && !v[i+13]) {
      assert.equal(v[i+11],0); found.add('mat');
    }
  }
  assert.equal(found.size,4);
});

test('each resting spot has a depth-tested cat at its actual pin and the center of its close-up',()=>{
  const scene=world.makeScene(), note=world.notes.find(n=>n.id===cat.id), pet=cat.create();
  for (const [w,h] of [[280,360],[420,264]]) for (const stop of cat.stops) {
    cat.call(pet,stop.id,true);
    const shot={...note.closeup,center:cat.point(pet,note.closeup.center)},view=sim.createView(false);
    sim.focusOn(view,shot,true);
    const camera=sim.camera(view,w,h), a=pet.yaw-cat.homeYaw;
    const pose={u_rotor:[1,0],u_liquid:[1,0],u_catPose:[pet.x,pet.z,Math.cos(a),Math.sin(a)],u_walk:[0,0]};
    const image=rasterize(scene.batches,camera.matrix,w,h,pose);
    const pin=M.project(cat.point(pet,note.anchor),camera.matrix,w,h);
    assert.equal(image.at(pin.x,pin.y),cat.id); assert.equal(image.at(w/2,h/2),cat.id);
    assert.ok(image.ids.filter(id=>id===cat.id).length>w*h*.065);
  }
});

test('a reduced-motion call repositions the cat, its pin, caption and close-up in a single frame',()=>{
  const p=openPage({reduced:true,rasterPick:true,compact:true}), markers=p.$('markers').children;
  key(p,'6'); key(p,'c'); p.win.tick();
  const before=surface(p).u_camera;
  const buttons=p.$('cat-stops').children;
  buttons[2].click(); p.win.tick(); assert.equal(p.win.frames.size,0);
  assert.match(p.$('cat-status').textContent,/window regular/);
  assert.equal(buttons[2].getAttribute('aria-pressed'),'true');
  assert.deepEqual(surface(p).u_walk,[0,0]); assert.notDeepEqual(surface(p).u_camera,before);
  const m=markers[5]; assert.ok(!m.hidden);
  const [,x,y]=m.style.transform.match(/translate\((-?\d+)px,(-?\d+)px\)/);
  key(p,'c'); p.win.tick(); key(p,'6'); key(p,'c'); p.win.tick();
  p.$('popover-close').click(); assert.ok(p.$('field-popover').hidden);
  tap(p,p.doc.rect.left+Number(x)+8,p.doc.rect.top+Number(y)+40);
  assert.equal(p.$('field-title').textContent,'Shop cat'); assert.ok(!p.$('field-popover').hidden);
  assert.equal(p.gl.resources.find(r=>r.name==='pick').uniforms.u_catPose[0],surface(p).u_catPose[0]);
  buttons[0].click(); p.win.tick(); assert.deepEqual(surface(p).u_camera,before);
  assert.equal(p.gl.draws.filter(d=>d.name==='shadow').length,1);
});

test('a walk freezes when hidden, can be redirected, and settles immediately when reduced motion is enabled',()=>{
  const p=openPage(); key(p,'6');
  p.$('cat-stops').children[2].click(); ticks(p,96);
  assert.match(p.$('cat-status').textContent,/On the way/);
  const before=surface(p).u_catPose, uploads=p.gl.uploads.filter(u=>u.static).length;
  assert.notEqual(before[0],cat.home[0]);
  p.doc.hidden=true; p.doc.emit('visibilitychange'); p.win.tick(60000);
  p.doc.hidden=false; p.doc.emit('visibilitychange'); p.win.tick();
  assert.deepEqual(surface(p).u_catPose,before);
  p.$('cat-stops').children[1].click();
  p.win.motion.matches=true; p.win.motion.emit('change'); p.win.tick();
  const expected=cat.create(); cat.call(expected,'counter',true);
  near(surface(p).u_catPose[0],expected.x); near(surface(p).u_catPose[1],expected.z);
  assert.equal(p.win.frames.size,0); assert.equal(p.gl.uploads.filter(u=>u.static).length,uploads);
  assert.doesNotMatch(p.$('cat-status').textContent,/On the way/);
});

test('picking a walking cat uses the last displayed body and paw pose even after the next call was queued',()=>{
  const p=openPage({noWebGL:true,rasterPick:true});
  p.doc.options.noWebGL=false;
  const canvas=p.$('scene'); canvas.width=380; canvas.height=260;
  const gl=canvas.getContext('webgl'), scene=world.makeScene();
  const renderer=createRenderer(gl,scene,p.context.PocketPlaces.art.makeAtlas());
  const pet=cat.create(),room={fan:fan.create(),drink:tea.appearance(),pouredAt:-Infinity,cat:pet};
  cat.call(pet,'booth'); cat.step(pet,2.1); assert.ok(pet.lift>0 && Math.abs(pet.stride)>.005);
  const view=sim.createView(false), note=world.notes[5];
  sim.focusOn(view,{...note.closeup,center:cat.point(pet,note.closeup.center)},true);
  const camera=sim.camera(view,380,260), pin=M.project(cat.point(pet,note.anchor),camera.matrix,380,260);
  const pick=()=>renderer.pick(camera,Math.floor(pin.x),259-Math.floor(pin.y));
  renderer.draw(camera,2.1,0,undefined,room); assert.equal(pick(),6);
  const uniforms=gl.resources.find(r=>r.name==='pick').uniforms, stride=[...uniforms.u_walk];
  cat.call(pet,'mat',true);
  assert.equal(pick(),6); assert.deepEqual(uniforms.u_walk,stride);
  renderer.draw(camera,2.2,0,undefined,room); assert.notEqual(pick(),6);
  assert.deepEqual(uniforms.u_walk,[0,0]); renderer.dispose();
});

test('the illustrated cat answers calls during graphics loss and reappears at that spot on recovery',()=>{
  const p=openPage({reduced:true}); key(p,'6');
  p.$('scene').emit('webglcontextlost');
  p.$('cat-stops').children[2].click(); assert.match(p.$('cat-status').textContent,/window regular/);
  p.$('object-list').children[0].click(); assert.ok(p.$('cat-panel').hidden);
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored');
  const model=cat.create(); cat.call(model,'booth',true);
  near(surface(p).u_catPose[0],model.x); near(surface(p).u_catPose[1],model.z);
  assert.deepEqual(p.errors,[]); assert.equal(p.$('note-title').textContent,'House milk tea');
});
