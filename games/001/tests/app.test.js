'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {page, html, scripts, root} = require('./support/page.js');
const {places,bounds} = require('../src/campus.js');
const {layout,project} = require('../src/map.js');
const {PREFIX,REACH} = require('../src/notebook.js');
const {running,advance,groundPosition,selectInGuide,walkToCue} = require('./support/walk.js');

test('the file entry point references every script in the folder and resolves all local assets and icons', () => {
  const files=fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js')).map(f=>'src/'+f);
  assert.deepEqual([...scripts].sort(),files.sort());
  assert.doesNotMatch(html,/<script[^>]*\btype=['"]module/);
  assert.match(html,/connect-src 'none'/);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  for (const [,ref] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (ref.startsWith('data:')) continue;
    if (ref.startsWith('#')) { assert.ok(ids.includes(ref.slice(1)),ref); continue; }
    assert.doesNotMatch(ref,/^(?:[\w+.-]+:|\/)|\.\./);
    assert.ok(fs.statSync(path.join(root,ref)).isFile());
  }
  for (const file of scripts) {
    const code=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(code,/\b(?:fetch|importScripts|sendBeacon|import)\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest|EventSource|Worker)\b/);
    for (const [,required] of code.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)) assert.match(required,/^\.\//);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root,'style.css'),'utf8'),/@import|url\(\s*['"]?(?:https?:|\/\/)/);
});

test('deferred classic scripts boot from markup, render immediately and sleep when the view is still', () => {
  const h=running({dpr:1.5});
  assert.equal(h.id('place-title').textContent,'Banyan Court');
  assert.equal(h.id('place-index').textContent,'01 / 07');
  assert.equal(h.id('bearing').textContent,'002°');
  assert.equal(h.id('day').getAttribute('aria-pressed'),'true');
  assert.equal(h.id('mini-map').pen.counts.drawImage,1);
  assert.equal(h.gl.draws.length,4);
  h.tick(3000);
  assert.equal(h.gl.draws.length,4);
  assert.equal(h.frames.size,0);
  h.canvas.clientWidth=800; h.canvas.clientHeight=500;
  h.win.emit('resize'); h.settle();
  assert.equal(h.canvas.width,1200);
  assert.equal(h.canvas.height,750);
  assert.equal(h.gl.draws.length,7);
});

test('Enter captures the mouse, movement follows the new heading, and releasing capture stops held keys', () => {
  const h=running(), initial=groundPosition(h);
  h.key('Enter',{key:'Enter'});
  assert.equal(h.doc.pointerLockElement,h.canvas);
  assert.equal(h.id('walk-label').textContent,'Stop walking');
  h.doc.emit('mousemove',{movementX:130,movementY:-15});
  h.key('KeyW'); h.key('ShiftLeft'); advance(h,60);
  const [x,z]=groundPosition(h);
  assert.ok(x>initial[0]+1 && z<initial[1]-4.5);
  assert.ok(parseInt(h.id('bearing').textContent,10)>15);
  assert.ok(h.uniform('uForward')[1]>0.1);
  h.doc.exitPointerLock();
  h.settle();
  assert.equal(h.id('walk-label').textContent,'Start walking');
  assert.deepEqual(groundPosition(h),[x,z]);
  const heading=h.uniform('uForward');
  h.doc.emit('mousemove',{movementX:200,movementY:100});
  h.tick();
  assert.deepEqual(h.uniform('uForward'),heading);
});

test('both light buttons and the N shortcut update the sky, lamps and location note without moving the visitor', () => {
  const h=running(), here=groundPosition(h);
  h.key('KeyN'); h.tick();
  assert.equal(h.id('night').getAttribute('aria-pressed'),'true');
  assert.ok(h.doc.body.classList.has('night'));
  assert.ok(h.uniform('uNight')[0]>0 && h.uniform('uNight')[0]<1);
  h.key('KeyN',{repeat:true}); h.settle();
  assert.equal(h.uniform('uNight')[0],1);
  assert.match(h.id('place-note').textContent,/lamplight/);
  h.id('day').emit('click'); h.settle();
  assert.equal(h.uniform('uNight')[0],0);
  h.id('night').emit('click'); h.settle();
  assert.equal(h.uniform('uNight')[0],1);
  assert.deepEqual(groundPosition(h),here);
});

test('guide buttons and map clicks select the same landmarks, travel positions the visitor, and reset retains time of day', () => {
  const h=running({reduced:true});
  h.id('night').emit('click'); h.tick();
  assert.equal(h.uniform('uNight')[0],1);
  h.id('mini-map-button').emit('click');
  const guide=h.id('guide-dialog'), list=guide.querySelector('.guide-list');
  assert.ok(guide.open);
  assert.equal(list.children.length,places.length);
  list.children[2].emit('click');
  assert.equal(h.id('selected-name').textContent,places[2].name);
  const sheet=h.id('guide-map'), plan=layout(bounds,sheet.clientWidth,sheet.clientHeight);
  const [x,y]=project(plan,...places[4].point);
  sheet.emit('click',{clientX:sheet.left+x,clientY:sheet.top+y});
  assert.equal(list.children[4].getAttribute('aria-pressed'),'true');
  assert.equal(h.id('selected-note').textContent,places[4].guide);
  sheet.emit('click',{clientX:sheet.left,clientY:sheet.top});
  assert.equal(h.id('selected-name').textContent,places[4].name);
  h.id('travel').emit('click'); h.settle();
  assert.equal(guide.open,false);
  assert.deepEqual(groundPosition(h),places[4].view.slice(0,2));
  assert.equal(h.id('place-title').textContent,places[4].name);
  assert.equal(h.id('place-index').textContent,'05 / 07');
  h.doc.exitPointerLock();
  h.id('reset').emit('click'); h.settle();
  assert.deepEqual(groundPosition(h),places[0].view.slice(0,2));
  assert.equal(h.id('place-title').textContent,places[0].name);
  assert.equal(h.uniform('uNight')[0],1);
});

test('guide and help release the mouse, suspend movement and handle shortcuts and backdrop dismissal', () => {
  const h=running();
  h.id('walk').emit('click'); h.key('KeyW'); advance(h,10);
  const p=groundPosition(h);
  h.key('KeyM'); h.settle();
  assert.ok(h.id('guide-dialog').open);
  assert.equal(h.doc.pointerLockElement,null);
  h.key('KeyW'); h.key('KeyN'); advance(h,15);
  assert.deepEqual(groundPosition(h),p);
  assert.equal(h.uniform('uNight')[0],0);
  h.key('Escape');
  assert.equal(h.id('guide-dialog').open,false);
  h.id('guide').emit('click'); h.key('KeyM');
  assert.equal(h.id('guide-dialog').open,false);
  h.key('Slash',{key:'?'});
  const help=h.id('help-dialog');
  assert.ok(help.open);
  help.emit('click',{clientX:20,clientY:20});
  assert.ok(help.open);
  help.emit('click',{clientX:-10,clientY:20});
  assert.equal(help.open,false);
  h.id('help').emit('click'); help.querySelector('.close-button').emit('click');
  assert.equal(help.open,false);
  const native=h.key('Enter',{key:'Enter',target:h.id('day')});
  assert.equal(native.defaultPrevented,false);
  assert.equal(h.doc.pointerLockElement,null);
});

test('when pointer lock is denied, dragging and arrow keys can still turn through the scene', async () => {
  const h=running({lock:'deny'});
  h.id('walk').emit('click'); await Promise.resolve();
  assert.match(h.id('toast').textContent,/Drag/);
  assert.equal(h.doc.pointerLockElement,null);
  h.canvas.emit('pointerdown',{button:0,pointerId:7,clientX:200,clientY:80});
  h.canvas.emit('pointermove',{pointerId:7,clientX:320,clientY:64});
  h.canvas.emit('pointercancel',{pointerId:7});
  h.settle();
  assert.ok(parseInt(h.id('bearing').textContent,10)>20);
  assert.equal(h.canvas.hasPointerCapture(7),false);
  const before=h.uniform('uForward');
  h.canvas.emit('pointermove',{pointerId:7,clientX:600,clientY:70});
  h.tick(); assert.deepEqual(h.uniform('uForward'),before);
  h.key('ArrowUp'); advance(h,15); h.up('ArrowUp'); h.settle();
  assert.ok(h.uniform('uForward')[1]>before[1]+0.15);
  h.key('Escape'); h.settle();
  assert.ok(!h.doc.body.classList.has('is-walking'));
});

test('touch walking can hold a direction and drag with another finger, including overlapping physical keys', () => {
  const h=running({coarse:true,reduced:true}), initial=groundPosition(h);
  h.id('walk').emit('click');
  assert.equal(h.locks,0);
  const pad=h.id('touch-pad').querySelectorAll('button').find(b=>b.dataset.key==='KeyW');
  h.key('KeyW'); pad.emit('pointerdown',{pointerId:3}); h.up('KeyW');
  h.canvas.emit('pointerdown',{button:0,pointerId:4,clientX:40,clientY:40});
  h.canvas.emit('pointermove',{pointerId:4,pointerType:'touch',clientX:125,clientY:35});
  advance(h,35);
  const [x,z]=groundPosition(h);
  assert.ok(x>initial[0]+0.4 && z<initial[1]-1);
  pad.emit('pointercancel',{pointerId:3}); h.canvas.emit('pointerup',{pointerId:4});
  h.settle();
  assert.equal(h.frames.size,0);
  h.id('walk').emit('click'); assert.ok(!h.doc.body.classList.has('is-walking'));
});

test('visibility loss cancels the animation and a restored tab does not replay unobserved walking time', () => {
  const h=running();
  h.key('Enter',{key:'Enter'}); h.key('KeyA'); advance(h,12);
  const here=groundPosition(h);
  h.doc.hidden=true; h.doc.emit('visibilitychange');
  assert.equal(h.frames.size,0);
  assert.equal(h.doc.pointerLockElement,null);
  h.tick(120000);
  h.doc.hidden=false; h.doc.emit('visibilitychange'); h.settle();
  assert.deepEqual(groundPosition(h),here);
  h.key('KeyD'); advance(h,4); h.win.emit('blur'); h.settle();
  assert.equal(h.frames.size,0);
});

test('a late mouse capture cannot trap the user after opening the field guide', () => {
  const h=running({lock:'pending'});
  h.id('walk').emit('click');
  h.key('KeyM');
  h.doc.pointerLockElement=h.canvas;
  h.doc.emit('pointerlockchange');
  assert.ok(h.id('guide-dialog').open);
  assert.equal(h.doc.pointerLockElement,null);
  assert.ok(!h.doc.body.classList.has('is-walking'));
});

test('missing WebGL displays actionable help, keeps controls usable and permits a successful retry', () => {
  const options={webgl:false}, h=page(options).boot();
  assert.equal(h.id('unavailable').hidden,false);
  assert.match(h.id('error-title').textContent,/WebGL is unavailable/);
  assert.match(h.id('error-message').textContent,/graphics acceleration/);
  assert.ok(h.id('walk').disabled);
  assert.equal(h.gl.buffers.length,0);
  assert.equal(h.frames.size,0);
  h.id('help').emit('click'); assert.ok(h.id('help-dialog').open);
  h.key('Escape');
  options.webgl=true; h.id('retry').emit('click'); h.settle();
  assert.ok(h.id('unavailable').hidden);
  assert.equal(h.id('walk').disabled,false);
  assert.ok(h.gl.draws.length>=4);
});

test('a shader initialization error gets a visible message and can be retried', () => {
  const options={compileFailure:true}, h=page(options).boot();
  assert.equal(h.id('unavailable').hidden,false);
  assert.equal(h.errors.length,1);
  assert.match(h.id('error-title').textContent,/could not start/);
  assert.equal(h.frames.size,0);
  options.compileFailure=false;
  h.id('retry').emit('click'); h.settle();
  assert.ok(h.id('unavailable').hidden);
  assert.deepEqual(groundPosition(h),places[0].view.slice(0,2));
});

test('restoring a lost WebGL context rebuilds buffers and resumes at the same place and time of day', () => {
  const h=running({reduced:true});
  h.key('KeyN'); h.key('KeyD'); advance(h,20);
  const here=groundPosition(h), uploads=h.gl.uploads.length;
  h.gl.lost=true;
  const e=h.canvas.emit('webglcontextlost');
  assert.ok(e.defaultPrevented);
  assert.equal(h.id('unavailable').hidden,false);
  assert.equal(h.id('retry').hidden,true);
  assert.equal(h.frames.size,0);
  h.gl.lost=false; h.canvas.emit('webglcontextrestored'); h.settle();
  assert.ok(h.id('unavailable').hidden);
  assert.ok(h.gl.uploads.length>uploads);
  assert.deepEqual(groundPosition(h),here);
  assert.equal(h.uniform('uNight')[0],1);
});

function startRoute(h, place) {
  selectInGuide(h,place);
  assert.equal(h.id('route-action').textContent,'Route to press');
  assert.match(h.id('route-distance').textContent,/^\d+ m$/);
  h.id('follow-route').emit('click');
  h.tick();
  assert.ok(!h.id('guide-dialog').open && !h.id('route-card').hidden);
  assert.equal(h.id('route-name').textContent, place.name);
}
function followOnFoot(h, place) {
  startRoute(h,place);
  walkToCue(h,()=>h.id('route-card').hidden);
  assert.equal(h.id('route-card').hidden,true,place.name+' arrived');
  const [x,z]=groundPosition(h);
  assert.ok(Math.hypot(x-place.stamp.at[0],z-place.stamp.at[1])<=REACH,place.name+' press within reach');
  assert.equal(h.id('stamp').hidden,false);
}

test('walking all seven directions, stamping by key, button and field guide, and reopening the complete notebook', () => {
  const storage=new Map(), h=running({storage,reduced:true});
  h.key('KeyE');
  assert.equal(h.id('stamp-count').textContent,'0 of 7 stamps');
  h.id('weather').emit('click'); h.settle();
  for (const [i,place] of places.entries()) {
    followOnFoot(h,place);
    if (place.id==='court') assert.equal(h.id('cover').hidden,true);
    if (place.id==='arcade' || place.id==='garden') assert.equal(h.id('cover').hidden,false);
    if (place.id==='terrace') {
      assert.ok(h.id('cover').hidden);
      assert.equal(h.uniform('uEye')[1],require('../src/simulation.js').EYE+place.stamp.floor);
    }
    if (i===1) h.id('stamp').emit('click');
    else if (i===2) {
      selectInGuide(h,place);
      assert.equal(h.id('route-action').textContent,'Stamp notebook');
      h.key('KeyE'); // Scene shortcuts are suspended inside a dialog.
      assert.equal(h.id('stamp-count').textContent,'2 of 7 stamps');
      h.id('follow-route').emit('click');
      assert.equal(h.id('route-action').textContent,'Stamp collected');
      assert.equal(h.id('follow-route').disabled,true);
      h.key('Escape');
    } else h.key('KeyE');
    h.key('KeyE',{repeat:true}); h.key('KeyE'); h.settle();
    assert.equal(h.id('stamp-count').textContent,(i+1)+' of 7 stamps');
    assert.equal(h.id('stamp').hidden,true);
    const entry=selectInGuide(h,place);
    assert.equal(entry.dataset.stamped,'true');
    assert.equal(h.id('stamp-title').textContent,place.stamp.title);
    assert.equal(h.id('field-note').textContent,place.stamp.note);
    h.key('Escape'); h.settle();
  }
  assert.match(h.id('toast').textContent,/Notebook complete/);
  const reopened=running({storage});
  assert.equal(reopened.id('stamp-count').textContent,'7 of 7 stamps');
  selectInGuide(reopened,places[3]);
  assert.equal(reopened.id('field-note').textContent,places[3].stamp.note);
  assert.deepEqual(groundPosition(reopened),places[0].view.slice(0,2));
});

test('a route can be reviewed, replaced, cancelled or cleared by changing viewpoint', () => {
  const h=running(), here=groundPosition(h);
  startRoute(h,places[4]);
  assert.deepEqual(groundPosition(h),here);
  assert.match(h.id('route-cue').textContent,/m to press/);
  h.key('KeyM');
  assert.equal(h.id('selected-name').textContent,places[4].name);
  assert.equal(h.id('route-action').textContent,'End route');
  selectInGuide(h,places[1]);
  h.key('Escape'); h.settle();
  assert.equal(h.id('route-name').textContent,places[4].name);
  startRoute(h,places[1]);
  h.key('KeyX'); h.settle();
  assert.ok(h.id('route-card').hidden);
  startRoute(h,places[2]);
  h.key('Escape'); h.id('end-route').emit('click'); h.settle();
  assert.ok(h.id('route-card').hidden);
  startRoute(h,places[3]);
  selectInGuide(h,places[3]); h.id('follow-route').emit('click');
  assert.ok(h.id('route-card').hidden && h.id('guide-dialog').open);
  assert.equal(h.id('route-action').textContent,'Route to press');
  startRoute(h,places[4]);
  selectInGuide(h,places[2]); h.id('travel').emit('click'); h.settle();
  assert.ok(h.id('route-card').hidden);
  assert.deepEqual(groundPosition(h),places[2].view.slice(0,2));
  startRoute(h,places[0]); h.key('Escape');
  h.id('reset').emit('click'); h.settle();
  assert.ok(h.id('route-card').hidden);
  assert.deepEqual(groundPosition(h),here);
});

test('blocked file storage keeps the notebook usable across reset and graphics restoration', () => {
  const h=running({denyStorage:true,reduced:true});
  followOnFoot(h,places[0]);
  h.id('stamp').emit('click'); h.settle();
  assert.equal(h.id('stamp-count').textContent,'1 of 7 stamps · this visit');
  h.key('KeyR'); h.key('KeyN'); h.settle();
  startRoute(h,places[4]); h.key('KeyW'); advance(h,12);
  const pos=groundPosition(h);
  h.gl.lost=true; h.canvas.emit('webglcontextlost');
  assert.ok(h.id('weather').disabled);
  h.key('KeyX'); h.key('KeyR'); h.key('KeyN');
  h.gl.lost=false; h.canvas.emit('webglcontextrestored'); h.settle();
  assert.deepEqual(groundPosition(h),pos);
  assert.equal(h.uniform('uWet')[0],1);
  assert.equal(h.uniform('uNight')[0],1);
  assert.ok(!h.id('route-card').hidden && !h.id('weather').disabled);
  assert.equal(h.id('route-name').textContent,places[4].name);
  h.id('reset').emit('click'); h.settle();
  const entry=selectInGuide(h,places[0]);
  assert.equal(entry.dataset.stamped,'true');
  assert.equal(h.id('field-note').textContent,places[0].stamp.note);
  assert.equal(h.errors.length,0);
});

test('a saved impression arriving from another walk updates the open guide and preserves its selection', () => {
  const storage=new Map(), h=running({storage});
  const entry=selectInGuide(h,places[3]);
  storage.set(PREFIX+'arcade','1');
  h.win.emit('storage',{key:'unrelated'});
  assert.equal(entry.dataset.stamped,'false');
  h.win.emit('storage',{key:PREFIX+'arcade'});
  assert.equal(entry.dataset.stamped,'true');
  assert.equal(h.id('stamp-count').textContent,'1 of 7 stamps');
  assert.equal(h.id('selected-name').textContent,places[3].name);
  assert.equal(h.id('field-note').textContent,places[3].stamp.note);
  storage.clear();
  h.win.emit('storage',{key:null});
  assert.equal(entry.dataset.stamped,'false');
  assert.equal(h.id('stamp-count').textContent,'0 of 7 stamps');
  assert.equal(h.id('selected-name').textContent,places[3].name);
});

test('weather animates independently of the maps, freezes behind a guide or hidden tab, and respects live motion preferences', () => {
  const h=running(), position=groundPosition(h), labelProgram=h.gl.draws.at(-1).program;
  h.id('weather').emit('click'); h.tick();
  assert.equal(h.id('weather').getAttribute('aria-pressed'),'true');
  assert.ok(h.uniform('uWet')[0]>0 && h.uniform('uWet')[0]<1);
  assert.equal(h.id('place-note').textContent,places[0].showerNote);
  h.key('KeyR',{repeat:true}); advance(h,150);
  assert.equal(h.uniform('uWet')[0],1);
  assert.equal(h.frames.size,1);
  const draws=h.gl.draws.length, maps=h.id('mini-map').pen.counts.drawImage;
  advance(h,30);
  assert.equal(h.gl.draws.length-draws,120);
  assert.equal(h.id('mini-map').pen.counts.drawImage,maps);
  h.key('KeyM'); h.settle();
  const frozen=h.uniform('uTime')[0];
  h.key('KeyR'); h.tick(50000);
  assert.equal(h.uniform('uTime')[0],frozen);
  h.key('Escape'); h.tick();
  assert.notEqual(h.uniform('uTime')[0],frozen);
  h.doc.hidden=true; h.doc.emit('visibilitychange');
  assert.equal(h.frames.size,0);
  const before=h.uniform('uTime')[0];
  h.tick(41751);
  h.doc.hidden=false; h.doc.emit('visibilitychange'); h.tick();
  assert.ok(Math.abs((h.uniform('uTime')[0]-before+2)%2-1/60)<1e-9);
  h.key('KeyN'); advance(h,120);
  assert.equal(h.uniform('uNight')[0],1);
  const pref=h.win.matchMedia('(prefers-reduced-motion: reduce)');
  pref.matches=true; pref.emit('change'); h.settle();
  assert.equal(h.uniform('uWet')[0],1);
  assert.equal(h.gl.draws.at(-1).program,labelProgram);
  h.key('KeyR'); h.settle();
  assert.equal(h.uniform('uWet')[0],0);
  assert.equal(h.uniform('uNight')[0],1);
  assert.equal(h.id('place-note').textContent,places[0].nightNote);
  assert.deepEqual(groundPosition(h),position);
});

test('holding only Shift or opposing movement keys lets the scene sleep and releasing one wakes walking', () => {
  const h=running({reduced:true}), draws=h.gl.draws.length;
  h.key('ShiftLeft'); h.settle();
  h.key('ShiftLeft',{repeat:true});
  assert.equal(h.frames.size,0);
  h.key('KeyW'); h.key('KeyS'); h.settle();
  assert.equal(h.gl.draws.length,draws);
  h.up('KeyS'); advance(h,30);
  assert.ok(groundPosition(h)[1]<places[0].view[1]-2);
  h.up('ShiftLeft'); h.up('KeyW'); h.settle();
});

test('a repeated animation timestamp does not strand held movement or a running shower', () => {
  const h=running();
  h.key('KeyW'); h.key('KeyR'); h.tick();
  const here=groundPosition(h), time=h.uniform('uTime')[0];
  h.tick(0);
  assert.deepEqual(groundPosition(h),here);
  assert.equal(h.uniform('uTime')[0],time);
  assert.equal(h.frames.size,1);
  h.tick();
  assert.ok(groundPosition(h)[1]<here[1]);
  assert.ok(h.uniform('uTime')[0]>time);
});

test('a failed rain shader releases the interrupted draw state before retrying on the same WebGL context', () => {
  const options={}, h=running(options), here=groundPosition(h);
  const staticTextures=[h.gl.draws.at(-2).texture,h.gl.draws.at(-1).texture];
  options.compileFailure=true;
  h.key('KeyR'); h.tick();
  assert.match(h.id('error-title').textContent,/interrupted/);
  assert.equal(h.frames.size,0);
  assert.ok(h.gl.programs.every(p=>p.deleted));
  assert.ok(h.gl.buffers.every(b=>b.deleted));
  assert.ok(staticTextures.every(t=>t.deleted));
  assert.ok(h.gl.writeDepth && !h.gl.flags.has(h.gl.BLEND));
  options.compileFailure=false;
  h.id('retry').emit('click'); h.tick();
  assert.ok(h.id('unavailable').hidden);
  const bake=h.gl.draws.findLast(d=>d.offscreen);
  assert.ok(bake.depth && bake.writeDepth && !bake.blend);
  assert.ok(h.uniform('uTime')[0]>0);
  assert.deepEqual(groundPosition(h),here);
});
