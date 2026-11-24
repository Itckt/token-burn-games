"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Deck = require("../src/deck.js");
const {round,ticks,place,near} = require("./round.js");
const loadout=["bank","haul","net"];

test("loadouts swap occupied slots without duplicates, isolate match state and recover invalid selections", () => {
  for (const bad of [null,{},["fork","patch"],["bank","bank","net"],["bank","__proto__","net"],["fork",,"net"]]) {
    assert.deepEqual(Deck.create(bad),Deck.create());
  }
  const draft=Deck.arrange(Deck.starter,1,"bank"), next=Deck.arrange(draft,2,"bank");
  assert.deepEqual(draft,["fork","bank","net"]);
  assert.deepEqual(next,["fork","net","bank"]);
  assert.deepEqual(Deck.starter,["fork","patch","net"]);
  for (const [slot,key] of [[3,"haul"],[-1,"net"],["1","bank"],[0,"constructor"]]) {
    assert.equal(Deck.arrange(next,slot,key),next);
  }
  const a=round({loadout:next}), b=round({loadout:next});
  G.playCard(a,0);
  assert.deepEqual(a.deck.hand,["bank","net"]);
  assert.deepEqual(b.deck.hand,["fork","net"]);
  assert.equal(b.deck.reserve,"bank");
});

test("Bank lens uses the rest of its tick after reflecting and hits a rival behind the shooter", () => {
  const g=round({loadout}), [p,,,foe]=g.actors, box=A.blocks[0];
  place(p,box.x,box.z+1.6); place(foe,box.x,box.z+3);
  p.yaw=Math.PI; p.fireCd=0.7;
  assert.ok(G.playCard(g,0));
  const bolt=g.shots[0], wallZ=box.z+box.d/2+0.06;
  G.step(g,{},0.05);
  assert.equal(bolt.bankWall,box);
  near(bolt.z,wallZ+G.RULES.shotSpeed*0.05-(p.z-wallZ));
  near(bolt.vz,G.RULES.shotSpeed); near(bolt.life,Deck.RULES.bankLife-0.05);
  near(p.fireCd,0.65);
  ticks(g,10);
  assert.equal(foe.hp,100-Deck.RULES.bankDamage);
  assert.equal(g.shots.length,0);
  assert.equal(g.events.filter(e=>e.type==="ricochet").length,1);
});

test("a bank bolt stops on the second wall and the deck perimeter absorbs it on first contact", () => {
  for (const edge of [false,true]) {
    const g=round({loadout}), p=g.actors[0];
    place(p,edge ? 12.9 : 0,edge ? 1.5 : 4.8);
    p.yaw=edge ? Math.PI/2 : 0;
    G.playCard(g,0); ticks(g,70);
    assert.equal(g.shots.length,0);
    assert.equal(g.events.filter(e=>e.type==="ricochet").length,edge ? 0 : 1);
    if (!edge) {
      const impact=g.events.find(e=>e.type==="impact"), north=A.blocks[8];
      near(impact.z,north.z+north.d/2+0.06);
    }
  }
});

test("a net on the reflected leg expires against total bolt travel time, including its first leg", () => {
  for (const remaining of [0.019,0.025]) {
    const g=round({loadout}), p=g.actors[0];
    place(p,0,4.9); p.yaw=0;
    g.net={x:0,z:2,team:1,remaining};
    G.playCard(g,0); g.shots[0].vz=80; G.step(g,{},0.05);
    assert.equal(g.events.some(e=>e.type==="ricochet"),true);
    assert.equal(g.events.some(e=>e.type==="intercept"),remaining===0.025);
    assert.equal(g.shots.length,remaining===0.025 ? 0 : 1);
  }
});

test("Haul line reels in the nearest exposed rival, preserves the driver and leaves room between runners", () => {
  const g=round({loadout}), [p,ally,,nearer,far]=g.actors;
  place(p,-4,0); place(ally,-3,0); place(nearer,-2,0); place(far,1,0);
  p.yaw=Math.PI/2;
  assert.ok(G.playCard(g,1));
  near(nearer.x,p.x+2*A.radius);
  assert.deepEqual([far.x,ally.x,p.shots,p.fireCd], [1,-3,0,0]);
  const event=g.events.at(-1);
  assert.equal(event.type,"haul"); near(event.x,-2); near(event.fromX,-4);
  assert.deepEqual([g.deck.energy,g.deck.hand[1],g.deck.reserve],[2,"net","haul"]);
});

test("Haul line keeps the hand and energy on a miss, shield, blocked line or overlapping runner", () => {
  for (const reason of ["miss","shield","cover","overlap"]) {
    const g=round({loadout}), [p,,,foe]=g.actors;
    place(p,-4,0); place(foe,-1,0); p.yaw=Math.PI/2;
    if (reason==="miss") p.yaw=0;
    if (reason==="shield") { foe.shield=1; place(g.actors[4],1,0); }
    if (reason==="cover") {
      const wall=A.blocks[0];
      place(p,wall.x-wall.w/2-0.7,wall.z); place(foe,wall.x+wall.w/2+0.7,wall.z);
    }
    if (reason==="overlap") place(foe,p.x,p.z);
    const before=JSON.stringify(g.deck);
    assert.equal(G.playCard(g,1),false,reason);
    assert.equal(JSON.stringify(g.deck),before);
    assert.match(g.events.at(-1).reason,/exposed rival/);
  }
});
