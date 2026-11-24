(() => {
  "use strict";
  const node=typeof module === "object" && module.exports;
  const M=node ? require("./math.js") : Slipwake.math;
  const A=node ? require("./arena.js") : Slipwake.arena;
  const Relay=node ? require("./relay.js") : Slipwake.relay;
  const Deck=node ? require("./deck.js") : Slipwake.deck;
  const Bots=node ? require("./bots.js") : Slipwake.bots;
  const Bolts=node ? require("./bolts.js") : Slipwake.bolts;
  const Signal=node ? require("./signal.js") : Slipwake.signal;
  const Freight=node ? require("./freight.js") : Slipwake.freight;
  const Pickup=node ? require("./pickup.js") : Slipwake.pickup;
  const Supply=node ? require("./supply.js") : Slipwake.supply;
  const RULES=Object.freeze({
    step:1/60, duration:180, target:12, hp:100, speed:4.35, botSpeed:2.55,
    fireDelay:0.29, shotSpeed:19.2, shotLife:0.82, shotDamage:22, hitRadius:0.51,
    dashDelay:3.6, dashTime:0.16, dashSpeed:17, pulseDelay:6.5, pulseRadius:3.55,
    pulseDamage:39, vaneTime:0.3, vaneDelay:4, respawnTime:3.2, shieldTime:1.25, rallyTime:6, focusTime:5, assistTime:6
  });
  const NAMES=["Coilrunner","Bollard","Mainspring","Torchlug","Cinderfin","Flintwheel"];
  const TEAMS=["Undertow","Afterburn"];
  const MODES=Object.freeze({
    skirmish:{name:"Team skirmish", target:RULES.target, units:["knockout","knockouts"], result:"Knockout target reached."},
    relay:{name:"Relay run", target:Relay.RULES.target, units:["delivery","deliveries"], result:"Delivery target reached."},
    signal:{name:"Signal shift", target:Signal.RULES.target, units:["signal point","signal points"], result:"Signal target reached."},
    freight:{name:"Freight tug", target:Freight.RULES.target, units:["haul","hauls"], result:"Freight target reached."}
  });
  const timers=["fireCd","dashCd","pulseCd","vaneCd","hpFlash","shield"];
  function createMatch({seed=0xB47A, mode="skirmish", duration=RULES.duration, target, bots=true, loadout}={}) {
    if (typeof mode!=="string" || !Object.hasOwn(MODES,mode)) mode="skirmish";
    if (!Number.isFinite(duration) || duration<0) duration=RULES.duration;
    if (!Number.isInteger(target) || target<1) target=MODES[mode].target;
    const random=M.rng(seed);
    const actors=A.opening.map(([x,z],id)=>({
      id,name:NAMES[id],team:id<3 ? 0 : 1,x,z,hp:RULES.hp,yaw:id<3 ? Math.PI/2 : -Math.PI/2,
      hpFlash:0,fireCd:0,dashCd:0,pulseCd:0,dashLeft:0,dashX:0,dashZ:0,vaneLeft:0,vaneCd:0,
      shield:0,shieldAtStart:0,respawn:0,reviveAt:0,stride:random()*Math.PI*2,speed:0,recoil:0,
      kills:0,assists:0,deaths:0,damage:0,shots:0,deliveries:0,completions:0,interceptions:0,healing:0,
      supplies:0,boostLeft:0,holds:0,hauls:0,returns:0,lastHits:Array(NAMES.length).fill(null),
      think:0,target:-1,path:[],task:null,lastFocus:null,
      strafe:random()<0.5 ? -1 : 1,stepChange:random(),spread:0
    }));
    const relay=mode==="relay" ? Relay.create() : null;
    return {phase:"ready",prior:"ready",elapsed:0,remaining:duration,mode,
      target,bots,actors,relay,signal:mode==="signal" ? Signal.create() : null,freight:mode==="freight" ? Freight.create() : null,
      deck:Deck.create(loadout),net:null,rally:null,focus:null,supply:Supply.create(seed),
      scores:[0,0],shots:[],events:[],sequence:0,random,winner:null};
  }
  function event(g,type,values) {
    g.events.push({id:++g.sequence,time:g.elapsed,type,...values});
    if (g.events.length>96) g.events.shift();
  }
  function eventsSince(g,sequence,visit) {
    const count=Math.min(g.events.length,g.sequence-sequence);
    for (let i=g.events.length-count;i<g.events.length;i++) visit(g.events[i]);
    return g.sequence;
  }
  function start(g) {
    if (g.phase==="ready") g.phase="playing";
  }
  function pause(g) {
    if (g.phase==="paused") g.phase=g.prior;
    else if (g.phase==="playing" || g.phase==="ready") { g.prior=g.phase; g.phase="paused"; }
  }
  function finish(g) {
    g.phase="ended";
    g.winner=g.scores[0]===g.scores[1] ? -1 : Number(g.scores[1]>g.scores[0]);
    event(g,"end",{winner:g.winner});
  }
  function score(g,team) {
    g.scores[team]++;
    if (g.scores[team]>=g.target) finish(g);
  }
  function relayEvent(g,change) {
    if (!change) return;
    const {type,...detail}=change;
    if (type==="delivery" && detail.source===0 && g.remaining<=5+1e-8) detail.deadline=true;
    event(g,type,detail);
    if (type==="delivery") {
      g.actors[detail.source].deliveries++;
      score(g,detail.team);
    } else if (type==="relayCatch") {
      if (detail.intercepted) g.actors[detail.source].interceptions++;
      else g.actors[detail.passer].completions++;
    }
  }
  function awardAssists(g,killer,victim) {
    const helpers=[];
    for (const ally of g.actors) {
      if (ally===killer || ally.team!==killer.team) continue;
      const hitAt=victim.lastHits[ally.id];
      const recentHit=hitAt!==null && g.elapsed-hitAt<=RULES.assistTime+1e-8;
      const calledTarget=ally.id===0 && g.focus?.target===victim.id && g.focus.until>g.elapsed;
      if (recentHit || calledTarget) {
        ally.assists++;
        helpers.push(ally.id);
      }
    }
    victim.lastHits.fill(null);
    return helpers;
  }
  function damageRunner(g,from,to,amount) {
    if (g.phase!=="playing" || from.team===to.team || to.hp<=0 ||
        !(amount>0) || !Number.isFinite(amount)) return false;
    const damage=Math.min(amount,to.hp);
    to.hp-=damage; from.damage+=damage; to.hpFlash=0.16;
    to.lastHits[from.id]=g.elapsed;
    event(g,"hit",{x:to.x,z:to.z,team:to.team,source:from.id,victim:to.id,damage});
    if (to.hp===0) {
      to.deaths++; from.kills++;
      to.respawn=RULES.respawnTime; to.reviveAt=g.elapsed+RULES.respawnTime; to.speed=0; to.path=[];
      to.boostLeft=0; to.vaneLeft=0;
      const helpers=awardAssists(g,from,to);
      event(g,"ko",{x:to.x,z:to.z,team:to.team,source:from.id,victim:to.id,assists:helpers});
      if (g.focus?.target===to.id) g.focus=null;
      if (g.relay) relayEvent(g,Relay.drop(g.relay,to));
      else if (g.mode==="skirmish") score(g,from.team);
    }
    return true;
  }
  function hurt(g,from,to,amount) {
    return to.shield<=0 && to.dashLeft<=0 && damageRunner(g,from,to,amount);
  }
  function launchBolt(g,a,yaw,damage,bank=false) {
    g.shots.push({x:a.x,z:a.z,vx:Math.sin(yaw)*RULES.shotSpeed,vz:Math.cos(yaw)*RULES.shotSpeed,
      yaw,life:bank ? Deck.RULES.bankLife : RULES.shotLife,owner:a.id,team:a.team,damage,bank});
    a.shots++;
    a.recoil=1;
  }
  function fire(g,a,yaw=a.yaw) {
    if (g.phase!=="playing" || a.hp<=0 || a.fireCd>0 || a.dashLeft>0 || !Number.isFinite(yaw)) return false;
    const dx=Math.sin(yaw), dz=Math.cos(yaw);
    a.fireCd=a.id===0 ? RULES.fireDelay : 0.48+g.random()*0.25;
    launchBolt(g,a,yaw,RULES.shotDamage);
    event(g,"shot",{x:a.x+dx*0.65,z:a.z+dz*0.65,yaw,team:a.team,source:a.id});
    return true;
  }
  function dash(g,a,dx,dz) {
    if (g.phase!=="playing" || a.hp<=0 || a.dashCd>0 || g.relay?.carrier===a.id) return false;
    const n=Math.hypot(dx,dz);
    const directed=n>0.001 && Number.isFinite(n);
    a.dashX=directed ? dx/n : Math.sin(a.yaw);
    a.dashZ=directed ? dz/n : Math.cos(a.yaw);
    a.dashCd=RULES.dashDelay; a.dashLeft=RULES.dashTime; a.vaneLeft=0;
    event(g,"dash",{x:a.x,z:a.z,team:a.team,dx:a.dashX,dz:a.dashZ,source:a.id});
    return true;
  }
  function raiseVane(g,a) {
    if (g.phase!=="playing" || !a.hp || a.vaneCd>0 || a.dashLeft>0 || a.shield>0) return false;
    a.vaneLeft=RULES.vaneTime;
    a.vaneCd=RULES.vaneDelay;
    event(g,"vane",{x:a.x,z:a.z,team:a.team,source:a.id});
    return true;
  }
  function pulse(g,a) {
    if (g.phase!=="playing" || a.hp<=0 || a.pulseCd>0 || a.dashLeft>0) return false;
    a.pulseCd=RULES.pulseDelay;
    event(g,"pulse",{x:a.x,z:a.z,team:a.team,source:a.id});
    for (const foe of g.actors) {
      if (g.phase!=="playing") break;
      if (foe.team===a.team || foe.hp<=0) continue;
      const dx=foe.x-a.x,dz=foe.z-a.z,n=Math.hypot(dx,dz);
      if (n<=RULES.pulseRadius && A.clearLine(a.x,a.z,foe.x,foe.z) && hurt(g,a,foe,RULES.pulseDamage) && foe.hp>0 && n>0.001)
        A.move(foe,dx/n*0.62,dz/n*0.62);
    }
    return true;
  }
  function repairCrew(g,player) {
    let healed=0;
    for (const ally of g.actors) {
      if (ally.team!==player.team || !ally.hp || ally.hp>=RULES.hp) continue;
      if (Math.hypot(ally.x-player.x,ally.z-player.z)>Deck.RULES.repairRadius ||
          !A.clearLine(player.x,player.z,ally.x,ally.z)) continue;
      const amount=Math.min(Deck.RULES.repair,RULES.hp-ally.hp);
      ally.hp+=amount;
      healed+=amount;
      event(g,"repair",{x:ally.x,z:ally.z,team:ally.team,source:player.id,victim:ally.id,amount});
    }
    player.healing+=healed;
    return healed>0;
  }
  function haul(g,player) {
    const rules=Deck.RULES, dx=Math.sin(player.yaw)*rules.haulReach, dz=Math.cos(player.yaw)*rules.haulReach;
    let first=A.firstSolid(player.x,player.z,dx,dz,0.06).fraction, target=null;
    for (const foe of g.actors) {
      if (foe.team===player.team || !foe.hp || foe.dashLeft>0) continue;
      const t=M.segmentCircle(player.x,player.z,dx,dz,foe.x,foe.z,RULES.hitRadius);
      if (t<first) { first=t; target=foe; }
    }
    if (!target || target.shield>0 || !A.clearLine(player.x,player.z,target.x,target.z)) return false;
    const x=target.x, z=target.z, distance=Math.hypot(x-player.x,z-player.z);
    const pull=Math.min(rules.haulDistance,distance-2*A.radius);
    if (pull<=0) return false;
    A.move(target,(player.x-x)*pull/distance,(player.z-z)*pull/distance);
    if (Math.hypot(target.x-x,target.z-z)<1e-7) return false;
    event(g,"haul",{x,z,fromX:player.x,fromZ:player.z,team:player.team,source:player.id,victim:target.id});
    return true;
  }
  function playCard(g,slot) {
    const player=g.actors[0];
    if (g.phase!=="playing" || !player.hp || player.dashLeft>0 || (slot!==0 && slot!==1)) return false;
    const rules=Deck.RULES;
    const reason=Deck.play(g.deck,slot,card=>{
      switch (card) {
        case "patch": return repairCrew(g,player);
        case "haul": return haul(g,player);
        case "fork":
          for (const offset of [-rules.spread,0,rules.spread]) launchBolt(g,player,player.yaw+offset,rules.boltDamage);
          break;
        case "bank": launchBolt(g,player,player.yaw,rules.bankDamage,true); break;
        case "net": g.net={x:player.x,z:player.z,team:player.team,remaining:rules.netTime}; break;
      }
      event(g,card,{x:player.x,z:player.z,team:player.team,source:player.id,yaw:player.yaw});
      return true;
    });
    if (reason) event(g,"cardDenied",{reason});
    return !reason;
  }
  function rally(g,x,z) {
    const player=g.actors[0];
    if (g.phase!=="playing" || !player.hp) return false;
    if (x===undefined && z===undefined) { x=player.x; z=player.z; }
    if (!A.walkable(x,z,A.radius-1e-6)) {
      event(g,"rallyDenied",{reason:"Aim at open deck"});
      return false;
    }
    g.rally={x,z,remaining:RULES.rallyTime};
    event(g,"rally",{x,z,team:player.team,source:player.id});
    return true;
  }
  function focus(g,target) {
    if (g.phase!=="playing" || !g.actors[0].hp) return false;
    if (target===null) {
      if (!g.focus) return false;
      g.focus=null;
      event(g,"focusClear",{});
      return true;
    }
    const foe=Number.isInteger(target) && g.actors[target];
    if (!foe || foe.team===0 || !foe.hp) return false;
    g.focus={target,until:g.elapsed+RULES.focusTime};
    event(g,"focus",{target,x:foe.x,z:foe.z});
    return true;
  }
  function passCore(g,actor,yaw=actor.yaw) {
    if (g.phase!=="playing" || !g.relay) return false;
    const change=Relay.pass(g.relay,actor,yaw);
    relayEvent(g,change);
    return Boolean(change);
  }
  function walk(a,dx,dz,speed,dt) {
    const n=Math.hypot(dx,dz), x=a.x,z=a.z;
    if (n>0.001) A.move(a,dx/n*speed*dt,dz/n*speed*dt);
    a.speed=Math.hypot(a.x-x,a.z-z)/dt;
    a.stride+=a.speed*dt*4.8;
  }
  function moveBot(g,a,dt,speed) {
    const plan=Bots.intent(g,a,dt);
    if (!plan) { a.speed=0; return; }
    walk(a,plan.mx,plan.mz,speed*plan.pace,dt);
    a.yaw=plan.yaw;
    if (plan.fire) fire(g,a,a.yaw);
    if (plan.pulse) pulse(g,a);
    if (g.relay?.carrier===a.id) {
      const outlet=Relay.outlet(g.actors,a);
      if (outlet) passCore(g,a,Math.atan2(outlet.x-a.x,outlet.z-a.z));
    }
  }
  function revive(g,a) {
    const [x,z]=A.homes[a.team][a.id%3];
    Object.assign(a,{x,z,hp:RULES.hp,respawn:0,shield:RULES.shieldTime,hpFlash:0,
      fireCd:0.22,dashCd:0,pulseCd:0,dashLeft:0,vaneCd:0,vaneLeft:0,think:0,path:[],task:null,recoil:0,speed:0});
    event(g,"respawn",{x,z,team:a.team,source:a.id});
  }
  function aimYaw(actor,x,z,fallback) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x-actor.x,z-actor.z)<=0.025) return fallback;
    return Math.atan2(x-actor.x,z-actor.z);
  }
  function playerActions(g,a,input,mx,mz) {
    a.yaw=aimYaw(a,input.aimX,input.aimZ,a.yaw);
    if (input.focusTarget!==undefined) focus(g,input.focusTarget);
    if (input.pass) passCore(g,a,aimYaw(a,input.passX,input.passZ,a.yaw));
    if (input.dash) dash(g,a,mx,mz);
    if (input.vane) raiseVane(g,a);
    if (input.pulse) pulse(g,a);
    if (g.phase!=="playing") return;
    if (input.card!==undefined) playCard(g,input.card);
    if (input.rally) rally(g,input.rallyX ?? input.aimX,input.rallyZ ?? input.aimZ);
  }
  function advanceControl(g,actors,dt) {
    if (g.freight) {
      const docked=g.freight.resetLeft>0;
      const dock=Freight.advance(g.freight,actors,dt);
      if (docked && !g.freight.resetLeft) event(g,"freightReset",{x:0,z:0});
      if (dock) {
        for (const id of dock.escorts) g.actors[id].hauls++;
        event(g,"freightDock",dock);
        score(g,dock.team);
      }
    } else {
      Signal.advance(g.signal,actors,dt,(type,team,station)=>{
        event(g,type,{team,x:station.x,z:station.z,name:station.name});
        if (type==="signalPoint") {
          for (const a of actors) {
            if (a.team===team && Pickup.inReach(a,station,Signal.RULES.radius+1e-8)) a.holds++;
          }
          score(g,team);
        }
        return g.phase==="playing";
      });
    }
    return g.phase==="playing";
  }
  function objectives(g,dt,wasCarried,protection) {
    if (g.relay) {
      const justDropped=wasCarried && g.relay.state==="dropped";
      const change=Relay.advance(g.relay,g.actors,justDropped ? 0 : dt,protection);
      relayEvent(g,change);
      // A catch or a loose pickup inside the gate counts even on the final tick.
      if (g.remaining<1e-7 && change && g.relay.carrier!==null) relayEvent(g,Relay.delivery(g.relay,g.actors));
    }
    if (g.signal || g.freight) {
      Pickup.controlSlices(g.actors,protection,dt,(actors,slice)=>advanceControl(g,actors,slice));
    }
    if (g.phase==="playing") Supply.advance(g,RULES.hp,event);
  }
  function step(g,input={},dt=RULES.step) {
    if (g.phase!=="playing" || !(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(dt,0.05,g.remaining);
    if (dt<=0) { finish(g); return; }
    g.elapsed+=dt; g.remaining=Math.max(0,g.remaining-dt);
    Deck.recharge(g.deck,dt);
    if (g.focus && g.focus.until<=g.elapsed+1e-8) g.focus=null;
    const previousNet=g.net, previousRally=g.rally, wasCarried=g.relay?.carrier!=null;
    const mx=Number.isFinite(input.mx) ? input.mx : 0, mz=Number.isFinite(input.mz) ? input.mz : 0;
    // All six runners see the same shield and cooldown deadlines before anyone acts.
    for (const a of g.actors) {
      a.shieldAtStart=a.shield;
      if (a.hp<=0) continue;
      for (const key of timers) a[key]=a[key]<=dt+1e-8 ? 0 : a[key]-dt;
      a.recoil=Math.max(0,a.recoil-7*dt);
    }
    for (const a of g.actors) {
      if (g.phase!=="playing") break;
      if (a.hp<=0) {
        a.respawn=Math.max(0,a.reviveAt-g.elapsed);
        if (a.respawn<=1e-7) revive(g,a);
        continue;
      }
      if (a.id===0) {
        playerActions(g,a,input,mx,mz);
        if (g.phase!=="playing") break;
      }
      const boostedTime=Math.min(dt,a.boostLeft);
      const boost=1+(Supply.RULES.speedFactor-1)*boostedTime/dt;
      const pace=boost*(g.relay?.carrier===a.id ? Relay.RULES.carrySpeed : 1);
      a.boostLeft=a.boostLeft<=dt+1e-8 ? 0 : a.boostLeft-dt;
      if (a.dashLeft>0) {
        walk(a,a.dashX,a.dashZ,RULES.dashSpeed,Math.min(dt,a.dashLeft));
      } else if (a.id===0) {
        walk(a,mx,mz,RULES.speed*pace,dt);
        if (input.fire) fire(g,a,a.yaw);
      } else if (g.bots) moveBot(g,a,dt,RULES.botSpeed*pace);
    }
    let protection;
    if (g.phase==="playing") {
      // Bolts compare swept contact times with the dodge/shield windows for this tick.
      Bolts.step(g,dt,RULES,damageRunner,event);
      if (g.relay?.flight || g.freight || g.signal) protection=g.actors.map(a=>Math.max(a.shieldAtStart,a.shield,a.dashLeft));
      for (const a of g.actors) {
        if (a.dashLeft>0) a.dashLeft=Math.max(0,a.dashLeft-dt);
        if (a.vaneLeft>0) a.vaneLeft=a.vaneLeft<=dt+1e-8 ? 0 : a.vaneLeft-dt;
      }
    }
    if (previousNet && previousNet===g.net && (previousNet.remaining-=dt)<=1e-8) g.net=null;
    if (previousRally && previousRally===g.rally && (previousRally.remaining-=dt)<=1e-8) g.rally=null;
    if (g.phase==="playing") objectives(g,dt,wasCarried,protection);
    if (g.phase==="playing" && g.remaining<1e-7) { g.remaining=0; finish(g); }
  }
  const api={RULES,NAMES,TEAMS,MODES,createMatch,start,pause,step,fire,dash,raiseVane,pulse,hurt,playCard,rally,passCore,focus,eventsSince};
  if (node) module.exports=api;
  else (globalThis.Slipwake ||= {}).game=api;
})();
