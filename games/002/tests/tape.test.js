"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const Freight = require("../src/freight.js");
const Tape = require("../src/tape.js");
const {round,ticks,place,near} = require("./round.js");

function record(g,tape,count,input={}) {
  for (let i=0;i<count;i++) {
    G.step(g,input);
    tape.capture(g);
  }
}

test("the tape keeps the opening, fixed-cadence samples and exact fractional finish without touching the live match", () => {
  const g=round({duration:0.413}), p=g.actors[0], tape=new Tape.Recorder(g);
  const initialX=p.x;
  record(g,tape,6,{mx:1});
  G.pause(g); record(g,tape,10,{mx:1});
  assert.equal(tape.frames.length,1);
  G.pause(g); record(g,tape,40,{mx:1});
  assert.ok(tape.finished);
  assert.equal(tape.frames.length,4);
  [0,0.2,0.4,0.413].forEach((t,i)=>near(tape.frames[i].time,t));
  const finalX=p.x, summary=JSON.stringify(tape);
  near(tape.read(-5).frame.actors[0].x,initialX);
  near(tape.read(90).frame.actors[0].x,finalX);
  near(tape.read(NaN).time,0);
  p.x=13; g.scores[0]=8; g.supply.state="open";
  tape.capture(g);
  assert.equal(JSON.stringify(tape),summary);
  assert.deepEqual(tape.read(tape.duration).frame.scores,[0,0]);
});

test("replay motion and aim interpolate between samples, taking the short turn across north", () => {
  const g=round(), p=g.actors[0]; place(p,0,0); p.yaw=Math.PI-0.1;
  const tape=new Tape.Recorder(g);
  ticks(g,12,{mx:1}); p.yaw=-Math.PI+0.1; tape.capture(g);
  const scene=tape.read(0.1);
  near(scene.frame.actors[0].x,G.RULES.speed*0.1);
  near(scene.frame.actors[0].yaw,Math.PI);
  assert.equal(scene.trail.length,2); assert.equal(scene.trail.at(-1),scene.frame);
  near(tape.frames[0].actors[0].x,0);
});

test("simultaneous plays share one stop, retain their captions and expose the score only at the play", () => {
  const g=round(), [p,,,a,b,c]=g.actors, tape=new Tape.Recorder(g);
  record(g,tape,6); G.hurt(g,p,a,100); G.hurt(g,p,b,100); tape.capture(g);
  record(g,tape,12); G.hurt(g,c,p,100); tape.capture(g);
  assert.equal(tape.marks.length,2);
  assert.deepEqual(tape.marks[0].plays,["Coilrunner knocked out Torchlug","Coilrunner knocked out Cinderfin"]);
  assert.deepEqual(tape.read(0.099).frame.scores,[0,0]);
  assert.deepEqual(tape.read(0.1).frame.scores,[2,0]);
  assert.deepEqual(tape.read(0.3).frame.scores,[2,1]);
  assert.equal(tape.read(0.1).previous,undefined);
  assert.equal(tape.read(0.11).previous,tape.marks[0]);
  assert.equal(tape.read(0.11).next,tape.marks[1]);
  assert.equal(tape.read(0.3).previous,tape.marks[0]);
  assert.equal(tape.read(0.3).next,undefined);
  for (let i=0;i<110;i++) { c.fireCd=0; G.fire(g,c,0); }
  assert.equal(g.events.length,96);
  tape.capture(g);
  assert.ok(g.events.every(e=>e.type==="shot"));
  assert.equal(tape.marks.length,2);
});

test("a knockout hides the runner until the exact respawn and trails never slide a body back to its bay", () => {
  const g=round(), [p,,,foe]=g.actors; place(foe,1,0);
  const tape=new Tape.Recorder(g);
  record(g,tape,3); G.hurt(g,p,foe,100); tape.capture(g);
  const down=g.elapsed, up=down+G.RULES.respawnTime;
  record(g,tape,200);
  assert.ok(tape.read(down-0.0001).frame.actors[foe.id].hp>0);
  assert.equal(tape.read(down).frame.actors[foe.id].hp,0);
  assert.equal(tape.read(up-0.0001).frame.actors[foe.id].hp,0);
  near(tape.read(up-0.0001).frame.actors[foe.id].x,1);
  const revived=tape.read(up).frame.actors[foe.id];
  near(revived.x,foe.x); assert.equal(revived.hp,100);
});

test("core possession and flight are captured at release and catch, with orders and supplies stored by value", () => {
  const g=round({mode:"relay"}), [p,ally]=g.actors;
  place(p,0,0); place(ally,3.1,0); const tape=new Tape.Recorder(g);
  record(g,tape,1);
  const pickedAt=g.elapsed;
  assert.equal(tape.read(pickedAt).frame.relay.carrier,0);
  record(g,tape,1); G.rally(g,-2,0); G.focus(g,4); G.passCore(g,p,Math.PI/2); tape.capture(g);
  const releasedAt=g.elapsed, flight=tape.read(releasedAt).frame;
  assert.equal(flight.relay.carrier,null); near(flight.relay.flight.dx,1);
  g.rally.x=4; g.focus.target=5; g.supply.site=1-g.supply.site;
  record(g,tape,20);
  near(tape.read(releasedAt+0.1).frame.relay.x,1.2);
  assert.equal(flight.rally.x,-2); assert.equal(flight.focus.target,4);
  assert.notEqual(flight.supply.site,g.supply.site);
  assert.equal(tape.read(pickedAt).frame.relay.carrier,0);
  assert.equal(tape.frames.at(-1).relay.carrier,1);
  assert.match(tape.marks.at(-1).plays[0],/Bollard caught the pass/);
});

test("a freight docking and its reset have separate positions with no invented cart travel between them", () => {
  const g=round({mode:"freight"}), p=g.actors[0];
  g.freight.x=Freight.RULES.terminal-0.01; place(p,g.freight.x,0);
  const tape=new Tape.Recorder(g);
  record(g,tape,1);
  const docked=g.elapsed;
  record(g,tape,125);
  const back=g.events.find(e=>e.type==="freightReset").time;
  assert.deepEqual(tape.read(docked).frame.scores,[1,0]);
  assert.match(tape.read(docked).mark.plays[0],/east depot/);
  near(tape.read(back-0.001).frame.freight.x,Freight.RULES.terminal);
  near(tape.read(back).frame.freight.x,0);
});

test("station marks keep the station that actually scored even when it rotates on the same tick", () => {
  const g=round({mode:"signal"}), p=g.actors[0]; place(p,0,0);
  const tape=new Tape.Recorder(g); record(g,tape,59);
  g.signal.remaining=G.RULES.step; record(g,tape,1);
  const at=tape.read(1);
  assert.deepEqual(at.mark.plays,["Undertow scored at Midships","Station moved to North slip"]);
  assert.equal(at.frame.signal.station,1);
  assert.deepEqual(at.frame.scores,[1,0]);
});

test("a complete quiet match stays near 900 samples and scrubbing only reads its recent trails", () => {
  const g=round(), tape=new Tape.Recorder(g);
  record(g,tape,10801);
  assert.equal(g.phase,"ended"); assert.ok(tape.finished);
  assert.equal(tape.marks.length,0);
  assert.ok(tape.frames.length<=2+G.RULES.duration/Tape.interval);
  near(tape.duration,G.RULES.duration);
  for (const t of [179.99,1.7,86.04,0,180]) {
    const scene=tape.read(t);
    near(scene.time,t);
    assert.ok(scene.trail.length<=2+Tape.trailTime/Tape.interval);
    assert.ok(scene.trail[0].time>=t-Tape.trailTime-Tape.interval-1e-8);
    assert.ok(scene.trail.every(f=>f.time<=t+1e-8));
  }
});

test("recording and seeking leave seeded combat and the simulation RNG untouched", () => {
  const options={mode:"freight",seed:15,bots:true,duration:9};
  const live=round(options), recorded=round(options), tape=new Tape.Recorder(recorded);
  while (live.phase==="playing") {
    G.step(live); G.step(recorded); tape.capture(recorded);
    if (recorded.sequence%17===0) tape.read(recorded.elapsed*0.5);
  }
  assert.equal(JSON.stringify(recorded),JSON.stringify(live));
  assert.equal(recorded.random(),live.random());
  const empty=round({duration:0}), zero=new Tape.Recorder(empty);
  record(empty,zero,1);
  assert.equal(zero.frames.length,1); assert.equal(zero.duration,0); assert.ok(zero.finished);
});
