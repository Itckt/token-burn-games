'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../js/math'), G=require('../js/mesh'), sim=require('../js/simulation');
const world=require('../js/world'), art=require('../js/art');
const {lightMatrix}=require('../js/renderer');
const {rasterize}=require('./support/raster');
const scene=world.makeScene();

test('the complete café fits WebGL 1 batches with finite, unit-length shading normals',()=>{
  assert.ok(scene.batches.length>=1 && scene.batches.length<=4);
  const found=new Set();
  for (const {vertices:v,indices} of scene.batches) {
    const count=v.length/G.STRIDE;
    assert.ok(Number.isInteger(count) && count<=65535);
    assert.ok(v.every(Number.isFinite)); assert.ok(indices.every(k=>k<count));
    for (let i=0;i<v.length;i+=G.STRIDE) {
      assert.ok(Math.abs(Math.hypot(v[i+3],v[i+4],v[i+5])-1)<1e-4);
      for (let j=6;j<=10;j++) assert.ok(v[i+j]>=0 && v[i+j]<=1);
      assert.ok(v[i+12]>=0 && v[i+12]<=1);
      found.add(v[i+11]);
    }
    for (let i=0;i<indices.length;i+=3) {
      const id=k=>v[indices[k]*G.STRIDE+11];
      assert.equal(id(i),id(i+1)); assert.equal(id(i+1),id(i+2));
    }
  }
  assert.deepEqual([...found].sort(),[0,...world.notes.map(n=>n.id)]);
});
test('each slip has distinct bilingual content and its own physical anchor',()=>{
  const notes=scene.notes;
  assert.deepEqual(notes.map(n=>n.id),[1,2,3,4,5,6,7,8]);
  for (const key of ['title','chinese','caption']) assert.equal(new Set(notes.map(n=>n[key])).size,notes.length);
  for (const n of notes) {
    assert.match(n.chinese,/\p{Script=Han}/u);
    assert.ok(n.caption.length>20 && n.caption.length<120);
    assert.ok(n.anchor.length===3 && n.anchor.every(Number.isFinite));
  }
});
test('all geometry fits the static directional shadow volume and the home composition',()=>{
  const camera=sim.camera(sim.createView(),830,490);
  for (const b of scene.batches) for (let k=0;k<b.vertices.length;k+=G.STRIDE) {
    const p=Array.from(b.vertices.slice(k,k+3));
    for (const matrix of [camera.matrix,lightMatrix]) {
      const clip=M.transform4(matrix,...p,1);
      assert.ok(Math.max(...clip.slice(0,3).map(Math.abs))<1,'geometry falls outside the frustum');
    }
  }
});
test('CPU depth raster finds all eight actual objects at their home-view pins',()=>{
  const width=750,height=435,camera=sim.camera(sim.createView(),width,height);
  const image=rasterize(scene.batches,camera.matrix,width,height);
  const counts=new Map();
  for (const id of image.ids) counts.set(id,(counts.get(id)||0)+1);
  assert.equal(image.at(0,0),-1);
  const coverage=1-counts.get(-1)/(width*height);
  assert.ok(coverage>.30 && coverage<.70);
  for (const note of scene.notes) {
    assert.ok(counts.get(note.id)>150,note.title+' is visible');
    const anchor=M.project(note.anchor,camera.matrix,width,height);
    let hit=false;
    for (let dx=-3;dx<=3;dx++) for (let dy=-3;dy<=3;dy++) {
      if (image.at(anchor.x+dx,anchor.y+dy)===note.id) hit=true;
    }
    assert.ok(hit,note.title+' pin identifies the visible mesh');
  }
});
test('depth-tested walls occlude props when orbiting around the closed back',()=>{
  const width=450,height=320;
  const camera=sim.camera({...sim.HOME,yaw:Math.PI,pitch:sim.LIMITS.minPitch},width,height);
  const image=rasterize(scene.batches,camera.matrix,width,height);
  const urn=scene.notes.find(n=>n.title==='Tea urn');
  const p=M.project(urn.anchor,camera.matrix,width,height);
  assert.equal(image.at(p.x,p.y),0);
  assert.equal(sim.exposed(urn.anchor,camera.direction),false);
});
test('solid props and printed panels use disjoint atlas coordinates inside the texture',()=>{
  const entries=Object.entries(art.blocks);
  for (const [i,[name,[x,y,w,h]]] of entries.entries()) {
    assert.ok(x>=0 && y>=0 && x+w<=art.SIZE && y+h<=art.SIZE);
    for (const [other,[xx,yy,ww,hh]] of entries.slice(i+1)) {
      assert.ok(x+w<=xx || xx+ww<=x || y+h<=yy || yy+hh<=y,name+' overlaps '+other);
    }
    const [u,v,r,b]=art.regions[name];
    assert.ok(u<r && v<b && r<.999 && b<.999);
  }
  assert.ok(art.regions.window0[2]<art.regions.window1[0]);
  assert.ok(art.regions.window1[2]<art.regions.window2[0]);
  for (const name of ['marquee','window0','window1','window2','menu','poster','clock','urn','pad','tin','plaque']) {
    const [u,v]=art.regions[name];
    assert.ok(scene.batches.some(b=>b.vertices.some((n,i)=>i%G.STRIDE===9 &&
      Math.abs(n-u)<1e-7 && Math.abs(b.vertices[i+1]-v)<1e-7)),name+' is on a mesh');
  }
});
test('the steam emitters start at the surfaces of the two teas and the urn',()=>{
  const expected=[1,1,5];
  for (const [i,s] of scene.steam.entries()) {
    let closest=Infinity;
    for (const {vertices} of scene.batches) for (let k=0;k<vertices.length;k+=G.STRIDE) {
      if (vertices[k+11]===expected[i]) {
        closest=Math.min(closest,Math.hypot(vertices[k]-s.x,vertices[k+1]-s.y,vertices[k+2]-s.z));
      }
    }
    assert.ok(closest<.12,'emitter starts close to the hot vessel'); assert.ok(s.height>.3);
  }
});

test('the traffic and rain coordinates run continuously along the three inward-facing window panes',()=>{
  const [left,top,right,bottom]=art.regions.street, panes=[[],[],[]];
  for (const {vertices} of scene.batches) for (let k=0;k<vertices.length;k+=G.STRIDE) {
    const u=vertices[k+9], v=vertices[k+10];
    if (u<left || u>right || v<top || v>bottom) continue;
    const pane=panes.findIndex((_,i)=>{
      const [a,,b]=art.regions['window'+i];
      return u>=a && u<=b;
    });
    assert.ok(pane>=0); assert.ok(vertices[k+3]>.99 && vertices[k]<-4);
    assert.equal(vertices[k+11],0,'weather is confined to the scenery');
    panes[pane].push({y:vertices[k+1],z:vertices[k+2],u,v});
  }
  let previousEdge=Infinity;
  for (const pane of panes) {
    assert.equal(pane.length,4);
    const zFront=Math.max(...pane.map(p=>p.z)), zBack=Math.min(...pane.map(p=>p.z));
    assert.ok(zFront<previousEdge); previousEdge=zBack;
    const lower=pane.filter(p=>p.v===bottom), upper=pane.filter(p=>p.v===top);
    assert.ok(upper.length===2 && lower.length===2 && upper[0].y>lower[0].y);
    assert.ok(pane.find(p=>p.z===zFront).u<pane.find(p=>p.z===zBack).u);
  }
});
