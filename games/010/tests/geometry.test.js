'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math');
const G = require('../js/mesh');

function close(a,b,epsilon=1e-5) {
  assert.equal(a.length,b.length);
  a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<=epsilon,'component '+i+': '+value+' vs '+b[i]));
}
function validateMesh(mesh) {
  const {positions:p,normals:n,uvs,indices}=mesh;
  assert.ok(p.length>0 && indices.length>0);
  assert.equal(p.length%3,0); assert.equal(indices.length%3,0);
  assert.equal(n.length,p.length); assert.equal(uvs.length,p.length/3*2);
  assert.ok([...p,...n,...uvs].every(Number.isFinite));
  assert.ok(indices.every(i=>Number.isInteger(i) && i>=0 && i<p.length/3));
  for (let i=0;i<n.length;i+=3) close([Math.hypot(n[i],n[i+1],n[i+2])],[1]);
  for (let i=0;i<indices.length;i+=3) {
    const triangle=indices.slice(i,i+3);
    const [a,b,c]=triangle.map(k=>p.slice(k*3,k*3+3));
    const face=M.cross(M.sub(b,a),M.sub(c,a));
    assert.ok(Math.hypot(...face)>1e-9,'non-degenerate triangle');
    const normal=triangle.map(k=>n.slice(k*3,k*3+3)).reduce(M.add);
    assert.ok(M.dot(face,normal)>0,'winding agrees with the shading normals');
  }
}

test('vector operations use a right-handed basis and preserve input arrays',()=>{
  const a=[2,3,-1], b=[1,-2,4];
  assert.deepEqual(M.add(a,b),[3,1,3]); assert.deepEqual(M.sub(a,b),[1,5,-5]);
  assert.equal(M.dot(a,b),-8); assert.deepEqual(M.scale(a,-2),[-4,-6,2]);
  assert.deepEqual(M.cross([1,0,0],[0,1,0]),[0,0,1]);
  close(M.unit([0,-3,4]),[0,-.6,.8]); close(M.unit([0,0,0]),[0,0,0]);
  assert.deepEqual(a,[2,3,-1]); assert.deepEqual(b,[1,-2,4]);
});
test('column-major composition rotates first and translates positions only',()=>{
  const transform=M.multiply(M.translation(4,3,2),M.rotation('y',Math.PI/2));
  close(M.transform4(transform,0,0,1,1),[5,3,2,1]);
  close(M.transform4(transform,0,0,1,0),[1,0,0,0]);
  close(M.multiply(M.identity(),transform),transform);
  for (const axis of ['x','y','z']) close(M.multiply(M.rotation(axis,.71),M.rotation(axis,-.71)),M.identity());
});
test('view basis stays orthonormal at both poles and looks down negative Z',()=>{
  for (const eye of [[2,3,4],[0,4,0],[0,-4,0]]) {
    const view=M.lookAt(eye,[0,0,0]);
    close(M.transform4(view,...eye,1),[0,0,0,1]);
    close(M.transform4(view,0,0,0,1),[0,0,-Math.hypot(...eye),1]);
    const rows=[0,1,2].map(i=>[view[i],view[i+4],view[i+8]]);
    close(M.cross(rows[0],rows[1]),rows[2]); close([M.dot(rows[0],rows[1])],[0]);
  }
  assert.throws(()=>M.lookAt([1,1,1],[1,1,1]),RangeError);
});
test('orthographic planes map to clip-space extrema and CSS uses a top-left origin',()=>{
  const p=M.ortho(-2,6,-1,3,.5,10.5);
  close(M.transform4(p,-2,-1,-.5,1),[-1,-1,-1,1]);
  close(M.transform4(p,6,3,-10.5,1),[1,1,1,1]);
  const pixel=M.project([-2,3,-.5],p,600,200); close([pixel.x,pixel.y,pixel.depth],[0,0,-1]);
  for (const args of [[2,2,-1,1,1,3],[-1,1,1,-1,1,3],[-1,1,-1,1,5,3]]) {
    assert.throws(()=>M.ortho(...args),RangeError);
  }
});

const builders = {
  panel:()=>G.panel(3,2),
  box:()=>G.box(2,3,4),
  'bevelled box':()=>G.box(2,.8,4,.15),
  'bevel clamped on a thin box':()=>G.box(1,.02,1,2),
  'rounded slab':()=>G.roundedSlab(2,.18,1,.22,.03),
  'unbevelled slab':()=>G.roundedSlab(2,.12,1,.12,0),
  'capped cylinder':()=>G.cylinder(.51,.68,1.7,17),
  'hollow vessel':()=>G.lathe([[.13,0],[.24,.3],[.23,.33],[.21,.31],[.17,.13]],24),
  'zero-radius cone tip':()=>G.lathe([[.7,0],[0,1]],13),
  ellipsoid:()=>G.ellipsoid(.7,.3,.9,18,9),
  'curved tube':()=>G.tube([[0,0,0],[1,0,0],[1.8,.45,0],[2.1,1.3,.2]],.08,9)
};
for (const [name,builder] of Object.entries(builders)) {
  test(name+' has finite attributes, valid indices, positive area and outward winding',()=>validateMesh(builder()));
}
test('panel UVs put top-left printing at the top-left of the physical sign',()=>{
  const m=G.panel(4,2);
  close(m.positions.slice(-3),[-2,1,0]); close(m.uvs.slice(-2),[0,0]);
  close(m.uvs.slice(0,2),[0,1]);
});
test('ellipsoid surface follows its implicit equation and its gradient',()=>{
  const radii=[2,.45,.73], mesh=G.ellipsoid(...radii);
  for (let i=0;i<mesh.positions.length;i+=3) {
    const p=mesh.positions.slice(i,i+3);
    close([p.reduce((sum,v,j)=>sum+(v/radii[j])**2,0)],[1]);
    close(mesh.normals.slice(i,i+3),M.unit(p.map((v,j)=>v/radii[j]**2)));
  }
});
test('tube transport handles repeated points, reversals and parallel reference axes',()=>{
  const mesh=G.tube([[0,0,0],[0,0,0],[1,0,0],[0,0,0],[.2,1,0]],.05,8);
  assert.ok(mesh.positions.every(Number.isFinite));
  for (let i=0;i<mesh.normals.length;i+=3) close([Math.hypot(...mesh.normals.slice(i,i+3))],[1]);
  assert.throws(()=>G.tube([[0,0,0],[0,0,0]],.1),RangeError);
  assert.throws(()=>G.tube([[0,0,0],[1,0,0]],.1,2),RangeError);
  assert.throws(()=>G.lathe([[1,0]],12),RangeError);
  assert.throws(()=>G.ellipsoid(1,0,2),RangeError);
});
test('batch rollover keeps each primitive whole and rebases unsigned-short indices',()=>{
  const b=new G.Batcher(8), panel=G.panel(1,1);
  for (let i=0;i<5;i++) b.add(panel,M.translation(i,0,0),'#408020',i+1,.4);
  const chunks=b.finish(); assert.deepEqual(chunks.map(c=>c.vertices.length/G.STRIDE),[8,8,4]);
  chunks.forEach(c=>{
    assert.ok(c.indices instanceof Uint16Array); assert.ok(c.vertices instanceof Float32Array);
    assert.ok(c.indices.every(i=>i<c.vertices.length/G.STRIDE));
    assert.deepEqual(Array.from(c.indices.slice(0,6)),panel.indices);
  });
  assert.equal(b.finish().length,3);
  assert.throws(()=>new G.Batcher(3).add(panel,M.identity(),'#ffffff'),RangeError);
});
test('batcher uses inverse-transpose normals under non-uniform scaling and reflection',()=>{
  for (const sx of [2,-2]) {
    const b=new G.Batcher(), mesh=G.ellipsoid(1,1,1,8,4);
    const m=M.identity(); m[0]=sx; m[5]=.5; m[10]=3; m[12]=9;
    b.add(mesh,m,'#408020',5,.7,[.1,.2,.6,.8]);
    const data=b.finish()[0].vertices;
    for (let i=0;i<data.length/G.STRIDE;i++) {
      const j=i*G.STRIDE, k=i*3, n=mesh.normals.slice(k,k+3);
      close(data.slice(j,j+3),[mesh.positions[k]*sx+9,mesh.positions[k+1]*.5,mesh.positions[k+2]*3]);
      close(data.slice(j+3,j+6),M.unit([n[0]/sx,n[1]/.5,n[2]/3]));
      close(data.slice(j+6,j+9),[64/255,128/255,32/255]);
      close(data.slice(j+9,j+13),[.1,.2,5,.7]);
    }
  }
});
