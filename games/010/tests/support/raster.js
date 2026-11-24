'use strict';

// Independent CPU reference for the opaque picking pass. Pixel centers use CSS
// (top-left) coordinates. The wall clock's transparent corners are cut away.
const {regions} = require('../../js/art');
const {STRIDE,parts} = require('../../js/mesh');
const {hub} = require('../../js/fan');
const {cup} = require('../../js/tea');
const cat = require('../../js/shop-cat');
const radio = require('../../js/radio');

function rasterize(batches,matrix,width,height,pose) {
  const ids=new Int16Array(width*height).fill(-1);
  const depths=new Float32Array(ids.length).fill(Infinity);
  for (const {vertices,indices} of batches) {
    const count=vertices.length/STRIDE, screen=new Float64Array((count+2)*6);
    const perspective=matrix[3]!==0 || matrix[7]!==0 || matrix[11]!==0;
    const clip=perspective ? new Float64Array(count*6) : null;
    function project(i,x,y,z,w,u,v) {
      const j=i*6;
      screen[j]=(1+x/w)*.5*width; screen[j+1]=(1-y/w)*.5*height;
      screen[j+2]=z/w; screen[j+3]=1/w; screen[j+4]=u/w; screen[j+5]=v/w;
    }
    for (let i=0;i<count;i++) {
      const k=i*STRIDE, part=vertices[k+13];
      let x=vertices[k], y=vertices[k+1], z=vertices[k+2];
      if (pose && part===parts.fanBlade) {
        const [cos,sin]=pose.u_rotor, dx=x-hub[0], dy=y-hub[1];
        x=hub[0]+dx*cos-dy*sin; y=hub[1]+dx*sin+dy*cos;
      } else if (pose && part===parts.teaSurface) {
        const [scale,drop]=pose.u_liquid;
        x=cup.x+scale*(x-cup.x); z=cup.z+scale*(z-cup.z); y+=drop;
      } else if (pose?.u_catPose && part>=parts.catBody && part<=parts.catRight) {
        const [px,pz,cos,sin]=pose.u_catPose, [lift,stride]=pose.u_walk;
        const foot=part===parts.catLeft ? stride : part===parts.catRight ? -stride : 0;
        const dx=x-cat.home[0]+foot*Math.sin(cat.homeYaw), dz=z-cat.home[1]+foot*Math.cos(cat.homeYaw);
        x=px+cos*dx+sin*dz; z=pz-sin*dx+cos*dz;
        y+=part===parts.catBody ? lift : -.52*lift+.52*Math.max(0,foot);
      } else if (pose?.u_tuning && part===parts.radioNeedle) {
        x+=pose.u_tuning[0]*.133*Math.cos(radio.yaw);
        z-=pose.u_tuning[0]*.133*Math.sin(radio.yaw);
      }
      const coord=row=>matrix[row]*x+matrix[row+4]*y+matrix[row+8]*z+matrix[row+12];
      const cx=coord(0),cy=coord(1),cz=coord(2),cw=coord(3),u=vertices[k+9],v=vertices[k+10];
      if (clip) clip.set([cx,cy,cz,cw,u,v],i*6);
      if (cw!==0) project(i,cx,cy,cz,cw,u,v);
    }
    function triangle(i0,i1,i2,id,clockFace) {
      const a=i0*6,b=i1*6,c=i2*6;
      const ax=screen[a],ay=screen[a+1],bx=screen[b],by=screen[b+1],cx=screen[c],cy=screen[c+1];
      const determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
      if (Math.abs(determinant)<1e-8) return;
      const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)),x1=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)-.5));
      const y0=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)),y1=Math.min(height-1,Math.floor(Math.max(ay,by,cy)-.5));
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
        const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/determinant;
        const v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/determinant, w=1-u-v;
        if (Math.min(u,v,w)<-1e-7) continue;
        const depth=u*screen[a+2]+v*screen[b+2]+w*screen[c+2], offset=y*width+x;
        if (depth < -1 || depth > 1 || depth>depths[offset]+1e-7) continue;
        if (clockFace) {
          const region=regions.clock;
          const reciprocal=u*screen[a+3]+v*screen[b+3]+w*screen[c+3];
          const uv=k=>(u*screen[a+k]+v*screen[b+k]+w*screen[c+k])/reciprocal;
          const s=(uv(4)-region[0])/(region[2]-region[0])-.5;
          const t=(uv(5)-region[1])/(region[3]-region[1])-.5;
          if (s*s+t*t>.49*.49) continue;
        }
        ids[offset]=id; depths[offset]=depth;
      }
    }
    const nearSide=i=>clip[i*6+2]+clip[i*6+3];
    for (let k=0;k<indices.length;k+=3) {
      const a=indices[k],b=indices[k+1],c=indices[k+2], id=vertices[a*STRIDE+11];
      const clockFace=id===4 && vertices[a*STRIDE+9]<.99;
      if (!clip || (nearSide(a)>=0 && nearSide(b)>=0 && nearSide(c)>=0)) {
        triangle(a,b,c,id,clockFace);
        continue;
      }
      if (nearSide(a)<0 && nearSide(b)<0 && nearSide(c)<0) continue;
      // Clip in homogeneous space before division to avoid projecting a wall
      // behind a customer's head across the front of the entire room.
      const polygon=[];
      let prev=c, scratch=count;
      for (const next of [a,b,c]) {
        const from=nearSide(prev), to=nearSide(next);
        if ((from<0)!==(to<0)) {
          const t=from/(from-to);
          const along=j=>clip[prev*6+j]+t*(clip[next*6+j]-clip[prev*6+j]);
          project(scratch,along(0),along(1),along(2),along(3),along(4),along(5));
          polygon.push(scratch++);
        }
        if (to>=0) polygon.push(next);
        prev=next;
      }
      for (let j=1;j+1<polygon.length;j++) triangle(polygon[0],polygon[j],polygon[j+1],id,clockFace);
    }
  }
  return {ids,depths,width,height,at:(x,y)=>ids[Math.floor(y)*width+Math.floor(x)]};
}
module.exports={rasterize};
