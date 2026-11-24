"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Signal = require("../src/signal.js");
const Bots = require("../src/bots.js");
const {round,ticks,place,near} = require("./round.js");
const signalRound = options => round({mode:"signal",...options});

test("every signal station fits on open deck and both crews can route to it", () => {
  for (const site of Signal.stations) {
    for (let i=0;i<64;i++) {
      const angle=i*Math.PI/32;
      assert.ok(A.walkable(site.x+Math.cos(angle)*Signal.RULES.radius,site.z+Math.sin(angle)*Signal.RULES.radius));
    }
    for (const [x,z] of A.homes.flat()) {
      assert.deepEqual(A.route(x,z,site.x,site.z).at(-1),{x:site.x,z:site.z});
    }
  }
  const g=signalRound();
  assert.equal(g.target,30);
  assert.deepEqual(g.signal,Signal.create());
  assert.equal(g.relay,null);
  G.hurt(g,g.actors[0],g.actors[3],100);
  assert.deepEqual(g.scores,[0,0]);
  assert.equal(g.actors[0].kills,1);
  assert.equal(round().signal,null);
});

test("one uncontested second awards one point at any crew size, including on the rim", () => {
  for (const crewSize of [1,2,3]) {
    const g=signalRound();
    place(g.actors[3],0,Signal.RULES.radius+0.0001);
    g.actors.slice(0,crewSize).forEach((a,i)=>place(a,Signal.RULES.radius-i*0.5,0));
    ticks(g,59);
    assert.deepEqual(g.scores,[0,0]);
    assert.equal(g.signal.owner,0);
    near(g.signal.progress,59/60);
    G.step(g);
    assert.deepEqual(g.scores,[1,0]);
    near(g.signal.progress,0);
    ticks(g,120);
    assert.deepEqual(g.scores,[3,0]);
  }
});

test("an empty ring, a contest and a direct takeover each clear the previous partial point", () => {
  for (const transition of ["empty","contest","takeover"]) {
    const g=signalRound(), [p,,,foe]=g.actors;
    place(p,0,0); ticks(g,50);
    if (transition!=="contest") place(p,4,0);
    if (transition!=="empty") place(foe,0,1);
    G.step(g);
    assert.equal(g.signal.contested,transition==="contest");
    near(g.signal.progress,transition==="takeover" ? G.RULES.step : 0);
    place(p,4,0); place(foe,0,1);
    ticks(g,transition==="takeover" ? 58 : 59);
    assert.deepEqual(g.scores,[0,0]);
    G.step(g);
    assert.deepEqual(g.scores,[0,1]);
  }
});

test("downed, shielded and slipping rivals cannot contest a station", () => {
  const g=signalRound(), [p,,,down,shielded,slipping]=g.actors;
  for (const a of [p,down,shielded,slipping]) place(a,0,0);
  G.hurt(g,p,down,100);
  shielded.shield=0.2;
  G.dash(g,slipping,1,0);
  ticks(g,4);
  assert.equal(g.signal.owner,0);
  assert.equal(g.signal.contested,false);
  place(slipping,5,0);
  ticks(g,8);
  assert.ok(g.signal.contested);
  assert.equal(g.signal.owner,null);
  near(g.signal.progress,0);
});

test("rotation splits a tick between sites, credits the outgoing ring first and cycles back", () => {
  const g=signalRound(), [p,,,foe]=g.actors;
  const north=Signal.stations[1];
  place(p,0,0); place(foe,north.x,north.z);
  ticks(g,59);
  g.signal.remaining=G.RULES.step;
  G.step(g,{},0.05);
  assert.deepEqual(g.scores,[1,0]);
  assert.equal(g.signal.station,1);
  assert.equal(g.signal.owner,1);
  near(g.signal.progress,0.05-G.RULES.step);
  assert.deepEqual(g.events.map(e=>e.type),["signalPoint","signalShift"]);
  const rotated=[];
  Signal.advance(g.signal,g.actors,2*Signal.RULES.shiftTime,(type,team,site)=>{
    if (type==="signalShift") rotated.push(site.name);
  });
  assert.deepEqual(rotated,["South slip","Midships"]);
  near(g.signal.progress,0.05-G.RULES.step);
});

test("the last eligible fraction can win at the horn and a winning point preempts a station change", () => {
  for (const contested of [false,true]) {
    const g=signalRound({target:1,duration:1}), [p,,,foe]=g.actors;
    place(p,0,0); ticks(g,59);
    g.signal.remaining=g.remaining;
    if (contested) place(foe,0,0);
    G.pause(g);
    const frozen=JSON.stringify(g); ticks(g,90);
    assert.equal(JSON.stringify(g),frozen);
    G.pause(g); G.step(g,{},0.05);
    assert.equal(g.winner,contested ? -1 : 0);
    assert.equal(g.events.at(-1).type,"end");
    assert.equal(g.events.filter(e=>e.type==="end").length,1);
    if (!contested) {
      assert.equal(g.signal.station,0);
      assert.equal(g.events.at(-2).type,"signalPoint");
    }
    const ended=JSON.stringify(g); ticks(g,100,{rally:true});
    assert.equal(JSON.stringify(g),ended);
  }
});

test("both bot crews follow the live station, with a player rally overriding only their own crew", () => {
  const g=signalRound(), ally=g.actors[1], rival=g.actors[3];
  for (const station of [0,2,1]) {
    g.signal.station=station;
    for (const bot of [ally,rival]) {
      const plan=Bots.intent(g,bot,G.RULES.step);
      assert.equal(bot.task,Signal.stations[station]);
      assert.ok(Math.hypot(plan.mx,plan.mz)>0);
    }
  }
  G.rally(g,-4,0);
  for (const bot of [ally,rival]) Bots.intent(g,bot,G.RULES.step);
  assert.equal(ally.task,g.rally);
  assert.equal(rival.task,Signal.stations[1]);
});

test("seeded signal matches change station, score for both crews and finish reproducibly", () => {
  function play(seed) {
    const g=signalRound({bots:true,seed}), totals=[0,0];
    let shifts=0;
    while (g.phase==="playing") {
      const before=g.sequence;
      G.step(g);
      for (const e of g.events.slice(g.events.length-(g.sequence-before))) {
        if (e.type==="signalPoint") totals[e.team]++;
        if (e.type==="signalShift") shifts++;
      }
      for (const a of g.actors) assert.ok(A.walkable(a.x,a.z,A.radius-1e-6));
      assert.ok(g.elapsed<=G.RULES.duration+1e-7);
    }
    assert.deepEqual(g.scores,totals);
    assert.ok(shifts>=2 && totals.every(n=>n>0) && totals.includes(g.target));
    return [g.elapsed,totals,g.actors.map(a=>[a.kills,a.x,a.z])];
  }
  assert.deepEqual(play(17),play(17));
  assert.notDeepEqual(play(17),play(1217));
});
