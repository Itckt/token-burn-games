"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const Relay = require("../src/relay.js");
const {round,ticks,place,near} = require("./round.js");

function possession(options={}) {
  const g=round({mode:"relay",...options});
  for (const a of g.actors) place(a,...A.homes[a.team][a.id%3]);
  place(g.actors[0],0,0);
  G.step(g);
  assert.equal(g.relay.carrier,0);
  return g;
}

test("only the carrier can pass, releasing its dash and keeping the launch direction during a pause", () => {
  const g=possession(), [p,ally]=g.actors;
  place(ally,3,0);
  assert.ok(!G.passCore(g,ally) && !G.passCore(g,p,NaN));
  G.pause(g); assert.ok(!G.passCore(g,p)); G.pause(g);
  assert.ok(G.passCore(g,p,Math.PI/2));
  assert.ok(!G.passCore(g,p));
  assert.ok(G.dash(g,p,-1,0));
  G.step(g);
  near(g.relay.x,Relay.RULES.passSpeed*G.RULES.step);
  G.pause(g); const frozen=JSON.stringify(g.relay); ticks(g,90);
  assert.equal(JSON.stringify(g.relay),frozen);
  G.pause(g); ticks(g,16);
  assert.equal(g.relay.carrier,ally.id);
  assert.equal(p.completions,1);
  assert.equal(g.events.filter(e=>e.type==="relayCatch").length,1);
});

test("a defender wins a simultaneous catch independent of roster order, and a nearer teammate wins an earlier catch", () => {
  const g=possession(), [p,ally,,defender]=g.actors;
  place(ally,3,0); place(defender,3,0);
  for (const crew of [g.actors,[...g.actors].reverse()]) {
    assert.equal(Relay.trace(crew,p,0,0,8,0).receiver,defender);
  }
  place(ally,2.8,0);
  assert.equal(Relay.trace(g.actors,p,0,0,8,0).receiver,ally);
  place(ally,3,0);
  G.passCore(g,p,Math.PI/2); ticks(g,15);
  assert.equal(g.relay.carrier,defender.id);
  assert.equal(defender.interceptions,1);
  assert.equal(p.completions,0);
});

test("a protected defender who crossed the flight path cannot intercept retroactively when protection ends", () => {
  for (const guard of ["shield","dashLeft"]) {
    const g=possession(), [p,ally,,defender]=g.actors;
    // The defender begins just inside the back of the catch circle. The
    // eastbound core leaves it before immunity ends within this same tick.
    place(defender,-0.65,0); defender[guard]=0.025;
    place(ally,1.2,0);
    G.passCore(g,p,Math.PI/2); G.step(g,{},0.05);
    assert.equal(g.relay.carrier,ally.id,guard);
    assert.equal(defender.interceptions,0);
  }
});

test("flight stops at the first wall, deck edge or range limit and leaves a recoverable loose core", () => {
  const box=A.blocks[0], r=Relay.RULES;
  for (const [x,z,yaw,endX,endZ] of [
    [box.x,box.z+2,Math.PI,box.x,box.z+box.d/2+r.coreRadius],
    [12.7,1,Math.PI/2,A.halfW-r.coreRadius,1],
    [0,0,Math.PI/2,r.passRange,0]
  ]) {
    const g=possession(), p=g.actors[0];
    place(p,x,z); G.passCore(g,p,yaw);
    const forecast=g.relay.flight.landing;
    near(forecast.x,endX); near(forecast.z,endZ);
    for (let i=0;i<45 && g.relay.flight;i++) G.step(g);
    assert.equal(g.relay.state,"dropped");
    near(g.relay.x,endX); near(g.relay.z,endZ);
    assert.equal(g.relay.lock,r.dropLock);
    assert.ok(A.walkable(g.relay.x,g.relay.z,A.radius-1e-6));
    assert.equal(g.events.filter(e=>e.type==="relayLand").length,1);
  }
});

test("a catch or loose pickup inside the opposing gate can score on the last fractional tick", () => {
  for (const kind of ["catch","loose"]) {
    const g=possession({target:1,duration:G.RULES.step+0.022}), [p,ally]=g.actors;
    const gate=Relay.gates[1];
    place(p,gate.x-1,gate.z); place(ally,gate.x-0.1,gate.z);
    if (kind==="catch") G.passCore(g,p,Math.PI/2);
    else {
      G.hurt(g,g.actors[3],p,100);
      g.relay.lock=0.01;
    }
    G.step(g,{},0.05);
    assert.equal(g.phase,"ended"); assert.equal(g.winner,0);
    assert.deepEqual(g.scores,[1,0]);
    assert.equal(ally.deliveries,1);
    assert.deepEqual(g.events.slice(-3).map(e=>e.type),[kind==="catch" ? "relayCatch" : "relayPickup","delivery","end"]);
  }
});

test("a pressured bot takes an open forward outlet and rejects a teammate screened by a defender", () => {
  const g=round({mode:"relay"}), [p,carrier,wing,defender]=g.actors;
  place(p,-10,0); place(carrier,0,0); place(wing,3.8,0); place(defender,0,1.4);
  G.step(g);
  assert.equal(g.relay.carrier,carrier.id);
  assert.equal(Relay.outlet(g.actors,carrier),wing);
  place(defender,1.7,0);
  assert.equal(Relay.outlet(g.actors,carrier),null);
  place(defender,-1,1.4);
  g.bots=true;
  G.step(g);
  assert.equal(g.relay.flight.thrower,carrier.id);
  for (let i=0;i<40 && g.relay.flight;i++) G.step(g);
  assert.equal(g.relay.carrier,wing.id);
  assert.equal(carrier.completions,1);
});
