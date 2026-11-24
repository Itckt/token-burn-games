'use strict';
const {before,test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const D = require('../js/design.js');
const S = require('../js/slices.js');

let mesh, profile, radii, heights;
const close = (a,b,tolerance=1e-8) => assert.ok(Math.abs(a-b)<tolerance,a+' vs '+b);
before(() => {
  mesh = G.noodles(); profile = P.measure(mesh);
  const count = mesh.vertices.length/G.STRIDE;
  radii = Float64Array.from({length:count},(_,i) => Math.hypot(mesh.vertices[i*G.STRIDE],mesh.vertices[i*G.STRIDE+2]));
  heights = Float64Array.from({length:count},(_,i) => mesh.vertices[i*G.STRIDE+1]);
});
const rim = G.RIM-G.WALL;
const slopeAt = taper => (G.RIM-G.BASE)/G.HEIGHT*taper;

test('every wall setting seats every available diameter at the first real surface it meets', () => {
  for (let percent=0; percent<=100; percent+=5) {
    const taper=percent/100, slope=slopeAt(taper);
    close(G.innerRadiusAt(G.HEIGHT,taper),rim);
    let lastGap=0;
    for (let width=72; width<=94; width++) {
      const fit=P.fit(profile,width,taper);
      let wallGap=Infinity, floor=Infinity, crown=-Infinity;
      for (let i=0; i<radii.length; i++) {
        const y=heights[i]*fit.scale+fit.offsetY;
        floor=Math.min(floor,y); crown=Math.max(crown,y);
        wallGap=Math.min(wallGap,rim-(G.HEIGHT-y)*slope-radii[i]*fit.scale);
      }
      assert.ok(wallGap>=-1e-12 && floor>=G.FLOOR-1e-12 && crown<G.HEIGHT);
      close(floor,fit.bottom); close(crown,fit.top); close(fit.gapMM,(floor-G.FLOOR)*P.mmPerUnit);
      close(fit.onFloor ? floor-G.FLOOR : wallGap,0);
      assert.ok(fit.gapMM>=lastGap); lastGap=fit.gapMM;
      if (!taper) assert.ok(fit.onFloor);
      const [x,y,z]=fit.contact;
      close(fit.contactY,y*fit.scale+fit.offsetY);
      close(rim-(G.HEIGHT-fit.contactY)*slope-Math.hypot(x,z)*fit.scale,wallGap);
      assert.ok(fit.outline.some(([r,h]) => Math.abs(h-fit.contactY)<1e-10 && Math.abs(r-Math.hypot(x,z)*fit.scale)<1e-10));
    }
  }
});

test('straight, nearly straight, out-of-range and absent wall settings have finite repeatable seats', () => {
  for (const value of [undefined,NaN,Infinity,-Infinity,2]) assert.deepEqual(P.fit(profile,88,value),P.fit(profile,88));
  assert.deepEqual(P.fit(profile,88,-1),P.fit(profile,88,0));
  for (const taper of [0,Number.MIN_VALUE,1e-15]) {
    const fit=P.fit(profile,94,taper);
    assert.equal(fit.gapMM,0); assert.equal(fit.onFloor,true); close(fit.bottom,G.FLOOR);
  }
  // Solve for the support transition at a fixed diameter by bisection.
  let lo=0,hi=1;
  for (let i=0;i<45;i++) {
    const t=(lo+hi)/2;
    if (P.fit(profile,88,t).onFloor) lo=t; else hi=t;
  }
  assert.ok(lo>0.5 && hi<0.75);
  assert.equal(P.fit(profile,88,lo-1e-8).gapMM,0);
  const lifted=P.fit(profile,88,hi+1e-8);
  assert.ok(lifted.gapMM>0 && lifted.gapMM<1e-4);
});

test('the scanner and metered pool use the selected lining from the floor through the rim', () => {
  for (const taper of [0,0.25,0.5,0.75,1]) {
    const fit=P.fit(profile,94,taper), slope=slopeAt(taper);
    for (const mm of [0,15,51,100]) {
      const s=S.scan(mesh,fit,mm);
      close(s.radius,rim-(G.HEIGHT-s.height)*slope);
    }
    for (const y of [G.FLOOR,fit.bottom,G.HEIGHT]) {
      const depth=y-G.FLOOR, r0=rim-(G.HEIGHT-G.FLOOR)*slope;
      // Integral of pi*(r0+slope*h)^2 in the physical cup.
      const integral=Math.PI*(r0*r0*depth+r0*slope*depth**2+slope**2*depth**3/3)*P.mmPerUnit**3/1000;
      close(P.volumeBelow(y,taper),integral);
    }
    const capacity=P.volumeBelow(fit.bottom,taper);
    for (const ml of [0,0.0001,capacity/2,capacity,capacity+1]) {
      const meter=P.meteredPour(fit,ml);
      close(P.volumeBelow(meter.surfaceY,taper),Math.min(ml,capacity));
      assert.ok(meter.surfaceY<=fit.bottom && meter.surfaceY>=G.FLOOR);
    }
  }
  assert.equal(P.volumeBelow(G.HEIGHT,NaN),P.volumeBelow(G.HEIGHT));
});

test('clearance sectors agree with an independently placed and rotated specimen', () => {
  for (const [width,taper] of [[72,1],[88,1],[94,0.5],[88,0]]) {
    const fit=P.fit(profile,width,taper), map=D.wallMap(mesh,fit);
    const expected=Array(24).fill(Infinity);
    const c=Math.cos(fit.rotation), s=Math.sin(fit.rotation);
    const v=mesh.vertices;
    for (let i=0; i<v.length; i+=G.STRIDE) {
      const x=fit.scale*(c*v[i]+s*v[i+2]), z=fit.scale*(-s*v[i]+c*v[i+2]);
      const y=fit.scale*v[i+1]+fit.offsetY, angle=Math.atan2(x,z)*180/Math.PI;
      const bin=Math.floor((angle+360)%360/15);
      expected[bin]=Math.min(expected[bin],(rim-(G.HEIGHT-y)*slopeAt(taper)-Math.hypot(x,z))*P.mmPerUnit);
    }
    map.gaps.forEach((mm,i) => close(mm,expected[i]));
    close(map.closestMM,Math.min(...expected));
    assert.equal(map.closeCount,expected.filter(mm=>mm<=0.5).length);
    if (!taper) assert.ok(map.closestMM>6 && map.closeCount===0);
  }
});

test('a sparse clearance map distinguishes unmeasured arcs and wraps at the front of the cup', () => {
  const b=new G.Builder();
  for (const x of [-1/1024,0,1/1024]) b.vertex([x,1,1],[0,1,0]);
  const mesh=b.finish(), fit={scale:1,offsetY:0,rotation:0,taper:0};
  const map=D.wallMap(mesh,fit);
  assert.equal(map.gaps.filter(mm=>mm===null).length,22);
  close(map.gaps[0],(rim-Math.hypot(1,1/1024))*P.mmPerUnit); close(map.gaps[23],map.gaps[0]);
  const turned=D.wallMap(mesh,{...fit,rotation:2*Math.PI});
  turned.gaps.forEach((mm,i) => mm===null ? assert.equal(map.gaps[i],null) : close(mm,map.gaps[i]));
});

test('the fit finder checks both unrounded targets inclusively, including no, one and all matches', () => {
  const sizes=D.measureSizes(profile,1), brief=D.findFits(sizes);
  assert.equal(sizes.length,23);
  sizes.forEach((s,i) => {
    const fit=P.fit(profile,72+i);
    assert.equal(s.diameter,72+i); close(s.capacityML,P.volumeBelow(fit.bottom));
    close(s.headroomMM,(G.HEIGHT-fit.top)*P.mmPerUnit);
  });
  assert.deepEqual(brief.matches.map(s=>s.diameter),[85,86,87,88]);
  const selected=sizes[16];
  const exact=D.findFits(sizes,selected.capacityML,selected.headroomMM);
  assert.deepEqual(exact.matches,[selected]);
  for (const [ml,mm] of [[selected.capacityML+1e-6,selected.headroomMM],[selected.capacityML,selected.headroomMM+1e-6]]) {
    assert.equal(D.findFits(sizes,ml,mm).matches.length,0);
  }
  assert.equal(D.findFits(sizes,-1,-5).matches.length,23);
  assert.equal(D.findFits(sizes,999,1000).matches.length,0);
  assert.deepEqual(D.findFits(sizes,NaN,Infinity),brief);
  assert.deepEqual(D.findFits(D.measureSizes(profile,0.5)).matches.map(s=>s.diameter),[93,94]);
  assert.deepEqual(D.findFits(D.measureSizes(profile,0)).matches,[]);
  assert.deepEqual(D.findFits(sizes),brief);
});
