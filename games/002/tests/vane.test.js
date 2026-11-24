"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Deck = require("../src/deck.js");
const {Controls} = require("../src/controls.js");
const {round,ticks,place,near} = require("./round.js");
const R=G.RULES;

function incoming(options={}) {
  const g=round(options), [player,,,shooter]=g.actors;
  place(player,0,0); place(shooter,3,0);
  G.fire(g,shooter,-Math.PI/2);
  return {g,player,shooter,shot:g.shots[0]};
}

test("the vane is a buffered edge, costs no energy, expires after its window and recharges on match time", () => {
  const keys=new Controls(), g=round(), p=g.actors[0];
  keys.press("KeyF"); keys.press("KeyF");
  G.step(g,keys.sample(0));
  assert.equal(g.events.filter(e=>e.type==="vane").length,1);
  near(p.vaneLeft,R.vaneTime-R.step);
  assert.equal(keys.sample(0).vane,false);
  keys.press("KeyF"); keys.clear(); assert.equal(keys.sample(0).vane,false);
  assert.equal(g.deck.energy,Deck.RULES.initial); assert.equal(p.shots,0);
  G.pause(g); const state=JSON.stringify(g);
  ticks(g,30,{vane:true}); assert.equal(JSON.stringify(g),state);
  G.pause(g); ticks(g,17); assert.equal(p.vaneLeft,0);
  assert.equal(G.raiseVane(g,p),false);
  ticks(g,222); G.step(g,{vane:true});
  assert.equal(g.events.filter(e=>e.type==="vane").length,2);
});

test("a returned bolt uses the rest of the tick and gives its defender damage, knockout and win credit", () => {
  const {g,player,shooter,shot}=incoming({target:1});
  place(shooter,1.4,0); shot.x=shooter.x; shot.vx=-64; shooter.hp=R.shotDamage;
  G.step(g,{vane:true},0.05);
  assert.equal(player.hp,100); assert.equal(player.returns,1);
  const e=g.events.find(e=>e.type==="boltReturn");
  near(e.x,R.hitRadius); assert.equal(e.source,0);
  assert.deepEqual([player.damage,player.kills,player.shots],[R.shotDamage,1,0]);
  assert.deepEqual([shooter.damage,shooter.deaths,shooter.shots],[0,1,1]);
  assert.deepEqual(g.scores,[1,0]); assert.equal(g.winner,0);
  assert.equal(g.shots.length,0);
});

test("contact before, at and after the vane deadline uses swept flight time", () => {
  for (const [window,returned] of [[0.026,true],[0.025,false],[0.024,false]]) {
    const {g,player,shot}=incoming();
    shot.x=R.hitRadius+0.5; shot.vx=-20; shot.vz=0;
    player.vaneLeft=window;
    G.step(g,{},0.05);
    assert.equal(player.returns,Number(returned),"window "+window);
    assert.equal(player.hp,returned ? 100 : 78);
    if (returned) {
      near(shot.x,R.hitRadius+0.5); near(shot.vx,20);
      near(shot.life,R.shotLife-0.05); near(shot.yaw,Math.PI/2);
    }
  }
});

test("every bolt in a timely volley turns with its original damage and remaining range", () => {
  const {g,player,shooter,shot}=incoming();
  shot.x=0.8; shot.vx=-20; shot.life=0.025; shot.damage=18;
  const second={...shot,life:0.8,damage:34}; g.shots.push(second);
  G.raiseVane(g,player); G.step(g,{},0.05);
  assert.equal(player.returns,2);
  assert.deepEqual(g.shots,[second]);
  near(shot.life,0); near(shot.x,0.72);
  assert.equal(second.owner,player.id); assert.equal(second.team,player.team);
  ticks(g,15);
  assert.equal(shooter.hp,66); assert.equal(player.damage,34);
});

test("a reflected bank bolt becomes a straight return and collides with its original wall again", () => {
  const g=round({loadout:["bank","haul","net"]}), [p,,,foe]=g.actors, box=A.blocks[0];
  place(p,box.x,box.z+1.6); place(foe,box.x,box.z+2.6);
  p.yaw=Math.PI; G.playCard(g,0);
  const shot=g.shots[0]; shot.vz=-150;
  place(p,-11,0); G.raiseVane(g,foe); G.step(g,{},0.05);
  assert.equal(foe.returns,1); assert.equal(shot.bank,false);
  assert.equal(g.shots.length,0);
  assert.deepEqual(g.events.filter(e=>["ricochet","boltReturn","impact"].includes(e.type)).map(e=>e.type),
    ["ricochet","boltReturn","impact"]);
  near(shot.z,box.z+box.d/2+0.06);
});

test("two overlapping vanes safely absorb a second return and never exchange a bolt indefinitely", () => {
  const {g,player,shooter,shot}=incoming();
  place(shooter,0,0); shot.x=0;
  G.raiseVane(g,shooter); G.raiseVane(g,player);
  G.step(g);
  assert.equal(g.shots.length,0);
  assert.deepEqual([player.returns,shooter.returns,player.hp,shooter.hp],[1,0,100,100]);
});

test("a shield, dash, friendly runner or earlier catch net cannot lend its contact to the vane", () => {
  for (const kind of ["shield","dash","friendly","net"]) {
    const {g,player,shot}=incoming();
    shot.x=1; shot.vx=-30;
    G.raiseVane(g,player);
    if (kind==="shield") player.shield=0.2;
    if (kind==="dash") G.dash(g,player,0,1);
    if (kind==="friendly") { shot.team=player.team; shot.owner=1; }
    if (kind==="net") g.net={team:0,x:0,z:0,remaining:1};
    G.step(g,{},0.05);
    assert.equal(player.hp,100,kind); assert.equal(player.returns,0,kind);
    if (kind==="net") assert.ok(g.events.some(e=>e.type==="intercept"));
    if (kind==="dash") assert.equal(player.vaneLeft,0);
  }
});

test("a vane leaves arc pulses and firing intact, folds on knockout and resets at respawn", () => {
  const g=round(), [p,,,foe]=g.actors;
  place(p,0,0); place(foe,2,0);
  assert.ok(G.raiseVane(g,p));
  assert.ok(G.fire(g,p,Math.PI/2)); assert.ok(G.pulse(g,foe));
  assert.equal(p.hp,R.hp-R.pulseDamage);
  G.hurt(g,foe,p,100);
  assert.equal(p.vaneLeft,0); assert.ok(!G.raiseVane(g,p));
  ticks(g,Math.round(R.respawnTime/R.step));
  assert.equal(p.vaneCd,0); assert.ok(!G.raiseVane(g,p));
  ticks(g,Math.round(R.shieldTime/R.step));
  assert.ok(G.raiseVane(g,p));
  G.dash(g,p,1,0); assert.equal(p.vaneLeft,0);
  const lobby=G.createMatch(); assert.ok(!G.raiseVane(lobby,lobby.actors[0]));
});
