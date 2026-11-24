'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sim=require('../js/simulation');
const M=require('../js/math');
const {bufferSize}=require('../js/renderer');
const {steam}=require('../js/world');
const nearly=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,a+' vs '+b);

test('slow orbit advances smoothly and stays on the open side of the café',()=>{
  const v=sim.createView(),angles=[];
  for (let i=0;i<7200;i++) {
    const old=v.yaw; sim.step(v,1/60);
    assert.ok(Math.abs(v.yaw-old)<.001); assert.ok(Math.abs(v.yaw-sim.HOME.yaw)<=.256);
    angles.push(v.yaw);
  }
  assert.ok(Math.max(...angles)-Math.min(...angles)>.49);
});
test('orbit pause, drag and re-enable preserve the current camera bearing',()=>{
  const v=sim.createView();
  for (let i=0;i<120;i++) sim.step(v,1/60);
  sim.setOrbit(v,false); const yaw=v.yaw;
  sim.step(v,.04); nearly(v.yaw,yaw);
  sim.rotate(v,10,3); assert.ok(v.targetYaw<yaw); assert.ok(v.targetPitch>sim.HOME.pitch);
  for (let i=0;i<100;i++) sim.step(v,1/60);
  const after=v.yaw; sim.setOrbit(v,true); nearly(v.targetYaw,after);
  sim.step(v,1/60); assert.ok(Math.abs(v.yaw-after)<.001);
  sim.rotate(v,1,1); assert.equal(v.auto,false);
});
test('damping is time-based at 30 and 120 fps and ignores invalid frame times',()=>{
  function after(fps) {
    const v=sim.createView(false); sim.rotate(v,62,30); sim.zoomBy(v,1.5);
    for (let i=0;i<fps/2;i++) sim.step(v,1/fps);
    return v;
  }
  const a=after(30),b=after(120);
  for (const key of ['yaw','pitch','zoom']) nearly(a[key],b[key]);
  for (const dt of [-1,NaN,Infinity]) assert.equal(sim.step(a,dt),0);
  assert.ok(sim.step(a,4000)<=.065);
});
test('pitch and zoom clamp at both limits, invalid zoom factors leave the target intact',()=>{
  const v=sim.createView();
  sim.rotate(v,0,1e7); assert.equal(v.targetPitch,sim.LIMITS.maxPitch);
  sim.rotate(v,0,-1e7); assert.equal(v.targetPitch,sim.LIMITS.minPitch);
  sim.zoomBy(v,1e20); assert.equal(v.targetZoom,sim.LIMITS.maxZoom);
  sim.zoomBy(v,1e-20); assert.equal(v.targetZoom,sim.LIMITS.minZoom);
  for (const x of [NaN,Infinity,0,-2]) sim.zoomBy(v,x);
  assert.equal(v.targetZoom,sim.LIMITS.minZoom);
});
test('reset takes the shortest route after repeated full rotations',()=>{
  const v=sim.createView(false);
  v.yaw=sim.HOME.yaw+4*Math.PI-.4; v.pitch=.92; v.zoom=1.6;
  sim.resetView(v,false);
  nearly(v.targetYaw-v.yaw,.4); nearly(v.targetPitch,sim.HOME.pitch); nearly(v.targetZoom,1);
  assert.equal(v.auto,false);
  for (let i=0;i<120;i++) sim.step(v,1/60);
  nearly(Math.cos(v.yaw),Math.cos(sim.HOME.yaw)); nearly(v.zoom,1);
});
test('automatic framing encloses the measured extents at portrait, square and wide aspects',()=>{
  for (const [w,h] of [[300,530],[840,840],[1030,456],[1920,700]]) {
    for (const yaw of [-1.3,.19,sim.HOME.yaw,1.96,Math.PI]) {
      const v={...sim.HOME,yaw};
      const {matrix,right,direction}=sim.camera(v,w,h);
      nearly(M.dot(right,direction),0); nearly(Math.hypot(...right),1);
      for (const point of sim.FRAME_POINTS) {
        const p=M.project(point,matrix,w,h);
        assert.ok(p.x>0 && p.x<w && p.y>0 && p.y<h && Math.abs(p.depth)<1);
      }
    }
  }
});
test('steam forms independent, continuous, upward ribbons with invisible endpoints',()=>{
  for (const source of steam) for (let strand=0;strand<3;strand++) {
    const points=Array.from({length:25},(_,i)=>sim.steamPoint(source,strand,i/24,4.5));
    nearly(points[0].y,source.y); nearly(points.at(-1).y,source.y+source.height);
    nearly(points[0].alpha,0); nearly(points.at(-1).alpha,0);
    for (const [i,p] of points.entries()) {
      assert.ok(p.width>0 && p.alpha>=0 && p.alpha<=1);
      if (i>0) { assert.ok(p.y>points[i-1].y); assert.ok(Math.abs(p.x-points[i-1].x)<.08); }
    }
    assert.notEqual(points[12].x,sim.steamPoint(source,strand,.5,6).x);
  }
  assert.notEqual(sim.steamPoint(steam[0],0,.4,1).z,sim.steamPoint(steam[0],1,.4,1).z);
});
test('steam topology stays fixed, billboard widths follow the camera and uploads reuse storage',()=>{
  const mesh=sim.steamMesh(steam,12),vertices=mesh.vertices,indices=mesh.indices;
  assert.equal(mesh.indices.length,steam.length*3*12*6);
  assert.equal(mesh.vertices.length,steam.length*3*13*2*5);
  assert.ok(indices.every(i=>i<vertices.length/5));
  sim.updateSteam(mesh,steam,[0,0,-1],5);
  assert.ok(vertices.every(Number.isFinite));
  for (let i=0;i<vertices.length;i+=10) {
    nearly(vertices[i],vertices[i+5]); nearly(vertices[i+1],vertices[i+6]);
    assert.ok(vertices[i+2]>vertices[i+7]);
    assert.equal(vertices[i+3],-1); assert.equal(vertices[i+8],1);
  }
  const before=vertices.slice(); sim.updateSteam(mesh,steam,[1,0,0],6);
  assert.equal(mesh.indices,indices); assert.equal(mesh.vertices,vertices);
  assert.notDeepEqual(before,vertices);
});
test('pointer pixels respect offset-independent CSS coordinates, fractional DPR and bottom-left readback',()=>{
  assert.deepEqual(sim.pickPixel(0,0,275,180,412,270),[0,269]);
  assert.deepEqual(sim.pickPixel(274.99,179.99,275,180,412,270),[411,0]);
  assert.deepEqual(sim.pickPixel(137.5,90,275,180,412,270),[206,134]);
  for (const [x,y] of [[-1,0],[0,-1],[275,0],[0,180],[NaN,1],[0,Infinity]]) {
    assert.equal(sim.pickPixel(x,y,275,180,412,270),null);
  }
  assert.equal(sim.pickPixel(0,0,0,10,1,2),null); assert.equal(sim.pickPixel(0,0,10,10,0,0),null);
});
test('touch threshold, wrapping navigation and sight lines handle edge cases',()=>{
  assert.equal(sim.moved({x:10,y:10},{x:13,y:13}),false);
  assert.equal(sim.moved({x:10,y:10},{x:13,y:14}),true);
  assert.equal(sim.cycleIndex(0,-1,6),5); assert.equal(sim.cycleIndex(5,7,6),0);
  assert.ok(sim.exposed([0,1,0],[0,.3,1]));
  assert.ok(!sim.exposed([0,1,0],[0,.1,-1]));
  assert.ok(!sim.exposed([-3,1,0],[-1,.1,0]));
  assert.ok(sim.exposed([0,1,0],[0,1,-.1]));
});
test('backing store preserves aspect and caps both pixel work and device limits',()=>{
  assert.deepEqual(bufferSize(400,300,1.5,4096),[600,450]);
  assert.deepEqual(bufferSize(0,100,2,4096),[1,1]);
  for (const [w,h,dpr,cap] of [[2000,1200,4,4096],[10000,350,3,2048],[270,800,2,1024]]) {
    const [a,b]=bufferSize(w,h,dpr,cap);
    assert.ok(a*b<=2400000 && Math.max(a,b)<=cap);
    nearly(a/w,b/h,.005);
  }
});
