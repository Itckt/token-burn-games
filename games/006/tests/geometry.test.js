'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Mesh, STRIDE, paint, rgb } = require('../js/mesh.js');
const M = require('../js/math.js');
const R = require('../js/ride.js');
const W = require('../js/world.js');
const commuters = require('../js/commuters.js');
const passengers = require('../js/passengers.js');
const { BLADE } = require('../js/weather.js');
const { PART } = require('../js/mesh.js');
const near = (a,b,e=1e-5) => assert.ok(Math.abs(a-b)<e, a+' vs '+b);
const at = (array, i, offset=0, size=3) => Array.from(array.slice(i*STRIDE+offset,i*STRIDE+offset+size));

test('materials preserve colour, texture, emission, opacity and signed door travel', () => {
  assert.deepEqual(rgb(0x00ff00),[0,1,0]);
  assert.deepEqual(paint(0xffffff),{color:[1,1,1],texture:0,emission:0,alpha:1,slide:0,scale:null});
  const m=new Mesh();
  m.quad([0,0,0],[4,0,0],[4,2,0],[0,2,0],paint(0xff8000,7,0.6,{scale:[2,0.5],alpha:0.25,slide:-0.81}));
  const { vertices,indices }=m.finish();
  assert.deepEqual(Array.from(indices),[0,1,2,0,2,3]);
  assert.deepEqual(at(vertices,0,10,2),[0,4]); assert.deepEqual(at(vertices,2,10,2),[2,0]);
  const stored=at(vertices,0,6,10);
  [1,128/255,0,0.25,0,4,7,0.6,-0.81,0].forEach((x,i)=>near(x,stored[i]));
});
test('box faces have outward normals and consistently wound, nondegenerate triangles', () => {
  const m=new Mesh(); m.box(-1,-2,-3,1,2,3,paint(0));
  const { vertices,indices }=m.finish();
  assert.equal(vertices.length/STRIDE,24); assert.equal(indices.length,36);
  for(let i=0;i<indices.length;i+=3) {
    const [a,b,c]=Array.from(indices.slice(i,i+3),id=>at(vertices,id));
    const n=at(vertices,indices[i],3);
    assert.ok(M.dot(n,a)>0);
    const actual=M.normalize(M.cross(M.subtract(b,a),M.subtract(c,a)));
    near(M.dot(actual,n),1);
  }
});
test('tube vertices form round rings normal to an arbitrary axis', () => {
  const a=[-1,2,0],b=[2,-1,-9], axis=M.normalize(M.subtract(b,a)), m=new Mesh();
  m.tube(a,b,0.23,paint(0),12);
  const {vertices,indices}=m.finish();
  assert.equal(indices.length,12*6);
  for(let i=0;i<vertices.length/STRIDE;i++) {
    const n=at(vertices,i,3), pos=at(vertices,i), end=i%4<2?a:b;
    near(M.dot(n,axis),0); near(Math.hypot(...n),1);
    n.forEach((v,k)=>near(pos[k],end[k]+0.23*v));
  }
});
test('long faces subdivide on either UV axis without breaking winding, scale or normals', () => {
  for(const points of [
    [[0,0,0],[0,0,-16],[0,1,-16],[0,1,0]],
    [[0,0,0],[1,0,0],[1,0,-16],[0,0,-16]]
  ]) {
    const m=new Mesh(4); m.quad(...points,paint(0,0,0,{scale:[1,1]}));
    const {vertices,indices}=m.finish();
    assert.equal(indices.length,24);
    const depths=new Set(),uvs=new Set();
    for(let i=0;i<vertices.length/STRIDE;i++) { depths.add(at(vertices,i)[2]); uvs.add(at(vertices,i,10,2).join(',')); }
    assert.deepEqual([...depths].sort((a,b)=>b-a),[0,-4,-8,-12,-16]); assert.equal(uvs.size,10);
    for(let i=0;i<indices.length;i+=3) {
      const [a,b,c]=Array.from(indices.slice(i,i+3),id=>at(vertices,id));
      assert.ok(M.dot(at(vertices,indices[i],3),M.cross(M.subtract(b,a),M.subtract(c,a)))>0);
    }
  }
});
test('WebGL 1 index limit is enforced before any 16-bit wraparound', () => {
  const m=new Mesh();
  m.vertices.length=65536*STRIDE; m.indices.push(0,1,65535);
  assert.equal(m.finish().indices[2],65535);
  m.vertices.length+=STRIDE; assert.throws(()=>m.finish(),RangeError);
});

function checkMesh(data, pass) {
  const {vertices:v,indices}=data, count=v.length/STRIDE;
  assert.ok(v instanceof Float32Array && indices instanceof Uint16Array);
  assert.ok(Number.isInteger(count) && count<=65536);
  assert.equal(indices.length%3,0);
  assert.ok(v.every(Number.isFinite),'finite vertex fields');
  for(let k=0;k<v.length;k+=STRIDE) {
    const norm=v[k+3]**2+v[k+4]**2+v[k+5]**2;
    if(Math.abs(norm-1)>1e-5) assert.fail('non-unit normal at float '+k);
    for(let c=6;c<=9;c++) if(v[k+c]<0 || v[k+c]>1) assert.fail('invalid colour or alpha');
    if(pass==='solid' ? v[k+9]!==1 : v[k+9]>=1 || v[k+9]<=0) assert.fail('wrong draw pass');
    if(!Number.isInteger(v[k+12]) || v[k+12]<0 || v[k+12]>31) assert.fail('unallocated atlas tile');
    if(v[k+13]<0 || v[k+13]>1) assert.fail('invalid emission');
  }
  assert.ok(indices.every(i=>i<count));
  for(let k=0;k<indices.length;k+=3) {
    const a=indices[k]*STRIDE,b=indices[k+1]*STRIDE,c=indices[k+2]*STRIDE;
    const ux=v[b]-v[a],uy=v[b+1]-v[a+1],uz=v[b+2]-v[a+2];
    const vx=v[c]-v[a],vy=v[c+1]-v[a+1],vz=v[c+2]-v[a+2];
    if((uy*vz-uz*vy)**2+(uz*vx-ux*vz)**2+(ux*vy-uy*vx)**2<1e-17) assert.fail('degenerate triangle');
  }
}
test('every chunk and the full carriage produce finite, valid meshes within the draw budget', () => {
  const stations=new Set(),cab=W.buildCab();
  checkMesh(cab.solid,'solid'); checkMesh(cab.glass,'glass');
  for(let i=0;i<R.LENGTH/R.CHUNK;i++) {
    const chunk=W.buildChunk(i);
    assert.equal(chunk.station,R.stationAt((i+0.5)*R.CHUNK));
    stations.add(chunk.station);
    checkMesh(chunk.solid,'solid'); checkMesh(chunk.glass,'glass');
    assert.ok(chunk.solid.indices.length/3<4000,'triangle budget per streamed section');
    assert.equal(chunk.glass.indices.length>0,chunk.station>=0);
  }
  assert.deepEqual([...stations].sort((a,b)=>a-b),[-1,0,1,2,3,4]);
});
test('the shuttle has wheel contact, lit glazing, a destination blind and distinct head and tail lamps', () => {
  const shuttle = require('../js/shuttle.js');
  for (const tail of [false,true]) {
    const data = shuttle.buildCar(tail), v = data.vertices;
    checkMesh(data, 'solid');
    const lamps = [], lights = new Set(), sign = [];
    let lowest = Infinity;
    for (let i=0; i<v.length; i+=STRIDE) {
      lowest = Math.min(lowest,v[i+1]);
      if (v[i+12] === 24) sign.push(v[i+2]);
      if (v[i+13] === 1 && v[i+2] > 5) lamps.push([...v.slice(i+6,i+9)].map(n=>Math.round(255*n)));
      if (v[i+13] > 0.6 && Math.abs(v[i]) > 1.42) lights.add(Math.sign(v[i]));
    }
    near(lowest, shuttle.RAIL_TOP); assert.equal(sign.length, 4);
    assert.equal(lamps.length, 8); assert.equal(lights.size, 2);
    assert.deepEqual(lamps[0], tail ? [255,101,82] : [255,237,199]);
    assert.ok(data.indices.length / 3 < 1000);
  }
  for (const span of R.VIADUCTS) for (let start = span.start; start < span.end; start += R.CHUNK) {
    const v = W.buildChunk(start / R.CHUNK).solid.vertices;
    for (const z of [0, -R.CHUNK]) {
      const rails = new Set();
      for (let i=0; i<v.length; i+=STRIDE) {
        if (v[i+1] === shuttle.RAIL_TOP && v[i+2] === z) rails.add(v[i]);
      }
      const xs = [...rails].sort((a,b)=>a-b);
      assert.equal(xs.length,4);
      for (const [i, edge] of [-0.825,-0.685,0.685,0.825].entries()) near(xs[i],R.trackOffset(start-z)+shuttle.TRACK_X+edge);
    }
  }
});
test('generation is seed-stable across regeneration, negative indices, and later laps', () => {
  const period=R.LENGTH/R.CHUNK;
  for(const i of [-1,0,8,27,146]) {
    assert.deepEqual(W.buildChunk(i+period),W.buildChunk(i));
    assert.deepEqual(W.buildChunk(i-period),W.buildChunk(i));
  }
  assert.notDeepEqual(W.buildChunk(8).solid.vertices,W.buildChunk(9).solid.vertices);
});
test('rail heads stay aligned to the track at joints and intermediate curve samples', () => {
  const period=R.LENGTH/R.CHUNK;
  function rail(chunk, z) {
    const v=chunk.solid.vertices, xs=new Set();
    for(let j=0;j<v.length;j+=STRIDE) {
      if(Math.abs(v[j+1]-0.363)>1e-5 || Math.abs(v[j+2]-z)>1e-5) continue;
      xs.add(v[j]);
    }
    return [...xs].sort((a,b)=>a-b);
  }
  for(const i of [-1,0,2,3,7,14,23,26,period-1]) {
    const a=W.buildChunk(i), b=W.buildChunk(i+1);
    const end=rail(a,-R.CHUNK), start=rail(b,0);
    assert.equal(end.length,4); assert.deepEqual(end,start);
    const x=R.trackOffset((i+1)*R.CHUNK);
    [-0.805,-0.705,0.705,0.805].forEach((v,j)=>near(end[j],x+v));
    if(a.station<0) for(const d of [4,8,12]) {
      const from=R.trackOffset(i*R.CHUNK+d);
      const xs=rail(a,-d); assert.equal(xs.length,4);
      [-0.805,-0.705,0.705,0.805].forEach((v,j)=>near(xs[j],from+v));
    }
  }
});

function doorIntervals(data, origin, x, minZ, maxZ) {
  const result=new Map(),v=data.vertices;
  for(let i=0;i<v.length;i+=STRIDE) {
    const travel=v[i+14],z=v[i+2]+origin;
    if(!travel||Math.abs(v[i]-x)>0.05||z<minZ||z>maxZ) continue;
    const bounds=result.get(travel)||[Infinity,-Infinity];
    bounds[0]=Math.min(bounds[0],z); bounds[1]=Math.max(bounds[1],z);
    result.set(travel,bounds);
  }
  return result;
}
test('right carriage doors align with a screen-door pair and clear the opening at all five stops', () => {
  const cab=W.buildCab();
  const car=doorIntervals(cab.glass,0,1.46,0.8,3.1);
  assert.equal(car.size,2);
  assert.equal(doorIntervals(cab.glass,0,-1.46,0.8,3.1).size,0,'offside doors stay locked');
  for(const station of R.STATIONS) {
    const before=W.buildChunk(station.at/R.CHUNK-1);
    const platform=doorIntervals(before.glass,R.CHUNK,1.887,0.8,3.1);
    assert.equal(platform.size,2);
    for(const [travel,closed] of car) {
      const other=platform.get(travel); assert.ok(other);
      closed.forEach((end,k)=>near(end,other[k],0.02));
      for(const pair of [closed,other]) {
        assert.ok(travel>0 ? pair[0]+travel>2.8 : pair[1]+travel<1.2);
      }
    }
  }
});

test('the reusable commuter formation has one valid solid figure per queue slot and a separate alighter', () => {
  const mesh = commuters.buildRiders();
  checkMesh(mesh, 'solid');
  const bounds = new Map(), v = mesh.vertices;
  for (let i = 0; i < v.length; i += STRIDE) {
    const id = v[i + 16], y = v[i + 1], z = v[i + 2];
    const box = bounds.get(id) || [Infinity, -Infinity, 0];
    box[0] = Math.min(box[0], y); box[1] = Math.max(box[1], y); box[2] = Math.max(box[2], Math.abs(z));
    bounds.set(id, box);
  }
  assert.deepEqual([...bounds.keys()], Array.from({length: passengers.MAX_WAITING + 1}, (_, i) => PART.RIDER + i));
  for (const [floor, crown, halfWidth] of bounds.values()) {
    assert.equal(floor, 0); assert.ok(crown > 1.5 && crown < 1.9);
    assert.ok(halfWidth < 0.30 && halfWidth > 0.18);
  }
});

test('the entire blade sweep fits the front glass and leaves both side-door windows independent', () => {
  const cab = W.buildCab(), solid = cab.solid.vertices, glass = cab.glass.vertices;
  const blade = [];
  for (let i = 0; i < solid.length; i += STRIDE) {
    if (solid[i + 16] === PART.WIPER) blade.push([...solid.slice(i, i + 3)]);
  }
  const pane = [];
  for (let i = 0; i < glass.length; i += STRIDE) {
    if (glass[i + 16] === PART.WINDSCREEN) {
      assert.equal(glass[i + 14], 0); pane.push([...glass.slice(i, i + 3)]);
    } else assert.equal(glass[i + 16], 0);
  }
  assert.ok(blade.length > 12); assert.equal(pane.length, 4);
  const minY = Math.min(...pane.map(p => p[1])), maxY = Math.max(...pane.map(p => p[1]));
  for (let i = 0; i <= 24; i++) {
    const angle = BLADE.arc * i / 24;
    for (const [x, y, z] of blade) {
      const dx = x - BLADE.x, dy = y - BLADE.y;
      const wx = BLADE.x + Math.cos(angle)*dx + Math.sin(angle)*dy;
      const wy = BLADE.y - Math.sin(angle)*dx + Math.cos(angle)*dy;
      assert.ok(wx >= -1.42 && wx <= 1.42 && wy >= minY && wy <= maxY && z < -1.64);
    }
  }
});

test('bridge buildings have plumb walls clear of the track, and each stop has exactly one S board at its mark', () => {
  const boards = [], courts = [], period = R.LENGTH / R.CHUNK;
  const courtColor = rgb(0x469186);
  for (let index = 0; index < period; index++) {
    const chunk = W.buildChunk(index), v = chunk.solid.vertices, start = index * R.CHUNK;
    const span = R.viaductAt(start);
    assert.equal(chunk.outdoor, Boolean(span));
    let boardVertices = 0, windows = 0, court = false;
    for (let i = 0; i < v.length; i += STRIDE) {
      if (v[i + 12] === 30) {
        boardVertices++;
        assert.ok(v[i] < -2 && v[i + 1] > 2 && Math.abs(v[i + 2]) < 0.01);
        near(v[i + 5], 1);
      }
      if (v[i + 12] === 29) {
        windows++;
        assert.equal(v[i + 15], 0, 'the city does not bend with the railway');
        assert.ok(Math.abs(v[i] - R.trackOffset(start - v[i + 2])) > 9);
        assert.equal(Math.abs(v[i+3]) + Math.abs(v[i+4]) + Math.abs(v[i+5]), 1);
      }
      if (courtColor.every((component, k) => Math.abs(v[i + 6 + k] - component) < 1e-6)) court = true;
    }
    assert.equal(windows > 0, Boolean(span));
    if (boardVertices) { assert.equal(boardVertices, 4); boards.push(start); }
    if (court) courts.push(start);
  }
  assert.deepEqual(boards, R.STATIONS.map(station => station.at));
  assert.equal(courts.length, 1);
  assert.equal(R.viaductAt(courts[0]).name, 'College Viaduct');
});
