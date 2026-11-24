"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Relay = require("../src/relay.js");
const {round,ticks,place,near} = require("./round.js");
const relayRound = options => round({mode:"relay",...options});

test("relay and skirmish have independent targets, scores and fresh round state", () => {
  const skirmish=round(), relay=relayRound();
  assert.equal(skirmish.mode,"skirmish");
  assert.equal(skirmish.relay,null);
  assert.equal(skirmish.target,12);
  assert.equal(relay.target,3);
  assert.equal(relay.remaining,skirmish.remaining);
  assert.deepEqual(relay.relay,Relay.create());
  for (const g of [relay,skirmish]) G.hurt(g,g.actors[0],g.actors[3],100);
  assert.deepEqual(relay.scores,[0,0]);
  assert.deepEqual(skirmish.scores,[1,0]);
  assert.equal(relay.actors[0].kills,1);
  assert.equal(relayRound({target:5}).target,5);
  assert.deepEqual(relayRound().relay,Relay.create());
});

test("both crews contest a loose core, then the closest eligible runner takes it exactly once", () => {
  const g=relayRound(), [p,ally,,enemy]=g.actors;
  place(p,-0.7,0); place(ally,0.1,0); place(enemy,-0.2,0);
  G.step(g);
  assert.ok(g.relay.contested);
  assert.equal(g.relay.carrier,null);
  enemy.shield=1;
  G.step(g);
  assert.equal(g.relay.carrier,ally.id);
  assert.equal(g.relay.contested,false);
  place(ally,1,0.3);
  ticks(g,20);
  assert.deepEqual([g.relay.x,g.relay.z],[ally.x,ally.z]);
  assert.equal(g.events.filter(e=>e.type==="relayPickup").length,1);
});

test("the pickup boundary includes touching runners and excludes knocked-out, dashing and shielded runners", () => {
  const g=relayRound(), [p,ally,other,enemy]=g.actors;
  place(p,Relay.RULES.pickupRadius+0.001,0);
  for (const a of [ally,other,enemy]) place(a,0,0);
  G.hurt(g,enemy,ally,100);
  other.shield=1;
  G.dash(g,enemy,0,1);
  G.step(g);
  assert.equal(g.relay.carrier,null);
  place(p,Relay.RULES.pickupRadius,0);
  G.step(g);
  assert.equal(g.relay.carrier,0);
});

test("carrying slows travel, locks dash, permits firing and scores only at the opposing gate", () => {
  for (const team of [0,1]) {
    const g=relayRound(), runner=g.actors[team*3];
    const home=Relay.gates[team], away=Relay.gates[1-team];
    place(runner,0,0);
    G.step(g);
    assert.equal(g.relay.carrier,runner.id);
    assert.ok(!G.dash(g,runner,1,0));
    assert.ok(G.fire(g,runner));
    if (team===0) {
      G.step(g,{mx:1,dash:true});
      near(runner.x,G.RULES.speed*Relay.RULES.carrySpeed*G.RULES.step);
      assert.equal(runner.dashCd,0);
    }
    place(runner,home.x,home.z);
    G.step(g);
    assert.deepEqual(g.scores,[0,0]);
    place(runner,away.x,away.z+Relay.RULES.gateRadius);
    G.step(g);
    assert.equal(g.scores[team],1);
    assert.equal(runner.deliveries,1);
    assert.equal(g.relay.state,"center");
    assert.equal(g.relay.lock,Relay.RULES.resetLock);
    assert.ok(G.dash(g,runner,0,1));
    const other=g.actors[team===0 ? 1 : 4];
    place(other,0,0);
    ticks(g,Math.round(Relay.RULES.resetLock/G.RULES.step)-1);
    assert.equal(g.relay.carrier,null);
    G.step(g);
    assert.equal(g.relay.carrier,other.id);
  }
});

test("a KO on the goal line drops the core before delivery with a full pickup grace period", () => {
  const g=relayRound(), [p,ally,,enemy]=g.actors;
  place(p,0,0); G.step(g);
  const gate=Relay.gates[1];
  place(p,gate.x,gate.z); place(ally,p.x,p.z+0.5); place(enemy,p.x-1.3,p.z);
  p.hp=1; G.fire(g,enemy,Math.PI/2);
  G.step(g,{},0.05);
  assert.deepEqual(g.scores,[0,0]);
  assert.deepEqual([g.relay.state,g.relay.x,g.relay.z],["dropped",p.x,p.z]);
  assert.equal(g.relay.lock,Relay.RULES.dropLock);
  ticks(g,Math.round(Relay.RULES.dropLock/G.RULES.step)-1);
  assert.equal(g.relay.carrier,null);
  G.step(g);
  assert.equal(g.relay.carrier,ally.id);
  assert.equal(g.actors[3].kills,1);
  assert.equal(g.events.filter(e=>e.type==="relayDrop").length,1);
});

test("an unattended dropped core freezes on pause and returns to midfield once after eight active seconds", () => {
  const g=relayRound(), [p,,,enemy]=g.actors;
  place(p,0,0); G.step(g);
  place(p,-4,0);
  G.hurt(g,enemy,p,100);
  const count=Math.round(Relay.RULES.returnTime/G.RULES.step);
  ticks(g,100);
  G.pause(g);
  const before=JSON.stringify(g.relay);
  ticks(g,180);
  assert.equal(JSON.stringify(g.relay),before);
  G.pause(g);
  ticks(g,count-101);
  assert.equal(g.relay.state,"dropped");
  G.step(g);
  assert.deepEqual([g.relay.x,g.relay.z,g.relay.carrier,g.relay.state],[0,0,null,"center"]);
  ticks(g,130);
  assert.equal(g.events.filter(e=>e.type==="relayReturn").length,1);
});

test("the last fraction of a tick can win a relay match and an undelivered core cannot break a tie", () => {
  for (const deliver of [false,true]) {
    const g=relayRound({target:1,duration:G.RULES.step+0.003}), carrier=g.actors[3];
    place(carrier,0,0); G.step(g);
    if (deliver) place(carrier,Relay.gates[0].x,0);
    G.step(g);
    assert.equal(g.winner,deliver ? 1 : -1);
    assert.equal(g.phase,"ended");
    assert.equal(g.remaining,0);
    assert.equal(g.events.at(-1).type,"end");
    assert.equal(g.events.filter(e=>e.type==="end").length,1);
    const snapshot=JSON.stringify(g);
    ticks(g,60,{rally:true,card:0});
    assert.equal(JSON.stringify(g),snapshot);
  }
});

test("seeded relay crews can pick up, intercept, respawn and win by delivery on the playable map", () => {
  function play(seed) {
    const g=relayRound({seed,bots:true});
    let steps=0, sequence=0;
    const seen=new Set();
    while (g.phase==="playing" && steps++<10802) {
      G.step(g);
      for (const a of g.actors) assert.ok(A.walkable(a.x,a.z,A.radius-1e-6));
      for (let i=g.events.length-(g.sequence-sequence);i<g.events.length;i++) seen.add(g.events[i].type);
      sequence=g.sequence;
      if (g.relay.carrier!==null) assert.ok(g.actors[g.relay.carrier].hp>0);
    }
    for (const type of ["relayPickup","relayDrop","delivery","respawn","ko","end"]) assert.ok(seen.has(type),type);
    assert.equal(g.phase,"ended");
    assert.ok(g.scores.includes(Relay.RULES.target));
    for (const team of [0,1]) {
      assert.equal(g.scores[team],g.actors.filter(a=>a.team===team).reduce((sum,a)=>sum+a.deliveries,0));
    }
    return JSON.stringify([steps,g.scores,g.actors.map(a=>[a.x,a.z,a.kills,a.deliveries])]);
  }
  assert.equal(play(1),play(1));
  assert.notEqual(play(1),play(81244));
});
