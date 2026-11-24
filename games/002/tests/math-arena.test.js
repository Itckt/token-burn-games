"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/math.js");
const A = require("../src/arena.js");
const { Controls } = require("../src/controls.js");

function near(actual, expected, tolerance=1e-5) {
  assert.ok(Math.abs(actual-expected) <= tolerance, `${actual} differs from ${expected}`);
}
function vector(actual, expected, tolerance) {
  assert.equal(actual.length,expected.length);
  expected.forEach((v,i) => near(actual[i],v,tolerance));
}

test("vector operations preserve perpendicularity, length and zero vectors", () => {
  const a=[3,-2,5], b=[1,4,-3], n=M.cross(a,b);
  near(M.dot(a,n),0);
  near(M.dot(b,n),0);
  near(Math.hypot(...M.unit(a)),1);
  vector(M.unit([0,0,0]),[0,0,0]);
  near(M.clamp(-3,-2,4),-2);
  near(M.mix(1,9,0.25),3);
  near(M.angleMix(Math.PI-0.2,-Math.PI+0.2,0.5),Math.PI);
});

test("model, composed transforms and inverse use WebGL column order", () => {
  const local=M.model(2,3,-4,Math.PI/2,2,3,4), parent=M.model(-1,7,3,-0.81);
  vector(M.project(local,1,2,3),[14,9,-6]);
  const composite=M.multiply(parent,local), inv=M.inverse(composite);
  for (const p of [[0,0,0],[2,-5,6],[0.25,2.4,-7]]) {
    vector(M.project(composite,...p),M.project(parent,...M.project(local,...p)));
    vector(M.project(inv,...M.project(composite,...p)),p);
  }
  assert.equal(M.inverse(M.model(0,0,0,0,1,0,1)),null);
  vector(M.project(M.ortho(-5,7,-2,8,1,11),-5,-2,-1),[-1,-1,-1]);
  vector(M.project(M.ortho(-5,7,-2,8,1,11),7,8,-11),[1,1,1]);
});

test("oblique camera projection and pointer rays round-trip across the deck", () => {
  for (const aspect of [0.65,1,1.8,3.2]) {
    const view=M.lookAt([-7,29,24],[1,0,2]);
    const vp=M.multiply(M.ortho(-10*aspect,10*aspect,-10,10,0.3,95),view);
    const inv=M.inverse(vp);
    for (const p of [[0,0,0],[-9,0.4,5],[11,1.82,-6]]) {
      const [x,y]=M.project(vp,...p);
      vector(M.groundPoint(inv,x,y,p[1]),p,2e-5);
    }
  }
  assert.equal(M.groundPoint(M.model(),0,0),null);
});

test("seeded randomness is replayable, distributed and exclusively below one", () => {
  const a=M.rng(0), b=M.rng(0), c=M.rng(11), buckets=new Set();
  for (let i=0;i<500;i++) {
    const value=a();
    assert.equal(value,b());
    assert.ok(value>=0 && value<1);
    buckets.add(Math.floor(value*10));
  }
  assert.equal(buckets.size,10);
  assert.notEqual(M.rng(0)(),c());
});

test("box sweeps respect segment length, padding, parallel edges and first contact", () => {
  const box={x:0,z:0,w:2,d:4};
  near(M.segmentBox(-5,0,10,0,box),0.4);
  near(M.segmentBox(5,0,-10,0,box,0.5),0.35);
  near(M.segmentBox(0,-3,0,2,box),0.5);
  near(M.segmentBox(-1,-2,0,0,box),0);
  near(M.segmentBox(-2,-3,1,1,box),1);
  assert.equal(M.segmentBox(-5,0,2,0,box),Infinity);
  assert.equal(M.segmentBox(-5,2.1,10,0,box),Infinity);
  assert.equal(M.segmentBox(2.1,0,0,0,box),Infinity);
});

test("circle sweeps include tangency, overlap and endpoint hits in both directions", () => {
  near(M.segmentCircle(-3,0,6,0,0,0,1),1/3);
  near(M.segmentCircle(3,0,-6,0,0,0,1),1/3);
  near(M.segmentCircle(-3,1,6,0,0,0,1),0.5);
  near(M.segmentCircle(0,0,0,0,0,0,1),0);
  near(M.segmentCircle(-3,0,2,0,0,0,1),1);
  near(M.segmentCircle(-1.000001,0,0.000002,0,0,0,1),0.5);
  for (const delta of [[0,0],[1,0],[-3,0]]) assert.equal(M.segmentCircle(-3,0,...delta,0,0,1),Infinity);
});

test("a circle sweep clipped by immunity can enter later, start inside, or miss an already-cleared runner", () => {
  const at=start=>M.segmentCircle(0,0,10,0,5,0,1,start);
  near(at(-0.5),0.4);
  near(at(0.3),0.4);
  near(at(0.5),0.5);
  near(at(0.6),0.6);
  for (const start of [0.601,1,1.1,Infinity,NaN]) assert.equal(at(start),Infinity);
});

test("both crews have clear opening and home positions on a symmetric collision map", () => {
  for (const [x,z] of [...A.opening,...A.homes.flat()]) assert.ok(A.walkable(x,z,A.radius+0.05));
  for (const b of A.blocks) {
    assert.equal(A.walkable(b.x,b.z),false);
    assert.ok(A.blocks.some(other => other.x===-b.x && other.z===-b.z && other.w===b.w && other.d===b.d));
  }
  assert.ok(!A.walkable(A.halfW,0));
  assert.ok(!A.walkable(0,-A.halfD));
});

test("fast movers stop at cover, slide along faces and stay on the platform", () => {
  const b=A.blocks[0], edge=b.x-b.w/2-A.radius;
  const a={x:edge-1.5,z:b.z};
  A.move(a,60,0);
  near(a.x,edge);
  A.move(a,1,0.6);
  near(a.x,edge); near(a.z,b.z+0.6);
  A.move(a,-100,0);
  near(a.x,-A.halfW+A.radius);
  A.move(a,0,100);
  near(a.z,A.halfD-A.radius);
  assert.ok(A.walkable(a.x,a.z));
});

test("thousands of seeded slides and oversized moves never enter solid geometry", () => {
  const r=M.rng(711);
  for (const [x,z] of A.opening) {
    const a={x,z};
    for (let i=0;i<550;i++) {
      const scale=i%11 ? 1.8 : 32;
      A.move(a,(r()-0.5)*scale,(r()-0.5)*scale);
      assert.ok(A.walkable(a.x,a.z,A.radius-1e-6),JSON.stringify(a));
    }
  }
});

test("navigation finds a traversable detour around a container and links both spawn decks", () => {
  const start={x:-9.5,z:-3.45}, end={x:-2.5,z:-3.45};
  assert.equal(A.clearLine(start.x,start.z,end.x,end.z),false);
  assert.ok(A.route(start.x,start.z,end.x,end.z).length>2);
  const points=[...A.homes[0],...A.opening.slice(0,3),[start.x,start.z]];
  for (const [x,z] of points) {
    for (const [tx,tz] of [...A.homes[1],[end.x,end.z]]) {
      const path=A.route(x,z,tx,tz);
      assert.deepEqual(path.at(-1),{x:tx,z:tz});
      let last={x,z};
      for (const next of path) {
        assert.ok(A.walkable(next.x,next.z,A.radius-0.01));
        assert.ok(A.clearLine(last.x,last.z,next.x,next.z,A.radius-0.01));
        last=next;
      }
    }
  }
  assert.deepEqual(A.route(0,0,1,0),[{x:1,z:0}]);
  assert.deepEqual(A.route(0,0,A.halfW+1,0),[]);
  assert.deepEqual(A.route(A.blocks[0].x,A.blocks[0].z,0,0),[]);
});

test("WASD stays aligned with the screen basis as the camera turns", () => {
  for (const yaw of [-0.245,0,Math.PI/2]) {
    const c=new Controls();
    c.press("KeyW");
    let input=c.sample(yaw);
    vector([input.mx,input.mz],[-Math.sin(yaw),-Math.cos(yaw)]);
    c.press("KeyS");
    c.press("KeyD");
    input=c.sample(yaw);
    vector([input.mx,input.mz],[Math.cos(yaw),-Math.sin(yaw)]);
    c.press("KeyA");
    input=c.sample(yaw);
    vector([input.mx,input.mz],[0,0]);
  }
});

test("input buffers a short click and consumes each ability edge exactly once", () => {
  const c=new Controls();
  c.trigger(); c.held=false;
  c.press("Space"); c.press("KeyE");
  const first=c.sample(0,[2,0,-4]), second=c.sample(0);
  assert.deepEqual([first.fire,first.dash,first.pulse,first.aimX,first.aimZ],[true,true,true,2,-4]);
  assert.deepEqual([second.fire,second.dash,second.pulse],[false,false,false]);
  c.trigger(); c.press("KeyD");
  assert.ok(c.sample(0).fire && c.sample(0).fire);
  c.clear();
  const idle=c.sample(0);
  assert.ok(!idle.fire && !idle.mx && !idle.mz);
});
