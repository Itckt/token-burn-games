(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath);
  if (node) module.exports = api;
  else root.FoundryCamera = api;
})(globalThis, function (M) {
  "use strict";
  const {add, sub, mul, madd, dot, cross, unit, lerp, clamp} = M;
  const VIEWS = {isometric: [-0.38,0.50], overhead: [0,Math.PI/2-0.015], front: [0,0.15]};
  function axes(yaw,pitch) {
    const out = [Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    const right = [Math.cos(yaw),0,-Math.sin(yaw)];
    return {out,right,up:cross(out,right)};
  }
  function cloud(course) {
    const points = [];
    for (const section of course.sections) {
      for (let i=0; i<section.samples.length; i++) {
        if (i%3 && i!==section.samples.length-1) continue;
        const f = section.samples[i];
        for (const sign of [-1,1]) {
          const p = madd(madd(f.p,f.b,sign*1.12),f.n,0.65);
          points.push(p,[p[0],0,p[2]]);
        }
      }
    }
    points.push(...course.landmarks);
    return points;
  }
  function framing(points,yaw,pitch,width,height,top=0,bottom=0,side=0) {
    const {right,up,out} = axes(yaw,pitch);
    const box = M.bounds(points.map(p => [dot(p,right),dot(p,up),dot(p,out)]));
    const mid = mul(add(box.min,box.max),0.5), size = sub(box.max,box.min);
    const scale = Math.max(0.01,size[0]/Math.max(width*0.45,width-side*2),
      size[1]/Math.max(height*0.38,height-top-bottom));
    const target = add(add(mul(right,mid[0]),mul(up,mid[1]+(top-bottom)*scale/2)),mul(out,mid[2]));
    return {target,half:Math.max(1.35,scale*height*0.5)};
  }
  function matrices(target,yaw,pitch,half,aspect,reach) {
    const {out,right,up} = axes(yaw,pitch);
    const distance = Math.max(70,reach*2.5+half*2);
    const eye = madd(target,out,distance);
    const near = 0.05, far = distance*2.5;
    const projection = M.ortho(-half*aspect,half*aspect,-half,half,near,far);
    return {vp:M.multiply(projection,M.lookAt(eye,target,up)),out,right,up,half,target,eye,aspect,near,far};
  }
  class Orbit {
    constructor() {
      [this.yaw,this.pitch] = VIEWS.isometric;
      this.wantYaw=this.yaw; this.wantPitch=this.pitch;
      this.target=[0,0,0]; this.wantTarget=[0,0,0];
      this.half=12; this.wantHalf=12; this.fitHalf=12;
      this.points=[[0,0,0]]; this.width=1; this.height=1; this.reach=40;
      this.following=false;
    }
    setCourse(course) {
      this.points=cloud(course);
      this.reach=M.length(sub(course.bounds.max,course.bounds.min));
    }
    fit(immediate = false) {
      this.following=false;
      const small = this.width<580;
      const f = framing(this.points,this.wantYaw,this.wantPitch,this.width,this.height,
        small ? 96 : 128,small ? 80 : 98,small ? 20 : 40);
      this.wantTarget=f.target; this.fitHalf=f.half*1.045; this.wantHalf=this.fitHalf;
      if (immediate) {
        this.yaw=this.wantYaw; this.pitch=this.wantPitch;
        this.target=this.wantTarget.slice(); this.half=this.wantHalf;
      }
    }
    get followHalf() { return 3.8 * Math.max(1, this.height / this.width); }
    follow(position, velocity = [0,0,0]) {
      if (!this.following) this.wantHalf = this.followHalf;
      this.following = true;
      // Look just past the marble to compensate for the eased camera. The
      // horizon stays level at the crown of a loop and during a fall.
      const lead = Math.min(0.09, 1 / Math.max(1, M.length(velocity)));
      this.wantTarget = madd(position, velocity, lead);
    }
    resize(w,h,immediate=false) {
      const previousScale = this.followHalf;
      this.width=Math.max(1,w); this.height=Math.max(1,h);
      if (this.following) {
        this.wantHalf *= this.followHalf / previousScale;
        if (immediate) this.half = this.wantHalf;
      } else this.fit(immediate);
    }
    orbit(dx,dy) {
      this.wantYaw-=dx*0.007;
      this.wantPitch=clamp(this.wantPitch+dy*0.006,0.12,Math.PI/2-0.015);
    }
    zoom(factor) {
      const scale = this.following ? this.followHalf : this.fitHalf;
      this.wantHalf=clamp(this.wantHalf*factor,scale*0.25,scale*3.8);
    }
    preset(key) {
      if (!Object.hasOwn(VIEWS,key)) return false;
      const [yaw,pitch]=VIEWS[key];
      this.wantYaw += Math.atan2(Math.sin(yaw-this.wantYaw),Math.cos(yaw-this.wantYaw));
      this.wantPitch=pitch; this.fit(); return true;
    }
    moving() {
      return Math.abs(this.wantYaw-this.yaw)>0.0001 || Math.abs(this.wantPitch-this.pitch)>0.0001 ||
        Math.abs(this.wantHalf-this.half)>0.0001 || M.length(sub(this.wantTarget,this.target))>0.0001;
    }
    update(dt, immediate=false) {
      const k=immediate || !this.moving() ? 1 : 1-Math.exp(-clamp(dt,0,0.1)*13);
      this.yaw+=(this.wantYaw-this.yaw)*k; this.pitch+=(this.wantPitch-this.pitch)*k;
      this.half+=(this.wantHalf-this.half)*k; this.target=lerp(this.target,this.wantTarget,k);
      return matrices(this.target,this.yaw,this.pitch,this.half,this.width/this.height,this.reach);
    }
  }
  return {VIEWS,axes,cloud,framing,matrices,Orbit};
});
