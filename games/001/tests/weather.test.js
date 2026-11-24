'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/weather.js');
const world = require('../src/campus.js').create();

test('rain fades at the same rate across refresh rates and reverses a passing shower smoothly', () => {
  function rainFor(hz) {
    const w = W.create();
    w.shower = true;
    for (let i=0; i<hz/2; i++) assert.ok(W.step(w,1/hz,false));
    return w;
  }
  const w = rainFor(60), reference = rainFor(144);
  assert.ok(Math.abs(w.wet-reference.wet)<1e-9 && Math.abs(w.time-reference.time)<1e-9);
  const wet = w.wet;
  assert.ok(wet>0 && wet<1 && w.drops);
  w.shower = false;
  W.step(w,.05,false);
  assert.ok(w.wet>0 && w.wet<wet);
  for (let i=0; i<150; i++) W.step(w,1/60,false);
  assert.deepEqual(w,W.create());
  assert.equal(W.step(w,1/60,false),false);
});

test('rain time wraps and pauses safely, with immediate still-weather changes for reduced motion', () => {
  const w=W.create(); w.shower=true;
  for (const dt of [0,-1,NaN,Infinity]) assert.equal(W.step(w,dt,false),false);
  W.step(w,80,false);
  assert.equal(w.time,.1);
  for (let i=0; i<120; i++) W.step(w,1/60,false);
  assert.equal(w.wet,1);
  assert.ok(Math.abs(w.time-.1)<1e-9);
  const before={...w};
  assert.equal(W.step(w,50,false,true),false);
  assert.deepEqual(w,before);
  assert.equal(W.step(w,1/60,true),true);
  assert.equal(w.drops,false);
  assert.equal(w.time,before.time);
  assert.equal(W.step(w,1/60,true),false);
  w.shower=false; W.step(w,1/60,true);
  assert.deepEqual(w,W.create());
});

test('rain seeds are deterministic triangles inside a single tiling volume', () => {
  const data=W.makeRainMesh();
  assert.deepEqual(W.makeRainMesh(),data);
  assert.equal(data.length,W.DROPS*15);
  const seeds=new Set();
  for (let i=0; i<data.length; i+=15) {
    const seed=data.slice(i,i+3);
    assert.ok(seed[0]>=0 && seed[0]<W.SPAN && seed[2]>=0 && seed[2]<W.SPAN);
    assert.ok(seed[1]>=0 && seed[1]<W.HEIGHT);
    seeds.add(seed.join(','));
    for (let corner=0; corner<3; corner++) {
      const n=i+5*corner;
      assert.deepEqual(data.slice(n,n+3),seed);
      assert.deepEqual([...data.slice(n+3,n+5)],[[-1,0],[1,0],[0,1]][corner]);
    }
  }
  assert.equal(seeds.size,W.DROPS);
});

test('the pavilion, arcade, library and cloister give cover right up to the eaves', () => {
  assert.equal(world.shelters.length,4);
  assert.equal(W.coverAt(0,20,world.shelters),undefined);
  for (const [x,z] of [[31,-22.8],[23.7,9.75],[-22,14.2],[-7,-22.4]]) {
    const roof=W.coverAt(x,z,world.shelters);
    assert.ok(roof && roof.height>3);
    assert.equal(W.coverAt(roof.x+roof.w/2,roof.z,world.shelters),roof);
    assert.notEqual(W.coverAt(roof.x+roof.w/2+.01,roof.z,world.shelters),roof);
  }
});
