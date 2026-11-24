(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api = factory(load('math'), load('signal'), load('roster'), load('drills'), load('coils'), load('freight'), load('salvage'), load('projectiles'));
  if (common) module.exports=api;
  else (root.Rift=root.Rift||{}).battle=api;
})(globalThis, function (M, Signal, Roster, Drills, Coils, Freight, Salvage, Projectiles) {
  'use strict';

  const STEP=1/30, DURATION=Drills.FORMATS.standard.duration, MAX_ENERGY=10, ENERGY_RATE=.46, CARD_LOCK=.78;
  const EPSILON = 1e-8;
  const LANES=Object.freeze([-2.16,2.16]), TOWER_X=7.32, TOWER_HP=620;
  const GUARD_TIME = 5, GUARD_RECHARGE = 22;
  const {CARDS, CARD, UNIT} = Roster;
  const laneName=lane=>lane===0?'A':'B';
  const direction=team=>team===0?1:-1;
  function formatTime(seconds) {
    const time=Math.max(0,Math.ceil(seconds-1e-8));
    return String(Math.floor(time/60)).padStart(2,'0')+':'+String(time%60).padStart(2,'0');
  }
  function log(s,message,side=null,kind=null) {
    s.log.unshift({id:s.nextId++,time:s.time,message,side,kind});
    if (s.log.length>30) s.log.pop();
  }
  function create(options={}) {
    const mode = typeof options.mode === 'string' && Object.hasOwn(Drills.FORMATS, options.mode) ? options.mode : 'standard';
    const {duration, seed = 73} = Drills.FORMATS[mode];
    const s={mode, duration, deck:Roster.deckOrDefault(options.deck), objective:null, repaired:[0,0], intercepted:[0,0],
      phase:'ready',resumePhase:'ready',time:duration,age:0,nextId:1,units:[],towers:[],shots:[],effects:[],log:[],
      energy:[7,7],locks:[{},{}],emitted:[[0,0],[0,0]],ai:options.ai!==false,aiIn:2.9,
      random:M.seeded(options.seed ?? seed),winner:null,reason:'',deployed:[0,0],destroyed:[0,0],
      cache:Signal.create(), captures:[0,0], coils:Coils.create(),
      guards:Array.from({length:2}, () => ({lane:null, until:0, readyAt:0, blocked:0}))};
    for (let team=0;team<2;team++) for (let lane=0;lane<2;lane++) {
      s.towers.push({id:s.nextId++,tower:true,team,lane,x:-direction(team)*TOWER_X,z:LANES[lane],hp:TOWER_HP,maxHp:TOWER_HP,cooldown:.5,fire:0,hit:0,aim:0});
    }
    if (mode !== 'standard') Drills.prepare(s, spawn);
    else if (options.opening!==false) {
      spawn(s,0,0,'ram',-2.75,-.02); spawn(s,0,0,'wasp',-4.5,.27);
      spawn(s,0,1,'strider',-1.72,-.15);
      spawn(s,1,0,'strider',1.70,.13); spawn(s,1,1,'wasp',3.0,.15); spawn(s,1,1,'ram',4.72,-.23);
    }
    log(s, Drills.FORMATS[mode].opening);
    return s;
  }
  function spawn(s,team,lane,cardId,x,offset=0) {
    const c=UNIT[cardId], u={id:s.nextId++,team,lane,cardId,x,prevX:x,z:LANES[lane]+offset,
      hp:c.hp,maxHp:c.hp,cooldown:.24,fire:0,hit:0,moving:false,walk:0,spawn:s.age};
    s.units.push(u);
    return u;
  }
  function effect(s,kind,x,z,y,team,life=.42) {
    const event = {id:s.nextId++,kind,x,z,y,team,age:0,life};
    s.effects.push(event);
    return event;
  }
  function canDeploy(s,team,lane,id) {
    if ((team!==0 && team!==1) || (lane!==0 && lane!==1) || typeof id !== 'string' || !Object.hasOwn(CARD,id)) return 'Invalid deployment';
    if (s.phase==='paused') return 'Resume the match to deploy';
    if (s.phase==='ended') return 'Match complete';
    if (s.phase==='ready' && team!==0) return 'Waiting for the opening move';
    if (!s.deck.includes(id)) return 'Card outside this deck';
    if (s.energy[team]+1e-8<CARD[id].cost) return 'Need '+CARD[id].cost+' energy';
    if ((s.locks[team][id]||0)>s.age+1e-8) return 'Card recharging';
    return '';
  }
  function deploymentSites(s, team, lane, id) {
    if (canDeploy(s, team, lane, id)) return [];
    const count=s.emitted[team][lane], offset=[0,-.44,.44,-.21,.21][count%5];
    const x=-direction(team)*(TOWER_X-1.22+(count%3)*.16);
    const tracks = CARD[id].count === 2 ? [offset * .45 - .36, offset * .45 + .36] : [offset];
    return tracks.map(offset => ({x, offset}));
  }
  function deploy(s,team,lane,id) {
    const sites = deploymentSites(s, team, lane, id);
    if (!sites.length) return {ok:false, error:canDeploy(s,team,lane,id)};
    if (s.phase==='ready') s.phase=s.resumePhase='playing';
    s.emitted[team][lane]++;
    s.energy[team]=Math.max(0,s.energy[team]-CARD[id].cost);
    s.locks[team][id]=s.age+CARD_LOCK;
    const units = sites.map(({x, offset}) => {
      const unit = spawn(s, team, lane, id, x, offset);
      effect(s, 'deploy', x, unit.z, .08, team, .65);
      return unit;
    });
    s.deployed[team]++;
    log(s,(team===0?'You deployed ':'Vanta deployed ')+CARD[id].name+' in Lane '+laneName(lane)+'.',team);
    return {ok:true, unit:units[0], units};
  }
  function pause(s) {
    if (s.phase==='ended') return false;
    if (s.phase==='paused') s.phase=s.resumePhase;
    else { s.resumePhase=s.phase; s.phase='paused'; }
    return true;
  }
  function isGuarded(s, team, lane) {
    const guard = s.guards[team];
    return guard.lane === lane && s.age < guard.until - EPSILON;
  }
  function canGuard(s, team, lane) {
    if ((team !== 0 && team !== 1) || (lane !== 0 && lane !== 1)) return 'Invalid guard order';
    if (s.phase !== 'playing') return s.phase === 'ready' ? 'Deploy a card first' : 'Guard requires a live match';
    if (s.age < s.guards[team].readyAt - EPSILON) return 'Lane guard recharging';
    return '';
  }
  function guard(s, team, lane) {
    const error = canGuard(s, team, lane);
    if (error) return {ok:false, error};
    Object.assign(s.guards[team], {lane, until:s.age + GUARD_TIME, readyAt:s.age + GUARD_RECHARGE});
    effect(s, 'guard', -direction(team) * TOWER_X, LANES[lane], .29, team, .65);
    log(s, (team === 0 ? 'You guarded' : 'Vanta guarded') + ' Lane ' + laneName(lane) + '.', team, 'guard');
    return {ok:true};
  }
  function placeCoil(s, team, lane, socket) {
    const result = Coils.place(s, team, lane, socket);
    if (result.ok) log(s, (team === 0 ? 'You set' : 'Vanta set') + ' a snare coil in Lane ' + laneName(lane) + '.', team);
    return result;
  }
  function dischargeCoil(s, team, field, count) {
    effect(s, 'snare', Coils.SOCKETS[field.socket], LANES[field.lane], .27, team, .55);
    const targets = count === 1 ? '1 machine' : count + ' machines';
    log(s, (team === 0 ? 'Your coil caught ' : 'Vanta’s coil caught ') + targets + ' in Lane ' + laneName(field.lane) + '.', team, 'snare');
  }
  function deliverFreight(s, team, lane) {
    effect(s, 'delivery', team === 0 ? Freight.DOCK : -Freight.DOCK, freightRailZ(lane), .75, team, .85);
    log(s, (team === 0 ? 'You delivered' : 'Vanta delivered') + ' the Lane ' + laneName(lane) + ' cart.', team, 'delivery');
  }
  function freightRailZ(lane) { return LANES[lane] + (lane === 0 ? -1 : 1) * 1.54; }
  function bankFuses(s, amounts) {
    for (const unit of s.units) if (unit.cargo) {
      const link = effect(s, 'transmit', unit.x, unit.z, UNIT[unit.cardId].label, unit.team, .48);
      Object.assign(link, {tx:0, ty:1.3, tz:0});
    }
    for (const team of [0, 1]) {
      const count = amounts[team];
      if (!count) continue;
      effect(s, 'uplink', 0, 0, 1.30, team, .8);
      log(s, (team === 0 ? 'You banked ' : 'Vanta banked ') + count + (count === 1 ? ' fuse.' : ' fuses.'), team, 'uplink');
    }
  }
  function interceptShot(s, unit, shot, [tx, ty, tz]) {
    s.intercepted[unit.team]++;
    const flash = effect(s, 'intercept', unit.x, unit.z, UNIT.skiff.height, unit.team, .30);
    Object.assign(flash, {tx, ty, tz});
    const kind = shot.type === 'shell' ? 'a mortar shell' : shot.type === 'relay' ? 'a relay bolt' : 'a pulse';
    log(s, (unit.team === 0 ? 'Your' : 'Vanta’s') + ' Pleat Skiff caught ' + kind + ' in Lane ' + laneName(unit.lane) + '.', unit.team, 'intercept');
  }
  function aiGuardLane(s) {
    if (canGuard(s, 1, 0)) return null;
    const danger = [0, 0];
    for (const shot of s.shots) if (shot.team === 0) danger[shot.lane] += shot.damage;
    for (const unit of s.units) {
      if (unit.team !== 0) continue;
      const c = UNIT[unit.cardId];
      const target = targetFor(s, unit, c.range);
      if (target) danger[unit.lane] += c.damage * (target.tower ? 2 : 1);
    }
    const lane = danger[1] > danger[0] ? 1 : 0;
    return danger[lane] >= 30 ? lane : null;
  }
  function aiChoice(s) {
    const choices=s.deck.map(id=>CARD[id]).filter(c=>!canDeploy(s,1,0,c.id));
    if (!choices.length) return null;
    const pressure=LANES.map((_,lane)=>{
      const friend=s.towers.find(t=>t.team===1&&t.lane===lane);
      const rival=s.towers.find(t=>t.team===0&&t.lane===lane);
      let weight=(friend.hp>0?.45:0)+(rival.hp>0?.6:-1.3)+s.random()*.9;
      const cache = s.cache;
      if (cache.lane === lane && (cache.phase === 'open' || (cache.phase === 'incoming' && cache.opensAt - s.age <= 8))) weight += .72;
      if (s.mode === 'freight') {
        const cart = s.objective.carts[lane];
        if (cart.returnAt !== null) weight -= 1;
        else if (cart.escorts[0] > cart.escorts[1]) weight += 1 + Math.max(0, cart.x) / Freight.DOCK;
      }
      if (s.mode === 'salvage') weight += Salvage.lanePriority(s, lane);
      for (const u of s.units) if (u.lane===lane) weight+=u.team===0?.34+(u.x+7)*.045:-.4;
      return weight;
    });
    const lane=pressure[0]>pressure[1]?0:1;
    const allies=s.units.filter(u=>u.team===1&&u.lane===lane);
    const ranked=choices.map(c=>{
      let value=s.random();
      if (allies.some(u=>u.cardId==='ram') && c.range>2) value+=.44;
      if (!allies.length && c.id==='ram') value+=.33;
      if (c.repair && allies.some(u => u.hp < u.maxHp * .7)) value += .6;
      if (c.screenRange && s.units.some(u => u.team === 0 && u.lane === lane && UNIT[u.cardId].range > 2)) value += .55;
      return {id:c.id,value};
    });
    ranked.sort((a,b)=>b.value-a.value);
    return {lane,id:ranked[0].id};
  }
  function targetFor(s,actor,range) {
    let target=null, best=Infinity;
    for (const other of s.units) {
      if (other.team===actor.team || other.lane!==actor.lane || other.hp<=0) continue;
      const dist=Math.hypot(actor.x-other.x,(actor.z-other.z)*.75);
      if (dist<=range && (!target || dist<best || (dist===best && other.id<target.id))) {target=other; best=dist;}
    }
    if (target || actor.tower) return target;
    const tower=s.towers.find(t=>t.team!==actor.team && t.lane===actor.lane && t.hp>0);
    return tower && Math.abs(tower.x-actor.x)<=range+.63 ? tower : null;
  }
  function attack(s,actor,target,c,damageQueue) {
    const isTower=!!actor.tower, type=isTower?'relay':c.shot, height=isTower?1.91:c.height*.72;
    actor.cooldown=isTower?1.27:c.cycle;
    actor.fire=1;
    actor.aim=Math.atan2(target.z-actor.z,target.x-actor.x);
    const destY=target.tower?1.25:UNIT[target.cardId].height*.59;
    if (type==='arc' || type==='ram') {
      damageQueue.push({target,amount:c.damage});
      effect(s,'strike',(actor.x+target.x)*.5,(actor.z+target.z)*.5,destY,actor.team,.24);
      return;
    }
    const dist=Math.hypot(target.x-actor.x,target.z-actor.z);
    s.shots.push({id:s.nextId++,team:actor.team,lane:actor.lane,type,targetId:target.id,
      x:actor.x,z:actor.z,y:height,tx:target.x,tz:target.z,ty:destY,age:0,
      duration:Math.max(.14,dist/(type==='shell'?5.5:12)),damage:isTower?24:c.damage});
  }
  function finish(s,winner,reason) {
    s.phase='ended'; s.winner=winner; s.reason=reason;
    log(s,winner===null?'Match drawn.':winner===0?'Your circuit won the match.':'Vanta won the match.',winner,'result');
  }
  function checkEnd(s) {
    if (s.phase==='ended') return;
    const hp=[0,0], standing=[0,0];
    for (const t of s.towers) {hp[t.team]+=t.hp; if (t.hp>0) standing[t.team]++;}
    s.destroyed=[2-standing[1],2-standing[0]];
    if (s.mode !== 'standard') {
      const result = Drills.outcome(s);
      if (result) finish(s, result.winner, result.reason);
    } else if (!standing[0] || !standing[1]) {
      finish(s,standing[0]===standing[1]?null:standing[0]>standing[1]?0:1,'Relay destruction');
    } else if (s.time<=0) {
      const difference=standing[0]-standing[1] || hp[0]-hp[1];
      finish(s,difference===0?null:difference>0?0:1,'Time limit');
    }
  }
  function advanceTowers(s, dt, damage) {
    for (const t of s.towers) {
      t.fire=Math.max(0,t.fire-dt*4); t.hit=Math.max(0,t.hit-dt*5); t.cooldown-=dt;
      if (t.hp<=0 || t.cooldown>EPSILON) continue;
      const target=targetFor(s,t,4.25);
      if (target) attack(s,t,target,null,damage);
    }
  }
  function repairTarget(s, tender, range) {
    let best = null;
    for (const unit of s.units) {
      if (unit === tender || unit.team !== tender.team || unit.lane !== tender.lane || unit.hp <= 0 || unit.hp >= unit.maxHp) continue;
      if (Math.hypot(tender.x - unit.x, tender.z - unit.z) > range) continue;
      const difference = best ? unit.hp * best.maxHp - best.hp * unit.maxHp : 0;
      if (!best || difference < 0 || (difference === 0 && unit.id < best.id)) best = unit;
    }
    return best;
  }
  function advanceUnits(s, dt, damage, repairs) {
    const moves = [];
    for (const u of s.units) {
      if (u.hp <= 0) continue;
      u.prevX=u.x; u.fire=Math.max(0,u.fire-dt*3.6); u.hit=Math.max(0,u.hit-dt*5); u.cooldown-=dt;
      const c=UNIT[u.cardId];
      u.moving=false;
      const ally = c.repair && repairTarget(s, u, c.repairRange);
      if (ally) {
        u.aim = Math.atan2(ally.z - u.z, ally.x - u.x);
        if (u.cooldown <= EPSILON) {
          u.fire = 1;
          u.cooldown = c.cycle;
          repairs.push({source:u, target:ally, amount:c.repair});
        }
        continue;
      }
      const target=targetFor(s,u,c.range);
      if (target) {
        u.aim=Math.atan2(target.z-u.z,target.x-u.x);
        if (c.damage && u.cooldown<=EPSILON) attack(s,u,target,c,damage);
        continue;
      }
      if (Coils.isSnared(u, s.age)) continue;
      const dir=direction(u.team);
      let travel=c.speed*dt;
      if (s.mode === 'salvage') travel = Math.min(travel, TOWER_X - u.x * dir);
      for (const other of s.units) {
        // The service sled hugs the rail so reinforcements can overtake it.
        if (other.cardId === 'carrier') continue;
        if (other.hp<=0 || other.team!==u.team || other.lane!==u.lane || Math.abs(other.z-u.z)>.36) continue;
        const gap=(other.x-u.x)*dir;
        if (gap>0) travel=Math.min(travel,Math.max(0,gap-.64));
      }
      if (travel > 1e-10) moves.push({unit:u, travel});
    }
    // Everyone sees the same positions when choosing a target and a following distance.
    for (const {unit, travel} of moves) {
      unit.x += travel * direction(unit.team);
      unit.walk += travel;
      unit.moving = true;
    }
  }
  function applyDamage(s, damage) {
    const protectedTargets = new Map();
    for (const {target,amount} of damage) {
      if (target.hp<=0) continue;
      let hit = amount;
      if (isGuarded(s, target.team, target.lane)) {
        hit = Math.ceil(amount / 2);
        let total = protectedTargets.get(target);
        if (!total) {
          total = {before:target.hp, raw:0};
          protectedTargets.set(target, total);
        }
        total.raw += amount;
      }
      target.hp=Math.max(0,target.hp-hit); target.hit=1;
      if (!target.hp) {
        if (target.id === s.objective?.carrierId) s.objective.lostAt = target.x;
        if (s.mode === 'salvage' && !target.tower) Salvage.drop(s, target);
        effect(s,'wreck',target.x,target.z,target.tower?1.1:.42,target.team,.78);
        if (target.tower) log(s,(target.team===0?'Your':'Vanta’s')+' Lane '+laneName(target.lane)+' relay fell.',1-target.team,'relay');
      }
    }
    // Compare the two possible HP losses once per victim. Counting per hit
    // credits overkill differently when simultaneous projectiles change order.
    for (const [target, {before, raw}] of protectedTargets) {
      s.guards[target.team].blocked += Math.min(before, raw) - (before - target.hp);
    }
    s.units=s.units.filter(u=>u.hp>0 && Math.abs(u.x)<9.75);
  }
  function applyRepairs(s, repairs) {
    for (const {source, target, amount} of repairs) {
      if (!s.units.includes(target)) continue;
      const restored = Math.min(amount, target.maxHp - target.hp);
      if (restored <= 0) continue;
      target.hp += restored;
      s.repaired[source.team] += restored;
      const tether = effect(s, 'mend', source.x, source.z, .81, source.team, .32);
      Object.assign(tether, {tx:target.x, tz:target.z, ty:UNIT[target.cardId].height * .68});
    }
  }
  function advanceObjective(s, from) {
    if (s.mode === 'salvage') {
      Salvage.advance(s, bankFuses);
      return;
    }
    if (s.mode === 'freight') {
      Freight.advance(s, from, s.age, deliverFreight);
      return;
    }
    const claim = Signal.advance(s.cache, s.units, from, s.age, s.duration);
    if (claim) {
      const {team, lane} = claim;
      s.energy[team] = Math.min(MAX_ENERGY, s.energy[team] + Signal.REWARD);
      s.captures[team]++;
      effect(s, 'cache', 0, LANES[lane], .28, team, .85);
      log(s, (team === 0 ? 'You secured' : 'Vanta secured') + ' the Lane ' + laneName(lane) + ' signal cache.', team, 'cache');
    }
  }
  function advanceOpponent(s, dt) {
    if (s.mode === 'watch') {
      const wave = Drills.sendWave(s, spawn);
      if (wave) log(s, 'Wave ' + wave + ' entered Lane B.', 1, 'wave');
    } else if (s.ai && (s.aiIn-=dt)<=0) {
      const lane = aiGuardLane(s);
      if (lane !== null) guard(s, 1, lane);
      const move=aiChoice(s);
      if (move) deploy(s,1,move.lane,move.id);
      const coil = !Drills.FORMATS[s.mode].drill && Coils.aiPlacement(s);
      if (coil) placeCoil(s, 1, coil.lane, coil.socket);
      s.aiIn=move?3.25+s.random()*2.7:1.1;
    }
  }
  function step(s, dt) {
    const from = s.age;
    s.age += dt;
    if (s.duration-s.age<EPSILON) s.age=s.duration;
    s.time=s.duration-s.age;
    for (let team=0; team<2; team++) s.energy[team]=Math.min(MAX_ENERGY,s.energy[team]+dt*ENERGY_RATE);
    s.effects=s.effects.filter(e=>(e.age+=dt)<e.life);
    const damage=[], repairs=[];
    Coils.advance(s, damage, dischargeCoil);
    Projectiles.advance(s,dt,damage,effect,interceptShot);
    advanceTowers(s,dt,damage);
    advanceUnits(s,dt,damage,repairs);
    applyDamage(s,damage);
    applyRepairs(s,repairs);
    advanceObjective(s,from);
    checkEnd(s);
    if (s.phase === 'playing') advanceOpponent(s,dt);
  }
  function tick(s, dt=STEP) {
    if (s.phase!=='playing' || !Number.isFinite(dt) || dt<=0) return;
    dt = Math.min(dt, s.duration - s.age);
    while (dt > STEP + 1e-10 && s.phase === 'playing') {
      step(s, STEP);
      dt -= STEP;
    }
    if (s.phase === 'playing') step(s, Math.abs(dt - STEP) < 1e-10 ? STEP : dt);
  }
  class FixedClock {
    constructor(){ this.carry=0; }
    advance(delta,fn,rate=1) {
      if (!Number.isFinite(delta) || delta<=0 || !Number.isFinite(rate) || rate<=0) return;
      // At 4× playback a stalled frame may consume at most one simulated second.
      this.carry+=Math.min(1, Math.min(.25,delta)*rate);
      while (this.carry+1e-10>=STEP) { fn(STEP); this.carry=Math.max(0,this.carry-STEP); }
    }
    get alpha(){return this.carry/STEP;}
  }
  return {STEP,DURATION,MAX_ENERGY,ENERGY_RATE,CARD_LOCK,LANES,TOWER_X,TOWER_HP,CARDS,CARD,create,spawn,deploy,canDeploy,pause,aiChoice,targetFor,shotPoint:Projectiles.point,checkEnd,tick,formatTime,laneName,FixedClock,
    GUARD_TIME,GUARD_RECHARGE,isGuarded,canGuard,guard,deploymentSites,placeCoil,freightRailZ};
});
