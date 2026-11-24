"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Bots = require("../src/bots.js");
const {round,ticks,place,near} = require("./round.js");

test("only a live player can mark a live rival, replace a call or explicitly clear it", () => {
  const g=G.createMatch({bots:false}), [p,,,foe,other]=g.actors;
  assert.equal(G.focus(g,foe.id),false);
  G.start(g);
  G.step(g,{focusTarget:foe.id});
  assert.equal(g.focus.target,foe.id);
  near(g.focus.until-g.elapsed,G.RULES.focusTime);
  const original=g.focus;
  for (const bad of [0,1,2,6,-1,3.5,"3",NaN,undefined]) {
    assert.equal(G.focus(g,bad),false);
    assert.equal(g.focus,original);
  }
  assert.ok(G.focus(g,other.id));
  G.hurt(g,p,foe,100);
  assert.equal(G.focus(g,foe.id),false);
  assert.equal(g.focus.target,other.id);
  assert.ok(G.focus(g,null));
  assert.equal(G.focus(g,null),false);
  G.hurt(g,other,p,100);
  assert.equal(G.focus(g,other.id),false);
  assert.equal(p.shots,0);
});

test("both crewmates immediately target a marked rival while honoring rally routes and intervening cover", () => {
  const g=round(), [,ally,wing,nearer,mark,rival]=g.actors;
  const wall=A.blocks[0];
  place(ally,wall.x,wall.z-1.8); place(mark,wall.x,wall.z+1.8);
  place(nearer,ally.x+1,ally.z);
  G.rally(g,-3,0); G.focus(g,mark.id);
  for (const a of [ally,wing,rival]) {
    const plan=Bots.intent(g,a,G.RULES.step);
    if (a.team===0) {
      assert.equal(a.target,mark.id); assert.equal(a.task,g.rally);
    } else assert.equal(g.actors[a.target].team,0);
    if (a===ally) assert.ok(!plan.fire && !plan.pulse);
  }
  assert.ok(ally.think>G.RULES.step);
  G.focus(g,null);
  Bots.intent(g,ally,G.RULES.step);
  assert.equal(ally.target,nearer.id);
  assert.equal(ally.task,g.rally);
});

test("focus freezes on pause, ends at five active seconds and ends immediately on its target's KO", () => {
  const g=round(), [p,ally,,foe]=g.actors;
  G.focus(g,foe.id); ticks(g,299);
  G.pause(g); const frozen=JSON.stringify(g);
  ticks(g,360,{focusTarget:null}); assert.equal(JSON.stringify(g),frozen);
  G.pause(g); G.step(g);
  assert.equal(g.focus,null);
  G.focus(g,foe.id); G.hurt(g,ally,foe,100);
  assert.equal(g.focus,null); assert.equal(p.assists,1);
  ticks(g,192);
  assert.equal(g.focus,null); assert.equal(foe.hp,100);
  assert.equal(round().actors[0].assists,0);
});

test("recent hits and a live mark credit each helper once, leave the killer out, and award one team point", () => {
  const g=round(), [p,first,killer,foe]=g.actors;
  G.focus(g,foe.id);
  G.hurt(g,p,foe,4); G.hurt(g,p,foe,5); G.hurt(g,first,foe,6);
  G.hurt(g,killer,foe,200);
  assert.deepEqual(g.events.find(e=>e.type==="ko").assists,[0,1]);
  assert.deepEqual([p.assists,first.assists,killer.assists,killer.kills,killer.damage],[1,1,0,1,85]);
  assert.deepEqual(g.scores,[1,0]);
  assert.ok(foe.lastHits.every(t=>t===null));
  ticks(g,192+75);
  G.hurt(g,killer,foe,100);
  assert.deepEqual(g.events.filter(e=>e.type==="ko").at(-1).assists,[]);
  assert.equal(first.assists,1);
  G.focus(g,g.actors[4].id); G.hurt(g,p,g.actors[4],100);
  assert.equal(p.assists,1,"own mark on a solo KO earns no assist");
});

test("assist credit includes the sixth second, expires on the next tick and survives the helper's KO", () => {
  for (const [delay,expected] of [[360,1],[361,0]]) {
    const g=round(), [p,ally,,foe]=g.actors;
    G.hurt(g,p,foe,10); ticks(g,delay);
    G.hurt(g,foe,p,100); G.hurt(g,ally,foe,100);
    assert.equal(p.assists,expected);
  }
  const g=round(), [victim,,,killer,helper]=g.actors;
  G.hurt(g,helper,victim,1); G.hurt(g,killer,victim,100);
  assert.equal(helper.assists,1);
  assert.deepEqual(g.events.find(e=>e.type==="ko").assists,[helper.id]);
});

test("shielded damage, a cleared mark and damage against a different runner earn no assist", () => {
  const g=round(), [p,killer,,foe,other]=g.actors;
  foe.shield=0.5;
  assert.ok(!G.hurt(g,p,foe,10));
  G.focus(g,foe.id); G.focus(g,null); G.hurt(g,p,other,10);
  ticks(g,30); G.hurt(g,killer,foe,100);
  assert.equal(p.assists,0);
});

test("each eligible runner on station receives hold credit for the same single signal point", () => {
  const g=round({mode:"signal",target:2}), [p,ally,shielded,rival]=g.actors;
  for (const a of [p,ally,shielded]) place(a,0,0);
  shielded.shield=2; ticks(g,60);
  assert.deepEqual(g.actors.map(a=>a.holds),[1,1,0,0,0,0]);
  assert.deepEqual(g.scores,[1,0]);
  place(rival,0,0); ticks(g,60);
  place(rival,5,0); ticks(g,60);
  assert.equal(g.winner,0);
  assert.deepEqual(g.actors.map(a=>a.holds),[2,2,1,0,0,0]);
  assert.deepEqual(g.scores,[2,0]);
});

test("bolts resolve the final fraction of shield and dodge protection at their actual crossing", () => {
  for (const guard of ["shield","dashLeft"]) {
    for (const [entry,damage] of [[0.005,0],[0.035,G.RULES.shotDamage]]) {
      const g=round(), [p,,,foe]=g.actors;
      place(foe,2,0); foe[guard]=0.025;
      const speed=100;
      place(p,foe.x-G.RULES.hitRadius-entry*speed,0);
      G.fire(g,p,Math.PI/2); g.shots[0].vx=speed;
      G.step(g,{},0.05);
      assert.equal(foe.hp,100-damage,guard+" at "+entry);
      assert.equal(g.shots.length,guard==="dashLeft" && damage===0 ? 1 : 0);
    }
  }
  const g=round(), [p,,,foe]=g.actors;
  place(foe,1,0); place(p,0,0); foe.dashLeft=0.03;
  G.fire(g,p,Math.PI/2); g.shots[0].vx=25;
  G.step(g,{},0.05);
  assert.equal(foe.hp,78,"a bolt still inside the circle when the dodge ends can connect");
});
