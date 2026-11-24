/* A seated viewer can be on the other side of a tabletop from a pin.
   Test the short eye-to-pin segment against the already batched furnishings. */
(function () {
  'use strict';
  const local=typeof module==='object' && module.exports;
  const {STRIDE,parts}=local ? require('./mesh.js') : PocketPlaces.mesh;
  const clock=(local ? require('./art.js') : PocketPlaces.art).regions.clock;

  function intersectsBox(origin,delta,lo,hi,end) {
    let start=0;
    for (let axis=0;axis<3;axis++) {
      const d=delta[axis], o=origin[axis];
      if (Math.abs(d)<1e-10) {
        if (o<lo[axis] || o>hi[axis]) return false;
      } else {
        const a=(lo[axis]-o)/d, b=(hi[axis]-o)/d;
        start=Math.max(start,Math.min(a,b)); end=Math.min(end,Math.max(a,b));
        if (end<start) return false;
      }
    }
    return true;
  }
  function hitTriangle(eye,d,v,a,b,c) {
    const ux=v[b]-v[a], uy=v[b+1]-v[a+1], uz=v[b+2]-v[a+2];
    const vx=v[c]-v[a], vy=v[c+1]-v[a+1], vz=v[c+2]-v[a+2];
    const hx=d[1]*vz-d[2]*vy, hy=d[2]*vx-d[0]*vz, hz=d[0]*vy-d[1]*vx;
    const det=ux*hx+uy*hy+uz*hz;
    if (Math.abs(det)<1e-9) return Infinity;
    const x=eye[0]-v[a], y=eye[1]-v[a+1], z=eye[2]-v[a+2];
    const s=(x*hx+y*hy+z*hz)/det;
    if (s<0 || s>1) return Infinity;
    const qx=y*uz-z*uy, qy=z*ux-x*uz, qz=x*uy-y*ux;
    const t=(d[0]*qx+d[1]*qy+d[2]*qz)/det;
    if (t<0 || t+s>1) return Infinity;
    if (v[a+9]>=clock[0] && v[a+9]<=clock[2] && v[a+10]>=clock[1] && v[a+10]<=clock[3]) {
      const uv=k=>(1-s-t)*v[a+k]+s*v[b+k]+t*v[c+k];
      const x=(uv(9)-clock[0])/(clock[2]-clock[0])-.5;
      const y=(uv(10)-clock[1])/(clock[3]-clock[1])-.5;
      if (x*x+y*y>.49*.49) return Infinity;
    }
    const distance=(vx*qx+vy*qy+vz*qz)/det;
    return distance>0 ? distance : Infinity;
  }
  function build(batches) {
    const chunks=[];
    for (const {vertices,indices} of batches) {
      // Consecutive triangles usually belong to a single plank, tile or utensil.
      for (let start=0;start<indices.length;start+=192) {
        const end=Math.min(indices.length,start+192), lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
        for (let i=start;i<end;i++) {
          const p=indices[i]*STRIDE;
          if (vertices[p+13]!==parts.fixed) continue;
          for (let a=0;a<3;a++) { lo[a]=Math.min(lo[a],vertices[p+a]); hi[a]=Math.max(hi[a],vertices[p+a]); }
        }
        if (lo[0]<=hi[0]) chunks.push({vertices,indices,start,end,lo,hi});
      }
    }
    return function visible(eye,target,id) {
      const delta=target.map((x,i)=>x-eye[i]);
      let nearest=1, hit=id;
      for (const {vertices:v,indices,start,end,lo,hi} of chunks) {
        if (!intersectsBox(eye,delta,lo,hi,nearest)) continue;
        for (let i=start;i<end;i+=3) {
          const a=indices[i]*STRIDE;
          if (v[a+13]!==parts.fixed) continue;
          const t=hitTriangle(eye,delta,v,a,indices[i+1]*STRIDE,indices[i+2]*STRIDE);
          if (t<nearest) { nearest=t; hit=v[a+11]; }
        }
      }
      return hit===id;
    };
  }
  const api={build};
  if (local) module.exports=api; else PocketPlaces.sightlines=api;
})();
