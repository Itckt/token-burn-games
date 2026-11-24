'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {root,html,scripts,openPage,pointer,tap,ticks,key,surface}=require('./support/page');
const {checkShader,shaderDeclarations}=require('./support/graphics');
const M=require('../js/math'), sim=require('../js/simulation'), world=require('../js/world');
const renderer=require('../js/renderer'), shaders=require('../js/shaders');

function scaleOfView(page) {
  const m=surface(page).u_camera;
  return Math.hypot(m[0],m[4],m[8]);
}
const names=world.notes.map(n=>n.title);

test('the double-click entry point loads each local classic script once and uses only local assets',()=>{
  const files=fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>'js/'+f).sort();
  assert.deepEqual([...scripts].sort(),files);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for (const [,id] of html.matchAll(/<use\b[^>]*href="#([^"]+)"/g)) assert.ok(ids.includes(id));
  for (const [,ref] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (ref.startsWith('#') || ref==='data:,') continue;
    assert.doesNotMatch(ref,/^(?:[a-z]+:|[./]*\/\/)|\.\./i);
    assert.ok(fs.statSync(path.join(root,ref)).isFile());
  }
  for (const script of html.matchAll(/<script\b[^>]+>/g)) {
    assert.match(script[0],/\bdefer\b/); assert.doesNotMatch(script[0],/\b(?:async|module)\b/);
  }
  for (const file of files) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root,'style.css'),'utf8'),/@import|url\(\s*["']?https?:/i);
  assert.match(html,/Drag to orbit/); assert.match(html,/Scroll to zoom/); assert.match(html,/Tap to inspect/);
});
test('shader pairs have balanced GLSL entry points, matched varyings and portable texture access',()=>{
  for (const pair of Object.values(shaders)) {
    checkShader(pair.vertex,false); checkShader(pair.fragment,true);
    const fromVertex=shaderDeclarations(pair.vertex,'varying');
    for (const [name,type] of shaderDeclarations(pair.fragment,'varying')) assert.equal(fromVertex.get(name),type);
    assert.doesNotMatch(pair.fragment,/#version 300|gl_FragDepth|\btexture\(/);
  }
  for (const pass of ['pick','shadow','surface']) assert.match(shaders[pass].fragment,/discard;/);
  assert.match(shaders.pick.fragment,/v_id\s*\/\s*255\.0/);
});
test('all printed signs and eight different illustrations paint with balanced drawing state',()=>{
  const p=openPage();
  assert.deepEqual(p.errors,[]);
  const atlas=p.doc.elements.find(e=>e.tag==='canvas' && e.width===2048);
  assert.ok(atlas); assert.equal(atlas.paper.depth,0);
  assert.ok(atlas.paper.texts.includes('半 刻 茶 餐 廳'));
  assert.ok(atlas.paper.texts.includes('H A L F   P A S T   T E A'));
  assert.ok(atlas.paper.texts.includes('MILK TEA'));
  const index=p.$('object-list');
  assert.equal(index.children.length,8);
  const drawings=new Set();
  for (const c of index.children) {
    const art=c.children[0].paper;
    assert.equal(art.depth,0); assert.ok(art.colors.size>=4);
    drawings.add(JSON.stringify(art.commands));
  }
  assert.equal(drawings.size,index.children.length);
});
test('render passes bake the shadow once and stream only a small steam buffer per frame',()=>{
  const p=openPage();
  assert.deepEqual(p.errors,[]);
  const gl=p.gl,initial=gl.draws.slice();
  assert.deepEqual(initial.map(d=>d.name),['shadow','ground','surface','steam']);
  assert.deepEqual(initial.map(d=>d.blend),[false,true,false,true]);
  assert.deepEqual(initial.map(d=>d.depthWrite),[true,false,true,false]);
  assert.ok(initial[0].target.color.width>=1024); assert.equal(initial[2].target,null);
  const allocated=gl.resources.length,staticUploads=gl.uploads.filter(u=>u.static).length;
  ticks(p,40);
  assert.equal(gl.draws.filter(d=>d.name==='shadow').length,1);
  assert.equal(gl.reads,0); assert.equal(p.win.frames.size,1);
  assert.equal(gl.resources.length,allocated); assert.equal(gl.uploads.filter(u=>u.static).length,staticUploads);
  const dynamic=gl.uploads.filter(u=>!u.static);
  assert.equal(dynamic.length,41); assert.ok(dynamic.every(u=>u.bytes<16384 && u.buf===dynamic[0].buf));
  assert.notEqual(dynamic[0].probe,dynamic.at(-1).probe);
  assert.notDeepEqual(initial[2].matrix,gl.draws.filter(d=>d.name==='surface').at(-1).matrix);
});
test('index, pins and paging keep the bilingual caption, art and selected state in sync',()=>{
  const p=openPage(), cards=p.$('object-list').children, markers=p.$('markers').children;
  assert.equal(p.$('note-title').textContent,names[0]); assert.equal(p.$('note-number').textContent,'01');
  assert.deepEqual(markers.map(m=>m.hidden),names.map((_,i)=>i!==0));
  p.$('previous').click(); assert.equal(p.$('note-title').textContent,names.at(-1));
  p.$('next').click(); assert.equal(p.$('note-title').textContent,names[0]);
  p.$('pins').click(); assert.ok(markers.every(m=>!m.hidden));
  markers[4].click(); assert.equal(p.$('note-title').textContent,'Tea urn');
  for (const [i,note] of world.notes.entries()) {
    cards[i].click();
    assert.equal(p.$('note-title').textContent,note.title);
    assert.equal(p.$('note-chinese').textContent,note.chinese);
    assert.equal(p.$('caption').textContent,'“'+note.caption+'”');
    for (const set of [cards,markers]) {
      assert.equal(set[i].getAttribute('aria-pressed'),'true');
      assert.equal(set.filter(c=>c.getAttribute('aria-pressed')==='true').length,1);
    }
  }
  p.$('pins').click(); assert.equal(markers.filter(m=>!m.hidden).length,1);
});
test('actual model coordinates pick the correct slip through page offsets, fractional DPR and depth',()=>{
  const p=openPage({rasterPick:true,reduced:true,dpr:1.5});
  const {width,height,left,top}=p.doc.rect;
  const camera=sim.camera(sim.createView(false),width,height);
  const samples=[[1.33,1.36,1.79],[-2.86,.98,2.88],[-2.82,1.24,1.39],
    [3.49,2.615,-3.035],[3.27,1.76,-1.97],[3.43,.42,2.68],world.notes[6].anchor,world.notes[7].anchor];
  for (const [i,sample] of samples.entries()) {
    const position=M.project(sample,camera.matrix,width,height);
    tap(p,left+position.x,top+position.y);
    assert.equal(p.$('note-title').textContent,names[i]);
  }
  tap(p,left+1,top+1); assert.equal(p.$('note-title').textContent,names.at(-1));
  assert.equal(p.gl.reads,samples.length+1);
  assert.equal(p.gl.fbo,null);
  assert.deepEqual(p.gl.viewportBox,[0,0,p.gl.drawingBufferWidth,p.gl.drawingBufferHeight]);
});
test('orbit drags, cancellations and lost pointer capture never open a caption',()=>{
  const p=openPage({pickId:4}),s=p.$('scene');
  pointer(p,'pointerdown',230,270); pointer(p,'pointermove',252,279);
  assert.equal(s.dataset.dragging,'true'); assert.equal(p.$('orbit').getAttribute('aria-pressed'),'false');
  pointer(p,'pointerup',252,279); assert.equal(s.dataset.dragging,'false'); assert.equal(p.gl.reads,0);
  pointer(p,'pointerdown',230,270); pointer(p,'pointercancel',230,270); pointer(p,'pointerup',230,270);
  assert.equal(p.gl.reads,0);
  pointer(p,'pointerdown',230,270); s.releasePointerCapture(1); pointer(p,'pointerup',230,270);
  assert.equal(p.gl.reads,0);
  pointer(p,'pointerdown',230,270); pointer(p,'pointermove',231,271); pointer(p,'pointerup',231,271);
  assert.equal(p.gl.reads,1); assert.equal(p.$('note-title').textContent,'Wall clock');
});
test('two-finger pinch changes scale and lifting the second finger never turns a pinch into a tap',()=>{
  const p=openPage({reduced:true}),initial=scaleOfView(p);
  pointer(p,'pointerdown',200,330,1,'touch'); pointer(p,'pointerdown',280,330,2,'touch');
  pointer(p,'pointermove',310,330,2,'touch'); pointer(p,'pointerup',310,330,2,'touch');
  pointer(p,'pointerup',200,330,1,'touch'); ticks(p,25);
  assert.ok(scaleOfView(p)>initial*1.33); assert.equal(p.gl.reads,0);
});
test('slow drags retain the distance traveled before crossing the tap threshold',()=>{
  function drag(increments) {
    const p=openPage({reduced:true});
    const start=surface(p).u_camera;
    pointer(p,'pointerdown',240,300);
    for (const dx of increments) pointer(p,'pointermove',240+dx,300);
    pointer(p,'pointerup',252,300); ticks(p,100);
    assert.equal(p.gl.reads,0); assert.notDeepEqual(surface(p).u_camera,start);
    return surface(p).u_camera;
  }
  const fine=drag([1,2,3,4,5,7,9,12]), coarse=drag([12]);
  assert.ok(fine.every((value,i)=>Math.abs(value-coarse[i])<1e-7));
});
test('a release-only drag turns as far as a streamed drag and cancelling the same movement is inert',()=>{
  function drag(kind) {
    const p=openPage({reduced:true});
    const before=surface(p).u_camera;
    pointer(p,'pointerdown',240,300);
    if (kind==='streamed') pointer(p,'pointermove',271,322);
    pointer(p,kind==='cancelled' ? 'pointercancel' : 'pointerup',271,322);
    ticks(p,100);
    assert.equal(p.gl.reads,0); assert.ok(!p.$('scene').hasPointerCapture(1));
    if (kind==='cancelled') assert.deepEqual(surface(p).u_camera,before);
    else assert.notDeepEqual(surface(p).u_camera,before);
    return surface(p).u_camera;
  }
  assert.deepEqual(drag('release'),drag('streamed')); drag('cancelled');
});
test('the final finger separation counts even when a pinch ends between move events',()=>{
  const p=openPage({reduced:true}), original=scaleOfView(p);
  pointer(p,'pointerdown',200,300,1,'touch'); pointer(p,'pointerdown',260,300,2,'touch');
  pointer(p,'pointerup',290,300,2,'touch'); pointer(p,'pointerup',200,300,1,'touch');
  ticks(p,100);
  assert.ok(Math.abs(scaleOfView(p)/original-1.5)<1e-5);
  assert.equal(p.gl.reads,0); assert.equal(p.$('scene').captures.size,0);
});
test('blur and loss of visibility release both captures and never submit a stale tap',()=>{
  const p=openPage({pickId:6,reduced:true}), canvas=p.$('scene');
  for (const cause of ['blur','hidden']) {
    pointer(p,'pointerdown',200,330,1,'touch'); pointer(p,'pointerdown',280,330,2,'touch');
    if (cause==='blur') p.win.emit('blur');
    else { p.doc.hidden=true; p.doc.emit('visibilitychange'); }
    assert.ok(!canvas.hasPointerCapture(1) && !canvas.hasPointerCapture(2));
    pointer(p,'pointerup',280,330,2,'touch'); pointer(p,'pointerup',200,330,1,'touch');
    assert.equal(p.gl.reads,0); assert.equal(canvas.dataset.dragging,'false');
    p.doc.hidden=false; p.doc.emit('visibilitychange');
  }
  tap(p,240,330); assert.equal(p.gl.reads,1); assert.equal(p.$('note-title').textContent,'Shop cat');
});
test('opening either dialog releases a held pointer and pauses frames without stamping the ticket behind it',()=>{
  const p=openPage({pickId:3}), canvas=p.$('scene');
  p.$('ticket-toggle').click();
  for (const dialog of ['guide','postcard']) {
    pointer(p,'pointerdown',310,300,15); assert.ok(canvas.hasPointerCapture(15));
    if (dialog==='guide') p.$('guide-open').click(); else key(p,'p');
    assert.ok(!canvas.hasPointerCapture(15)); assert.equal(p.win.frames.size,0);
    pointer(p,'pointerup',310,300,15);
    p.$('stage').resize(); key(p,'3'); ticks(p);
    assert.equal(p.gl.reads,0); assert.equal(p.win.frames.size,0);
    assert.match(p.$('service-stamps').getAttribute('aria-label'),/^0 of/);
    assert.equal(p.$('note-title').textContent,'House milk tea');
    p.$(dialog+'-close').click();
    assert.equal(p.win.frames.size,1);
  }
});
test('zoom, keyboard orbit and reset are clamped, reversible and accessible',()=>{
  const p=openPage({reduced:true}),s=p.$('scene'),initial=scaleOfView(p);
  const wheel=s.emit('wheel',{deltaY:-2,deltaMode:1});
  assert.equal(wheel.defaultPrevented,true); ticks(p); assert.ok(scaleOfView(p)>initial);
  for (let i=0;i<30;i++) p.$('zoom-in').click();
  assert.ok(p.$('zoom-in').disabled); assert.ok(!p.$('zoom-out').disabled);
  ticks(p,80); assert.ok(Math.abs(scaleOfView(p)/initial-sim.LIMITS.maxZoom)<.001);
  for (let i=0;i<30;i++) key(p,'-');
  assert.ok(p.$('zoom-out').disabled); assert.ok(!p.$('zoom-in').disabled);
  key(p,' '); assert.equal(p.$('orbit').getAttribute('aria-pressed'),'true');
  key(p,' ',{repeat:true}); assert.equal(p.$('orbit').getAttribute('aria-pressed'),'true');
  key(p,'ArrowRight'); assert.equal(p.$('orbit').getAttribute('aria-pressed'),'false');
  key(p,'ArrowUp'); ticks(p);
  key(p,'4'); assert.equal(p.$('note-title').textContent,'Wall clock');
  const ignored=key(p,'6',{ctrlKey:true}); assert.equal(ignored.defaultPrevented,false);
  assert.equal(p.$('note-title').textContent,'Wall clock');
  key(p,'R'); ticks(p,100);
  assert.ok(Math.abs(scaleOfView(p)/initial-1)<.001);
  assert.equal(p.$('orbit').getAttribute('aria-pressed'),'false');
});
test('hover reads a single pixel on demand and idle animation avoids GPU readbacks',()=>{
  const p=openPage({pickId:3});
  ticks(p,20); assert.equal(p.gl.reads,0);
  for (let i=0;i<20;i++) pointer(p,'pointermove',250+i,307);
  p.win.tick(); assert.equal(p.gl.reads,1); assert.equal(p.$('scene').dataset.hovering,'true');
  assert.equal(p.gl.program.name,'steam');
  p.$('scene').emit('pointerleave'); ticks(p,15);
  assert.equal(p.$('scene').dataset.hovering,'false'); assert.equal(p.gl.reads,1);
});
test('a resting reduced-motion view wakes for hover, pointer exit and resize, then releases its frame',()=>{
  const p=openPage({reduced:true,pickId:5});
  p.win.tick(); assert.equal(p.win.frames.size,0);
  pointer(p,'pointermove',310,300); p.win.tick();
  assert.equal(surface(p).u_hover,5); assert.equal(p.win.frames.size,0);
  p.$('scene').emit('pointerleave'); p.win.tick();
  assert.equal(surface(p).u_hover,-1); assert.equal(p.win.frames.size,0);
  p.doc.rect.width=500; p.$('stage').resize(); p.win.tick();
  assert.deepEqual(p.gl.viewportBox,[0,0,750,682]);
  assert.equal(p.gl.reads,1); assert.equal(p.win.frames.size,0);
});
test('expanded and touch views keep captions in reach and restore focus on exit',()=>{
  const p=openPage({pickId:6});
  p.$('expand').focus(); p.$('expand').click();
  assert.equal(p.$('viewer').getAttribute('aria-modal'),'true');
  assert.equal(p.doc.activeElement,p.$('scene'));
  assert.ok(p.doc.querySelectorAll('.intro, .ticket-wrap, .catalog').every(el=>el.inert));
  tap(p,330,370); assert.equal(p.$('field-popover').hidden,false);
  assert.equal(p.$('field-title').textContent,'Shop cat');
  key(p,'Escape'); assert.equal(p.$('expand').getAttribute('aria-pressed'),'false');
  assert.equal(p.$('field-popover').hidden,true); assert.equal(p.doc.activeElement,p.$('expand'));
  assert.ok(p.doc.querySelectorAll('.intro, .ticket-wrap, .catalog').every(el=>!el.inert));
  p.win.compact.matches=true; tap(p,331,370);
  assert.equal(p.$('field-popover').hidden,false);
  p.$('popover-close').click(); assert.equal(p.$('field-popover').hidden,true);
});
test('resizing updates both the backing store and projection without rebuilding scene geometry',()=>{
  const p=openPage(),count=p.gl.resources.length;
  p.doc.rect.width=342; p.doc.rect.height=310; p.win.devicePixelRatio=2;
  p.$('stage').resize(); p.win.tick();
  assert.deepEqual([p.$('scene').width,p.$('scene').height],[684,620]);
  assert.deepEqual(p.gl.viewportBox,[0,0,684,620]);
  assert.equal(p.gl.resources.length,count);
  assert.ok(p.$('markers').children[0].style.transform.includes('translate('));
});
test('hidden pages suspend animation and reduced motion holds steam and camera still',()=>{
  const p=openPage({reduced:true});
  ticks(p,5);
  const surface=p.gl.draws.filter(d=>d.name==='surface');
  assert.deepEqual(surface[0].matrix,surface.at(-1).matrix);
  const probes=p.gl.uploads.filter(u=>!u.static).map(u=>u.probe); assert.equal(new Set(probes).size,1);
  p.doc.hidden=true; p.doc.emit('visibilitychange'); assert.equal(p.win.frames.size,0);
  const count=p.gl.draws.length; p.win.tick(90000); assert.equal(p.gl.draws.length,count);
  p.doc.hidden=false; p.doc.emit('visibilitychange'); assert.equal(p.win.frames.size,1);
  p.win.motion.matches=false; p.win.motion.emit('change'); ticks(p,5);
  assert.equal(p.$('orbit').getAttribute('aria-pressed'),'true');
  assert.notEqual(probes[0],p.gl.uploads.at(-1).probe);
});
test('a missing WebGL context leaves a readable fallback and eight fully usable slips',()=>{
  const p=openPage({noWebGL:true});
  assert.equal(p.$('scene-error').hidden,false); assert.match(p.$('error-title').textContent,/WebGL is unavailable/);
  assert.match(p.$('error-copy').textContent,/hardware acceleration/);
  assert.equal(p.win.frames.size,0);
  for (const id of ['orbit','pins','expand','zoom-in','zoom-out','reset']) assert.ok(p.$(id).disabled);
  assert.ok(p.$('markers').children.every(m=>m.hidden));
  p.$('object-list').children[5].click(); assert.equal(p.$('note-title').textContent,'Shop cat');
  p.$('next').click(); assert.equal(p.$('note-title').textContent,'Counter fan');
  p.$('next').click(); assert.equal(p.$('note-title').textContent,'Booth radio');
  p.$('next').click(); assert.equal(p.$('note-title').textContent,'House milk tea');
  p.$('guide-open').click(); assert.ok(p.$('guide').open);
  p.$('guide-close').click(); assert.equal(p.$('guide').open,false); assert.equal(p.doc.activeElement,p.$('guide-open'));
});
test('context loss cancels frames and rebuilding the GPU resources preserves the selected slip',()=>{
  const p=openPage(); p.$('object-list').children[2].click(); p.$('expand').click();
  const event=p.$('scene').emit('webglcontextlost');
  assert.equal(event.defaultPrevented,true); assert.equal(p.win.frames.size,0);
  assert.equal(p.$('scene-error').hidden,false); assert.equal(p.$('expand').getAttribute('aria-pressed'),'false');
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored');
  assert.deepEqual(p.errors,[]); assert.equal(p.$('scene-error').hidden,true); assert.equal(p.win.frames.size,1);
  assert.equal(p.$('note-title').textContent,'Pineapple bun'); assert.ok(!p.$('orbit').disabled);
  assert.deepEqual(p.doc.gl.draws.map(d=>d.name),['shadow','ground','surface','steam']);
});
test('small texture limits downsample the atlas and all allocation failures have a clean fallback',()=>{
  const small=openPage({maxTexture:1024});
  assert.deepEqual(small.errors,[]);
  const textures=small.gl.resources.filter(r=>r.kind==='texture');
  assert.ok(textures.every(t=>t.width<=1024));
  assert.equal(textures.find(t=>t.mipmap).width,1024);
  for (const options of [{failCompile:true},{failLink:true},{incomplete:true}]) {
    const p=openPage(options);
    assert.equal(p.errors.length,1); assert.equal(p.$('scene-error').hidden,false);
    assert.match(p.$('error-title').textContent,/could not start/); assert.equal(p.win.frames.size,0);
    assert.ok(p.gl.resources.length>0 && p.gl.resources.every(r=>r.deleted));
    p.$('next').click(); assert.equal(p.$('note-title').textContent,'Window booth');
  }
});
test('explicit renderer disposal releases every owned program, texture, buffer and target exactly once',()=>{
  const p=openPage({noWebGL:true});
  p.doc.options.noWebGL=false;
  const gl=p.$('scene').getContext('webgl');
  const engine=renderer.createRenderer(gl,world.makeScene(),p.context.PocketPlaces.art.makeAtlas());
  assert.ok(gl.resources.every(r=>!r.deleted)); engine.dispose(); engine.dispose();
  assert.ok(gl.resources.every(r=>r.deleted));
});
