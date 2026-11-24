'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const postcard=require('../js/postcard'), world=require('../js/world'), sim=require('../js/simulation');
const {openPage,key,ticks,pointer,surface}=require('./support/page');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' vs '+b);

test('postcard mats contain the full source at its original aspect in wide and upright formats',()=>{
  for (const [w,h] of [[1280,720],[320,580],[512,512],[2000,300],[90,1000]]) {
    const {width,height,mat,image}=postcard.layout(w,h);
    assert.equal(height>width,h>w); near(image.w/image.h,w/h);
    near(image.x+image.w/2,mat.x+mat.w/2); near(image.y+image.h/2,mat.y+mat.h/2);
    assert.ok(image.w<=mat.w+1e-6 && image.h<=mat.h+1e-6);
    assert.ok(Math.abs(image.w-mat.w)<1e-6 || Math.abs(image.h-mat.h)<1e-6);
    assert.ok(mat.y+mat.h+155<height && mat.x+mat.w<width);
  }
  for (const args of [[0,400],[300,-1],[NaN,20],[1,Infinity]]) assert.throws(()=>postcard.layout(...args),RangeError);
});

test('a postcard draws the currently selected close-up without hover or UI, even before the next animation frame',()=>{
  const p=openPage({reduced:true,pickId:4}), {width,height}=p.doc.rect;
  pointer(p,'pointermove',310,300); p.win.tick(); assert.equal(surface(p).u_hover,4);
  key(p,'7'); key(p,'c'); key(p,'w');
  const before=p.gl.draws.length, reads=p.gl.reads;
  key(p,'P');
  const print=p.$('postcard-print'), link=p.$('postcard-save');
  assert.ok(p.$('postcard-dialog').open); assert.ok(!print.hidden && !link.hidden);
  assert.equal(p.doc.activeElement,p.$('postcard-close'));
  assert.equal(p.win.frames.size,0); assert.equal(p.gl.reads,reads);
  assert.deepEqual(p.gl.draws.slice(before).map(d=>d.name),['ground','surface','steam']);
  assert.equal(surface(p).u_hover,-1);
  const view=sim.createView(false); sim.focusOn(view,world.notes[6].closeup,true);
  assert.deepEqual(surface(p).u_camera,Array.from(sim.camera(view,width,height).matrix));
  assert.equal(surface(p).u_rain,1);
  const images=print.paper.commands.filter(([op])=>op==='drawImage');
  assert.equal(images.length,1); assert.equal(images[0][1],p.$('scene'));
  const {image}=postcard.layout(p.$('scene').width,p.$('scene').height);
  assert.deepEqual(images[0].slice(2),[image.x,image.y,image.w,image.h]);
  assert.ok(print.paper.texts.includes('CLOSE-UP  /  SHOWER'));
  assert.ok(print.paper.texts.includes('Counter fan'));
  assert.match(print.getAttribute('aria-label'),/shower.*Counter fan/);
  assert.equal(link.download,'half-past-tea-shower-counter-fan.png');
  assert.ok(p.win.blobs.has(link.getAttribute('href')));
  const draws=p.gl.draws.length; ticks(p,10); assert.equal(p.gl.draws.length,draws);
  p.$('postcard-close').click();
  assert.equal(p.doc.activeElement,p.$('scene')); assert.equal(p.win.blobs.size,0);
  assert.equal(link.getAttribute('href'),null); assert.equal(p.win.frames.size,1);
  p.win.tick(); assert.equal(p.win.frames.size,0);
});

test('portrait print keeps each slip caption intact in the footer beside its numbered cancellation',()=>{
  const p=openPage({noWebGL:true}), source=p.$('portrait');
  source.width=310; source.height=480;
  for (const note of world.notes) {
    const card=p.doc.createElement('canvas');
    postcard.paint(card,{source,note,mode:'evening',closeup:false,illustrated:false});
    assert.ok(card.height>card.width);
    const lines=card.paper.commands.filter(([op])=>op==='fillText');
    const title=lines.findIndex(([,text])=>text===note.title);
    const stamp=lines.findIndex(([,text])=>text==='茶');
    const quote=lines.slice(title+1,stamp);
    assert.equal(quote.map(([,text])=>text).join(' '),'“'+note.caption+'”');
    assert.ok(quote.every(([,,x,y])=>x>10 && y<card.height-10));
    assert.ok(card.paper.texts.includes('WIDE VIEW  /  EVENING'));
    assert.ok(card.paper.texts.includes('SLIP '+String(note.id).padStart(2,'0')));
    assert.equal(card.paper.depth,0);
  }
});

test('delayed encoders cannot publish an old image after close, reopen or a failed export',()=>{
  const p=openPage({noWebGL:true,deferEncoding:true}), link=p.$('postcard-save');
  const open=()=>p.$('postcard-open').click(), close=()=>p.$('postcard-close').click();
  open(); assert.ok(link.hidden); close(); p.$('next').click(); open();
  p.doc.encodings[0].complete();
  assert.ok(link.hidden); assert.equal(p.win.blobs.size,0);
  p.doc.encodings[1].complete(null);
  assert.match(p.$('postcard-status').textContent,/could not/); assert.equal(link.getAttribute('href'),null);
  close(); open(); p.doc.encodings[2].complete();
  assert.ok(!link.hidden); assert.match(link.download,/illustration-window-booth\.png$/);
  assert.equal(p.win.blobs.size,1);
  close(); assert.equal(p.win.blobs.size,0);
  open(); close(); p.doc.encodings[3].complete(); assert.equal(p.win.blobs.size,0);
});

test('postcard preview and download use the selected local illustration without a graphics context',()=>{
  const p=openPage({noWebGL:true});
  p.$('object-list').children[5].click(); p.$('postcard-open').click();
  const print=p.$('postcard-print');
  assert.equal(print.paper.commands.find(([op])=>op==='drawImage')[1],p.$('portrait'));
  assert.ok(print.paper.texts.includes('ILLUSTRATED SLIP') && print.paper.texts.includes('Shop cat'));
  assert.equal(p.$('postcard-save').download,'half-past-tea-illustration-shop-cat.png');
  assert.equal(p.win.frames.size,0); assert.equal(p.doc.gl,undefined);
  p.$('postcard-close').click(); assert.equal(p.doc.activeElement,p.$('postcard-open'));
  assert.deepEqual(p.errors,[]);
});

test('a postcard over the expanded café takes Escape first and returns to its opener',()=>{
  const p=openPage();
  p.$('expand').focus(); p.$('expand').click(); key(p,'P');
  const modal=p.$('postcard-dialog');
  const escape=modal.emit('keydown',{key:'Escape'});
  assert.ok(!escape.defaultPrevented);
  modal.close(); // Native dialog default action after the keydown.
  assert.equal(p.$('viewer').getAttribute('aria-modal'),'true');
  assert.equal(p.doc.activeElement,p.$('scene')); assert.equal(p.win.frames.size,1);
  key(p,'Escape'); assert.equal(p.$('expand').getAttribute('aria-pressed'),'false');
  assert.equal(p.doc.activeElement,p.$('expand'));
});

test('a graphics interruption keeps an open print intact and restores focus to the usable index',()=>{
  const p=openPage({reduced:true,deferEncoding:true});
  key(p,'6'); p.$('expand').click(); key(p,'p');
  const print=p.$('postcard-print'), commandCount=print.paper.commands.length;
  p.$('scene').emit('webglcontextlost');
  assert.ok(p.$('postcard-dialog').open); assert.equal(p.doc.activeElement,p.$('postcard-close'));
  p.doc.encodings[0].complete();
  assert.match(p.$('postcard-save').download,/afternoon-shop-cat/);
  assert.equal(print.paper.commands.length,commandCount);
  p.$('postcard-close').click();
  assert.equal(p.doc.activeElement,p.$('object-list').children[5]); assert.equal(p.win.frames.size,0);
  p.$('postcard-open').click(); p.doc.encodings[1].complete();
  assert.match(p.$('postcard-save').download,/illustration-shop-cat/);
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored');
  assert.ok(p.$('postcard-dialog').open); assert.equal(p.win.frames.size,0);
  p.$('postcard-close').click(); p.win.tick(); assert.equal(p.win.frames.size,0);
  assert.deepEqual(p.errors,[]);
});
