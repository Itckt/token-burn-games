"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Freight = require("../src/freight.js");
const Bots = require("../src/bots.js");
const {round,ticks,place,near} = require("./round.js");
const R = Freight.RULES;
const freightRound = options => round({mode:"freight",...options});

test("Freight tug has its own score and a navigable berth for every runner along the entire track", () => {
  const g=freightRound();
  assert.equal(g.target,R.target);
  assert.deepEqual(g.freight,Freight.create());
  assert.equal(g.signal,null); assert.equal(g.relay,null);
  assert.equal(round().freight,null);
  for (let i=0;i<=100;i++) {
    g.freight.x=(2*i/100-1)*R.terminal;
    const berths=g.actors.map(a=>Freight.destination(g.freight,a));
    for (const berth of berths) {
      assert.ok(A.walkable(berth.x,berth.z));
      assert.ok(Math.hypot(berth.x-g.freight.x,berth.z)<R.radius);
    }
    assert.equal(new Set(berths.map(b=>b.x+","+b.z)).size,6);
  }
  G.hurt(g,g.actors[0],g.actors[3],100);
  assert.deepEqual(g.scores,[0,0]);
});

test("one, two and three escorts give distinct speeds in either direction, including on the rim", () => {
  for (const team of [0,1]) for (const size of [1,2,3]) {
    const g=freightRound();
    const crew=g.actors.filter(a=>a.team===team).slice(0,size);
    crew.forEach((a,i)=>place(a,0,R.radius-i*0.6));
    G.step(g,{},0.05);
    near(g.freight.x,(team ? -1 : 1)*(R.speed+(size-1)*R.extraSpeed)*0.05);
    assert.equal(g.freight.owner,team);
    assert.equal(g.freight.escorts,size);
  }
});

test("a single defender stalls three escorts, an empty cart holds and a takeover reverses from that spot", () => {
  const g=freightRound(), [p,a,b,foe]=g.actors;
  for (const actor of [p,a,b]) place(actor,0,0);
  ticks(g,12); const x=g.freight.x;
  place(foe,x,0); ticks(g,5);
  near(g.freight.x,x);
  assert.ok(g.freight.contested);
  assert.equal(g.freight.owner,null);
  for (const actor of [p,a,b,foe]) place(actor,-5,0);
  ticks(g,5);
  near(g.freight.x,x); assert.equal(g.freight.escorts,0);
  assert.equal(g.freight.contested,false);
  place(foe,x,0); G.step(g,{},0.05);
  near(g.freight.x,x-R.speed*0.05);
  assert.equal(g.freight.owner,1);
});

test("contest, escort speed and station credit change at the instant protection expires within the tick", () => {
  const g=freightRound(), [p,ally,,foe]=g.actors;
  for (const a of [p,ally,foe]) place(a,0,0);
  p.shield=0.02;
  ally.dashLeft=0.035; ally.dashX=1;
  foe.shield=0.045;
  G.step(g,{},0.05);
  near(g.freight.x,0.015*R.speed+0.01*(R.speed+R.extraSpeed));
  assert.ok(g.freight.contested);
  const s=round({mode:"signal"});
  place(s.actors[0],0,0); s.actors[0].shield=0.03;
  G.step(s,{},0.05);
  near(s.signal.progress,0.02);
  place(s.actors[3],0,0); s.actors[3].shield=0.05;
  s.signal.progress=0.96;
  G.step(s,{},0.05);
  assert.deepEqual(s.scores,[1,0]);
  assert.ok(s.signal.contested); near(s.signal.progress,0);
});

test("only live escorts at docking get personal haul credit, and the next run starts at midfield", () => {
  const g=freightRound(), [p,ally,late,,rival]=g.actors;
  const dock=R.terminal-0.015;
  g.freight.x=dock;
  place(p,dock,0); place(ally,dock,1); place(late,dock,0); place(rival,dock,-1);
  late.shield=0.3;
  G.hurt(g,p,rival,100);
  G.step(g);
  assert.deepEqual(g.scores,[1,0]); near(g.freight.x,R.terminal);
  assert.deepEqual(g.actors.map(a=>a.hauls),[1,1,0,0,0,0]);
  const e=g.events.find(e=>e.type==="freightDock");
  assert.deepEqual(e.escorts,[0,1]); assert.equal(e.team,0);
  ticks(g,119); near(g.freight.x,R.terminal);
  G.step(g); near(g.freight.x,0); near(g.freight.resetLeft,0);
  assert.deepEqual(g.scores,[1,0]);
  assert.equal(g.events.filter(e=>e.type==="freightDock").length,1);
  place(p,0,0); G.step(g); assert.ok(g.freight.x>0);
});

test("a reset ending partway through a tick leaves only the unused time to push", () => {
  const g=freightRound();
  g.freight.x=R.terminal; g.freight.resetLeft=0.036;
  place(g.actors[3],0,0);
  G.step(g,{},0.05);
  near(g.freight.x,-R.speed*0.014);
  assert.equal(g.freight.owner,1);
});

test("a last-fraction docking can win at either depot, while a contest at the horn draws", () => {
  for (const team of [0,1]) for (const contested of [false,true]) {
    const g=freightRound({duration:0.012,target:1});
    g.freight.x=(team ? -1 : 1)*(R.terminal-0.012*R.speed);
    place(g.actors[team*3],g.freight.x,0);
    if (contested) place(g.actors[(1-team)*3],g.freight.x,0);
    G.pause(g); const saved=JSON.stringify(g);
    ticks(g,20); assert.equal(JSON.stringify(g),saved);
    G.pause(g); G.step(g,{},0.05);
    assert.equal(g.winner,contested ? -1 : team); near(g.elapsed,0.012);
    assert.equal(g.actors[team*3].hauls,contested ? 0 : 1);
    assert.equal(g.events.at(-1).type,"end");
    const final=JSON.stringify(g); ticks(g,30); assert.equal(JSON.stringify(g),final);
  }
});

test("crews converge on the cart, a friendly rally takes priority and both sides plan for the midfield reset", () => {
  const g=freightRound(), [p,ally,,foe]=g.actors;
  place(p,-5,0); place(ally,-4,0); place(foe,4,0);
  for (const a of [ally,foe]) {
    const plan=Bots.intent(g,a,1/60);
    assert.equal(a.task,g.freight);
    assert.ok(plan.mx*(a.team ? -1 : 1)>0);
  }
  G.rally(g,-6,0);
  assert.ok(Bots.intent(g,ally,1/60).mx<0);
  Bots.intent(g,foe,1/60);
  assert.equal(ally.task,g.rally); assert.equal(foe.task,g.freight);
  g.freight.x=-R.terminal; g.freight.resetLeft=1;
  near(Freight.destination(g.freight,foe).x,0.8);
});

test("seeded freight matches see escorts in both directions, contested stops and a reproducible result", () => {
  function play() {
    const g=freightRound({bots:true,seed:1217}), teams=new Set();
    let contested=false;
    while (g.phase==="playing") {
      G.step(g);
      if (g.freight.owner!==null) teams.add(g.freight.owner);
      contested ||= g.freight.contested;
      assert.ok(Math.abs(g.freight.x)<=R.terminal+1e-8);
      assert.ok(g.actors.every(a=>A.walkable(a.x,a.z,A.radius-1e-6)));
    }
    assert.equal(teams.size,2); assert.ok(contested);
    assert.ok(g.scores.includes(R.target));
    return [g.elapsed,g.scores,g.actors.map(a=>[a.kills,a.hauls])];
  }
  assert.deepEqual(play(),play());
});
