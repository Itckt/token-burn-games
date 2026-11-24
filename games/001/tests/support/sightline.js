'use strict';
const {STRIDE}=require('../../src/mesh.js');

// First triangle met along eye + t*(target-eye). A small overrun lets a test
// distinguish the intended surface from a misplaced or missing feature.
function firstHit(world,eye,target,limit=1.02) {
  const data=world.vertices, [ox,oy,oz]=eye;
  const dx=target[0]-ox, dy=target[1]-oy, dz=target[2]-oz;
  const min=eye.map((v,i)=>Math.min(v,v+(target[i]-v)*limit));
  const max=eye.map((v,i)=>Math.max(v,v+(target[i]-v)*limit));
  let t=Infinity, material=null;
  for (let a=0; a<data.length; a+=3*STRIDE) {
    const b=a+STRIDE, c=b+STRIDE;
    if ([0,1,2].some(k=>(data[a+k]<min[k] && data[b+k]<min[k] && data[c+k]<min[k]) ||
        (data[a+k]>max[k] && data[b+k]>max[k] && data[c+k]>max[k]))) continue;
    const ex=data[b]-data[a], ey=data[b+1]-data[a+1], ez=data[b+2]-data[a+2];
    const fx=data[c]-data[a], fy=data[c+1]-data[a+1], fz=data[c+2]-data[a+2];
    const hx=dy*fz-dz*fy, hy=dz*fx-dx*fz, hz=dx*fy-dy*fx;
    const det=ex*hx+ey*hy+ez*hz;
    if (Math.abs(det)<1e-9) continue;
    const sx=ox-data[a], sy=oy-data[a+1], sz=oz-data[a+2];
    const u=(sx*hx+sy*hy+sz*hz)/det;
    if (u<0 || u>1) continue;
    const qx=sy*ez-sz*ey, qy=sz*ex-sx*ez, qz=sx*ey-sy*ex;
    const v=(dx*qx+dy*qy+dz*qz)/det;
    if (v<0 || u+v>1) continue;
    const distance=(fx*qx+fy*qy+fz*qz)/det;
    if (distance>0 && distance<=limit && distance<t) {
      t=distance;
      material=data[a+9];
    }
  }
  return {t,material};
}
module.exports={firstHit};
