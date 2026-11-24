(() => {
  "use strict";
  const M=typeof module === "object" && module.exports ? require("./math.js") : Slipwake.math;
  const halfW=13.7, halfD=8.15, radius=0.4;
  // These dimensions drive the meshes, collision map and radar.
  const blocks=[
    {kind:"cargo", x:-5.95,z:-3.45,w:4.25,d:1.75,h:1.65,paint:"green"},
    {kind:"cargo", x:5.95,z:3.45,w:4.25,d:1.75,h:1.65,paint:"gold"},
    {kind:"vent", x:-3.05,z:2.72,w:2.62,d:1.7,h:1.14},
    {kind:"vent", x:3.05,z:-2.72,w:2.62,d:1.7,h:1.14},
    {kind:"crate", x:-8.6,z:4.8,w:1.96,d:1.85,h:1.58},
    {kind:"crate", x:8.6,z:-4.8,w:1.96,d:1.85,h:1.58},
    {kind:"case", x:-7.0,z:5.10,w:1.08,d:1.1,h:0.98},
    {kind:"case", x:7.0,z:-5.10,w:1.08,d:1.1,h:0.98},
    {kind:"barrier", x:-0.75,z:-5.98,w:3.45,d:0.84,h:0.94},
    {kind:"barrier", x:0.75,z:5.98,w:3.45,d:0.84,h:0.94}
  ];
  const homes=[
    [[-11.4,0],[-10.85,-4.6],[-10.9,4.4]],
    [[11.4,0],[10.85,4.6],[10.9,-4.4]]
  ];
  const opening=[[-5.3,0.55],[-8.95,-2.0],[-3.65,5.15],[5.3,-0.55],[8.95,2.0],[3.65,-5.15]];
  function walkable(x,z,r=radius) {
    return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x)<=halfW-r && Math.abs(z)<=halfD-r &&
      !blocks.some(b => Math.abs(x-b.x)<b.w/2+r && Math.abs(z-b.z)<b.d/2+r);
  }
  function clearLine(x,z,bx,bz,padding=0) {
    return blocks.every(b => M.segmentBox(x,z,bx-x,bz-z,b,padding) === Infinity);
  }
  // First solid contact along a finite flight. A null block denotes the deck edge.
  function firstSolid(x,z,dx,dz,padding,skip=null) {
    const edgeX = dx ? (Math.sign(dx)*(halfW-padding)-x)/dx : Infinity;
    const edgeZ = dz ? (Math.sign(dz)*(halfD-padding)-z)/dz : Infinity;
    const edge = Math.min(edgeX,edgeZ);
    let fraction = edge <= 1 ? Math.max(0,edge) : Infinity, block = null;
    for (const obstacle of blocks) {
      if (obstacle === skip) continue;
      const t = M.segmentBox(x,z,dx,dz,obstacle,padding);
      if (t < fraction) { fraction = t; block = obstacle; }
    }
    return {fraction,block};
  }
  function move(actor,dx,dz,r=radius) {
    // Sweep each axis to preserve sliding along a face and prevent fast dashes tunnelling.
    function axis(key, other, size, depth, bound, delta) {
      const start=actor[key];
      let end=M.clamp(start+delta,-bound+r,bound-r);
      for (const b of blocks) {
        if (Math.abs(actor[other]-b[other])>=b[depth]/2+r-1e-7) continue;
        const low=b[key]-b[size]/2-r, high=b[key]+b[size]/2+r;
        if (delta>0 && start<=low+1e-7) end=Math.min(end,low);
        if (delta<0 && start>=high-1e-7) end=Math.max(end,high);
      }
      actor[key]=end;
    }
    axis("x","z","w","d",halfW,dx);
    axis("z","x","d","w",halfD,dz);
  }
  // A persistent four-neighbour grid is shared by all five bots.
  const cell=0.72, cols=37, rows=22;
  const grid=Array.from({length:cols*rows},(_,i)=>{
    const x=(i%cols-(cols-1)/2)*cell, z=(Math.floor(i/cols)-(rows-1)/2)*cell;
    return {x,z,open:walkable(x,z,radius+0.09),edges:[]};
  });
  grid.forEach((p,i)=>{
    if (!p.open) return;
    for (const j of [i-1,i+1,i-cols,i+cols]) {
      const q=grid[j];
      if (q && q.open && Math.hypot(p.x-q.x,p.z-q.z)<cell+0.01 && clearLine(p.x,p.z,q.x,q.z,radius+0.02)) p.edges.push(j);
    }
  });
  function nearest(x,z) {
    let best=-1, distance=Infinity;
    grid.forEach((p,i)=>{
      const d=(p.x-x)**2+(p.z-z)**2;
      if (p.open && d<distance && clearLine(x,z,p.x,p.z,radius-0.005)) { distance=d; best=i; }
    });
    return best;
  }
  function route(x,z,bx,bz) {
    if (!walkable(x,z,radius-1e-6) || !walkable(bx,bz,radius-1e-6)) return [];
    if (clearLine(x,z,bx,bz,radius+0.025)) return [{x:bx,z:bz}];
    const start=nearest(x,z), goal=nearest(bx,bz);
    if (start<0 || goal<0) return [];
    const parent=new Int16Array(grid.length).fill(-1), queue=[start];
    parent[start]=start;
    for (let head=0; head<queue.length && parent[goal]<0; head++) {
      const i=queue[head];
      for (const j of grid[i].edges) if (parent[j]<0) { parent[j]=i; queue.push(j); }
    }
    if (parent[goal]<0) return [];
    const path=[];
    for (let i=goal; ; i=parent[i]) {
      path.push({x:grid[i].x,z:grid[i].z});
      if (i===start) break;
    }
    path.reverse();
    path.push({x:bx,z:bz});
    return path;
  }
  const api={halfW,halfD,radius,blocks,homes,opening,walkable,clearLine,firstSolid,move,route};
  if (typeof module === "object" && module.exports) module.exports=api;
  else (globalThis.Slipwake ||= {}).arena=api;
})();
