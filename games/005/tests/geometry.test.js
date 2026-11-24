'use strict';
const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const M = require('../js/math.js');
const L = require('../js/lesson.js');

let model;
before(() => { model = G.buildModel(); });

function visitVertices(data, stride, visit) {
  for (let i = 0; i < data.length; i += stride) visit(data[i], data[i+1], data[i+2], i);
}

test('every part has finite interleaved attributes, unit normals and valid 16-bit triangles', () => {
  for (const [name, mesh] of Object.entries(model)) {
    const {vertices, indices} = mesh;
    assert.ok(vertices instanceof Float32Array && indices instanceof Uint16Array, name);
    assert.equal(vertices.length % G.STRIDE, 0, name);
    assert.equal(indices.length % 3, 0, name);
    const count = vertices.length / G.STRIDE;
    assert.ok(count > 2 && count <= 65536, name);
    assert.ok(indices.length && indices.every(i => i < count), name);
    assert.ok(vertices.every(Number.isFinite), name);
    visitVertices(vertices, G.STRIDE, (x,y,z,i) => {
      assert.ok(Math.abs(Math.hypot(vertices[i+3],vertices[i+4],vertices[i+5])-1) < 1e-5, name);
      assert.ok(vertices[i+6]>=0 && vertices[i+6]<=1 && vertices[i+7]>=0 && vertices[i+7]<=1 &&
        vertices[i+8]>=0 && vertices[i+8]<=1, name);
    });
    for (const [data, stride] of [[vertices, G.STRIDE], ...(mesh.hydrated ? [[mesh.hydrated, 6]] : [])]) {
      for (let i=0; i<indices.length; i+=3) {
        const a = indices[i]*stride, b = indices[i+1]*stride, c = indices[i+2]*stride;
        const ab = [0,1,2].map(k => data[b+k]-data[a+k]);
        const ac = [0,1,2].map(k => data[c+k]-data[a+k]);
        assert.ok(Math.hypot(...M.cross(ab, ac)) > 1e-10, name + ' has a collapsed triangle');
      }
    }
  }
});

test('the shell and lining follow a common taper and the removable wedge meets both cut edges', () => {
  assert.ok(G.BASE < G.RIM);
  assert.equal(G.radiusAt(0), G.BASE);
  assert.equal(G.radiusAt(G.HEIGHT), G.RIM);
  const opening = G.EDGE_R-G.EDGE_L;
  assert.ok(opening > Math.PI/2 && opening < Math.PI);
  for (const [name, inside, front] of [
    ['shell',false,false], ['lining',true,false], ['completeShell',false,true], ['completeLining',true,true]
  ]) {
    const data = model[name].vertices;
    let left = false, right = false;
    visitVertices(data, G.STRIDE, (x,y,z,i) => {
      const radius = Math.hypot(x,z), angle = Math.atan2(x,z);
      assert.ok(Math.abs(radius - (G.radiusAt(y)-(inside ? G.WALL : 0))) < 2e-6);
      assert.ok((x*data[i+3]+z*data[i+5])*(inside ? -1 : 1) > 0);
      if (Math.abs(angle-G.EDGE_L) < 1e-6) left = true;
      else if (Math.abs(angle-G.EDGE_R) < 1e-6) right = true;
      else assert.equal(angle>G.EDGE_L && angle<G.EDGE_R, front, name);
    });
    assert.ok(left && right, name);
  }
  visitVertices(model.edges.vertices, G.STRIDE, (x,y,z) => {
    const a = Math.atan2(x,z);
    assert.ok(Math.min(Math.abs(a-G.EDGE_L),Math.abs(a-G.EDGE_R))<1e-6);
    assert.ok(Math.hypot(x,z) >= G.radiusAt(y)-G.WALL-1e-6);
  });
});

test('the cake clears the floor, meets the lining on all sides, and stays inside the sleeve', () => {
  const sectors = Array(8).fill(0);
  let lowest = Infinity, highest = -Infinity;
  visitVertices(model.noodles.vertices, G.STRIDE, (x,y,z) => {
    const radius = Math.hypot(x,z);
    lowest = Math.min(lowest,y);
    highest = Math.max(highest,y);
    assert.ok(radius < G.radiusAt(y)-0.01, 'strand crosses the printed sleeve');
    if (radius > G.radiusAt(y)-G.WALL-0.003) {
      const sector = Math.floor((Math.atan2(x,z)+Math.PI)*8/M.TAU);
      sectors[sector % 8]++;
    }
  });
  assert.ok(sectors.every(n => n > 0), 'the dry cake needs contact around its perimeter');
  assert.ok(lowest > G.FLOOR+0.65 && highest < G.HEIGHT-0.45);
  assert.ok(highest-lowest > 0.65);
});

test('hydration preserves strand correspondence, introduces slack, and keeps food in the cup', () => {
  let movedDown = 0, stillHigh = 0;
  const level = L.scene(L.duration).surfaceY;
  for (const name of ['noodles','toppings']) {
    const {vertices, hydrated} = model[name];
    assert.equal(hydrated.length, vertices.length / G.STRIDE * 6);
    assert.ok(hydrated.every(Number.isFinite));
    visitVertices(hydrated, 6, (x,y,z,i) => {
      const j = i/6*G.STRIDE;
      assert.ok(Math.abs(Math.hypot(hydrated[i+3],hydrated[i+4],hydrated[i+5])-1)<1e-5);
      for (const t of [0.25,0.50,0.75,1]) {
        const h = M.lerp(vertices[j+1],y,t);
        const radius = Math.hypot(M.lerp(vertices[j],x,t), M.lerp(vertices[j+2],z,t));
        assert.ok(h > G.FLOOR && radius < G.radiusAt(h), name);
      }
      if (name === 'noodles') {
        assert.ok(y < level, 'steeped noodles should be immersed');
        if (y < G.BLOCK_BOTTOM-0.20) movedDown++;
        if (y > G.BLOCK_TOP-0.13) stillHigh++;
      }
    });
  }
  const count = model.noodles.vertices.length / G.STRIDE;
  assert.ok(movedDown > 0.15*count && stillHigh > 0.08*count);
});

test('the noodle label identifies a matching vertex in both baked poses', () => {
  const {noodles} = model, i = 1406;
  const dry = noodles.vertices.subarray(i*G.STRIDE,i*G.STRIDE+3);
  const anchor = G.strandAnchor(noodles,dry);
  assert.deepEqual(anchor.dry,dry);
  assert.deepEqual(anchor.wet,noodles.hydrated.subarray(i*6,i*6+3));
});

test('the peeled lid has a hinge at the back lip and a raised, folded foil surface', () => {
  const lid = model.lid.vertices;
  let nearRim = 0, folded = 0;
  visitVertices(lid, G.STRIDE, (x,y,z) => {
    assert.ok(y>G.HEIGHT-0.005 && z<0);
    if (y < G.HEIGHT+0.04 && Math.hypot(x,z)>G.RIM-0.09) nearRim++;
    if (y > G.HEIGHT+0.48 && z < -0.65) folded++;
  });
  assert.ok(nearRim>4 && folded>100);
});

test('the water front maps to the actual opening and the top covers a circular surface', () => {
  let topInterior = false, bottom = false;
  visitVertices(model.water.vertices, G.STRIDE, (x,y,z,i) => {
    assert.ok(y===0 || y===1);
    assert.ok(Math.hypot(x,z) <= 1+1e-6);
    if (model.water.vertices[i+4] > 0.99 && Math.hypot(x,z) < 0.001) topInterior = true;
    if (y===0) {
      bottom = true;
      const a = Math.atan2(x,z);
      assert.ok(a >= G.EDGE_L-1e-6 && a <= G.EDGE_R+1e-6);
    }
  });
  assert.ok(topInterior && bottom);
});

test('a ray from the opening camera can see the air pocket only with the front wedge removed', () => {
  const eye = L.scene(0), point = [0.38,0.60,0.68];
  const direction = [Math.sin(eye.yaw)*Math.cos(eye.pitch),Math.sin(eye.pitch),Math.cos(eye.yaw)*Math.cos(eye.pitch)];
  // Two-sided ray/triangle intersection, using the actual rendered mesh indices.
  function obstructs(mesh) {
    const v = mesh.vertices;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a,b,c] = [0,1,2].map(k => {
        const j = mesh.indices[i+k]*G.STRIDE;
        return [v[j],v[j+1],v[j+2]];
      });
      const ab = M.sub(b,a), ac = M.sub(c,a), n = M.cross(direction,ac), det = M.dot(ab,n);
      if (Math.abs(det)<1e-9) continue;
      const ap = M.sub(point,a), u = M.dot(ap,n)/det;
      if (u<0 || u>1) continue;
      const q = M.cross(ap,ab), w = M.dot(direction,q)/det;
      if (w>=0 && u+w<=1 && M.dot(ac,q)/det > 0.0001) return true;
    }
    return false;
  }
  for (const name of ['shell','lining','lip','edges','base','lid','noodles']) {
    assert.equal(obstructs(model[name]),false,name);
  }
  assert.equal(obstructs(model.completeShell),true);
});

test('a capped tube and a closed tube have the expected manifold faces and directions', () => {
  const b = new G.Builder();
  G.tube(b, [[0,0,0],[0,1,0]], 0.1, [1,1,1], 8);
  const mesh = b.finish();
  assert.equal(mesh.indices.length/3,32);
  assert.equal(mesh.vertices.length/G.STRIDE,34);
  const loop = new G.Builder();
  const points = Array.from({length:24}, (_,i) => G.polar(1,0,M.TAU*i/24));
  G.tube(loop,points,0.05,[1,1,1],8,true);
  const closed = loop.finish();
  assert.equal(closed.indices.length/3,24*8*2);
  const edges = new Map();
  for (let i=0; i<closed.indices.length; i+=3) {
    for (let k=0; k<3; k++) {
      const a = closed.indices[i+k], b = closed.indices[i+(k+1)%3];
      const key = Math.min(a,b) + '/' + Math.max(a,b);
      edges.set(key,(edges.get(key) || 0)+1);
    }
  }
  assert.ok([...edges.values()].every(n => n===2));
});

test('geometry builders reject unusable paths, pose lengths, and overflowing indices', () => {
  const b = new G.Builder(), p = [[0,0,0],[0,1,0]], c = [1,1,1];
  assert.throws(() => G.tube(b,[],0.1,c),RangeError);
  assert.throws(() => G.tube(b,p,-1,c),RangeError);
  assert.throws(() => G.tube(b,p,1,c,2),RangeError);
  assert.throws(() => G.tube(b,p,1,c,8,false,[p[0]]),RangeError);
  assert.throws(() => G.tube(b,[p[0],p[0]],1,c),RangeError);
  b.vertex(p[0],c,c,undefined,p[1],c);
  b.vertex(p[1],c);
  assert.throws(() => b.finish(),/hydrated/);
  b.vertices.length = G.STRIDE*65537;
  assert.throws(() => b.finish(),/16-bit/);
});

test('the packaged food design is reproducible from a seed', () => {
  const copy = G.noodles();
  assert.deepEqual(copy.vertices,model.noodles.vertices);
  assert.deepEqual(copy.hydrated,model.noodles.hydrated);
  assert.deepEqual(copy.indices,model.noodles.indices);
  assert.notDeepEqual(G.toppings(34).vertices,model.toppings.vertices);
});

test('invalid triangle indices are rejected before unsigned-short conversion can wrap them', () => {
  for (const index of [-1,0.5,3,65536,NaN]) {
    const builder=new G.Builder();
    for (const p of [[0,0,0],[0,1,0],[1,0,0]]) builder.vertex(p,[0,0,1]);
    builder.tri(0,1,index);
    assert.throws(() => builder.finish(),/index/);
  }
  const builder=new G.Builder();
  assert.throws(() => G.tube(builder,[[0,0,0],[0,1,0]],Infinity,[1,1,1]),RangeError);
});

test('a bad segment or hydrated tangent cannot leave half a strand in a reusable builder', () => {
  const b=new G.Builder(), p=[[0,0,0],[0,1,0],[0,2,0],[0,3,0]], c=[1,1,1];
  G.tube(b,p,0.1,c);
  const original=b.finish();
  for (const bad of [[p[0],p[1],p[1],p[2]],[p[0],p[1],p[2],p[1]],
    [p[0],p[1],p[2],[0,NaN,1]],[p[0],p[1],p[2],[Infinity,2,0]]]) {
    assert.throws(() => G.tube(b,bad,0.1,c),RangeError);
    assert.throws(() => G.tube(b,p,0.1,c,8,false,bad),RangeError);
    assert.deepEqual(b.finish(),original);
  }
  assert.throws(() => G.tube(b,[p[0],p[1],p[2],p[0]],0.1,c,8,true),RangeError);
  assert.deepEqual(b.finish(),original);
});
