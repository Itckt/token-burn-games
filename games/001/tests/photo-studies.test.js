'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../src/math.js');
const sim=require('../src/simulation.js');
const {create}=require('../src/campus.js');
const {PREFIX,RADIUS,atLookout,framingCue,assess}=require('../src/photo-studies.js');
const {firstHit}=require('./support/sightline.js');
const {running,groundPosition,selectInGuide}=require('./support/walk.js');
const world=create(), lookouts=world.places.filter(p=>p.study);

function aim(eye,target) {
  const [dx,dy,dz]=M.sub(target,eye);
  return [Math.atan2(dx,-dz),Math.atan2(dy,Math.hypot(dx,dz))];
}

test('every photo lookout frames a visible triangle from the centre and walkable edges of its tile',()=>{
  assert.equal(lookouts.length,3);
  for (const p of lookouts) {
    let checked=0;
    for (let i=-1;i<12;i++) {
      const radius=i<0 ? 0 : RADIUS-.001;
      const s=sim.makeState(p.view);
      s.x+=radius*Math.cos(i*M.TAU/12); s.z+=radius*Math.sin(i*M.TAU/12);
      if (!sim.canStand(s.x,s.z,world)) continue;
      const eye=sim.eyePosition(s,world), target=p.study.target;
      assert.equal(atLookout(s,world),p);
      assert.ok(Math.abs(firstHit(world,eye,target).t-1)<.001,p.name+' clear sightline');
      [s.yaw,s.pitch]=aim(eye,target);
      s.night=p.study.light==='night'; s.light=Number(s.night);
      s.weather.shower=!!p.study.rain; s.weather.wet=Number(s.weather.shower);
      for (const aspect of [.5,1,2.4]) {
        assert.equal(assess(s,world,p.study.zoom,aspect).ready,true);
        assert.equal(assess(s,world,p.study.zoom===2 ? 1 : 2,aspect).ready,false);
      }
      s.yaw+=Math.PI;
      assert.match(assess(s,world,p.study.zoom,1.7).cue,/Turn/);
      checked++;
    }
    assert.ok(checked>=7);
  }
});

test('photo framing follows the exposed aspect and lens and rejects off-station and obstructed views',()=>{
  const delta=[.25,0,-1], aspect=1.8;
  assert.equal(framingCue(delta,0,0,1,aspect),'');
  assert.equal(framingCue(delta,0,0,1,.6),'Pan right');
  assert.equal(framingCue(delta,0,0,2,aspect),'Pan right');
  assert.equal(framingCue([-.5,0,-1],0,0,1,aspect),'Pan left');
  assert.equal(framingCue([0,.5,-1],0,0,1,aspect),'Tilt up');
  assert.equal(framingCue([0,-.5,-1],0,0,1,aspect),'Tilt down');
  assert.equal(framingCue([0,1,-1],0,-sim.PITCH_LIMIT,1,aspect),'Tilt up');
  assert.equal(framingCue([0,-1,-1],0,sim.PITCH_LIMIT,1,aspect),'Tilt down');
  const p=lookouts[0], s=sim.makeState(p.view);
  s.x+=RADIUS+.001;
  assert.equal(assess(s,world,2,aspect),null);
  s.x=p.view[0]+1;
  const wall={kind:'box',x:s.x-.5,z:s.z,w:.06,d:2};
  assert.equal(atLookout(s,{...world,colliders:[wall]}),undefined);
  for (const invalid of [0,-1,Infinity,NaN]) assert.equal(assess(s,world,1,invalid),null);
});

test('study cues distinguish lighting and shower transitions from settings the walker must change',()=>{
  for (const p of lookouts) {
    const s=sim.makeState(p.view), cue=()=>assess(s,world,p.study.zoom,1).cue;
    if (p.study.light==='day') {
      s.light=1; s.night=true; assert.match(cue(),/daylight \(N\)/);
      s.night=false; s.light=.18; assert.equal(cue(),'Waiting for daylight');
    } else if (p.study.light==='night') {
      assert.match(cue(),/night lighting/);
      s.night=true; s.light=.9; assert.equal(cue(),'Waiting for nightfall');
    } else {
      s.weather.wet=.8; assert.match(cue(),/shower/);
      s.weather.shower=true; s.weather.wet=.1; assert.equal(cue(),'Waiting for rain');
    }
  }
});

function openStudies(h) {
  h.key('KeyM'); h.id('tab-studies').emit('click');
  return h.id('study-list').children;
}
function frameAt(h,i) {
  openStudies(h)[i].querySelector('button').emit('click');
  h.settle();
  assert.ok(!h.id('viewfinder').hidden && !h.id('guide-dialog').open);
  assert.deepEqual(groundPosition(h),lookouts[i].view.slice(0,2));
}
function dragTo(h,target,zoom) {
  const [yaw,pitch]=aim(h.uniform('uEye'),target);
  const [x,y,z]=h.uniform('uForward'), startYaw=Math.atan2(x,-z), startPitch=Math.asin(y);
  const pointer={button:0,pointerId:13,pointerType:'mouse'};
  h.canvas.emit('pointerdown',{...pointer,clientX:100,clientY:100});
  h.canvas.emit('pointermove',{...pointer,clientX:100+M.wrapAngle(yaw-startYaw)*zoom/.003,
    clientY:100-(pitch-startPitch)*zoom/.003});
  h.canvas.emit('pointerup',pointer); h.settle();
}

test('all three framed studies produce captioned prints, distinct saved records and contact thumbnails',async()=>{
  const storage=new Map(), h=running({storage,reduced:true});
  for (const [i,p] of lookouts.entries()) {
    frameAt(h,i);
    assert.equal(h.id('study-name').textContent,p.study.name);
    assert.equal(h.id('study-hint').hidden,false);
    // An ordinary postcard from the right tile, with the wrong lens or light,
    // still prints without awarding the study.
    h.key('Space');
    assert.ok(h.id('print-dialog').open && h.id('print-study').hidden);
    assert.ok(!storage.has(PREFIX+p.id));
    h.id('retake').emit('click'); h.settle();
    if (p.study.zoom===2) h.key('Equal');
    if (p.study.light==='night') h.key('KeyN');
    if (p.study.rain) h.id('weather').emit('click');
    h.settle();
    dragTo(h,p.study.target,p.study.zoom);
    assert.equal(h.id('study-hint').dataset.ready,'true');
    const thumbnail=h.id('study-list').children[i].querySelector('canvas');
    const drawImage=thumbnail.pen.drawImage, frame=require('../src/postcard.js').layout(h.canvas.width,h.canvas.height);
    thumbnail.pen.drawImage=function(sheet,x,y,w,height,...dest) {
      assert.equal(sheet,h.id('print-preview'),'the album uses the exposed print');
      assert.ok(x>=frame.x-.001 && y>=frame.y-.001);
      assert.ok(x+w<=frame.x+frame.w+.001 && y+height<=frame.y+frame.h+.001);
      assert.deepEqual(dest,[0,0,thumbnail.width,thumbnail.height]);
      drawImage.call(this,sheet,x,y,w,height,...dest);
    };
    h.id('shutter').emit('click');
    assert.ok(!h.id('print-study').hidden);
    assert.equal(h.id('print-study').textContent,p.study.name+' · recorded');
    assert.ok(h.id('print-preview').pen.text.some(t=>t.includes(p.study.name.toUpperCase())));
    assert.equal(thumbnail.pen.counts.drawImage,1);
    await Promise.resolve();
    assert.match(h.id('print-download').download,/-study\.png$/);
    assert.equal(storage.get(PREFIX+p.id),'1');
    h.id('retake').emit('click'); h.id('shutter').emit('click');
    assert.equal(thumbnail.pen.counts.drawImage,2,'a retake replaces the contact print');
    h.key('Escape'); h.key('Escape'); h.settle();
    assert.equal(h.id('study-count').textContent,(i+1)+' of 3 studies recorded');
  }
  const reopened=running({storage});
  assert.equal(reopened.id('study-count').textContent,'3 of 3 studies recorded');
  assert.equal(reopened.id('stamp-count').textContent,'0 of 7 stamps');
  for (const card of openStudies(reopened)) assert.match(card.querySelector('small').textContent,/Recorded/);
  storage.clear(); reopened.win.emit('storage',{key:null});
  assert.equal(reopened.id('study-count').textContent,'0 of 3 studies recorded');
  assert.deepEqual(h.errors,[]);
});

test('a full store or late PNG encoder keeps the captured study available during the visit',()=>{
  const h=running({storageFull:true,holdPNG:true,reduced:true});
  const p=lookouts[0];
  frameAt(h,0); h.key('Equal'); h.settle(); dragTo(h,p.study.target,2);
  h.key('Space');
  assert.equal(h.id('study-count').textContent,'1 of 3 studies recorded · this visit');
  assert.match(h.id('print-study').textContent,/this visit/);
  h.gl.lost=true; h.canvas.emit('webglcontextlost');
  h.encodings[0].callback(h.encodings[0].blob);
  assert.equal(h.urls.size,0);
  h.gl.lost=false; h.canvas.emit('webglcontextrestored'); h.settle();
  h.win.emit('storage',{key:null}); h.id('reset').emit('click'); h.settle();
  assert.equal(h.id('study-count').textContent,'1 of 3 studies recorded · this visit');
  const card=openStudies(h)[0];
  assert.equal(card.querySelector('canvas').pen.counts.drawImage,1);
  assert.match(card.querySelector('small').textContent,/Recorded/);
  assert.deepEqual(h.errors,[]);
});

test('the walking prompt opens the correct study and the shutter rechecks a lens changed since the last frame',()=>{
  const h=running({coarse:true,reduced:true}), p=lookouts[0];
  assert.ok(h.id('lookout-camera').hidden);
  selectInGuide(h,p); h.id('travel').emit('click'); h.settle();
  assert.equal(h.id('lookout-camera').hidden,false);
  assert.match(h.id('lookout-camera').getAttribute('aria-label'),/Hands above the court/);
  h.id('lookout-camera').emit('click'); h.key('Equal'); h.settle(); dragTo(h,p.study.target,2);
  assert.equal(h.id('study-hint').dataset.ready,'true');
  h.id('lens-out').emit('click'); h.id('shutter').emit('click');
  assert.ok(h.id('print-dialog').open && h.id('print-study').hidden);
  assert.equal(h.id('study-count').textContent,'0 of 3 studies recorded');
});

test('a failed exposure earns no study and a failed thumbnail leaves the full print downloadable',async()=>{
  const h=running({reduced:true}), p=lookouts[0];
  frameAt(h,0); h.key('Equal'); h.settle(); dragTo(h,p.study.target,2);
  const pen=h.id('print-preview').getContext('2d'), drawImage=pen.drawImage;
  pen.drawImage=()=>{throw Error('copy failed');};
  h.key('Space');
  assert.ok(!h.id('print-dialog').open);
  assert.equal(h.id('study-count').textContent,'0 of 3 studies recorded');
  pen.drawImage=drawImage;
  h.id('study-list').children[0].querySelector('canvas').pen.drawImage=()=>{throw Error('thumbnail lost');};
  h.key('Space');
  assert.ok(h.id('print-dialog').open);
  assert.equal(h.id('study-count').textContent,'1 of 3 studies recorded');
  await Promise.resolve();
  assert.ok(!h.id('print-download').hidden && h.urls.has(h.id('print-download').href));
});
