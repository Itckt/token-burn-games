'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/math.js');
const S = require('../src/simulation.js');
const bounds = {west:-50, east:50, north:-50, south:50};
const open = {bounds, colliders:[]};
const start = (yaw = 0) => S.makeState([0, 0, yaw, 0]);
function stepFor(s, codes, seconds = 1, hz = 60, world = open, reduced = false) {
  const keys = new Set(codes);
  for (let i = 0; i < Math.round(seconds * hz); i++) S.step(s, keys, 1/hz, world, reduced);
  return s;
}
function close(a, b, tol = 1e-6) { assert.ok(Math.abs(a-b) < tol, `${a} vs ${b}`); }

test('WASD moves relative to the horizontal heading and opposite directions cancel', () => {
  const n = stepFor(start(), ['KeyW']);
  assert.ok(n.z < -3);
  close(n.x, 0);
  for (const [code,x,z] of [['KeyD',-n.z,0],['KeyA',n.z,0],['KeyS',0,-n.z]]) {
    const s = stepFor(start(), [code]);
    close(s.x,x); close(s.z,z);
  }
  const east = start(Math.PI/2);
  east.pitch = east.aimPitch = 1.25;
  stepFor(east, ['KeyW']);
  close(east.x, -n.z); close(east.z, 0);
  const opposed = stepFor(start(), ['KeyA','KeyD','KeyW','KeyS']);
  close(opposed.x,0); close(opposed.z,0);
});

test('walking accelerates smoothly, diagonal input is normalized, and either Shift increases speed', () => {
  const s = start();
  stepFor(s, ['KeyW'], 1/60);
  assert.ok(-s.vz > 0 && -s.vz < S.WALK/2);
  stepFor(s, ['KeyW'], 2);
  close(-s.vz, S.WALK);
  const diagonal = stepFor(start(), ['KeyW','KeyD'], 2);
  const straight = stepFor(start(), ['KeyW'], 2);
  close(Math.hypot(diagonal.x,diagonal.z), -straight.z);
  for (const shift of ['ShiftLeft','ShiftRight']) {
    const fast = stepFor(start(), ['KeyW',shift], 2);
    close(-fast.vz,S.RUN);
    close(fast.z / straight.z, S.RUN / S.WALK);
  }
  const previous = s.z;
  stepFor(s, [], 1.5);
  assert.ok(s.z < previous && s.z > previous-0.3);
  close(s.vz,0);
});

test('the same walk and release cover the same distance at different refresh rates', () => {
  function walk(hz) {
    const s = stepFor(start(0.67), ['KeyW','KeyA'], 2, hz);
    return stepFor(s, [], 1, hz);
  }
  const base = walk(60);
  for (const hz of [20,30,90,120,144]) {
    const s = walk(hz);
    close(s.x,base.x,0.0001); close(s.z,base.z,0.0001);
  }
});

test('mouse input is smoothed, wraps the shortest way through north/south, and clamps pitch', () => {
  const s = start(Math.PI - 0.04);
  S.look(s, 80, -99999, 0.001);
  close(s.yaw, Math.PI-0.04);
  close(s.aimYaw, -Math.PI+0.04);
  close(s.aimPitch,S.PITCH_LIMIT);
  stepFor(s, [], 1/60);
  const turn = M.wrapAngle(s.yaw-(Math.PI-0.04));
  assert.ok(turn > 0 && turn < 0.08);
  assert.ok(s.pitch > 0 && s.pitch < s.aimPitch);
  stepFor(s, [], 1.5);
  close(s.yaw,s.aimYaw);
  S.look(s, 0, 99999);
  close(s.aimPitch,-S.PITCH_LIMIT);
  const before = {...s};
  S.look(s, Infinity, 20);
  S.look(s, 0, NaN);
  assert.deepEqual(s, before);
});

test('keyboard looking works without a mouse and reset clears all residual motion', () => {
  const s = stepFor(start(), ['ArrowRight','ArrowUp','KeyW'], 2);
  assert.ok(Math.abs(s.yaw) > 2 && s.pitch > 1.35 && Math.hypot(s.vx,s.vz) > 1);
  stepFor(s, ['ArrowLeft','ArrowDown'], 0.5);
  assert.ok(s.aimPitch < 1);
  s.night = true; s.light = 0.78;
  S.setView(s, [10,12,-0.8,0.22]);
  assert.deepEqual([s.x,s.z,s.yaw,s.aimYaw,s.pitch,s.aimPitch,s.vx,s.vz,s.phase,s.bob],
    [10,12,-0.8,-0.8,0.22,0.22,0,0,0,0]);
  assert.equal(s.night,true);
  assert.equal(s.light,0.78);
});

test('invalid frame times leave the camera alone and long gaps cannot cause teleportation', () => {
  const s = start(), original = {...s};
  for (const dt of [NaN,Infinity,-1,0]) assert.equal(S.step(s,new Set(['KeyW']),dt,open),false);
  assert.deepEqual(s,original);
  S.step(s,new Set(['KeyW','ShiftLeft']),600,open);
  assert.ok(-s.z < S.RUN*0.1 && s.z < 0);
});

test('player clearance respects perimeter, circular trunks, and rounded box corners', () => {
  const world = {bounds,colliders:[{kind:'box',x:0,z:0,w:4,d:2},{kind:'circle',x:8,z:4,r:1}]};
  assert.equal(S.canStand(0,0,world),false);
  assert.equal(S.canStand(2.20,1.20,world),false);
  assert.equal(S.canStand(2.25,1.25,world),true);
  assert.equal(S.canStand(9.31,4,world),false);
  assert.equal(S.canStand(9.33,4,world),true);
  for (const [x,z] of [[-49.9,0],[49.9,0],[0,49.9],[0,-49.9]]) assert.equal(S.canStand(x,z,world),false);
  assert.equal(S.canStand(49.67,-49.67,world),true);
});

test('substeps prevent tunnelling through a thin wall and allow sliding along it', () => {
  const world = {bounds,colliders:[{kind:'box',x:1,z:0,w:0.06,d:30}]};
  const s = start();
  S.move(s,12,-4,world);
  assert.ok(s.x < 1-0.03-S.RADIUS && s.x > 0.4);
  close(s.z,-4);
  assert.ok(S.canStand(s.x,s.z,world));
  S.move(s,-140,0,world);
  assert.ok(s.x >= bounds.west+S.RADIUS && s.x < bounds.west+0.55);
  const trunk = {bounds,colliders:[{kind:'circle',x:0,z:-2,r:0.1}]};
  const other = start();
  S.move(other,0,-8,trunk);
  assert.ok(other.z > -2+0.1+S.RADIUS);
});

test('light fades in both directions, reverses mid-transition, and snaps to exact endpoints', () => {
  const s = start();
  s.night = true;
  stepFor(s, [], 0.15);
  const twilight = s.light;
  assert.ok(twilight > 0 && twilight < 1);
  s.night = false;
  stepFor(s,[],0.1);
  assert.ok(s.light > 0 && s.light < twilight);
  stepFor(s,[],2);
  assert.equal(s.light,0);
  s.night = true;
  let previous=0;
  for (let i=0; i<120; i++) {
    S.step(s,new Set(),1/60,open);
    assert.ok(s.light >= previous && s.light <= 1);
    previous=s.light;
  }
  assert.equal(s.light,1);
  assert.equal(S.step(s,new Set(),1/60,open),false);
});

test('walking adds small head movement and reduced motion gives a steady camera and instant lighting', () => {
  const s = stepFor(start(),['KeyW'],0.4);
  assert.ok(Math.abs(s.bob)>0.001 && Math.abs(s.bob)<0.025);
  const steady = start();
  steady.night = true;
  stepFor(steady,['KeyW'],1/60,60,open,true);
  assert.equal(steady.bob,0);
  assert.equal(steady.light,1);
});

test('landmark proximity follows its approach and resists small boundary oscillations', () => {
  const places = [{id:'west',view:[0,10],point:[0,0]}, {id:'east',view:[10,10],point:[10,0]}];
  assert.equal(S.nearest({x:2,z:6},places).id,'west');
  assert.equal(S.nearest({x:5.3,z:5},places).id,'east');
  assert.equal(S.nearest({x:5.3,z:5},places,'west').id,'west');
  assert.equal(S.nearest({x:6,z:5},places,'west').id,'east');
  assert.equal(S.nearest({x:1,z:1},[{id:'point',view:[3,3],point:[3,3]}]).id,'point');
});

test('changing reduced-motion preference mid-stride immediately steadies the camera', () => {
  const s=stepFor(start(),['KeyW'],.4);
  assert.notEqual(s.bob,0);
  stepFor(s,['KeyW'],1/60,60,open,true);
  assert.equal(s.bob,0);
  const before={...s};
  S.look(s,32,20,NaN);
  S.move(s,0,Infinity,open);
  assert.deepEqual(s,before);
});

test('bearings round and wrap cleanly at north and all eight compass sectors', () => {
  const labels=['N','NE','E','SE','S','SW','W','NW'];
  for (let n=-8; n<=16; n++) {
    const idx=(n%8+8)%8;
    assert.deepEqual(S.bearing(n*Math.PI/4),{degrees:idx*45,label:labels[idx]});
  }
  assert.deepEqual(S.bearing(-0.004),{degrees:0,label:'N'});
});

test('reversing away from a wall wakes a reduced-motion walk even after the animation slept',()=>{
  const world={bounds:{west:-10,east:10,north:0,south:10},colliders:[]};
  const s=S.makeState([0,3,0,0]), dt=1/60, forward=new Set(['KeyW']);
  for (let i=0;i<180;i++) if (!S.step(s,forward,dt,world,true)) break;
  assert.equal(s.vz,0);
  assert.equal(S.step(s,new Set(),dt,world,true),false);
  const z=s.z;
  assert.ok(S.step(s,new Set(['KeyS']),dt,world,true));
  assert.ok(s.z>z);
});
