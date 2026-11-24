(() => {
  "use strict";
  const node=typeof module === "object" && module.exports;
  const M=node ? require("./math.js") : Slipwake.math;
  const {RULES}=node ? require("./game.js") : Slipwake.game;
  const MAX=240;
  const counts={shot:3,impact:7,hit:4,ko:26,dash:13,pulse:24,respawn:12,fork:11,repair:12,
    net:12,intercept:8,relayPickup:14,relayDrop:12,relayReturn:12,delivery:28,rally:6,
    relayPass:5,relayCatch:12,relayLand:9,signalShift:18,signalPoint:5,bank:6,ricochet:12,haul:8,supplyCollect:16,
    vane:6,boltReturn:12,freightDock:24};
  const radii={pulse:RULES.pulseRadius,ko:1.68,respawn:1.1,dash:0.94,repair:0.82,
    relayPickup:1.1,relayDrop:1.25,relayCatch:1.05,delivery:2.0,rally:1.1,signalShift:1.6,supplyCollect:1.05,
    boltReturn:0.94,freightDock:2};
  function create(seed=419) { return {bits:[],rings:[],tethers:[],random:M.rng(seed)}; }
  function emit(f,e) {
    const type=e.type,team=e.team,rand=f.random;
    const count=counts[type]||0, end=radii[type];
    const gold=type.startsWith("relay") || type==="delivery" || type==="bank" || type==="ricochet";
    const signal=type==="signalShift" || type==="vane" || type==="boltReturn";
    if (type==="haul") {
      f.tethers.push({x:e.fromX,z:e.fromZ,toX:e.x,toZ:e.z,age:0,life:0.22});
      if (f.tethers.length>6) f.tethers.shift();
    }
    if (end) {
      f.rings.push({x:e.x,z:e.z,team,gold,signal,end,age:0,life:type==="pulse" ? 0.44 : 0.32});
      if (f.rings.length>24) f.rings.shift();
    }
    for (let i=0;i<count;i++) {
      const angle=type==="shot" || type==="fork" ? e.yaw+(rand()-0.5)*0.75 : rand()*Math.PI*2;
      const speed=(type==="ko" ? 2.6 : 1.3)+rand()*(type==="pulse" ? 5.4 : 2.7);
      const y=type==="dash" || type==="pulse" || type==="respawn" ? 0.24 : 1.0;
      const life=type==="shot" ? 0.09+rand()*0.07 : 0.19+rand()*0.38;
      f.bits.push({x:e.x,y,z:e.z,vx:Math.sin(angle)*speed-(e.dx||0)*2,
        vy:0.25+rand()*(type==="ko" ? 5.8 : 2.9),vz:Math.cos(angle)*speed-(e.dz||0)*2,
        life,age:0,size:0.035+rand()*(type==="ko" ? 0.10 : 0.07),team,gold,signal,white:i%3===0});
    }
    if (f.bits.length>MAX) f.bits.splice(0,f.bits.length-MAX);
  }
  function step(f,dt) {
    let keep=0;
    for (const p of f.bits) {
      p.age+=dt;
      if (p.age>=p.life) continue;
      p.x+=p.vx*dt; p.y=Math.max(0.04,p.y+p.vy*dt); p.z+=p.vz*dt;
      p.vy-=9.0*dt; f.bits[keep++]=p;
    }
    f.bits.length=keep;
    for (const list of [f.rings,f.tethers]) {
      keep=0;
      for (const effect of list) { effect.age+=dt; if (effect.age<effect.life) list[keep++]=effect; }
      list.length=keep;
    }
  }
  const api={create,emit,step,MAX};
  if (node) module.exports=api;
  else (globalThis.Slipwake ||= {}).effects=api;
})();
