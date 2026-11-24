'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const street=require('../js/street'), {regions}=require('../js/art');
const {openPage,ticks,key,surface}=require('./support/page');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' vs '+b);

test('lighting crossfades from its current mixture at different frame rates and snaps on request',()=>{
  function sample(fps) {
    const light=street.createLight();
    for (const mode of ['shower','evening','afternoon']) {
      const before={...light};
      street.setLight(light,mode);
      near(light.rain,before.rain); near(light.night,before.night);
      for (let i=0;i<fps/6;i++) {
        street.stepLight(light,1/fps);
        assert.ok(light.rain>=0 && light.night>=0 && light.rain+light.night<=1.000001);
      }
    }
    return light;
  }
  const a=sample(30), b=sample(120);
  near(a.rain,b.rain); near(a.night,b.night);
  const before={...a};
  for (const dt of [NaN,Infinity,-2,0]) street.stepLight(a,dt);
  for (const id of ['constructor','snow',null]) street.setLight(a,id,true);
  assert.deepEqual(a,before);
  street.setLight(a,'shower',true); assert.deepEqual(a,{mode:'shower',rain:1,night:0});
  street.setLight(a,'evening'); for (let i=0;i<150;i++) street.stepLight(a,1/60);
  assert.deepEqual(a,{mode:'evening',rain:0,night:1});
});
test('the minibus crosses all three sashes in order and wraps entirely outside the painted panorama',()=>{
  const {width,top,height,period}=street.bus;
  assert.ok(top>0 && top+height<1 && width>0 && width<1/3);
  const panes=[], speed=street.busLeft(1)-street.busLeft(0);
  assert.ok(speed>0);
  for (let t=0;t<period;t+=.125) {
    const x=street.busLeft(t);
    near(x,street.busLeft(t+period)); near(x,street.busLeft(t-period));
    const next=street.busLeft(t+.125);
    if (next<x) { assert.ok(x>1 && next+width<0); }
    else near(next-x,speed*.125);
    const sash=Math.floor((x+width/2)*3);
    if (sash>=0 && sash<3 && !panes.includes(sash)) panes.push(sash);
  }
  assert.deepEqual(panes,[0,1,2]);
  const [u,v,r,b]=regions.street, evening=regions.streetNight;
  near(evening[2]-evening[0],r-u); near(evening[3]-evening[1],b-v);
  for (let i=0;i<3;i++) {
    const sash=regions['window'+i];
    assert.ok(sash[0]>=u && sash[2]<=r); near(sash[1],v); near(sash[3],b);
  }
});
test('weather buttons and shortcut drive shader lighting, rainfall and traffic without rebuilding the café',()=>{
  const p=openPage(),gl=p.gl;
  const resources=gl.resources.length, uploads=gl.uploads.filter(u=>u.static).length;
  const left=surface(p).u_busLeft;
  p.$('light-shower').click(); ticks(p,3);
  assert.equal(p.$('stage').dataset.light,'shower');
  assert.ok(surface(p).u_rain>0 && surface(p).u_rain<1);
  assert.ok(surface(p).u_rainTime>0 && surface(p).u_rainTime<1);
  assert.ok(surface(p).u_busLeft>left);
  key(p,'W'); key(p,'w',{repeat:true}); key(p,'w',{ctrlKey:true});
  assert.equal(p.$('stage').dataset.light,'evening');
  ticks(p,100);
  assert.equal(surface(p).u_rain,0); assert.equal(surface(p).u_night,1);
  for (const mode of street.modes) {
    assert.equal(p.$('light-'+mode).getAttribute('aria-pressed'),String(mode==='evening'));
  }
  key(p,'w'); ticks(p,100);
  assert.equal(p.$('stage').dataset.light,'afternoon'); assert.equal(surface(p).u_night,0);
  assert.equal(gl.resources.length,resources);
  assert.equal(gl.uploads.filter(u=>u.static).length,uploads);
  assert.equal(gl.draws.filter(d=>d.name==='shadow').length,1);
  assert.equal(gl.reads,0);
  assert.ok(gl.uploads.filter(u=>!u.static).every(u=>u.bytes<16384));
});
test('a hidden page freezes street time, and reduced motion paints changes once and then rests',()=>{
  const p=openPage(); p.$('light-shower').click(); ticks(p,10);
  const parked=surface(p).u_busLeft, rain=surface(p).u_rainTime;
  p.doc.hidden=true; p.doc.emit('visibilitychange'); p.win.tick(360000);
  p.doc.hidden=false; p.doc.emit('visibilitychange'); p.win.tick();
  near(surface(p).u_busLeft,parked); near(surface(p).u_rainTime,rain);
  p.win.motion.matches=true; p.win.motion.emit('change'); p.win.tick();
  assert.equal(surface(p).u_rain,1); assert.equal(p.win.frames.size,0);
  const count=p.gl.draws.length;
  ticks(p,40); assert.equal(p.gl.draws.length,count);
  p.$('light-evening').click(); p.win.tick();
  assert.equal(surface(p).u_night,1); assert.equal(surface(p).u_rain,0);
  near(surface(p).u_busLeft,parked); near(surface(p).u_rainTime,rain);
  assert.equal(p.win.frames.size,0);
  p.win.motion.matches=false; p.win.motion.emit('change'); ticks(p,3);
  assert.notEqual(surface(p).u_busLeft,parked);
});
