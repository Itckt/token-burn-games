'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const terrain=require('../src/terrain.js');
const sim=require('../src/simulation.js');
const {canStand,canWalk}=require('../src/collision.js');
const {MAT,STRIDE}=require('../src/mesh.js');
const world=require('../src/campus.js').create();
const {ramp,deck,pavilion,heightAt}=terrain;
const close=(n,target,tol=1e-6)=>assert.ok(Math.abs(n-target)<tol,n+' vs '+target);

test('walking heights agree with the rendered board ends, ramp seam, and pavilion platform',()=>{
  const {surfaces,vertices:v}=world;
  const z=(ramp.north+ramp.south)/2;
  assert.equal(heightAt(ramp.west-.001,z,surfaces),0);
  assert.equal(heightAt(ramp.west,z,surfaces),0);
  close(heightAt((ramp.west+ramp.east)/2,z,surfaces),deck.high/2);
  close(heightAt(deck.west-.001,z,surfaces),deck.high,.001);
  assert.equal(heightAt(deck.west,z,surfaces),deck.high);
  assert.equal(heightAt(deck.west+.001,z,surfaces),deck.high);
  for (const point of [[pavilion.west,pavilion.north],[pavilion.east,pavilion.south]]) {
    assert.equal(heightAt(...point,surfaces),pavilion.high);
    assert.equal(heightAt(...point),0);
  }
  let boards=0;
  for (let i=0; i<v.length; i+=STRIDE) if (v[i+9]===MAT.timber) {
    const surface=v[i]<deck.west ? ramp : deck;
    close(v[i+1],terrain.heightOn(surface,v[i]));
    assert.ok(v[i+4]>.98);
    boards++;
  }
  assert.ok(boards>=6*70);
});

test('walking ascends continuously, stays on the deck behind its rails and descends through the entrance',()=>{
  const z=(ramp.north+ramp.south)/2;
  const state=sim.makeState([ramp.west-1,z,Math.PI/2,0]);
  const forward=new Set(['KeyW','ShiftRight']), back=new Set(['KeyS','ShiftLeft']);
  let eye=sim.EYE, climbed=false;
  for (let i=0;i<240;i++) {
    sim.step(state,forward,1/60,world,true);
    const y=sim.eyePosition(state,world)[1];
    assert.ok(y>=eye-1e-9 && y-eye<.02);
    if (y>sim.EYE && y<sim.EYE+deck.high) {
      assert.equal(sim.nearest(state,world.places,'arcade',world.surfaces).id,'terrace');
      climbed=true;
    }
    eye=y;
  }
  assert.ok(climbed && state.x>deck.east-1 && state.x<deck.east);
  close(eye,sim.EYE+deck.high);
  const x=state.x;
  sim.move(state,2,0,world);
  close(state.x,x);
  for (let i=0;i<260;i++) sim.step(state,back,1/60,world,true);
  assert.ok(state.x<ramp.west);
  close(sim.eyePosition(state,world)[1],sim.EYE);
  assert.equal(canWalk(32,deck.north-1,32,deck.north+1,world),false);
  assert.equal(canWalk(20,ramp.north-.8,20,ramp.north+.8,world),false);
  assert.equal(canWalk(ramp.west-1,z,ramp.west+1,z,world),true);
  assert.equal(canStand(34.7,18.5,world),false);
});

test('one short movement substep cannot cut through the rim of a round post',()=>{
  const post={bounds:{west:-2,east:2,north:-2,south:2},colliders:[{kind:'circle',x:0,z:0,r:.2}]};
  const state=sim.makeState([-.09,.519,0,0]);
  assert.ok(canStand(state.x,state.z,post) && canStand(.09,state.z,post));
  assert.equal(canWalk(state.x,state.z,.09,state.z,post),false);
  sim.move(state,.18,0,post);
  close(state.x,-.09);
  state.z=.521;
  sim.move(state,.18,0,post);
  close(state.x,.09);
});
