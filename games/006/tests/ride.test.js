'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ride.js');
const M = require('../js/math.js');
const tick = 1/60;
const near = (a,b,epsilon=1e-7) => assert.ok(Math.abs(a-b) <= epsilon, a+' vs '+b);
function select(s, target) { while (s.target < target) R.command(s,'faster'); }
function until(s, predicate, limit = 240) {
  for (let i=0; i<limit*60 && !predicate(s); i++) R.advance(s,tick);
  assert.ok(predicate(s),'condition reached within '+limit+' simulated seconds');
}

test('all five platform spans, station centres and legs repeat on both sides of the seam', () => {
  assert.equal(R.STATIONS.length,5);
  assert.equal(R.STATIONS.reduce((sum, _, i) => sum + R.legLength(i),0),R.LENGTH);
  for (let lap=-2;lap<=2;lap++) R.STATIONS.forEach((s,i) => {
    const pos = s.at + lap*R.LENGTH;
    assert.equal(R.routeLeg(pos),i);
    assert.equal(R.routeLeg(pos-0.001),M.mod(i-1,5));
    assert.equal(R.stationAt(pos-R.STATION_BACK),i);
    assert.equal(R.stationAt(pos-R.STATION_BACK-0.01),-1);
    assert.equal(R.stationAt(pos+R.STATION_FRONT-0.01),i);
    assert.equal(R.stationAt(pos+R.STATION_FRONT),-1);
    assert.equal(R.stationAt(pos+R.legLength(i)/2),-1);
    assert.equal((pos+R.STATION_FRONT)%R.CHUNK || 0,0);
    assert.equal((pos-R.STATION_BACK)%R.CHUNK || 0,0);
  });
});
test('track is straight through stations and curves smoothly between them', () => {
  R.STATIONS.forEach((s,i) => {
    for (let x=s.at-R.STATION_BACK; x<=s.at+R.STATION_FRONT; x+=4) {
      near(R.trackOffset(x),0); near(R.trackSlope(x),0,1e-6);
    }
    const mid = s.at + R.legLength(i)/2;
    assert.ok(Math.abs(R.trackOffset(mid))>15);
    assert.equal(Math.sign(R.trackOffset(mid)), i%2 ? -1 : 1);
  });
  for (let x=-R.LENGTH; x<R.LENGTH; x+=1.25) {
    near(R.trackOffset(x),R.trackOffset(x+R.LENGTH));
    assert.ok(Math.abs(R.trackSlope(x))<0.34);
    assert.ok(Math.abs(R.trackSlope(x+0.5)-R.trackSlope(x))<0.01);
  }
});
test('departure is deliberate and target speed changes in bounded 10 km/h steps', () => {
  const s=R.createRide(); R.advance(s,10);
  assert.deepEqual([s.position,s.speed,s.target,s.berth,R.driveState(s),R.doorState(s)],[0,0,0,0,'Ready','Closed']);
  for(let i=0;i<14;i++) R.command(s,'faster');
  assert.equal(s.target,80); assert.equal(s.speed,0);
  R.advance(s,tick); assert.equal(s.berth,null); assert.equal(R.driveState(s),'Powering');
  assert.ok(s.speed > 0 && s.speed <= 1.11*tick);
  for(let i=0;i<14;i++) R.command(s,'slower');
  assert.equal(s.target,0);
});
test('traction, cruising and braking use physical units and finite rates', () => {
  const s=R.createRide(); select(s,30); R.advance(s,1);
  near(s.speed,1.1); near(s.position,0.55);
  R.advance(s,10); near(s.speed,30/3.6); assert.equal(R.driveState(s),'Cruising');
  const at=s.position; R.advance(s,1); near(s.position-at,30/3.6);
  R.command(s,'slower'); assert.equal(R.driveState(s),'Braking'); R.advance(s,1);
  near(s.speed,30/3.6-1.36);
  R.command(s,'brake'); assert.equal(s.target,0);
  assert.equal(s.hardBrake,true); R.advance(s,1); near(s.speed,30/3.6-1.36-2.50);
  until(s,x=>x.speed===0);
  assert.equal(R.driveState(s),'Stopped'); assert.equal(s.berth,null);
  const stopped=s.position; R.advance(s,5); assert.equal(s.position,stopped);
  R.command(s,'faster'); R.advance(s,1); assert.ok(s.position>stopped);
});
test('automatic approach reaches the exact berth smoothly at every target setting', () => {
  for(let target=10;target<=R.MAX_KMH;target+=10) {
    const s=R.createRide(); select(s,target);
    let speedBefore, sawArrival=false;
    for(let i=0;i<200*60 && s.last===0;i++) {
      const position=s.position; speedBefore=s.speed;
      R.advance(s,tick);
      assert.ok(s.position>=position && s.position<=R.STATIONS[1].at);
      assert.ok(s.speed*3.6 <= target+1e-8);
      sawArrival ||= R.driveState(s)==='Arriving';
    }
    assert.equal(sawArrival,true); assert.ok(speedBefore < 0.06);
    assert.deepEqual([s.position,s.berth,s.last,s.speed,s.phase,s.door,s.target],[432,1,1,0,'opening',0,target]);
  }
});
test('doors dwell, close and release traction in order; the selected speed is retained', () => {
  const s=R.createRide(); select(s,40); until(s,x=>x.phase==='opening');
  const stop=s.position;
  R.advance(s,R.DOOR_TIME/2); near(s.door,0.5); assert.equal(R.doorState(s),'Opening');
  R.advance(s,R.DOOR_TIME/2); assert.equal(s.door,1); assert.equal(R.doorState(s),'Open');
  R.advance(s,R.DWELL_TIME-tick); assert.equal(s.phase,'dwell'); assert.equal(s.door,1);
  R.advance(s,tick); assert.equal(R.doorState(s),'Closing');
  R.advance(s,R.DOOR_TIME); assert.equal(s.phase,'ready'); assert.equal(s.door,0);
  assert.equal(s.position,stop); assert.equal(s.speed,0); assert.equal(s.berth,1);
  R.advance(s,tick); assert.equal(s.berth,null); assert.ok(s.speed>0); assert.equal(s.target,40);
});
test('manual doors reverse mid-travel, interlock traction, and reject requests away from the berth', () => {
  const s=R.createRide(); R.command(s,'doors'); R.advance(s,0.5);
  const partial=s.door; assert.ok(partial>0 && partial<1);
  select(s,80); R.command(s,'doors'); R.advance(s,0.2); assert.ok(s.door<partial);
  R.command(s,'doors'); R.advance(s,R.DOOR_TIME); assert.equal(s.phase,'dwell');
  assert.equal(s.position,0); assert.equal(s.speed,0);
  R.command(s,'doors'); R.advance(s,R.DOOR_TIME+tick); assert.equal(s.phase,'running');
  const before={...s}; assert.match(R.command(s,'doors'),/berthed/); assert.deepEqual(s,before);
  R.command(s,'brake'); R.advance(s,1);
  assert.equal(s.speed,0); assert.equal(s.berth,null);
  assert.match(R.command(s,'doors'),/berthed/);
});
test('a zero target selected during boarding keeps the train on the platform', () => {
  const s=R.createRide(); select(s,60); until(s,x=>x.phase==='dwell');
  R.command(s,'brake'); R.advance(s,30);
  assert.deepEqual([s.position,s.berth,s.speed,s.target,s.phase,s.door],[432,1,0,0,'ready',0]);
  R.command(s,'doors'); R.advance(s,R.DOOR_TIME); assert.equal(s.phase,'dwell');
});
test('pause freezes fractional time, movement, and boarding, and ignores drive commands', () => {
  for (const phase of ['running','opening','dwell','closing']) {
    const s=R.createRide(); select(s,50); until(s,x=>x.phase===phase);
    R.advance(s,0.007); R.command(s,'pause'); const before={...s};
    R.advance(s,25); assert.match(R.command(s,'faster'),/Resume/);
    assert.match(R.command(s,'doors'),/Resume/); assert.deepEqual(s,before);
    assert.equal(R.driveState(s),'Paused');
    R.command(s,'pause'); R.advance(s,tick); assert.ok(s.time>before.time);
  }
});
test('arbitrary frame partitions give the same simulation at a shared tick', () => {
  function run(deltas) {
    const s=R.createRide(); select(s,80);
    deltas.forEach(dt=>R.advance(s,dt)); return s;
  }
  const expected=run([100]);
  for (const fps of [24,30,60,90,144]) {
    const actual=run(Array(100*fps).fill(1/fps));
    near(actual.fraction,expected.fraction);
    assert.deepEqual({...actual,fraction:0},{...expected,fraction:0});
  }
  const idle=R.createRide(), before={...idle};
  for (const dt of [-1,0,NaN,Infinity]) R.advance(idle,dt);
  assert.deepEqual(idle,before);
});
test('the service completes two laps, wraps the route monitor, and keeps increasing world distance', () => {
  const s=R.createRide(); select(s,80);
  for(let n=1;n<=10;n++) {
    until(s,x=>x.phase==='opening' && x.last===n%5);
    assert.equal(s.position,R.STATIONS[n%5].at+Math.floor(n/5)*R.LENGTH);
    assert.equal(s.nextMark-s.position,R.legLength(s.last));
    assert.equal(s.berth,n%5); assert.equal(s.door,0); assert.equal(s.speed,0);
  }
});
test('mixed driver inputs preserve door, target, speed and route invariants', () => {
  const s=R.createRide(), rand=M.seeded(3603);
  const actions=['faster','faster','slower','doors','brake','pause'];
  for (let i=0;i<14000;i++) {
    if(rand()<0.10) R.command(s,actions[Math.floor(rand()*actions.length)]);
    const previous=s.position;
    R.advance(s,rand()*0.32);
    assert.ok(s.position>=previous && s.position<=s.nextMark);
    assert.ok(s.speed>=0 && s.speed*3.6<=R.MAX_KMH+1e-8);
    assert.ok(s.target>=0 && s.target<=R.MAX_KMH && s.target%10===0);
    assert.ok(s.door>=0 && s.door<=1);
    if(s.door>0) { assert.notEqual(s.berth,null); assert.equal(s.speed,0); }
    if(s.berth!==null) assert.equal(R.stationAt(s.position),s.berth);
  }
});
test('keyboard aliases, unsupported keys and instrument units agree with the guide', () => {
  for(const [action,keys] of Object.entries({faster:['ArrowUp','KeyW'],slower:['ArrowDown','KeyS'],
    brake:['Space'],doors:['KeyD'],pause:['KeyP'],center:['KeyR'],left:['ArrowLeft'],right:['ArrowRight'],
    help:['KeyH','Slash'],view:['KeyV'],dismiss:['Escape']})) {
    keys.forEach(key=>assert.equal(R.keyAction(key),action));
  }
  assert.equal(R.keyAction('F5'),'');
  assert.deepEqual([-1,0,29.7,999,1000,2352].map(R.distanceLabel),['0 m','0 m','30 m','999 m','1.00 km','2.35 km']);
});
