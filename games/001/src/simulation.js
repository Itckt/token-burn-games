(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./collision.js'), require('./weather.js'), require('./terrain.js'));
  else root.Atlas.sim = factory(root.Atlas.math, root.Atlas.collision, root.Atlas.weather, root.Atlas.terrain);
})(globalThis, function (M, collision, weather, terrain) {
  'use strict';
  const {RADIUS, canStand} = collision;
  const WALK=3.55, RUN=6.25, EYE=1.78, PITCH_LIMIT=1.39;
  function makeState(view) {
    const state={night:false,light:0,phase:0,bob:0,weather:weather.create()};
    return setView(state,view);
  }
  function setView(s,[x,z,yaw,pitch]) {
    Object.assign(s,{x,z,yaw,aimYaw:yaw,pitch,aimPitch:pitch,vx:0,vz:0,bob:0,phase:0});
    return s;
  }
  function eyePosition(s, world) {
    return [s.x, terrain.heightAt(s.x, s.z, world.surfaces) + EYE + s.bob, s.z];
  }
  function look(s,dx,dy,sensitivity=.00235) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(sensitivity)) return;
    s.aimYaw=M.wrapAngle(s.aimYaw+dx*sensitivity);
    s.aimPitch=M.clamp(s.aimPitch-dy*sensitivity,-PITCH_LIMIT,PITCH_LIMIT);
  }
  function move(s,dx,dz,world) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
    const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/(RADIUS*.65)));
    for(let i=0;i<n;i++) {
      if(dx && collision.canWalk(s.x,s.z,s.x+dx/n,s.z,world)) s.x+=dx/n;
      if(dz && collision.canWalk(s.x,s.z,s.x,s.z+dz/n,world)) s.z+=dz/n;
    }
  }
  function step(s,keys,dt,world,reducedMotion=false,zoom=1) {
    if (!Number.isFinite(dt) || dt<=0) return false;
    dt=Math.min(.1,dt);
    const press=key=>keys.has(key)?1:0;
    const yaw0=s.yaw,pitch0=s.pitch,x0=s.x,z0=s.z,oldLight=s.light,oldBob=s.bob;
    s.aimYaw=M.wrapAngle(s.aimYaw+(press('ArrowRight')-press('ArrowLeft'))*dt*1.65/zoom);
    s.aimPitch=M.clamp(s.aimPitch+(press('ArrowUp')-press('ArrowDown'))*dt*1.30/zoom,-PITCH_LIMIT,PITCH_LIMIT);
    const turn=1-Math.exp(-25*dt);
    s.yaw=M.wrapAngle(s.yaw+M.wrapAngle(s.aimYaw-s.yaw)*turn);
    s.pitch=M.mix(s.pitch,s.aimPitch,turn);
    const forward=press('KeyW')-press('KeyS'),side=press('KeyD')-press('KeyA');
    const length=Math.max(1,Math.hypot(forward,side)),speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?RUN:WALK;
    const vx=(Math.sin(s.yaw)*forward+Math.cos(s.yaw)*side)*speed/length;
    const vz=(-Math.cos(s.yaw)*forward+Math.sin(s.yaw)*side)*speed/length;
    // Integrating the exponential exactly keeps travel distance independent of frame rate.
    const rate=forward||side?12:18, decay=Math.exp(-rate*dt);
    const dx=vx*dt+(s.vx-vx)*(1-decay)/rate,dz=vz*dt+(s.vz-vz)*(1-decay)/rate;
    s.vx=vx+(s.vx-vx)*decay; s.vz=vz+(s.vz-vz)*decay;
    if(Math.abs(dx)+Math.abs(dz)>.000006) {
      move(s,dx,dz,world);
      // A sleeping camera must not retain momentum into a wall. Keep the
      // tangential velocity so diagonal movement still slides along its face.
      if (Math.abs(s.x-x0-dx)>1e-8) s.vx=0;
      if (Math.abs(s.z-z0-dz)>1e-8) s.vz=0;
    }
    const distance=Math.hypot(s.x-x0,s.z-z0);
    s.phase=(s.phase+distance*2.83)%M.TAU;
    const targetBob=Math.sin(s.phase)*.024*Math.min(1,distance/(WALK*dt));
    s.bob=reducedMotion ? 0 : M.mix(s.bob,targetBob,1-Math.exp(-12*dt));
    s.light=M.mix(s.light,Number(s.night),reducedMotion?1:1-Math.exp(-4.8*dt));
    if(Math.abs(s.light-Number(s.night))<.001) s.light=Number(s.night);
    return distance>0 || Math.abs(M.wrapAngle(s.yaw-yaw0))+Math.abs(s.pitch-pitch0)+Math.abs(s.bob-oldBob)+Math.abs(s.light-oldLight)>.000002;
  }
  function nearest(s,places,currentId,surfaces) {
    const id=terrain.surfaceAt(s.x,s.z,surfaces)?.placeId;
    const onPlatform=id && places.find(p=>p.id===id);
    if (onPlatform) return onPlatform;
    let best=Infinity, place=places[0];
    for(const p of places) {
      // The approach and the landmark form one location. Hysteresis steadies boundary labels.
      const [ax,az]=p.view, dx=p.point[0]-ax,dz=p.point[1]-az;
      const t=M.clamp(((s.x-ax)*dx+(s.z-az)*dz)/(dx*dx+dz*dz||1),0,1);
      const d=Math.hypot(s.x-ax-t*dx,s.z-az-t*dz)-(p.id===currentId?1.15:0);
      if(d<best) { best=d; place=p; }
    }
    return place;
  }
  function bearing(yaw) {
    const degrees=((Math.round(yaw*180/Math.PI)%360)+360)%360;
    return {degrees,label:['N','NE','E','SE','S','SW','W','NW'][Math.round(degrees/45)%8]};
  }
  return {RADIUS,WALK,RUN,EYE,PITCH_LIMIT,makeState,setView,eyePosition,look,canStand,move,step,nearest,bearing};
});
