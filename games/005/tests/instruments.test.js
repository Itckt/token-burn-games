'use strict';
const {before, test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const S = require('../js/slices.js');

let mesh, profile;
before(() => { mesh = G.noodles(); profile = P.measure(mesh); });
const close = (a,b,tolerance=1e-8) => assert.ok(Math.abs(a-b) <= tolerance, a+' vs '+b);
function triangles(points, faces) {
  const b = new G.Builder();
  for (const p of points) b.vertex(p,[0,1,0]);
  for (const face of faces) b.tri(...face);
  return b.finish();
}

test('a slice gives the same two edge intersections for every triangle winding', () => {
  const points = [[0,0,0],[4,4,0],[0,4,8]];
  for (const face of [[0,1,2],[2,1,0],[1,2,0],[2,0,1],[0,2,1],[1,0,2]]) {
    const triangle = triangles(points,[face]);
    const line = S.intersect(triangle,2);
    assert.equal(line.length,4);
    const endpoints = [line.slice(0,2),line.slice(2)].sort((a,b) => a[0]-b[0]);
    assert.deepEqual(endpoints,[[0,4],[2,0]]);
    for (const outside of [-4,0,4,10]) assert.deepEqual(S.intersect(triangle,outside),[]);
  }
});

test('a horizontal edge, a point contact and a coplanar face have well-defined sections', () => {
  const slab = triangles([[0,1,0],[2,1,2],[2,3,4],[0,1,3]],[[0,1,2],[0,1,3]]);
  assert.deepEqual(S.intersect(slab,1),[0,0,2,2]);
  assert.deepEqual(S.intersect(slab,3),[]);
  const throughVertex = triangles([[0,1,2],[2,0,0],[2,2,0]],[[0,1,2]]);
  assert.deepEqual(S.intersect(throughVertex,1),[0,2,2,0]);
});

test('neighbouring triangles produce a closed square of the correct perimeter', () => {
  const points = [], faces = [];
  for (const y of [0,1]) for (const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,1]]) points.push([x,y,z]);
  for (let a=0; a<4; a++) {
    const b=(a+1)%4;
    faces.push([a,b,b+4],[a,b+4,a+4]);
  }
  const lines=S.intersect(triangles(points,faces),0.25), ends=new Map();
  assert.equal(lines.length,8*4);
  let perimeter=0;
  for (let i=0; i<lines.length; i+=4) {
    const [x,z,u,v]=lines.slice(i,i+4);
    perimeter+=Math.hypot(x-u,z-v);
    for (const key of [x+','+z,u+','+v]) ends.set(key,(ends.get(key)||0)+1);
  }
  close(perimeter,8);
  assert.ok([...ends.values()].every(count => count===2));
});

test('real scanner strokes intersect the transformed triangles inside the lining', () => {
  for (const width of [72,77,88,94]) {
    const fit=P.fit(profile,width);
    const level=Math.round(((fit.bottom+fit.top)/2-G.FLOOR)*P.mmPerUnit);
    const slice=S.scan(mesh,fit,level);
    assert.equal(slice.region,'Noodle contours');
    close(slice.height,G.FLOOR+level/P.mmPerUnit);
    // Independent reference: place the entire mesh in the cup first, then
    // walk all three edges of each triangle at the requested world height.
    const placed=[];
    for (let i=0; i<mesh.vertices.length; i+=G.STRIDE) {
      const [x,y,z]=mesh.vertices.subarray(i,i+3);
      const angle=Math.atan2(x,z)+fit.rotation, radius=Math.hypot(x,z)*fit.scale;
      placed.push([radius*Math.sin(angle),y*fit.scale+fit.offsetY,radius*Math.cos(angle)]);
    }
    let offset=0;
    for (let i=0; i<mesh.indices.length; i+=3) {
      const hits=[];
      for (let edge=0; edge<3; edge++) {
        const p=placed[mesh.indices[i+edge]], q=placed[mesh.indices[i+(edge+1)%3]];
        if ((p[1]>slice.height)===(q[1]>slice.height)) continue;
        const t=(slice.height-p[1])/(q[1]-p[1]);
        hits.push([p[0]+t*(q[0]-p[0]),p[2]+t*(q[2]-p[2])]);
      }
      if (!hits.length) continue;
      assert.equal(hits.length,2);
      const [x,z,u,v]=slice.strokes.slice(offset,offset+4);
      if (Math.hypot(x-hits[1][0],z-hits[1][1])<Math.hypot(x-hits[0][0],z-hits[0][1])) hits.reverse();
      close(x,hits[0][0]); close(z,hits[0][1]); close(u,hits[1][0]); close(v,hits[1][1]);
      assert.ok(Math.max(Math.hypot(x,z),Math.hypot(u,v))<=slice.radius+1e-8);
      offset+=4;
    }
    assert.ok(offset>0);
    assert.equal(offset,slice.strokes.length);
  }
});

test('the scanner distinguishes clear space below and above, clamps heights and retraces a previous cut', () => {
  const fit=P.fit(profile,88), mid=S.scan(mesh,fit,50);
  for (const mm of [-10,0,15,100,120]) {
    const cut=S.scan(mesh,fit,mm);
    assert.deepEqual(cut.strokes,[]);
    assert.equal(cut.region,mm>=100 ? 'Above the block' : mm<=0 ? 'Cup floor' : 'Air pocket');
    assert.equal(cut.heightMM,Math.max(0,Math.min(mm,100)));
  }
  for (const mm of [50,NaN,Infinity,undefined]) assert.deepEqual(S.scan(mesh,fit,mm),mid);
  assert.equal(S.scan(mesh,P.fit(profile,72),0).region,'Floor contact');
});

test('pocket capacity agrees with independent integration of the model lining in millimetres', () => {
  let previous=0;
  for (let width=P.minDiameter; width<=P.maxDiameter; width++) {
    const fit=P.fit(profile,width), volume=P.volumeBelow(fit.bottom);
    let integrated=0;
    const slabs=256, depth=fit.gapMM/slabs;
    for (let i=0; i<slabs; i++) {
      const y=G.FLOOR+(i+0.5)*depth/P.mmPerUnit;
      const r=(G.radiusAt(y)-G.WALL)*P.mmPerUnit;
      integrated+=Math.PI*r*r*depth/1000;
    }
    close(volume,integrated,0.00002);
    assert.ok(volume>=previous);
    previous=volume;
  }
  for (const height of [NaN,Infinity,undefined,-50,G.FLOOR]) assert.equal(P.volumeBelow(height),0);
  assert.equal(P.volumeBelow(999),P.volumeBelow(G.HEIGHT));
  assert.equal(P.volumeBelow(P.fit(profile,88).bottom).toFixed(1),'148.9');
});

test('metered doses round-trip from empty to exact underside contact at every diameter', () => {
  for (let width=P.minDiameter; width<=P.maxDiameter; width++) {
    const fit=P.fit(profile,width), capacity=P.volumeBelow(fit.bottom);
    for (const dose of [0,1e-7,1,capacity/2,capacity-1e-5,capacity,capacity+10,-100,NaN,Infinity]) {
      const meter=P.meteredPour(fit,dose);
      const expected=Math.max(0,Math.min(Number.isFinite(dose) ? dose : 0,capacity));
      assert.equal(meter.amountML,expected);
      close(P.volumeBelow(meter.surfaceY),expected);
      assert.ok(meter.surfaceY>=G.FLOOR && meter.surfaceY<=fit.bottom);
      close(meter.depthMM,(meter.surfaceY-G.FLOOR)*P.mmPerUnit);
      if (expected===capacity) assert.equal(meter.surfaceY,fit.bottom);
    }
    if (!fit.onFloor) assert.ok(P.meteredPour(fit,capacity/2).depthMM>fit.gapMM/2);
  }
  const small=P.meteredPour(P.fit(profile,88),50), large=P.meteredPour(P.fit(profile,94),50);
  assert.equal(small.surfaceY,large.surfaceY);
  assert.equal(small.depthMM.toFixed(1),'12.5');
});
