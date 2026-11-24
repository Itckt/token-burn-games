/* A single walkable aisle joins three resting spots. Distance along it also
   identifies the cat's position when a new call interrupts a walk. */
(function () {
  'use strict';
  const local=typeof module==='object' && module.exports;
  const M=local ? require('./math.js') : PocketPlaces.math;
  const {parts}=local ? require('./mesh.js') : PocketPlaces.mesh;
  const id=6, home=[3.43,2.51], homeYaw=.35;
  const waypoints=[home,[3.59,1.70],[3.65,.60],[3.35,-.10],[2.63,-.23],
    [1.78,-.29],[.83,-.18],[-.15,-.08],[-.87,.24],[-.97,1.51]];
  const stops=[
    {id:'mat',name:'Front mat',node:0,yaw:homeYaw,caption:'Back on the mat. All four paws are off duty.'},
    {id:'counter',name:'Counter end',node:3,yaw:-.45,caption:'Keeping one ear on the till and one on the pastry tray.'},
    {id:'booth',name:'Booth aisle',node:9,yaw:.91,caption:'The window regular has arrived. A table for one, plus tail.'}
  ];
  const path=[];
  function append(x,z) {
    const prev=path.at(-1);
    path.push({x,z,s:prev ? prev.s+Math.hypot(x-prev.x,z-prev.z) : 0});
  }
  // Sample a Catmull–Rom curve once. Walking and turning use metres and seconds.
  append(...home);
  const distances=[0];
  for (let i=0;i<waypoints.length-1;i++) {
    const [a,b,c,d]=[-1,0,1,2].map(k=>waypoints[M.clamp(i+k,0,waypoints.length-1)]);
    for (let j=1;j<=14;j++) {
      const t=j/14;
      append(...b.map((v,k)=>v+.5*t*((c[k]-a[k])+t*((2*a[k]-5*v+4*c[k]-d[k])+
        t*(-a[k]+3*v-3*c[k]+d[k])))));
    }
    distances.push(path.at(-1).s);
  }
  function sample(s) {
    let low=0, high=path.length-1;
    while (high-low>1) {
      const mid=(low+high)>>1;
      if (path[mid].s<=s) low=mid; else high=mid;
    }
    const a=path[low], b=path[high], t=M.clamp((s-a.s)/(b.s-a.s),0,1);
    return [a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t];
  }
  function heading(s,sign) {
    const [x,z]=sample(s-.035), [nextX,nextZ]=sample(s+.035);
    return Math.atan2(sign*(nextX-x),sign*(nextZ-z));
  }
  function arc(from,to) { return Math.atan2(Math.sin(to-from),Math.cos(to-from)); }
  function create() {
    return {x:home[0],z:home[1],yaw:homeYaw,s:0,lift:0,stride:0,destination:stops[0],trip:null};
  }
  function settle(cat) {
    const stop=cat.destination;
    cat.s=distances[stop.node];
    [cat.x,cat.z]=sample(cat.s);
    cat.yaw=stop.yaw; cat.lift=cat.stride=0; cat.trip=null;
  }
  const speed=1.35, turnRate=4.4;
  function call(cat,place,instant=false) {
    const stop=stops.find(p=>p.id===place);
    if (!stop) return;
    if (instant) { cat.destination=stop; settle(cat); return; }
    if (stop===cat.destination) return;
    cat.destination=stop;
    const end=distances[stop.node], gap=end-cat.s, sign=Math.sign(gap);
    const departure=sign ? heading(cat.s,sign) : cat.yaw;
    const arrival=sign ? heading(end,sign) : cat.yaw;
    const turnOut=arc(cat.yaw,departure), turnIn=arc(arrival,stop.yaw);
    cat.trip={start:cat.s,sign,startYaw:cat.yaw,turnOut,arrival,turnIn,elapsed:0,
      turnTime:Math.abs(turnOut)/turnRate,walkTime:Math.abs(gap)/speed,restTime:Math.abs(turnIn)/turnRate,
      startLift:cat.lift,startStride:cat.stride};
  }
  function step(cat,seconds) {
    const trip=cat.trip;
    if (!trip || !Number.isFinite(seconds) || seconds<=0) return;
    trip.elapsed+=seconds;
    const walk=trip.elapsed-trip.turnTime;
    if (walk<0) {
      const t=trip.elapsed/trip.turnTime;
      cat.yaw=trip.startYaw+trip.turnOut*t;
      cat.lift=trip.startLift*(1-t); cat.stride=trip.startStride*(1-t);
    } else if (walk<trip.walkTime) {
      const distance=speed*walk;
      cat.s=trip.start+trip.sign*distance;
      [cat.x,cat.z]=sample(cat.s);
      cat.yaw=heading(cat.s,trip.sign);
      const weight=Math.min(1,walk*7,(trip.walkTime-walk)*7);
      const beat=Math.sin(distance*13);
      cat.lift=weight*(.039+.016*beat*beat);
      cat.stride=weight*.071*beat;
    } else {
      const rest=walk-trip.walkTime;
      if (rest>=trip.restTime) { settle(cat); return; }
      cat.s=distances[cat.destination.node];
      [cat.x,cat.z]=sample(cat.s);
      cat.lift=cat.stride=0;
      cat.yaw=trip.arrival+trip.turnIn*(rest/trip.restTime);
    }
  }
  function point(cat,original) {
    const a=cat.yaw-homeYaw, c=Math.cos(a), s=Math.sin(a);
    const dx=original[0]-home[0], dz=original[2]-home[1];
    return [cat.x+c*dx+s*dz,original[1]+cat.lift,cat.z-s*dx+c*dz];
  }

  function build({group,oval,pipe,put}) {
    group(home[0],.047,home[1],homeYaw,0,()=>{
      oval(0,.030,-.025,.473,.035,.483,'#bb9770');
    });
    group(home[0],.047,home[1],homeYaw,id,()=>{
      oval(0,.211,-.059,.294,.208,.356,'#cf9659');
      for (const side of [-1,1]) {
        const left=side<0 ? parts.catLeft : parts.catRight;
        oval(side*.124,.084,.241,.097,.064,.118,'#f0d9af',{part:left});
        oval(side*.163,.077,-.213,.099,.058,.125,'#c8945c',
          {part:side<0 ? parts.catRight : parts.catLeft});
      }
      pipe([[-.18,.16,-.20],[-.321,.119,-.22],[-.367,.089,-.089],[-.348,.086,.068],
        [-.279,.075,.16],[-.226,.078,.217]],.066,'#be8049');
      oval(0,.386,.157,.246,.218,.207,'#dfa866');
      function ear(side) {
        const a=[side*.231,.462,.137], b=[side*.092,.524,.181], tip=[side*.210,.694,.116], back=[side*.170,.476,.021];
        const shape={positions:[],normals:[],uvs:[],indices:[]};
        for (const face of [[a,b,tip],[tip,b,back],[a,tip,back],[a,back,b]]) {
          const [p,q,r]=side>0 ? face.reverse() : face;
          const n=M.unit(M.cross(M.sub(q,p),M.sub(r,p))), start=shape.positions.length/3;
          for (const v of [p,q,r]) { shape.positions.push(...v); shape.normals.push(...n); shape.uvs.push(0,0); }
          shape.indices.push(start,start+1,start+2);
        }
        put(shape,0,0,0,'#c48853');
        pipe([[side*.190,.559,.153],[side*.201,.623,.141]],.017,'#d9a188');
      }
      for (const s of [-1,1]) {
        ear(s);
        oval(s*.063,.343,.327,.083,.063,.043,'#f4deb5');
        pipe([[s*.072,.406,.344],[s*.110,.415,.335],[s*.152,.397,.314]],.012,'#353e35',null,7);
        for (let k=0;k<2;k++) pipe([[s*.112,.345-k*.023,.343],[s*.254,.357-k*.049,.322]],.005,'#353e35',null,5);
        pipe([[s*.11,.538,.240],[s*.100,.501,.289]],.016,'#a97347');
      }
      oval(0,.367,.369,.031,.020,.017,'#9e705c');
      for (let k=0;k<3;k++) {
        const z=-.27+k*.094;
        pipe([[-.158,.348,z],[-.081,.389,z+.022],[0,.410,z+.027],[.094,.389,z+.019]],.018,'#b47c47');
      }
    },parts.catBody);
  }
  const api={id,home,homeYaw,stops,create,call,step,settle,point,build};
  if (local) module.exports=api; else PocketPlaces.shopCat=api;
})();
