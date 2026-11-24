(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./math.js') : root.Rift.math);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Rift = root.Rift || {}).mesh = api;
})(globalThis, function (M) {
  'use strict';

  const STRIDE = 10;
  const palette = new Map();
  function rgb(hex) {
    if (Array.isArray(hex)) return hex;
    if (!palette.has(hex)) {
      const n = Number.parseInt(hex.replace('#', ''), 16);
      palette.set(hex, [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]);
    }
    return palette.get(hex);
  }
  function outline(w, d, cut) {
    const x=w/2, z=d/2, c=M.clamp(cut, 0, Math.min(x,z)*0.96);
    if (c === 0) return [[-x,-z],[-x,z],[x,z],[x,-z]];
    return [[-x+c,-z],[-x,-z+c],[-x,z-c],[-x+c,z],[x-c,z],[x,z-c],[x,-z+c],[x-c,-z]];
  }

  class Builder {
    constructor() { this.data=[]; this.frame=M.identity(); }
    group(x,y,z, yaw,pitch,roll, fn) {
      const saved=this.frame;
      let local=M.translation(x,y,z);
      if (yaw) local=M.multiply(local,M.rotationY(yaw));
      if (pitch) local=M.multiply(local,M.rotationX(pitch));
      if (roll) local=M.multiply(local,M.rotationZ(roll));
      this.frame=M.multiply(saved,local);
      try { fn(this); } finally { this.frame=saved; }
      return this;
    }
    tri(a,b,c,color,glow=0) {
      const p=M.transformPoint(this.frame,a), q=M.transformPoint(this.frame,b), r=M.transformPoint(this.frame,c);
      const raw=M.cross(M.sub(q,p),M.sub(r,p));
      if (Math.hypot(...raw)<1e-10) return;
      const normal=M.normalize(raw), tint=rgb(color);
      for (const v of [p,q,r]) this.data.push(...v,...normal,...tint,glow);
    }
    quad(a,b,c,d,col,glow=0) { this.tri(a,b,c,col,glow); this.tri(a,c,d,col,glow); }
    solid(rings,col,glow=0) {
      const low=rings[0], high=rings[rings.length-1], n=low.length;
      for (let i=1;i<n-1;i++) {
        this.tri(low[0], low[i+1], low[i],col,glow);
        this.tri(high[0], high[i], high[i+1],col,glow);
      }
      for (let row=1;row<rings.length;row++) {
        for (let i=0;i<n;i++) {
          const j=(i+1)%n;
          this.quad(rings[row-1][i],rings[row-1][j],rings[row][j],rings[row][i],col,glow);
        }
      }
    }
    // Chamfered outline, with a second bevel catching the light along the top lip.
    box(x,y,z,w,h,d,col,cut=0,bevel=0,glow=0) {
      const lip=Math.min(bevel,h*.42,w*.2,d*.2), base=outline(w,d,cut);
      const ring=(height,inset) => base.map(([px,pz])=>[x+px*(1-inset*2/w),y+height,z+pz*(1-inset*2/d)]);
      const rings=[ring(-h/2,lip)];
      if (lip>0) rings.push(ring(-h/2+lip,0),ring(h/2-lip,0));
      rings.push(ring(h/2,lip));
      this.solid(rings,col,glow);
      return this;
    }
    cylinder(x,y,z,rBottom,rTop,h,sides,col,glow=0,turn=0) {
      const ring=(r,py)=>Array.from({length:sides},(_,i)=>{
        const angle=turn-i*M.TAU/sides;
        return [x+r*Math.cos(angle),py,z+r*Math.sin(angle)];
      });
      this.solid([ring(rBottom,y-h/2),ring(rTop,y+h/2)],col,glow);
      return this;
    }
    tube(a,b,r0,r1,sides,col,glow=0) {
      const axis=M.normalize(M.sub(b,a));
      if (M.dot(axis,axis)<.5) return this;
      const first=M.normalize(M.cross(Math.abs(axis[1])>.85?[1,0,0]:[0,1,0],axis));
      const second=M.cross(axis,first);
      const ring=(p,r)=>Array.from({length:sides},(_,i)=>{
        const t=M.TAU*i/sides;
        return p.map((v,k)=>v+r*(first[k]*Math.cos(t)+second[k]*Math.sin(t)));
      });
      this.solid([ring(a,r0),ring(b,r1)],col,glow);
      return this;
    }
    poly(points,y0,y1,col,glow=0) {
      this.solid([y0,y1].map(y=>points.map(([x,z])=>[x,y,z])),col,glow);
      return this;
    }
    finish() { return new Float32Array(this.data); }
  }
  return {Builder,STRIDE,rgb,outline};
});
