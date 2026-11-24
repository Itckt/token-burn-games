/* Each camera sits above an actual cushion or stool, at a customer's eye height. */
(function () {
  'use strict';
  const local=typeof module==='object' && module.exports;
  const M=local ? require('./math.js') : PocketPlaces.math;
  const sim=local ? require('./simulation.js') : PocketPlaces.sim;
  const places=[
    {id:'booth', name:'Window booth', eye:[-2.95,1.61,2.52], look:[-2.30,1.36,1.26]},
    {id:'counter', name:'Counter stool', eye:[1.47,1.68,-.85], look:[1.25,1.91,-2.42]},
    {id:'table', name:'Tea table', eye:[1.20,1.58,2.75], look:[1.34,1.37,1.50]}
  ];
  function sit(id) {
    const place=places.find(p=>p.id===id);
    if (!place) return null;
    const [x,y,z]=M.unit(M.sub(place.eye,place.look));
    const yaw=Math.atan2(x,z), pitch=Math.asin(y);
    return {...sim.createView(false),place,yaw,targetYaw:yaw,pitch,targetPitch:pitch};
  }
  function turn(seat,dx,dy) {
    seat.targetYaw+=dx*.006;
    seat.targetPitch=M.clamp(seat.targetPitch-dy*.005,-1.15,1.15);
  }
  function camera(seat,width,height) {
    const aspect=Math.max(1,width)/Math.max(1,height);
    const flat=Math.cos(seat.pitch), eye=seat.place.eye;
    const direction=[Math.sin(seat.yaw)*flat,Math.sin(seat.pitch),Math.cos(seat.yaw)*flat];
    const view=M.lookAt(eye,M.sub(eye,direction));
    // Keep a useful horizontal field of view on an upright phone.
    const fov=2*Math.atan(.62/(Math.min(1,aspect)*seat.zoom));
    const projection=M.perspective(fov,aspect,.065,36);
    return {matrix:M.multiply(projection,view),eye,direction,right:[view[0],view[4],view[8]],seated:true};
  }
  const api={places,sit,turn,camera};
  if (local) module.exports=api; else PocketPlaces.seating=api;
})();
