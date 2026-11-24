'use strict';
const {before,test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const D = require('../js/design.js');
const L = require('../js/lesson.js');
const O = require('../js/observations.js');
const close = (a,b,eps=1e-8) => assert.ok(Math.abs(a-b)<=eps,a+' versus '+b);
let mesh, profile, stops;
before(() => {
  mesh = G.noodles();
  profile = P.measure(mesh);
  stops = O.forSpecimen(profile);
});

function lowestAt(soft) {
  let bottom = Infinity;
  for (let i=0; i<mesh.hydrated.length/6; i++) {
    bottom = Math.min(bottom,mesh.vertices[i*G.STRIDE+1]*(1-soft)+mesh.hydrated[i*6+1]*soft);
  }
  return bottom;
}

test('the drawn reactions balance gravity and are normal to the actual supporting surface at every bench setting', () => {
  for (let t=0; t<=100; t+=5) for (let d=72; d<=94; d++) {
    const fit = P.fit(profile,d,t/100), f = D.supportForces(fit,55);
    close(f.weightN,0.055*9.81);
    assert.equal(f.arrows.length,fit.onFloor ? 2 : 3);
    const net = [0,0];
    for (const {kind,tail,tip} of f.arrows) {
      const dx=tip[0]-tail[0], dy=tip[1]-tail[1], length=Math.hypot(dx,dy);
      assert.ok(length>0); assert.equal(tip[2],tail[2]);
      const magnitude=kind==='weight' ? f.weightN : f.reactionN;
      net[0]+=magnitude*dx/length; net[1]+=magnitude*dy/length;
      if (kind==='weight') { assert.ok(dy<0); close(dx,0); continue; }
      close(magnitude*dy/length,f.upN); close(Math.abs(magnitude*dx/length),f.inwardN);
      if (fit.onFloor) {
        close(tail[1],G.FLOOR); close(f.inwardN,0); close(f.reactionN,f.weightN);
      } else {
        const side=Math.sign(tail[0]);
        close(tail[1],fit.contactY); close(side*tail[0],G.innerRadiusAt(tail[1],fit.taper));
        // Dot the arrow with a tangent constructed from the rim and floor.
        const dr=G.innerRadiusAt(G.HEIGHT,fit.taper)-G.innerRadiusAt(G.FLOOR,fit.taper);
        close(dx*side*dr+dy*(G.HEIGHT-G.FLOOR),0);
        assert.ok(dx*side<0 && dy>0);
      }
    }
    close(net[0],0); close(net[1],0);
  }
});

test('doubling mass doubles each component without moving the seat, including the straight-wall limit', () => {
  for (const taper of [0,Number.EPSILON,0.5,1]) {
    const fit=Object.freeze(P.fit(profile,94,taper));
    const a=D.supportForces(fit,40), b=D.supportForces(fit,80);
    for (const key of ['weightN','reactionN','upN','inwardN']) close(2*a[key],b[key]);
    assert.deepEqual(a.arrows,b.arrows);
    assert.equal(D.supportForces(fit,-10).massG,D.minMassG);
    assert.equal(D.supportForces(fit,200).massG,D.maxMassG);
    for (const value of [undefined,NaN,Infinity]) assert.deepEqual(D.supportForces(fit,value),b);
  }
});

test('the guided dry contact surface clips only protruding curls and stays inside the lining through the steep', () => {
  const sectors=new Set();
  for (let i=0; i<mesh.hydrated.length/6; i++) {
    const raw=Array.from(mesh.vertices.subarray(i*G.STRIDE,i*G.STRIDE+3)), dry=G.seatedPoint(raw);
    const wet=mesh.hydrated.subarray(i*6,i*6+3), r=Math.hypot(raw[0],raw[2]), wall=G.innerRadiusAt(raw[1]);
    close(dry[1],raw[1]);
    if (r<=wall) assert.deepEqual(dry,raw);
    else {
      close(Math.hypot(dry[0],dry[2]),wall);
      close(dry[0]*raw[2],dry[2]*raw[0]);
      sectors.add(Math.floor((Math.atan2(raw[0],raw[2])+Math.PI)*4/Math.PI)%8);
    }
    for (const t of [0,0.35,1]) {
      const [x,y,z]=dry.map((v,k)=>v*(1-t)+wet[k]*t);
      assert.ok(Math.hypot(x,z)<=G.innerRadiusAt(y)+1e-12);
    }
  }
  assert.equal(sectors.size,8);
});

test('the depth ruler agrees with every interpolated vertex and its inverse finds the first crossing', () => {
  const original=(lowestAt(0)-G.FLOOR)*P.mmPerUnit, deepest=(lowestAt(0)-lowestAt(1))*P.mmPerUnit;
  for (const time of [36,36.01,37,39,40,42,L.looseTime,45,38,36]) {
    const scene=L.scene(time,profile), bottom=lowestAt(scene.soft), g=L.gapReading(profile,scene.bottom);
    close(g.originalMM,original); close(g.reachedMM,(profile.bottom-bottom)*P.mmPerUnit);
    close(g.remainingMM,(bottom-G.FLOOR)*P.mmPerUnit);
  }
  for (const depth of [0.0001,original/4,original/2,0.9*deepest,deepest]) {
    const t=L.timeAtGapDepth(profile,depth), at=L.scene(t,profile);
    assert.ok(t>36 && t<=L.looseTime); close((profile.bottom-lowestAt(at.soft))*P.mmPerUnit,depth);
    assert.ok((profile.bottom-lowestAt(L.scene(t-0.001).soft))*P.mmPerUnit<depth);
  }
  assert.equal(L.timeAtGapDepth(profile,0),36);
  for (const depth of [original,deepest+Number.EPSILON*deepest,deepest+0.001,original+1,-1,NaN,Infinity,undefined]) {
    assert.equal(L.timeAtGapDepth(profile,depth),null);
  }
  const still={bottom:1,wetBottom:1,top:2};
  assert.equal(L.timeAtGapDepth(still,2),null);
  const resting={bottom:G.FLOOR,wetBottom:G.FLOOR};
  assert.equal(L.gapReading(resting,G.FLOOR).reachedMM,0);
  assert.equal(L.timeAtGapDepth(resting,1),null);
});

test('observation captions use the measured specimen at the instant the named change occurs', () => {
  for (const p of [profile,P.measure(G.noodles(431))]) {
    const cues=O.forSpecimen(p);
    assert.deepEqual(cues.map(c=>L.at(c.time).index),[0,1,2,3,4]);
    const [gap,seat,bump,pour,steep]=cues, size=(p.bottom-G.FLOOR)*P.mmPerUnit;
    assert.ok(gap.note.includes(size.toFixed(1)+' mm'));
    assert.equal(L.scene(seat.time,p).lift,0); assert.ok(L.scene(seat.time-0.01,p).lift>0);
    assert.ok(bump.note.includes(((L.floorAt(0.38,L.scene(bump.time,p).baseFlex)-G.FLOOR)*P.mmPerUnit).toFixed(1)+' mm'));
    close(L.scene(pour.time,p).surfaceY,p.bottom);
    close((p.bottom-L.scene(steep.time,p).bottom)*P.mmPerUnit,size/2);
    assert.ok(steep.note.includes((size/2).toFixed(1)+' mm'));
  }
  const shallow={...profile,wetBottom:profile.bottom-0.01,limits:null};
  const last=O.forSpecimen(shallow).at(-1);
  assert.equal(last.time,L.looseTime);
  assert.ok(last.note.includes((0.01*P.mmPerUnit).toFixed(1)+' mm'));
});

test('the flex reading at the bracket agrees with the triangle directly underneath it', () => {
  const {vertices,indices}=G.base(), {x,z}=L.gapProbe;
  const scene=L.scene(L.bumpTime,profile);
  for (let i=0; i<indices.length; i+=3) {
    const [a,b,c]=Array.from(indices.subarray(i,i+3),id=>vertices.subarray(id*G.STRIDE,id*G.STRIDE+3));
    if (![a,b,c].every(p=>Math.abs(p[1]-G.FLOOR)<1e-7)) continue;
    const bx=b[0]-a[0], bz=b[2]-a[2], cx=c[0]-a[0], cz=c[2]-a[2];
    const det=bx*cz-cx*bz;
    const u=((x-a[0])*cz-(z-a[2])*cx)/det, v=(bx*(z-a[2])-bz*(x-a[0]))/det;
    if (u<0 || v<0 || u+v>1) continue;
    const displaced=p=>L.floorAt(p[0],scene.baseFlex);
    const actual=(1-u-v)*displaced(a)+u*displaced(b)+v*displaced(c);
    close(actual*P.mmPerUnit,L.floorAt(x,scene.baseFlex)*P.mmPerUnit,0.01);
    assert.ok(stops[2].note.includes(((actual-G.FLOOR)*P.mmPerUnit).toFixed(1)+' mm'));
    return;
  }
  assert.fail('the bracket must lie on a drawn floor triangle');
});

test('observation playback stops once per crossing at every speed, even on a frame spanning the entire lesson', () => {
  for (const rate of L.rates) {
    let state=L.clock(0,true);
    for (const stop of stops) {
      const elapsed=(stop.time-state.time)/rate;
      const before=O.advance(state,elapsed-0.00001,rate,false,stops);
      assert.ok(before.playing && before.time<stop.time);
      const held=O.advance(before,0.00002,rate,false,stops);
      assert.deepEqual(held,L.clock(stop.time));
      assert.deepEqual(O.advance(state,Number.MAX_VALUE,rate,false,stops),held);
      assert.equal(O.advance(held,999,rate,false,stops),held);
      state=L.toggle(held);
      assert.ok(O.advance(state,0.0001,rate,false,stops).time>stop.time);
    }
    assert.deepEqual(O.advance(state,1000,rate,false,stops),L.clock(45));
  }
});

test('chapter loops stop on the next lap after a resume or late seek and preserve invalid or paused frames', () => {
  for (const [index,stop] of stops.entries()) {
    const step=L.steps[index], state=L.clock(stop.time,true);
    for (const rate of L.rates) {
      assert.deepEqual(O.advance(state,step.duration/rate,rate,true,stops),L.clock(stop.time));
      const justBefore=O.advance(state,(step.duration-0.01)/rate,rate,true,stops);
      assert.ok(justBefore.playing); close(justBefore.time,stop.time-0.01);
      const late=L.clock(step.start+step.duration-0.01,true);
      assert.deepEqual(O.advance(late,10000,rate,true,stops),L.clock(stop.time));
      const wrapped=O.advance(late,0.02/rate,rate,true,stops);
      assert.ok(wrapped.playing); close(wrapped.time,step.start+0.01);
    }
    for (const dt of [-1,0,NaN,Infinity]) assert.equal(O.advance(state,dt,2,true,stops),state);
    const held=L.clock(stop.time);
    assert.equal(O.advance(held,0.01,2,true,stops),held);
    assert.deepEqual(O.advance(state,0.01,99,false,stops),L.tick(state,0.01));
  }
});
