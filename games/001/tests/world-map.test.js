'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/campus.js');
const A = require('../src/architecture.js');
const M = require('../src/math.js');
const G = require('../src/mesh.js');
const S = require('../src/simulation.js');
const MapPlan = require('../src/map.js');
const {firstHit} = require('./support/sightline.js');
const world = C.create();

test('the whole campus is a bounded static batch with finite positions, unit normals and valid materials', () => {
  const data = world.vertices, stride = G.STRIDE, materials = new Set();
  assert.ok(data instanceof Float32Array);
  assert.equal(data.length % (stride * 3), 0);
  assert.ok(world.casterStart > 0 && world.casterStart < data.length / stride);
  assert.equal(world.casterStart % 3, 0);
  // Keep enough detail for the clock and colonnades within the walking render budget.
  assert.ok(data.length / (stride * 3) < 100000);
  let leastAlignment = 1;
  for (let i = 0; i < data.length; i += stride * 3) {
    for (let k = 0; k < 3; k++) {
      const j = i + stride * k;
      for (let n = 0; n < stride; n++) assert.ok(Number.isFinite(data[j+n]));
      for (let n = 6; n < 9; n++) assert.ok(data[j+n] >= 0 && data[j+n] <= 1);
      assert.ok(Math.abs(Math.hypot(data[j+3],data[j+4],data[j+5])-1) < 1e-5);
      assert.equal(data[j+9],data[i+9]);
    }
    const a = data.subarray(i, i+3);
    const ab = M.sub(data.subarray(i+stride, i+stride+3),a);
    const ac = M.sub(data.subarray(i+stride*2, i+stride*2+3),a);
    const face = M.cross(ab, ac), length = Math.hypot(...face);
    assert.ok(length > 1e-9);
    leastAlignment = Math.min(leastAlignment,M.dot(face,data.subarray(i+3,i+6))/length);
    materials.add(data[i+9]);
  }
  assert.ok(leastAlignment > 0.999);
  assert.deepEqual(materials, new Set(Object.values(G.MAT)));
});

test('the same seed reproduces every vertex while a new seed changes foliage and keeps the seven landmarks', () => {
  function bytes(w) { return Buffer.from(w.vertices.buffer,w.vertices.byteOffset,w.vertices.byteLength); }
  assert.ok(bytes(C.create(407)).equals(bytes(world)));
  const other = C.create(2031);
  assert.ok(!bytes(other).equals(bytes(world)));
  assert.deepEqual(other.buildings,world.buildings);
  assert.deepEqual(other.places,world.places);
  for (const p of other.places) assert.ok(S.canStand(p.view[0],p.view[1],other));
});

test('guide entries, sign planes, raised beds and streetlights agree with the navigable world', () => {
  assert.equal(world.places.length,7);
  assert.equal(new Set(world.places.map(p => p.id)).size,world.places.length);
  for (const p of world.places) {
    assert.ok(p.name && p.note && p.guide);
    assert.equal(p.view.length,4);
    assert.ok(p.view.every(Number.isFinite));
    assert.ok(S.canStand(p.view[0],p.view[1],world),p.name);
    assert.equal(S.nearest(S.makeState(p.view),world.places).id,p.id);
  }
  for (const sign of world.signs) {
    assert.ok(sign.width > 0 && sign.height > 0 && sign.words.length > 0);
    assert.equal(sign.right[1],0);
    assert.equal(Math.hypot(...sign.right),1);
    assert.ok(sign.center.every(Number.isFinite));
  }
  for (const [x,z] of world.lamps) assert.equal(S.canStand(x,z,world),false);
  for (const bed of world.beds) assert.equal(S.canStand(bed.x,bed.z,world),false);
  assert.equal(S.canStand(-23,2,world),false);
  assert.equal(S.canStand(3.9,-22.2,world),false);
});

test('all seven approaches, the arcade passage, and the inside of the pavilion connect on foot', () => {
  const [ox,oz] = C.places[0].view;
  const targets = C.places.map(p => ({name:p.name, point:p.view.slice(0,2)}));
  targets.push({name:'arcade passage',point:[18.5,9.25]}, {name:'pavilion shelter',point:[31,-23]});
  const queue = [[0,0]], reached = new Set(['0,0']);
  function clear(x0,z0,x1,z1) {
    for (let i=1; i<=6; i++) {
      if (!S.canStand(M.mix(x0,x1,i/6),M.mix(z0,z1,i/6),world)) return false;
    }
    return true;
  }
  for (let i=0; i<queue.length; i++) {
    const [ix,iz] = queue[i];
    for (const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]) {
      const nx=ix+dx,nz=iz+dz,key=nx+','+nz;
      if (reached.has(key) || !clear(ox+ix,oz+iz,ox+nx,oz+nz)) continue;
      reached.add(key);
      queue.push([nx,nz]);
    }
  }
  for (const {name,point:[x,z]} of targets) {
    assert.ok(queue.some(([ix,iz]) => Math.hypot(ox+ix-x,oz+iz-z)<1 &&
      clear(ox+ix,oz+iz,x,z)),name+' must be reachable through clear ground');
  }
});

function checkSightline(place, target) {
  const state = S.makeState(place.view), {yaw,pitch} = state;
  const eye = S.eyePosition(state,world);
  const view = M.lookAt(eye,M.add(eye,M.direction(yaw,pitch)));
  for (const aspect of [0.6,1,1.77,2.4]) {
    const vp = M.multiply(M.perspective(57*Math.PI/180,aspect,0.09,465),view);
    const [cx,cy,,w] = M.transform(vp,target);
    assert.ok(w > 0 && Math.abs(cx/w) < 0.65 && Math.abs(cy/w) < 0.75);
  }
  const closest = firstHit(world,eye,target).t;
  assert.ok(Math.abs(closest-1)<0.015,place.name+' sightline, first hit at '+closest);
}
test('the tower dial is framed and visible from the opening view', () => {
  checkSightline(C.places[0],[3.9,14.19,-19.025]);
});
test('the terrace viewpoint frames the raised copper fold through clear air in portrait and landscape',()=>{
  // Probe the interior of the upper patinated panel, clear of its shared edges.
  checkSightline(C.places.find(p=>p.id==='terrace'),[34.5233,6.7133,18.69]);
});

test('facade pieces and sign directions follow the horizontal / outward axes on all four sides', () => {
  for (const [nx,nz] of [[0,1],[1,0],[0,-1],[-1,0]]) {
    const w = {mesh:new G.Mesh(), signs:[]}, f = A.facade(w,3,6,nx,nz);
    const p = f.point(2,4,0.5);
    assert.deepEqual(p,[3+2*nz+nx*0.5,4,6-2*nx+nz*0.5]);
    f.piece(2,4,0.5,3,1,0.2,'#ccbbaa');
    assert.equal(w.mesh.vertexCount,36);
    f.sign(2,4,0.5,3,1,'Test sign','light');
    assert.deepEqual(w.signs[0].center,p);
    assert.equal(Math.abs(M.dot(w.signs[0].right,[nx,0,nz])),0);
  }
  const outline = C.clippedOutline(0,0,8,6,0.5);
  assert.equal(outline.length,8);
  assert.ok(outline.every(([x,z]) => Math.abs(x)<=4 && Math.abs(z)<=3));
});

test('the north-up map fits the entire perimeter with equal metre scales on each axis', () => {
  const {bounds:b} = world;
  for (const [width,height] of [[400,250],[120,80],[130,280],[700,120]]) {
    const p=MapPlan.layout(b,width,height);
    const [west,north]=MapPlan.project(p,b.west,b.north);
    const [east,south]=MapPlan.project(p,b.east,b.south);
    assert.ok(west>0 && east<width && north>0 && south<height);
    assert.ok(west<east && north<south);
    assert.ok(Math.abs((east-west)/(b.east-b.west)-(south-north)/(b.south-b.north))<1e-9);
    for (const place of world.places) {
      const [x,y]=MapPlan.project(p,...place.point);
      assert.equal(MapPlan.pickPlace(p,world.places,x,y),place);
    }
  }
});

test('map selection uses the nearest marker inside the pointer tolerance', () => {
  const p={cx:0,cy:0,scale:1};
  const markers=[{point:[10,10]}, {point:[18,10]}];
  assert.equal(MapPlan.pickPlace(p,markers,12,9,7),markers[0]);
  assert.equal(MapPlan.pickPlace(p,markers,15,10,7),markers[1]);
  assert.equal(MapPlan.pickPlace(p,markers,60,50,7),null);
  assert.equal(MapPlan.pickPlace(p,[],15,10),null);
});
