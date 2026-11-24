"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Deck = require("../src/deck.js");
const Bots = require("../src/bots.js");
const {Controls} = require("../src/controls.js");
const {round,ticks,place,near} = require("./round.js");

test("energy fills on exact intervals, preserves partial charge when spent and banks no time at capacity", () => {
  const d=Deck.create(), r=Deck.RULES;
  assert.equal(d.energy,4);
  for (const dt of [0,-1,NaN,Infinity]) Deck.recharge(d,dt);
  assert.equal(d.charge,0);
  for (let i=0;i<179;i++) Deck.recharge(d,1/60);
  assert.equal(d.energy,4);
  Deck.recharge(d,1/60); assert.equal(d.energy,5); near(d.charge,0);
  Deck.recharge(d,1.25);
  Deck.play(d,0,()=>true);
  assert.equal(d.charge,1.25);
  Deck.recharge(d,1.75);
  assert.equal(d.energy,3);
  Deck.recharge(d,120);
  assert.deepEqual([d.energy,d.charge],[r.capacity,0]);
  Deck.play(d,0,()=>true);
  Deck.recharge(d,r.chargeTime-0.01);
  assert.equal(d.energy,r.capacity-Deck.cards.net.cost);
});

test("a card exchanges only its own slot, failed plays preserve the hand and energy", () => {
  const d=Deck.create(), before=JSON.stringify(d);
  for (const slot of [-1,2,NaN,null,"0"]) {
    assert.ok(Deck.play(d,slot,()=>assert.fail("invalid slot applied")));
    assert.equal(JSON.stringify(d),before);
  }
  assert.ok(Deck.play(d,1,()=>false));
  assert.equal(JSON.stringify(d),before);
  assert.equal(Deck.play(d,0,card=>card==="fork"),null);
  assert.deepEqual([d.hand,d.reserve,d.energy],[["net","patch"],"fork",1]);
  const short=JSON.stringify(d);
  assert.match(Deck.play(d,1,()=>assert.fail("unaffordable card applied")),/energy/);
  assert.equal(JSON.stringify(d),short);
  Deck.recharge(d,3);
  Deck.play(d,1,card=>card==="patch");
  assert.deepEqual([d.hand,d.reserve,d.energy],[["net","fork"],"patch",0]);
  assert.deepEqual(Deck.create().hand,["fork","patch"]);
});

test("Fork coil fires three independently swept bolts on aim and leaves primary cadence intact", () => {
  const g=round(), [p,,,center,left,right]=g.actors, rules=Deck.RULES;
  place(p,-3,0);
  place(center,1,0); place(left,1,-4*Math.tan(rules.spread)); place(right,1,4*Math.tan(rules.spread));
  p.fireCd=0.8;
  G.step(g,{aimX:5,aimZ:0,card:0,fire:true});
  near(p.fireCd,0.8-G.RULES.step);
  assert.equal(p.shots,3);
  assert.equal(g.events.filter(e=>e.type==="fork").length,1);
  g.shots.forEach((s,i)=>near(s.yaw,Math.PI/2+(i-1)*rules.spread));
  ticks(g,20);
  assert.ok([center,left,right].every(a=>a.hp===100-rules.boltDamage));
  assert.equal(p.damage,3*rules.boltDamage);
  assert.equal(g.shots.length,0);
});

test("cargo blocks all three fork bolts fired from its face", () => {
  const g=round(), [p,,,foe]=g.actors, box=A.blocks[0];
  place(p,box.x-box.w/2-A.radius,box.z); place(foe,box.x+box.w/2+1,box.z);
  G.step(g,{aimX:foe.x,aimZ:foe.z,card:0});
  ticks(g,30);
  assert.equal(foe.hp,100);
  assert.equal(p.damage,0);
  assert.equal(g.events.filter(e=>e.type==="impact").length,3);
});

test("Patch reel caps each repair and respects team, cover, radius and KO state", () => {
  const g=round(), [p,ally,covered,enemy]=g.actors, box=A.blocks[8];
  place(p,box.x,box.z+1); place(covered,box.x,box.z-1);
  place(ally,p.x+1,p.z); place(enemy,p.x+0.6,p.z);
  p.hp=61; ally.hp=96; covered.hp=20; enemy.hp=35;
  assert.ok(G.playCard(g,1));
  assert.deepEqual([p.hp,ally.hp,covered.hp,enemy.hp,p.healing],[93,100,20,35,36]);
  assert.deepEqual(g.events.filter(e=>e.type==="repair").map(e=>e.amount),[32,4]);
  const other=round(), [caster,far,down,rival]=other.actors;
  place(caster,0,0); place(far,Deck.RULES.repairRadius+0.001,0); place(down,0,1);
  far.hp=80;
  G.hurt(other,rival,down,100);
  const before=JSON.stringify(other.deck);
  assert.equal(G.playCard(other,1),false);
  assert.equal(other.events.at(-1).type,"cardDenied");
  assert.equal(JSON.stringify(other.deck),before);
  assert.equal(down.hp,0);
  place(far,Deck.RULES.repairRadius,0);
  assert.ok(G.playCard(other,1));
  assert.equal(far.hp,100);
});

function withNet() {
  const g=round(), player=g.actors[0];
  place(player,0,0);
  player.yaw=0;
  g.deck.energy=Deck.RULES.capacity;
  assert.ok(G.playCard(g,0));
  assert.ok(G.playCard(g,0));
  return g;
}
function shootEast(g,actor,x,z) {
  place(actor,x,z);
  actor.fireCd=0;
  assert.ok(G.fire(g,actor,Math.PI/2));
}

test("the catch net intercepts the first hostile crossing, lets friendly shots out and stays anchored", () => {
  const g=withNet(), [p,ally,,enemy]=g.actors;
  place(ally,-3.5,0);
  shootEast(g,enemy,-5,0); ticks(g,15);
  assert.equal(ally.hp,100-G.RULES.shotDamage,"an exposed ally is closer than the net");
  place(ally,0,1);
  shootEast(g,enemy,-5,0); ticks(g,15);
  const caught=g.events.find(e=>e.type==="intercept");
  near(caught.x,-Deck.RULES.netRadius);
  assert.equal(p.hp,100);
  place(enemy,4,0);
  shootEast(g,p,0,0); ticks(g,16);
  assert.equal(enemy.hp,100-G.RULES.shotDamage);
  place(enemy,-1.5,0);
  assert.ok(G.pulse(g,enemy));
  assert.equal(p.hp,100-G.RULES.pulseDamage);
  assert.ok(p.x>0);
  assert.deepEqual([g.net.x,g.net.z],[0,0]);
  shootEast(g,enemy,-0.6,0);
  G.step(g);
  assert.equal(g.events.filter(e=>e.type==="intercept").length,2);
});

test("net expiry uses swept contact time when a bolt crosses during the field's final tick", () => {
  for (const [distance,caught] of [[0.10,true],[0.40,false]]) {
    const g=withNet(), enemy=g.actors[3];
    g.net.remaining=0.01;
    shootEast(g,enemy,-Deck.RULES.netRadius-distance,0);
    G.step(g,{},0.05);
    assert.equal(g.net,null);
    assert.equal(g.events.some(e=>e.type==="intercept"),caught);
    ticks(g,12);
    assert.equal(g.actors[0].hp,caught ? 100 : 100-G.RULES.shotDamage);
  }
});

test("round phase, life and dash gate card use while energy recovers during a respawn", () => {
  const g=G.createMatch({bots:false}), p=g.actors[0];
  assert.ok(!G.playCard(g,0));
  ticks(g,200); assert.equal(g.deck.energy,4);
  G.start(g);
  G.dash(g,p,1,0); assert.ok(!G.playCard(g,0));
  ticks(g,10);
  G.pause(g); assert.ok(!G.playCard(g,0));
  const deck=JSON.stringify(g.deck); ticks(g,500);
  assert.equal(JSON.stringify(g.deck),deck);
  G.pause(g); G.hurt(g,g.actors[3],p,100);
  assert.ok(!G.playCard(g,0));
  ticks(g,180,{card:0});
  assert.equal(g.deck.energy,5); assert.equal(p.shots,0);
  ticks(g,15); assert.ok(G.playCard(g,0));
  G.pause(g);
  assert.ok(!G.playCard(g,1));
});

test("rallies default to the player, replace cleanly and reject blocked or off-deck destinations", () => {
  const g=round(), p=g.actors[0], box=A.blocks[0];
  assert.ok(G.rally(g));
  assert.deepEqual([g.rally.x,g.rally.z],[p.x,p.z]);
  assert.ok(G.rally(g,-2,0));
  const order=g.rally;
  for (const [x,z] of [[box.x,box.z],[A.halfW,0],[NaN,0],[0,Infinity],[undefined,2]]) {
    assert.ok(!G.rally(g,x,z));
    assert.equal(g.rally,order);
  }
  ticks(g,120);
  G.pause(g);
  const remaining=g.rally.remaining;
  assert.ok(!G.rally(g,0,0)); ticks(g,200);
  assert.equal(g.rally.remaining,remaining);
  G.pause(g);
  G.hurt(g,g.actors[3],p,100);
  assert.ok(!G.rally(g,0,0));
  ticks(g,239); assert.equal(g.rally,order);
  G.step(g); assert.equal(g.rally,null);
});

test("both crewmates can rally around cover even with the player standing beside a waypoint", () => {
  const g=round({bots:true}), goal={x:-2.5,z:-3.45};
  for (const a of g.actors) { a.fireCd=100; a.pulseCd=100; }
  place(g.actors[1],-9.5,-3.45);
  assert.ok(!A.clearLine(g.actors[1].x,g.actors[1].z,goal.x,goal.z));
  G.rally(g,goal.x,goal.z);
  for (let i=0;i<359;i++) {
    G.step(g);
    for (const ally of g.actors.slice(1,3)) assert.ok(A.walkable(ally.x,ally.z,A.radius-1e-6));
  }
  for (const ally of g.actors.slice(1,3)) {
    assert.ok(Math.hypot(ally.x-goal.x,ally.z-goal.z)<0.9);
    assert.equal(ally.task,g.rally);
  }
  assert.ok(g.actors.slice(3).every(a=>a.task!==g.rally));
  G.step(g); G.step(g);
  assert.ok(g.actors.every(a=>a.task===null));
});

test("a carrier follows its delivery route, a wingmate follows the rally and opponents intercept", () => {
  const g=round({mode:"relay"}), carrier=g.actors[1], wing=g.actors[2], rival=g.actors[3];
  place(carrier,0,0); place(wing,-2,0); place(rival,4,0);
  G.step(g);
  assert.equal(g.relay.carrier,carrier.id);
  G.rally(g,-6,0);
  const dt=G.RULES.step;
  assert.ok(Bots.intent(g,carrier,dt).mx>0);
  assert.ok(Bots.intent(g,wing,dt).mx<0);
  const intercept=Bots.intent(g,rival,dt);
  assert.ok(intercept.mx<0 && rival.target===carrier.id);
  assert.equal(wing.task,g.rally);
  assert.equal(carrier.task,carrier.id);
  assert.equal(rival.task,carrier.id);
});

test("fast card presses keep slot order and rally edges clear after sampling or leaving the field", () => {
  const c=new Controls();
  c.press("Digit2"); c.press("Digit1"); c.press("KeyR");
  let input=c.sample(0);
  assert.deepEqual([input.card,input.rally],[1,true]);
  input=c.sample(0);
  assert.deepEqual([input.card,input.rally],[0,false]);
  assert.equal(c.sample(0).card,undefined);
  c.press("Digit1"); c.press("KeyR"); c.clear();
  input=c.sample(0);
  assert.deepEqual([input.card,input.rally],[undefined,false]);
});
