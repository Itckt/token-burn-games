"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/game.js");
const A = require("../src/arena.js");
const R = G.RULES;
const {round,ticks,place,near} = require("./round.js");
function duel() {
  const g=round(), [p,,,foe]=g.actors;
  place(p,-3,0); place(foe,1,0);
  return {g,p,foe};
}

test("invalid round options recover the mode defaults and a zero-duration round ends exactly once", () => {
  for (const [mode,duration,target] of [["signal",NaN,0],["relay",Infinity,1.5],["constructor",-1,"12"]]) {
    const g=round({mode,duration,target});
    assert.equal(g.mode,mode==="constructor" ? "skirmish" : mode);
    assert.equal(g.target,G.MODES[g.mode].target);
    assert.equal(g.remaining,R.duration);
    G.step(g);
    assert.ok(Number.isFinite(g.elapsed) && g.actors.every(a=>A.walkable(a.x,a.z)));
  }
  const empty=round({duration:0});
  ticks(empty,3,{fire:true});
  assert.deepEqual([empty.elapsed,empty.remaining,empty.winner,empty.actors[0].shots],[0,0,-1,0]);
  assert.deepEqual(empty.events.map(e=>e.type),["end"]);
});

test("a fresh round has one player, five bots, two original crews and a stationary lobby", () => {
  const g=G.createMatch();
  assert.deepEqual(g.actors.map(a=>a.team),[0,0,0,1,1,1]);
  assert.equal(new Set(g.actors.map(a=>a.name)).size,6);
  assert.equal(new Set(G.TEAMS).size,2);
  assert.ok(g.bots);
  assert.equal(g.phase,"ready");
  ticks(g,40,{mx:1,fire:true});
  assert.equal(g.elapsed,0);
  assert.deepEqual(g.scores,[0,0]);
  assert.equal(g.remaining,180);
  assert.equal(g.target,12);
  assert.ok(g.actors.every(a=>a.shots===0 && a.hp===100));
  assert.ok(!G.fire(g,g.actors[0]));
  assert.ok(!G.dash(g,g.actors[0],1,0));
  assert.ok(!G.pulse(g,g.actors[0]));
});

test("pausing preserves the previous phase, clock, projectiles and cooldowns", () => {
  const g=G.createMatch({bots:false});
  G.pause(g); G.start(g); assert.equal(g.phase,"paused");
  G.pause(g); assert.equal(g.phase,"ready");
  G.start(g); G.step(g,{fire:true,mx:1});
  G.pause(g);
  const before=JSON.stringify(g);
  ticks(g,150,{fire:true,mx:-1,dash:true,pulse:true});
  assert.equal(JSON.stringify(g),before);
  G.pause(g); G.step(g);
  assert.equal(g.phase,"playing"); assert.ok(g.elapsed>R.step);
  for (const dt of [0,-0.03,NaN,Infinity]) {
    const previous=g.elapsed;
    G.step(g,{fire:true},dt);
    assert.equal(g.elapsed,previous);
  }
});

test("walking and diagonal strafing cover equal distances independently of aim", () => {
  for (const [mx,mz] of [[1,0],[-1,-1],[0,1]]) {
    const g=round(), p=g.actors[0];
    place(p,0,0);
    G.step(g,{mx,mz,aimX:8,aimZ:0});
    near(Math.hypot(p.x,p.z),R.speed*R.step);
    near(p.yaw,Math.PI/2);
    const previous=[p.x,p.z];
    G.step(g,{mx:Infinity,mz:NaN,aimX:p.x,aimZ:p.z});
    assert.deepEqual([p.x,p.z],previous);
    near(p.yaw,Math.PI/2);
  }
});

test("holding fire observes the weapon cadence and produces sequenced muzzle events", () => {
  const {g,p}=duel();
  ticks(g,60,{fire:true,aimX:10,aimZ:0});
  assert.equal(p.shots,4);
  assert.equal(g.events.filter(e=>e.type==="shot").length,4);
  assert.ok(g.events.every((e,i)=>!i || e.id===g.events[i-1].id+1));
  assert.ok(!G.fire(g,p,NaN));
  assert.ok(Math.abs(g.elapsed-1)<1e-8);
});

test("a swept bolt passes allies and hits only the nearest opponent even in a long tick", () => {
  const {g,p,foe}=duel();
  const ally=g.actors[1], other=g.actors[4];
  place(ally,-2,0); place(other,3,0);
  assert.ok(G.fire(g,p,Math.PI/2));
  g.shots[0].vx=320;
  G.step(g,{},0.05);
  assert.equal(ally.hp,100); assert.equal(p.hp,100);
  assert.equal(foe.hp,100-R.shotDamage); assert.equal(other.hp,100);
  assert.equal(g.shots.length,0);
  const impact=g.events.find(e=>e.type==="impact");
  near(impact.x,foe.x-R.hitRadius);
  assert.equal(p.damage,R.shotDamage);
});

test("cover wins a projectile intersection before a runner, including point-blank fire", () => {
  const {g,p,foe}=duel(), b=A.blocks[0];
  place(p,b.x-b.w/2-A.radius,b.z);
  place(foe,b.x+b.w/2+1,b.z);
  G.fire(g,p,Math.PI/2); g.shots[0].vx=300;
  G.step(g,{},0.05);
  assert.equal(foe.hp,100); assert.equal(g.shots.length,0);
  near(g.events.at(-1).x,b.x-b.w/2-0.06);

  place(p,-12,b.z); place(foe,-10,b.z); p.fireCd=0;
  G.fire(g,p,Math.PI/2); g.shots[0].vx=300;
  G.step(g,{},0.05);
  assert.equal(foe.hp,78);
});

test("bolts expire at their lifetime and leave the arena at its perimeter", () => {
  const {g,p,foe}=duel();
  place(p,-12,0); place(foe,10,0);
  G.fire(g,p,Math.PI/2);
  ticks(g,Math.ceil(R.shotLife/R.step)+1);
  assert.equal(g.shots.length,0); assert.equal(foe.hp,100);
  place(p,A.halfW-0.45,0); p.fireCd=0;
  G.fire(g,p,Math.PI/2); ticks(g,2);
  assert.equal(g.shots.length,0);
});

test("pulse damages only visible rivals in range and pushes them away from the caster", () => {
  const g=round(), [p,ally,,nearFoe,covered,far]=g.actors, b=A.blocks[8];
  place(p,b.x,b.z+0.98); place(covered,b.x,b.z-0.98);
  place(ally,p.x,p.z+1); place(nearFoe,p.x+1.9,p.z); place(far,p.x+R.pulseRadius+0.1,p.z);
  const oldX=nearFoe.x;
  assert.ok(G.pulse(g,p)); assert.ok(!G.pulse(g,p));
  assert.equal(nearFoe.hp,100-R.pulseDamage);
  near(nearFoe.x,oldX+0.62);
  assert.ok([p,ally,covered,far].every(a=>a.hp===100));
  assert.equal(g.events.filter(e=>e.type==="pulse").length,1);
  ticks(g,Math.ceil(R.pulseDelay/R.step)+1);
  assert.ok(G.pulse(g,p));
});

test("pulse knockback stops at the deck edge and cannot push a protected foe", () => {
  const {g,p,foe}=duel();
  place(p,A.halfW-2,1); place(foe,A.halfW-A.radius-0.05,1);
  G.pulse(g,p); near(foe.x,A.halfW-A.radius);
  p.pulseCd=0; foe.shield=1;
  const before=[foe.x,foe.z,foe.hp]; G.pulse(g,p);
  assert.deepEqual([foe.x,foe.z,foe.hp],before);
});

test("a pulse sees the same shield deadline for early and late actor slots", () => {
  for (const [shield,protectedThisTick] of [[R.step,true],[R.step/2,false]]) {
    const g=round(), [p,,,enemy]=g.actors;
    place(p,0,0); place(enemy,1,0);
    // Straddle the tick boundary so a shield lasting beyond it still absorbs the burst.
    p.shield=enemy.shield=protectedThisTick ? shield+0.001 : shield;
    G.step(g,{pulse:true});
    G.pulse(g,enemy);
    const expected=protectedThisTick ? R.hp : R.hp-R.pulseDamage;
    assert.deepEqual([p.hp,enemy.hp],[expected,expected]);
  }
});

test("dash has a fixed travel distance, brief immunity and its own cooldown", () => {
  const {g,p,foe}=duel();
  place(p,-1,0);
  assert.ok(G.dash(g,p,0,4));
  assert.ok(!G.dash(g,p,0,1));
  assert.ok(!G.fire(g,p) && !G.pulse(g,p));
  assert.ok(!G.hurt(g,foe,p,100));
  ticks(g,Math.ceil(R.dashTime/R.step));
  near(p.x,-1); near(p.z,R.dashSpeed*R.dashTime);
  assert.equal(p.dashLeft,0);
  assert.ok(G.hurt(g,foe,p,3));
  ticks(g,Math.ceil(R.dashDelay/R.step)+1);
  p.yaw=-Math.PI/2;
  assert.ok(G.dash(g,p,0,0));
  near(p.dashX,-1); near(p.dashZ,0);
});

test("a dash into cargo obeys the same swept collision boundary as walking", () => {
  const {g,p}=duel(), b=A.blocks[0], edge=b.x-b.w/2-A.radius;
  place(p,edge-0.2,b.z);
  G.step(g,{dash:true,mx:1});
  ticks(g,20);
  near(p.x,edge); near(p.z,b.z);
  assert.ok(A.walkable(p.x,p.z,A.radius-1e-6));
});

test("bolts pass dashing runners and break on an active spawn shield", () => {
  const {g,p,foe}=duel(), behind=g.actors[4];
  place(behind,4,0);
  G.dash(g,foe,1,0);
  G.fire(g,p,Math.PI/2); g.shots[0].vx=280;
  G.step(g,{},0.05);
  assert.equal(behind.hp,78); assert.equal(foe.hp,100);
  ticks(g,12); assert.equal(foe.dashLeft,0);
  p.fireCd=0; foe.shield=0.5;
  G.fire(g,p,Math.PI/2); g.shots[0].vx=280;
  G.step(g,{},0.05);
  assert.equal(behind.hp,78); assert.equal(foe.hp,100); assert.equal(g.shots.length,0);
});

test("knockouts credit actual damage once and revive at the victim's own protected bay", () => {
  const {g,p,foe}=duel();
  for (const amount of [-1,0,Infinity,NaN]) assert.ok(!G.hurt(g,p,foe,amount));
  assert.ok(!G.hurt(g,g.actors[4],foe,23));
  assert.ok(G.hurt(g,p,foe,90)); assert.ok(G.hurt(g,p,foe,500));
  assert.ok(!G.hurt(g,p,foe,10));
  assert.deepEqual(g.scores,[1,0]);
  assert.deepEqual([p.kills,p.damage,foe.deaths,foe.hp],[1,100,1,0]);
  assert.ok(!G.fire(g,foe) && !G.pulse(g,foe) && !G.dash(g,foe,1,1));
  ticks(g,Math.ceil(R.respawnTime/R.step)-1); assert.equal(foe.hp,0);
  G.step(g); assert.equal(foe.hp,R.hp);
  assert.deepEqual([foe.x,foe.z],A.homes[1][foe.id%3]);
  assert.equal(foe.shield,R.shieldTime);
  assert.equal(foe.dashCd,0); assert.equal(foe.pulseCd,0);
  assert.ok(!G.hurt(g,p,foe,21));
  ticks(g,Math.ceil(R.shieldTime/R.step)+1);
  assert.ok(G.hurt(g,p,foe,21));
  assert.equal(g.events.filter(e=>e.type==="respawn").length,1);
});

test("the score limit locks the result immediately, even during a multi-target burst", () => {
  const g=round({target:1}), [p,,,a,b]=g.actors;
  place(p,0,0); place(a,1,0); place(b,-1,0); a.hp=b.hp=20;
  G.pulse(g,p);
  assert.deepEqual(g.scores,[1,0]);
  assert.equal(b.hp,20); assert.equal(g.phase,"ended"); assert.equal(g.winner,0);
  assert.equal(g.events.filter(e=>e.type==="end").length,1);
  const before=JSON.stringify(g);
  G.pause(g); G.start(g); ticks(g,90,{mx:1,fire:true});
  assert.equal(JSON.stringify(g),before);
});

test("the horn handles a draw or either winner and clamps a partial last tick", () => {
  for (const [team,winner] of [[null,-1],[0,0],[1,1]]) {
    const g=round({duration:0.025});
    if (team!==null) G.hurt(g,g.actors[team*3],g.actors[(1-team)*3],100);
    G.step(g); assert.equal(g.phase,"playing");
    G.step(g); assert.equal(g.phase,"ended");
    assert.equal(g.remaining,0); near(g.elapsed,0.025);
    assert.equal(g.winner,winner);
  }
});

test("a lethal pulse ends movement at the winning hit and leaves a full respawn interval on an earlier KO", () => {
  for (const target of [1,12]) {
    const g=round({target}), [p,,,foe]=g.actors;
    place(p,0,0); place(foe,1,0); foe.hp=1;
    G.step(g,{pulse:true,mx:1,fire:true,card:0,rally:true});
    near(foe.respawn,R.respawnTime);
    assert.equal(foe.x,1);
    if (target===1) {
      assert.equal(g.events.at(-1).type,"end");
      assert.deepEqual([p.x,p.shots,g.rally],[0,0,null]);
    } else {
      ticks(g,Math.round(R.respawnTime/R.step)-1);
      assert.equal(foe.hp,0);
      G.step(g);
      assert.equal(foe.hp,R.hp);
    }
  }
});

function playBots(seed) {
  const g=round({seed,bots:true});
  const player=g.actors[0];
  let steps=0, largestQueue=0;
  while (g.phase==="playing" && steps++<11000) {
    G.step(g);
    largestQueue=Math.max(largestQueue,g.events.length);
    for (const a of g.actors) {
      assert.ok(A.walkable(a.x,a.z,A.radius-1e-5));
      assert.ok(Number.isFinite(a.yaw) && a.hp>=0 && a.hp<=R.hp);
      if (a.target>=0) assert.notEqual(g.actors[a.target].team,a.team);
    }
  }
  assert.equal(g.phase,"ended");
  assert.ok(g.scores.includes(R.target));
  assert.ok(g.scores.every(score=>score>0));
  assert.ok(g.actors.slice(1).every(a=>a.shots>0 && a.damage>0));
  assert.equal(player.shots,0);
  assert.equal(g.actors.reduce((n,a)=>n+a.deaths,0),g.scores[0]+g.scores[1]);
  for (const team of [0,1]) assert.equal(g.actors.filter(a=>a.team===team).reduce((n,a)=>n+a.kills,0),g.scores[team]);
  assert.equal(largestQueue,96);
  return JSON.stringify([steps,g.scores,g.actors.map(a=>[a.x,a.z,a.shots,a.kills,a.damage]),g.events]);
}
test("five autonomous bots navigate, fire, score and finish full reproducible matches", () => {
  const first=playBots(1217);
  assert.equal(playBots(1217),first);
  assert.notEqual(playBots(2711),first);
});
