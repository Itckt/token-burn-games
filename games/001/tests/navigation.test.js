'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {RADIUS, canStand, canWalk} = require('../src/collision.js');
const {Planner, WalkingRoute, lengthFrom} = require('../src/navigation.js');
const {layout, project, drawRoute} = require('../src/map.js');
const {Recording2D} = require('./support/graphics.js');
const campus = require('../src/campus.js').create();
const bounds = {west:-8, east:8, north:-8, south:8};

function verifyLegs(world, from, points, destination) {
  assert.ok(points && points.length, 'expected a walking route');
  assert.deepEqual(points.at(-1),destination);
  for (const [x,z] of points) {
    const [ax,az] = from, steps = Math.max(1,Math.ceil(Math.hypot(x-ax,z-az)/.08));
    // Check the finished polyline using the movement test independently of its planner.
    for (let i=0; i<=steps; i++) {
      assert.ok(canStand(ax+(x-ax)*i/steps,az+(z-az)*i/steps,world),'blocked leg '+from+' to '+[x,z]);
    }
    from = [x,z];
  }
}

test('swept clearance checks thin obstacles between endpoints and the rounded corners of a planter', () => {
  const world = {bounds,colliders:[{kind:'box',x:0,z:0,w:2,d:2},{kind:'circle',x:4,z:0,r:.25}]};
  assert.equal(canWalk(-4,0,2,0,world),false);
  assert.equal(canWalk(-4,1.4,2,1.4,world),true);
  assert.equal(canWalk(1.4,1.1,1.1,1.4,world),true);
  assert.equal(canWalk(1.34,1.04,1.04,1.34,world),false);
  for (const [a,b] of [[[3,-2],[5,2]],[[4.55,-2],[4.55,2]],[[4,-2],[4,0]]]) {
    assert.equal(canWalk(...a,...b,world),false);
    assert.equal(canWalk(...b,...a,world),false);
  }
  assert.equal(canWalk(4.58,-2,4.58,2,world),true);
  for (const p of [[NaN,2],[3,Infinity],[0,0],[8-RADIUS/2,2]]) {
    assert.equal(canStand(...p,world),false);
    assert.equal(canWalk(0,3,...p,world),false);
  }
  assert.equal(canStand(0,0,world,0),false);
  assert.equal(canWalk(2,2,2,2,world),true);
});

test('straight and coincident routes keep their exact endpoints and need no lattice', () => {
  const planner = new Planner({bounds,colliders:[]}), a = [.164,.27], b = [3.164,4.27];
  assert.deepEqual(planner.find(a,b),[b]);
  assert.deepEqual(planner.find(b,b),[b]);
  assert.ok(Math.abs(lengthFrom(a,[b])-5)<1e-10);
  assert.equal(lengthFrom(b,[b]),0);
  assert.equal(planner.grid,null);
  assert.equal(planner.find([Infinity,0],b),null);
  assert.equal(planner.find(a,[8,0]),null);
});

test('a wall narrower than the route lattice still blocks crossings and isolated destinations', () => {
  const wall = {kind:'box',x:0,z:0,w:.06,d:16};
  const world = {bounds,colliders:[wall]};
  const planner = new Planner(world);
  for (const goal of [[6,.1],[0,.1]]) assert.equal(planner.find([-6,.1],goal),null);
  const gap = {...world,colliders:[{...wall,d:12}]};
  const around = new Planner(gap).find([-6,.1],[6,.1]);
  verifyLegs(gap,[-6,.1],around,[6,.1]);
  assert.ok(around.some(p=>Math.abs(p[1])>6+RADIUS));
  for (const [a,b] of [[[0,0],[1,1]],[[1,1],[0,0]]]) assert.equal(new Planner(gap).find(a,b),null);
});

test('every campus approach and stamp tile connects to every press along continuously walkable ground', () => {
  const planner = new Planner(campus);
  for (const start of campus.places.flatMap(p=>[p.view.slice(0,2),p.stamp.at])) {
    for (const place of campus.places) {
      const path = planner.find(start,place.stamp.at);
      verifyLegs(campus,start,path,place.stamp.at);
      assert.ok(lengthFrom(start,path)<160, place.name+' excessive detour');
    }
  }
});

test('live directions skip a completed corner and replan when a visitor leaves the path', () => {
  const world = {bounds,colliders:[{kind:'box',x:0,z:0,w:1,d:5}]};
  const planner = new Planner(world), from = [-6,0], goal = [6,0];
  const preview = planner.find(from,goal), original = structuredClone(preview);
  const route = new WalkingRoute(planner,from,{stamp:{at:goal}},preview);
  const atBend = route.update(preview[0]);
  assert.ok(atBend.length<original.length);
  verifyLegs(world,original[0],atBend,goal);
  const offCourse = [3,-6];
  assert.deepEqual(route.update(offCourse),[goal]);
  const backBehindWall = [-4,0];
  verifyLegs(world,backBehindWall,route.update(backBehindWall),goal);
  assert.equal(route.update([0,0]),null);
  verifyLegs(world,from,route.update(from),goal);
  assert.deepEqual(preview,original);
});

test('both map sizes project each route corner and mark the physical endpoint in map coordinates', () => {
  const state = {x:-3,z:5}, route = [[-3,-2],[2,-2],[4,0]], c = {active:'#a53',paper:'#fed'};
  for (const large of [false,true]) {
    const p = layout(bounds,large?331:187,large?247:111);
    const ctx = new Recording2D(), path = [];
    for (const op of ['moveTo','lineTo','translate']) ctx[op] = (...args)=>path.push([op,...args]);
    drawRoute(ctx,p,state,null,c,large);
    assert.deepEqual(path,[]);
    drawRoute(ctx,p,state,route,c,large);
    assert.deepEqual(path,[['moveTo',...project(p,state.x,state.z)],
      ...route.map(point=>['lineTo',...project(p,...point)]), ['translate',...project(p,...route.at(-1))]]);
    assert.equal(ctx.counts.stroke,2);
    assert.equal(ctx.counts.fillRect,1);
  }
});
