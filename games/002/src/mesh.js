(() => {
  "use strict";
  const node=typeof module === "object" && module.exports;
  const M=node ? require("./math.js") : Slipwake.math;
  const STRIDE=10, TAU=Math.PI*2, colors=new Map();
  function rgb(hex) {
    if (typeof hex!=="string") return hex;
    if (!colors.has(hex)) {
      const n=parseInt(hex.replace("#",""),16);
      colors.set(hex,[(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255]);
    }
    return colors.get(hex);
  }
  function outline(w,d,r) {
    const a=w/2,b=d/2;
    r=M.clamp(r,0,Math.min(a,b)*0.99);
    return r===0 ? [[-a,-b],[-a,b],[a,b],[a,-b]] :
      [[-a,-b+r],[-a,b-r],[-a+r,b],[a-r,b],[a,b-r],[a,-b+r],[a-r,-b],[-a+r,-b]];
  }
  class Builder {
    constructor() { this.data=[]; this.pose=[0,0,0,1,0]; }
    at(x,y,z,yaw,draw) {
      const p=this.pose,c=Math.cos(yaw),s=Math.sin(yaw);
      this.pose=[p[0]+p[3]*x+p[4]*z,p[1]+y,p[2]-p[4]*x+p[3]*z,p[3]*c-p[4]*s,p[4]*c+p[3]*s];
      try { draw(this); } finally { this.pose=p; }
    }
    vertex(v,n,color,glow) {
      const [x,y,z,c,s]=this.pose;
      this.data.push(x+c*v[0]+s*v[2],y+v[1],z-s*v[0]+c*v[2],c*n[0]+s*n[2],n[1],-s*n[0]+c*n[2],color[0],color[1],color[2],glow);
    }
    tri(a,b,c,color,glow=0) {
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      const cross=M.cross(ab,ac), length=Math.hypot(...cross);
      if (length<1e-9) return;
      const n=cross.map(v=>v/length), col=rgb(color);
      this.vertex(a,n,col,glow); this.vertex(b,n,col,glow); this.vertex(c,n,col,glow);
    }
    quad(a,b,c,d,color,glow=0) {
      this.tri(a,b,c,color,glow); this.tri(a,c,d,color,glow);
    }
    layers(x,z,levels,color,glow=0) {
      const rings=levels.map(([y,points])=>points.map(([px,pz])=>[x+px,y,z+pz]));
      const bottom=rings[0], top=rings[rings.length-1], n=bottom.length;
      for (let i=1;i<n-1;i++) {
        this.tri(top[0],top[i],top[i+1],color,glow);
        this.tri(bottom[0],bottom[i+1],bottom[i],color,glow);
      }
      for (let j=0;j<rings.length-1;j++) for (let i=0;i<n;i++) {
        const k=(i+1)%n;
        this.quad(rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i],color,glow);
      }
    }
    box(x,y,z,w,h,d,color,glow=0) {
      const profile=outline(w,d,0);
      this.layers(x,z,[[y-h/2,profile],[y+h/2,profile]],color,glow);
    }
    bevel(x,y,z,w,h,d,color,corner=0.1,lip=0.045,glow=0) {
      const e=Math.min(lip,h*0.35,w*0.22,d*0.22);
      const face=outline(w,d,corner), inset=outline(w-2*e,d-2*e,corner);
      const bottom=y-h/2,top=y+h/2;
      this.layers(x,z,[[bottom,inset],[bottom+e,face],[top-e,face],[top,inset]],color,glow);
    }
    drum(x,y,z,rx,h,rz,n,color,glow=0) {
      const face=Array.from({length:n},(_,i)=>[Math.sin(i*TAU/n)*rx,Math.cos(i*TAU/n)*rz]);
      this.layers(x,z,[[y-h/2,face],[y+h/2,face]],color,glow);
    }
    tile(x,y,z,w,d,color,glow=0) {
      const v=outline(w,d,0).map(([a,b])=>[x+a,y,z+b]);
      this.quad(...v,color,glow);
    }
    line(x1,z1,x2,z2,width,color,y=0.014,glow=0) {
      const dx=x2-x1,dz=z2-z1,l=Math.hypot(dx,dz);
      if (l<1e-8) return;
      const a=-dz/l*width/2,b=dx/l*width/2;
      this.quad([x1-a,y,z1-b],[x1+a,y,z1+b],[x2+a,y,z2+b],[x2-a,y,z2-b],color,glow);
    }
    ring(x,y,z,inner,outer,n,color,start=0,end=TAU,glow=0) {
      for (let i=0;i<n;i++) {
        const a=M.mix(start,end,i/n), b=M.mix(start,end,(i+1)/n);
        const point=(angle,r)=>[x+Math.sin(angle)*r,y,z+Math.cos(angle)*r];
        this.quad(point(a,outer),point(b,outer),point(b,inner),point(a,inner),color,glow);
      }
    }
    beam(a,b,w,d,color,glow=0) {
      const axis=M.unit(b.map((v,i)=>v-a[i]));
      if (Math.hypot(...axis)===0) return;
      const u=M.unit(M.cross(axis,Math.abs(axis[1])<0.95 ? [0,1,0] : [0,0,1])),v=M.cross(axis,u);
      const corners=p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>p.map((q,i)=>q+s*u[i]*w/2+t*v[i]*d/2));
      const low=corners(a),high=corners(b);
      this.quad(...high,color,glow); this.quad(...low.slice().reverse(),color,glow);
      for (let i=0;i<4;i++) { const j=(i+1)%4; this.quad(low[i],low[j],high[j],high[i],color,glow); }
    }
    finish() { return new Float32Array(this.data); }
  }
  const api={Builder,STRIDE,TAU,rgb,outline};
  if (node) module.exports=api;
  else (globalThis.Slipwake ||= {}).mesh=api;
})();
