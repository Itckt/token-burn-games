"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Supply = require("../src/supply.js");
const Relay = require("../src/relay.js");
const Bots = require("../src/bots.js");
const {round,ticks,place,near} = require("./round.js");
const R = Supply.RULES;

function landNextTick(g) {
  g.supply.state = "incoming";
  g.supply.nextAt = g.elapsed + G.RULES.step;
  return Supply.sites[g.supply.site];
}

test("both hoists have room for the whole pickup circle and routes from each bay", () => {
  assert.notEqual(Supply.create(0).site,Supply.create(1).site);
  for (const site of Supply.sites) {
    for (let i=0;i<64;i++) {
      const angle=i*Math.PI/32;
      assert.ok(A.walkable(site.x+R.radius*Math.sin(angle),site.z+R.radius*Math.cos(angle)));
    }
    for (const [x,z] of A.homes.flat()) {
      assert.deepEqual(A.route(x,z,site.x,site.z).at(-1),{x:site.x,z:site.z});
    }
  }
});

test("the crane warns, lands and alternates on a fixed schedule whether claimed or left on deck", () => {
  for (const collect of [false,true]) {
    const g=round({seed:1}), p=g.actors[0], first=g.supply.site;
    ticks(g,R.firstWarning*60-1);
    assert.equal(g.supply.state,"waiting");
    G.step(g);
    assert.equal(g.supply.state,"incoming");
    const site=Supply.sites[first];
    if (collect) place(p,site.x,site.z);
    ticks(g,R.leadTime*60-1);
    assert.equal(p.supplies,0);
    G.step(g);
    assert.equal(g.supply.state,collect ? "waiting" : "open");
    assert.equal(p.supplies,Number(collect));
    if (collect) assert.equal(p.boostLeft,R.boostTime,"a full-health runner still gets the boost");
    ticks(g,R.window*60);
    assert.equal(g.supply.state,"waiting");
    assert.notEqual(g.supply.site,first);
    near(g.supply.nextAt,R.firstWarning+R.period);
    ticks(g,(R.period-R.leadTime-R.window)*60);
    assert.equal(g.supply.state,"incoming");
    assert.equal(g.events.filter(e=>e.type==="supplyInbound").length,2);
    assert.equal(g.events.filter(e=>e.type==="supplyLand").length,1);
  }
});

test("rivals on the rim contest a landed crate and the closest eligible crewmate claims it once", () => {
  const g=round(), [p,ally,,rival]=g.actors, site=landNextTick(g);
  place(p,site.x,site.z+0.5); place(ally,site.x,site.z+0.1); place(rival,site.x+R.radius,site.z);
  p.hp=45; ally.hp=88; rival.hp=15;
  G.step(g);
  assert.ok(g.supply.contested);
  assert.ok(g.actors.every(a=>a.supplies===0));
  G.pause(g);
  const frozen=JSON.stringify(g);
  ticks(g,660,{dash:true});
  assert.equal(JSON.stringify(g),frozen);
  G.pause(g);
  rival.shield=0.5;
  G.step(g);
  assert.deepEqual([ally.hp,ally.supplies,ally.boostLeft],[100,1,R.boostTime]);
  assert.equal(p.hp,45); assert.equal(rival.hp,15);
  const claim=g.events.find(e=>e.type==="supplyCollect");
  assert.deepEqual([claim.heal,claim.source,claim.name],[12,ally.id,site.name]);
  ticks(g,10);
  assert.equal(g.events.filter(e=>e.type==="supplyCollect").length,1);
  assert.equal(ally.healing,0,"a crate repair is separate from card healing");
});

test("downed and slipping runners cannot deny a crate, and equal-distance crewmates have a stable winner", () => {
  const g=round(), [p,ally,,dead,slipping]=g.actors, site=landNextTick(g);
  for (const a of [p,ally,dead,slipping]) place(a,site.x,site.z);
  G.hurt(g,p,dead,100); G.dash(g,slipping,1,0);
  p.hp=12;
  G.step(g);
  assert.equal(p.hp,12+R.repair);
  assert.equal(p.supplies,1);
  assert.ok(g.actors.slice(1).every(a=>a.supplies===0));
});

test("a runner arriving as the pickup window closes cannot claim from the departing crane", () => {
  const g=round(), p=g.actors[0], site=landNextTick(g);
  G.step(g);
  ticks(g,R.window*60-1);
  assert.equal(g.supply.state,"open");
  place(p,site.x,site.z); p.hp=20;
  G.step(g);
  assert.equal(g.supply.state,"waiting");
  assert.deepEqual([p.hp,p.boostLeft,p.supplies],[20,0,0]);
});

test("the speed boost respects a partial final tick, core weight, dash speed, and a knockout", () => {
  for (const carrying of [false,true]) {
    const g=round({mode:"relay"}), p=g.actors[0];
    place(p,carrying ? 0 : -2,0);
    G.step(g);
    assert.equal(g.relay.carrier,carrying ? 0 : null);
    const x=p.x, boostTime=0.0125, dt=0.05;
    p.boostLeft=boostTime;
    G.step(g,{mx:1},dt);
    const speed=G.RULES.speed*(carrying ? Relay.RULES.carrySpeed : 1);
    near(p.x-x,speed*(boostTime*R.speedFactor+dt-boostTime));
    assert.equal(p.boostLeft,0);
    p.boostLeft=R.boostTime;
    if (!carrying) {
      const start=p.x;
      G.step(g,{dash:true,mx:1},dt);
      near(p.x-start,G.RULES.dashSpeed*dt);
      ticks(g,10);
    }
    G.hurt(g,g.actors[3],p,100);
    assert.equal(p.boostLeft,0);
    ticks(g,192);
    assert.equal(p.boostLeft,0);
  }
});

test("one wounded bot per crew can detour while rally and carrier duties take priority", () => {
  const g=round({mode:"relay"}), [,ally,wing,rival]=g.actors, site=landNextTick(g);
  place(ally,site.x-1.8,site.z); place(wing,site.x-2.1,site.z); place(rival,site.x+2,site.z);
  for (const a of [ally,wing,rival]) a.hp=45;
  for (const a of [ally,wing,rival]) Bots.intent(g,a,G.RULES.step);
  assert.equal(ally.task,site); assert.notEqual(wing.task,site); assert.equal(rival.task,site);
  g.relay.state="carried"; g.relay.carrier=ally.id;
  for (const a of [ally,wing]) Bots.intent(g,a,G.RULES.step);
  assert.equal(ally.task,ally.id); assert.equal(wing.task,site);
  G.rally(g,-4,0);
  for (const a of [ally,wing,rival]) Bots.intent(g,a,G.RULES.step);
  assert.equal(ally.task,ally.id);
  assert.equal(wing.task,g.rally);
  assert.equal(rival.task,site);
  rival.hp=100;
  assert.equal(Supply.destination(g,rival),null);
});

test("a wounded bot collects a real drop and a match ending before touchdown pays no reward", () => {
  const g=round({bots:true}), ally=g.actors[1], site=landNextTick(g);
  place(ally,site.x,site.z+1.8); ally.hp=40;
  ticks(g,45);
  assert.equal(ally.supplies,1);
  assert.ok(ally.boostLeft>0);
  const short=round({duration:0.02}), p=short.actors[0], other=Supply.sites[short.supply.site];
  short.supply.state="incoming"; short.supply.nextAt=0.021;
  place(p,other.x,other.z); G.step(short,{},0.05); ticks(short,10);
  assert.equal(short.phase,"ended"); assert.equal(p.supplies,0);
  assert.equal(round().supply.state,"waiting");
});
