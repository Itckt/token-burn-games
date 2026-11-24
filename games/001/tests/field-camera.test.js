'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const postcard=require('../src/postcard.js');
const {Renderer}=require('../src/renderer.js');
const {makeState}=require('../src/simulation.js');
const world=require('../src/campus.js').create();
const {page}=require('./support/page.js');
const {running,advance,groundPosition,selectInGuide}=require('./support/walk.js');

test('printed sheets preserve the full frame and reserve a legible caption in either orientation',()=>{
  for (const [w,h] of [[1920,1080],[673,1101],[700,700],[1,1],[2,7300],[8000,3]]) {
    const harn=page(), sheet=harn.id('print-preview'), src=harn.canvas;
    src.width=w; src.height=h;
    const p=postcard.layout(w,h), info={name:'Kite Terrace',detail:'Night · Clear · NW 302° · 2×'};
    let copy;
    sheet.getContext('2d').drawImage=(...args)=>{copy=args;};
    postcard.print(sheet,src,info);
    assert.deepEqual(copy,[src,p.x,p.y,p.w,p.h]);
    assert.equal(sheet.width,p.width); assert.equal(sheet.height,p.height);
    assert.ok(p.w<=1440 && p.h<=1440 && p.w>=1 && p.h>=1);
    const scale=Math.min(1,1440/Math.max(w,h));
    assert.ok(Math.abs(p.h-scale*h)<=1 && Math.abs(p.w-scale*w)<=1);
    assert.ok(p.x>=p.rim && p.width===2*p.x+p.w && p.y>=p.rim);
    assert.ok(p.height-p.y-p.h>=89*p.unit && p.width>=360);
    assert.ok(sheet.pen.text.includes(info.name) && sheet.pen.text.includes(info.detail));
  }
  for (const bad of [NaN,0,-1,Infinity]) assert.throws(()=>postcard.layout(150,bad),RangeError);
});

test('postcards label the exposed light, weather and compass even if a transition just reversed',()=>{
  const p=world.places[5], s=makeState(p.view);
  s.yaw=-.004; s.night=true; s.weather.shower=true;
  let info=postcard.caption(p,s,3);
  assert.equal(info.filename,'campus-atlas-terrace-day-clear-000.png');
  assert.match(info.detail,/N 000°.*3×/);
  s.light=.4; s.weather.wet=.6;
  assert.match(postcard.caption(p,s,2).detail,/Dusk.*Shower/);
  s.night=false; s.weather.shower=false;
  assert.match(postcard.caption(p,s,2).detail,/Dawn.*Clearing/);
  s.light=1; s.weather.wet=0; s.yaw=-Math.PI/2;
  info=postcard.caption(p,s,1);
  assert.equal(info.name,'Kite Terrace');
  assert.equal(info.filename,'campus-atlas-terrace-night-clear-270.png');
  assert.match(info.detail,/W 270°/);
});

test('optical zoom uses one lens for sky, scene, signs and rain without rebuilding static graphics',()=>{
  const h=page(),r=new Renderer(h.canvas,world,h.gl),s=makeState(world.places[5].view);
  s.weather.drops=true; s.weather.wet=.8;
  for (const zoom of [1,2,3,1]) {
    r.draw(s,zoom);
    const [horizontal,vertical]=r.sky.p.uniforms.uLens;
    assert.ok(Math.abs(vertical-Math.tan(57*Math.PI/360)/zoom)<1e-10);
    assert.ok(Math.abs(horizontal*r.projection[0]-1)<1e-6);
    assert.ok(Math.abs(vertical*r.projection[5]-1)<1e-6);
    assert.deepEqual(r.lettering.p.uniforms.uVP,r.scene.p.uniforms.uVP);
    assert.deepEqual(r.rain.p.uniforms.uVP,r.scene.p.uniforms.uVP);
    assert.equal(r.resize(zoom),false);
  }
  assert.equal(h.gl.draws.filter(d=>d.offscreen).length,1);
  assert.equal(h.gl.buffers.length,4);
});

test('a route survives framing, bounded zoom, an idle-frame capture, PNG download and retake',async()=>{
  const h=running({reduced:true});
  selectInGuide(h,world.places[2]); h.id('follow-route').emit('click'); h.settle();
  assert.equal(h.doc.pointerLockElement,h.canvas);
  const from=groundPosition(h), base=h.uniform('uLens')[1];
  h.key('KeyC'); h.settle();
  assert.equal(h.doc.pointerLockElement,null);
  assert.equal(h.id('viewfinder').hidden,false);
  assert.equal(h.id('camera').getAttribute('aria-pressed'),'true');
  assert.ok(h.id('lens-out').disabled);
  h.key('KeyW'); h.key('Equal'); h.id('lens-in').emit('click'); h.key('Equal');
  h.key('ArrowLeft'); advance(h,15); h.up('ArrowLeft'); h.up('KeyW'); h.settle();
  assert.ok(h.id('lens-in').disabled);
  assert.equal(h.id('lens-value').textContent,'3×');
  assert.deepEqual(groundPosition(h),from);
  assert.ok(Math.abs(h.uniform('uLens')[1]-base/3)<1e-10);
  h.id('lens-out').emit('click');
  h.key('KeyR'); h.key('KeyN'); h.settle();
  const before=h.gl.draws.length;
  const sheet=h.id('print-preview'),pen=sheet.getContext('2d');
  pen.drawImage=(source)=>{
    assert.equal(source,h.canvas);
    assert.equal(h.gl.draws.length,before+3,'fresh WebGL draw immediately before the 2D copy');
    assert.ok(Math.abs(h.uniform('uLens')[1]-base/2)<1e-10);
  };
  h.key('Space');
  assert.ok(h.id('print-dialog').open);
  assert.equal(h.encodings.length,1);
  h.key('Space',{repeat:true}); h.key('KeyC'); h.key('KeyN'); h.settle();
  assert.equal(h.encodings.length,1);
  assert.ok(h.id('print-download').hidden);
  await Promise.resolve();
  const link=h.id('print-download');
  assert.ok(!link.hidden && h.urls.has(link.href));
  assert.match(link.download,/^campus-atlas-court-night-shower-\d{3}\.png$/);
  assert.match(sheet.getAttribute('aria-label'),/Banyan Court.*Night.*Shower.*2×/);
  h.id('retake').emit('click'); h.settle();
  assert.equal(h.urls.size,0);
  assert.ok(link.hidden && !link.href);
  assert.equal(h.doc.activeElement,h.canvas);
  h.key('Escape'); h.settle();
  assert.ok(h.id('viewfinder').hidden && !h.id('route-card').hidden);
  assert.equal(h.uniform('uLens')[1],base);
  assert.deepEqual(groundPosition(h),from);
});

test('touch framing keeps feet still, permits a native focused button and clears a lost pointer',()=>{
  const h=running({coarse:true,reduced:true}),here=groundPosition(h);
  h.id('camera').emit('click');
  h.canvas.emit('pointerdown',{pointerId:4,button:0,clientX:15,clientY:20});
  h.canvas.emit('pointermove',{pointerId:4,pointerType:'touch',clientX:110,clientY:0});
  h.canvas.emit('lostpointercapture',{pointerId:4});
  h.key('KeyA'); h.settle();
  assert.ok(h.uniform('uForward')[0]>.4);
  assert.deepEqual(groundPosition(h),here);
  assert.equal(h.locks,0);
  assert.equal(h.key('Space',{target:h.id('lens-in')}).defaultPrevented,false);
  assert.ok(!h.id('print-dialog').open);
  h.id('camera-close').emit('click'); h.settle();
  assert.ok(h.id('viewfinder').hidden);
});

test('late encoders, unavailable PNGs and graphics recovery leave only the current print downloadable',()=>{
  const options={holdPNG:true,reduced:true};
  const h=running(options), review=h.id('print-dialog'), link=h.id('print-download');
  h.key('KeyC'); h.id('shutter').emit('click');
  h.key('Escape'); h.id('shutter').emit('click');
  const [old,current]=h.encodings;
  old.callback(old.blob);
  assert.ok(link.hidden && h.urls.size===0 && review.open);
  current.callback(null);
  assert.match(h.id('print-status').textContent,/Retake/);
  h.id('retake').emit('click'); h.id('shutter').emit('click');
  options.denyURL=true;
  h.encodings[2].callback(h.encodings[2].blob);
  assert.ok(link.hidden && review.open);
  h.key('Escape'); h.id('shutter').emit('click');
  h.gl.lost=true; h.canvas.emit('webglcontextlost');
  options.denyURL=false;
  h.encodings[3].callback(h.encodings[3].blob);
  assert.ok(h.id('viewfinder').hidden && !review.open && link.hidden);
  assert.ok(h.id('camera').disabled && h.urls.size===0);
  h.gl.lost=false; h.canvas.emit('webglcontextrestored'); h.settle();
  assert.equal(h.id('camera').disabled,false);
  h.key('KeyC'); h.id('shutter').emit('click');
  h.encodings[4].callback(h.encodings[4].blob);
  assert.ok(review.open && !link.hidden && h.urls.size===1);
  review.querySelector('.close-button').emit('click');
  assert.equal(h.urls.size,0);
  assert.equal(h.errors.length,0);
});
