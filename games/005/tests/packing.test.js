'use strict';
const {before, test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const L = require('../js/lesson.js');

let mesh, profile;
const close = (a,b,epsilon=1e-8) => assert.ok(Math.abs(a-b) < epsilon, a+' vs '+b);
before(() => { mesh=G.noodles(); profile=P.measure(mesh); });

test('the model scale, contact point and outline are measured from the generated strands', () => {
  close((G.HEIGHT-G.FLOOR)*P.mmPerUnit,100);
  assert.equal(profile.outline[0][1],profile.bottom);
  assert.equal(profile.outline.at(-1)[1],profile.top);
  assert.equal(Math.max(...profile.outline.map(([r]) => r)),profile.radius);
  assert.ok(profile.outline.every((p,i,all) => !i || p[1]>all[i-1][1]));
  const [x,y,z] = profile.contact;
  assert.ok(profile.outline.some(([r,h]) => h===y && r===Math.hypot(x,z)));
  assert.ok(profile.outline.length<=15);
  assert.deepEqual(P.measure(mesh),profile);
});

test('every slider width fits the whole cake inside the fixed taper with a real support point', () => {
  const v=mesh.vertices;
  let lastGap=-1;
  for (let width=P.minDiameter; width<=P.maxDiameter; width++) {
    const fit=P.fit(profile,width);
    let floorClearance=Infinity, wallClearance=Infinity, radius=0, top=-Infinity;
    for (let i=0; i<v.length; i+=G.STRIDE) {
      const r=fit.scale*Math.hypot(v[i],v[i+2]), y=v[i+1]*fit.scale+fit.offsetY;
      wallClearance=Math.min(wallClearance,G.radiusAt(y)-G.WALL-r);
      floorClearance=Math.min(floorClearance,y-G.FLOOR);
      radius=Math.max(radius,r); top=Math.max(top,y);
    }
    assert.ok(wallClearance>=-1e-12 && floorClearance>=-1e-12 && top<G.HEIGHT);
    close(radius*2*P.mmPerUnit,width);
    close(floorClearance*P.mmPerUnit,fit.gapMM);
    close(top,fit.top);
    close(fit.onFloor ? floorClearance : wallClearance,0);
    assert.ok((fit.onFloor ? wallClearance : floorClearance)>0);
    assert.ok(fit.gapMM>=lastGap);
    for (const [r,y] of fit.outline) assert.ok(y>=G.FLOOR-1e-12 && r<=G.radiusAt(y)-G.WALL+1e-12);
    lastGap=fit.gapMM;
  }
  assert.ok(P.fit(profile,76).onFloor && !P.fit(profile,77).onFloor);
  assert.equal(P.fit(profile,88).gapMM.toFixed(1),'34.0');
  assert.equal(P.fit(profile,94).gapMM.toFixed(1),'51.5');
});

test('contact is continuous through the precise width where floor and wall meet the block together', () => {
  const slope=(G.RIM-G.BASE)/G.HEIGHT;
  const threshold=2*profile.radius*P.mmPerUnit*(G.radiusAt(G.FLOOR)-G.WALL)/(profile.intercept+slope*profile.bottom);
  const below=P.fit(profile,threshold-1e-5), at=P.fit(profile,threshold), above=P.fit(profile,threshold+1e-5);
  assert.ok(below.onFloor && !above.onFloor);
  close(at.bottom,G.FLOOR);
  assert.ok(above.gapMM>0 && above.gapMM<0.0001);
  assert.ok(Math.abs(above.offsetY-below.offsetY)<1e-5);
  assert.equal(above.rotation,below.rotation);
});

test('width bounds, invalid inputs and returning to a previous size are deterministic', () => {
  const normal=P.fit(profile);
  assert.equal(normal.diameter,P.defaultDiameter);
  for (const v of [undefined,NaN,Infinity,-Infinity]) assert.deepEqual(P.fit(profile,v),normal);
  assert.deepEqual(P.fit(profile,-5),P.fit(profile,P.minDiameter));
  assert.deepEqual(P.fit(profile,200),P.fit(profile,P.maxDiameter));
  P.fit(profile,81.25);
  assert.deepEqual(P.fit(profile),normal);
  for (const vertices of [[],[1],Array(G.STRIDE).fill(0),Array(G.STRIDE*2).fill(NaN)]) {
    assert.throws(() => P.measure({vertices:Float32Array.from(vertices)}),RangeError);
  }
  assert.throws(() => P.measure({vertices:mesh.vertices,hydrated:new Float32Array(6)}),RangeError);
});

test('waterline stops use the lowest and highest real dry curls, including between frame times', () => {
  for (const fraction of [0,0.15,0.5,0.9,1]) {
    const height=profile.bottom+(profile.top-profile.bottom)*fraction;
    const t=L.timeAtWaterline(height), s=L.scene(t,profile);
    close(s.surfaceY,height);
    assert.equal(s.index,3);
    assert.ok(L.scene(t-0.001,profile).surfaceY<height && L.scene(t+0.001,profile).surfaceY>height);
    assert.equal(L.section(s).pool,fraction===1 ? 'Block covered' : 'At lower curls');
  }
  const start=L.steps[3].start, end=L.timeAtWaterline(1000);
  assert.equal(L.section(L.scene(start,profile)).pool,'Dry pocket');
  assert.equal(L.section(L.scene(L.timeAtWaterline(profile.bottom)-0.001,profile)).pool,'Below block');
  assert.ok(L.scene(end-0.1).water<L.scene(end).water && end<L.steps[4].start);
  for (const v of [-10,undefined,NaN,Infinity]) assert.equal(L.timeAtWaterline(v),start);
  close(L.scene(L.duration,profile).bottom,profile.wetBottom);
  close(L.scene(L.duration,profile).top,profile.wetTop);
});
