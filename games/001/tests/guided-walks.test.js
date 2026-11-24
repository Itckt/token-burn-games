'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {catalogue,Directions,STOP_RADIUS}=require('../src/walks.js');
const {create}=require('../src/campus.js');
const {canWalk}=require('../src/collision.js');
const {running,groundPosition,walkToCue,selectInGuide}=require('./support/walk.js');
const world=create();
function checkPath(from, points, campus) {
  assert.ok(points?.length);
  for (const point of points) {
    assert.ok(canWalk(...from,...point,campus),'clear segment to '+point);
    from=point;
  }
}

test('both guided walks preview continuous paths to the lookouts, including after a detour',()=>{
  const d=new Directions(world);
  for (const walk of catalogue) {
    const from=world.places[0].view.slice(0,2);
    const preview=d.preview(from,walk);
    assert.ok(walk.stops.length>=3);
    checkPath(from,preview,world);
    assert.ok(d.toStop(from,walk,0));
    for (const [i,stop] of walk.stops.entries()) {
      const at=d.place.view.slice(0,2);
      assert.equal(d.place.id,stop.id);
      assert.ok(preview.some(p=>p[0]===at[0] && p[1]===at[1]));
      assert.notDeepEqual(at,d.place.stamp.at);
      const detour=world.places[4].stamp.at;
      d.update(detour,null);
      checkPath(detour,d.leg.points,world);
      assert.deepEqual(d.leg.points.at(-1),at,'replanning still targets the lookout');
      assert.equal(d.advance(detour),false,'walking past another stop cannot skip the current one');
      assert.equal(d.update(at,null),'stop');
      assert.equal(d.update(at,null),undefined);
      assert.equal(d.index,i);
      assert.equal(d.last,i===walk.stops.length-1);
      assert.ok(d.advance(at));
    }
    assert.equal(d.leg,null);
    assert.equal(d.advance(from),false);
  }
});

test('lookout arrival needs a clear approach and failed replacements preserve the current leg',()=>{
  const place={id:'lookout',view:[.65,0,0,0],stamp:{at:[3,0]}};
  const campus={bounds:{west:-5,east:5,north:-5,south:5},places:[place],
    colliders:[{kind:'box',x:0,z:0,w:.1,d:2}]};
  const d=new Directions(campus), walk={stops:[{id:'lookout'},{id:'lookout'}]};
  assert.ok(d.toStop([-.65,0],walk,0));
  assert.ok(1.3<STOP_RADIUS);
  d.update([-.65,0]);
  assert.equal(d.arrived,false);
  checkPath([-.65,0],d.leg.points,campus);
  const leg=d.leg;
  assert.equal(d.toStop([0,0],walk,0),false);
  assert.equal(d.leg,leg);
  assert.equal(d.preview([0,0],walk),null);
  assert.equal(d.update([.65,0]),'stop');
  assert.equal(d.advance([0,0]),false);
  assert.ok(d.arrived && d.index===0);
  d.clear();
  assert.equal(d.update([.65,0]),undefined);
});

test('the guide previews both itineraries and supports roving keyboard focus without moving the walker',()=>{
  const h=running(), here=groundPosition(h);
  h.key('KeyM');
  h.id('tab-places').emit('keydown',{key:'ArrowRight'});
  assert.equal(h.doc.activeElement,h.id('tab-walks'));
  assert.equal(h.id('tab-walks').tabIndex,0);
  assert.equal(h.id('tab-studies').tabIndex,-1);
  assert.equal(h.id('page-places').hidden,true);
  assert.ok(!h.id('page-walks').hidden && h.id('walks-map').pen.counts.drawImage);
  const choices=h.id('walk-choices').children;
  choices[1].emit('click');
  assert.equal(h.id('itinerary-name').textContent,catalogue[1].name);
  assert.deepEqual(h.id('itinerary-stops').children.map(el=>el.textContent),
    catalogue[1].stops.map(stop=>world.places.find(p=>p.id===stop.id).name));
  assert.match(h.id('walk-length').textContent,/3 stops · \d+ m from here/);
  h.id('tab-walks').emit('keydown',{key:'End'});
  assert.equal(h.id('tab-studies').getAttribute('aria-selected'),'true');
  h.id('tab-studies').emit('keydown',{key:'ArrowRight'});
  assert.equal(h.doc.activeElement,h.id('tab-places'));
  h.key('Escape'); h.settle();
  assert.deepEqual(groundPosition(h),here);
  assert.ok(h.id('route-card').hidden);
});

test('walk the three stops from the HUD, pause for the camera and guide, and finish after restoration',()=>{
  const h=running({reduced:true}), walk=catalogue[0], from=groundPosition(h);
  h.key('KeyM'); h.id('tab-walks').emit('click'); h.id('take-walk').emit('click'); h.tick();
  assert.deepEqual(groundPosition(h),from);
  h.key('KeyF'); h.settle();
  for (const [i,stop] of walk.stops.entries()) {
    const place=world.places.find(p=>p.id===stop.id);
    assert.equal(h.id('route-name').textContent,place.name);
    assert.match(h.id('route-cue').textContent,/m to lookout/);
    walkToCue(h,()=>!h.id('stop-detail').hidden && !h.id('route-card').hidden);
    const [x,z]=groundPosition(h);
    assert.ok(Math.hypot(x-place.view[0],z-place.view[1])<=STOP_RADIUS);
    assert.equal(h.id('walk-progress').textContent,walk.name+' · '+(i+1)+' / 3');
    assert.equal(h.id('stop-note').textContent,stop.note);
    if (i===0) {
      h.key('KeyC'); h.key('KeyF'); h.key('Escape'); h.settle();
      h.key('KeyM'); h.key('KeyF');
      assert.equal(h.id('page-walks').hidden,false);
      assert.equal(h.id('take-walk').textContent,'End guided walk');
      assert.equal(h.id('itinerary-stops').children[0].getAttribute('aria-current'),'step');
      h.key('Escape'); h.settle();
      h.gl.lost=true; h.canvas.emit('webglcontextlost');
      h.key('KeyF');
      h.gl.lost=false; h.canvas.emit('webglcontextrestored'); h.settle();
      assert.equal(h.id('stop-note').textContent,stop.note);
      assert.deepEqual(groundPosition(h),[x,z]);
    }
    h.key('KeyF',{repeat:true}); h.settle();
    assert.ok(!h.id('stop-detail').hidden);
    if (i===1) h.id('next-stop').emit('click');
    else h.key('KeyF');
    h.tick();
  }
  assert.ok(h.id('route-card').hidden);
  assert.match(h.id('toast').textContent,/Water & copper complete/);
  assert.equal(h.id('stamp-count').textContent,'0 of 7 stamps');
  assert.deepEqual(h.errors,[]);
});

test('a guided walk can replace a press route and can be changed, cancelled or reset',()=>{
  const h=running();
  selectInGuide(h,world.places[1]); h.id('follow-route').emit('click'); h.tick();
  h.key('KeyM'); h.id('tab-walks').emit('click'); h.id('take-walk').emit('click'); h.tick();
  assert.equal(h.id('route-name').textContent,'Moon Gate Pool');
  h.key('KeyM'); h.id('walk-choices').children[1].emit('click'); h.id('take-walk').emit('click'); h.tick();
  assert.match(h.id('walk-progress').textContent,/Between lectures/);
  h.key('KeyM'); h.id('tab-places').emit('click'); selectInGuide(h,world.places[2]);
  h.id('follow-route').emit('click'); h.tick();
  assert.equal(h.id('route-name').textContent,'Meridian Tower');
  assert.ok(h.id('walk-progress').hidden && h.id('stop-detail').hidden);
  for (const id of ['cancel','guide','reset']) {
    h.key('KeyM'); h.id('tab-walks').emit('click'); h.id('take-walk').emit('click'); h.tick();
    if (id==='guide') { h.key('KeyM'); h.id('take-walk').emit('click'); h.key('Escape'); }
    else if (id==='cancel') h.key('KeyX');
    else h.id('reset').emit('click');
    h.settle();
    assert.ok(h.id('route-card').hidden);
  }
});
