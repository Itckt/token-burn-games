'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const orders=require('../js/orders'), {notes}=require('../js/world'), M=require('../js/math');
const {openPage,tap,key,surface}=require('./support/page');
const stampCount=p=>p.$('service-stamps').children.filter(mark=>mark.textContent==='✓').length;

test('the original shifts use the same six objects, accept only the next stamp and advance only after service',()=>{
  let state=orders.firstTicket();
  const visited=new Set(), ids=new Set();
  for (const [index,ticket] of orders.tickets.entries()) {
    assert.equal(state.ticket,index); assert.equal(state.step,0);
    assert.ok(!ids.has(ticket.id)); ids.add(ticket.id);
    for (const [step,clue] of ticket.steps.entries()) {
      assert.ok(clue.cue && clue.hint && notes.some(n=>n.id===clue.id));
      visited.add(clue.id);
      assert.equal(orders.nextTicket(state),state);
      for (const wrong of [0,clue.id+10,null,String(clue.id)]) assert.equal(orders.stamp(state,wrong),state);
      const before=state;
      state=orders.stamp(state,clue.id);
      assert.equal(before.step,step);
      assert.deepEqual(state,{ticket:index,step:step+1});
      assert.equal(orders.stamp(state,clue.id),state);
      assert.deepEqual(orders.unpack(orders.pack(state)),state);
    }
    assert.ok(orders.served(state));
    state=orders.nextTicket(state);
  }
  assert.deepEqual([...visited].sort(),[1,2,3,4,5,6]);
  assert.ok(orders.served(state)); assert.equal(orders.nextTicket(state),state);
});
test('unreadable, stale or out-of-range saved tickets revert to an unopened shift',()=>{
  for (const raw of [undefined,null,'','{','null','[]','42','{"version":2}',
    '{"version":1,"ticket":"old-order","step":0}','{"version":1,"ticket":"constructor","step":0}']) {
    assert.equal(orders.unpack(raw),null);
  }
  const valid=JSON.parse(orders.pack(orders.firstTicket()));
  for (const step of [-1,4,.5,'1',null]) assert.equal(orders.unpack(JSON.stringify({...valid,step})),null);
  assert.deepEqual(orders.unpack(JSON.stringify(valid)),orders.firstTicket());
});
test('only deliberate picks stamp an open ticket, through the real mesh, pins, keys and index',()=>{
  const p=openPage({reduced:true,rasterPick:true});
  const first=orders.tickets[0];
  assert.equal(p.$('service-ticket').hidden,true);
  p.$('ticket-toggle').click(); assert.equal(p.$('ticket-toggle').getAttribute('aria-expanded'),'true');
  p.$('next').click(); p.$('next').click();
  p.$('lens').click(); p.$('lens-next').click(); p.$('lens-prev').click(); p.win.tick();
  assert.equal(p.$('note-title').textContent,'Pineapple bun');
  assert.equal(stampCount(p),0); assert.equal(p.$('service-cue').textContent,first.steps[0].cue);
  p.$('service-hint').click(); assert.equal(p.$('service-feedback').textContent,first.steps[0].hint);
  const {left,top,width,height}=p.doc.rect;
  const pixel=M.project(notes[2].closeup.center,surface(p).u_camera,width,height);
  tap(p,left+pixel.x,top+pixel.y);
  assert.equal(p.gl.reads,1); assert.equal(stampCount(p),1);
  assert.equal(p.$('service-cue').textContent,first.steps[1].cue);
  key(p,'6'); assert.equal(p.$('note-title').textContent,'Shop cat');
  assert.match(p.$('service-feedback').textContent,/cat/i); assert.equal(stampCount(p),1);
  p.$('ticket-toggle').click(); key(p,'1'); p.$('ticket-toggle').click();
  assert.equal(stampCount(p),1);
  key(p,'1',{repeat:true}); assert.equal(stampCount(p),1);
  key(p,'1'); assert.equal(stampCount(p),2);
  p.$('lens').click(); p.win.tick(); p.$('pins').click();
  p.$('markers').children[1].click(); assert.equal(stampCount(p),3);
  assert.equal(p.$('service-cue').textContent,first.served);
  assert.ok(p.$('service-hint').hidden && !p.$('service-next').hidden);
  p.$('object-list').children[5].click(); assert.equal(stampCount(p),3);
  p.$('service-next').click(); assert.equal(stampCount(p),0);
  assert.equal(p.$('service-name').textContent,orders.tickets[1].name);
  p.$('object-list').children[3].click(); assert.equal(stampCount(p),1);
});
test('saved stamps resume after reload, including the last served ticket until replay is requested',()=>{
  const p=openPage({noWebGL:true}), store=p.win.localStorage;
  p.$('ticket-toggle').click(); p.$('object-list').children[2].click();
  const q=openPage({noWebGL:true,storage:store});
  assert.equal(q.$('ticket-label').textContent,'Resume ticket'); assert.ok(q.$('service-ticket').hidden);
  q.$('object-list').children[0].click(); q.$('ticket-toggle').click();
  assert.equal(stampCount(q),1);
  for (const [i,ticket] of orders.tickets.entries()) {
    for (const clue of ticket.steps.slice(i===0 ? 1 : 0)) q.$('object-list').children[clue.id-1].click();
    assert.equal(q.$('service-cue').textContent,ticket.served);
    if (i<orders.tickets.length-1) q.$('service-next').click();
  }
  const r=openPage({noWebGL:true,storage:store});
  assert.equal(r.$('ticket-label').textContent,'View served ticket'); r.$('ticket-toggle').click();
  assert.equal(r.$('service-number').textContent,'03'); assert.equal(stampCount(r),3);
  assert.equal(r.$('service-next').textContent,'Work another shift'); r.$('service-next').click();
  assert.equal(r.$('service-number').textContent,'01'); assert.equal(stampCount(r),0);
  assert.deepEqual(r.errors,[]);
});
test('corrupt saves and blocked storage leave all tickets playable through the illustrated fallback',()=>{
  for (const storage of [
    {getItem:()=>'{bad json',setItem(){}},
    {getItem(){throw Error('file storage blocked');},setItem(){throw Error('file storage blocked');}},
    {getItem:()=>null,setItem(){throw Error('quota exceeded');}}
  ]) {
    const p=openPage({noWebGL:true,storage});
    for (const id of ['light-afternoon','light-shower','light-evening','lens','lens-prev','lens-next']) {
      assert.ok(p.$(id).disabled);
    }
    assert.equal(p.$('ticket-label').textContent,'Take a ticket');
    p.$('ticket-toggle').click();
    for (const clue of orders.tickets[0].steps) p.$('object-list').children[clue.id-1].click();
    assert.equal(stampCount(p),3); assert.equal(p.win.frames.size,0); assert.deepEqual(p.errors,[]);
  }
});
test('graphics recovery restores the weather and close-up while the counter remains in service',()=>{
  const p=openPage({reduced:true});
  p.$('ticket-toggle').click(); key(p,'3'); p.$('lens').click(); p.$('light-evening').click(); p.win.tick();
  p.$('expand').focus(); p.$('expand').click(); p.$('scene').emit('webglcontextlost');
  assert.equal(p.win.frames.size,0); assert.equal(p.doc.activeElement,p.$('object-list').children[2]);
  p.$('object-list').children[0].click(); assert.equal(stampCount(p),2);
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored');
  assert.equal(surface(p).u_night,1); assert.equal(p.$('lens').getAttribute('aria-pressed'),'true');
  assert.equal(p.$('note-title').textContent,notes[0].title);
  const center=M.project(notes[0].closeup.center,surface(p).u_camera,810,455);
  assert.ok(Math.abs(center.x-405)<.001 && Math.abs(center.y-227.5)<.001);
  assert.deepEqual(p.doc.gl.draws.map(d=>d.name),['shadow','ground','surface','steam']);
  p.$('object-list').children[1].click(); assert.equal(stampCount(p),3);
  assert.deepEqual(p.errors,[]);
});
