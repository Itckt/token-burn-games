/* The two pieces share a continuous crust print until the cook separates them. */
(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const {parts} = local ? require('./mesh.js') : PocketPlaces.mesh;
  const id = 9, origin = [.756,1.083,1.414], yaw = -.20;
  const finishes = ['Butter only','Golden syrup','Condensed milk'];
  const cuts = ['Whole','Triangles'];
  const orders = [
    {name:'Window regular', cut:'Triangles', finish:'Golden syrup', receipt:'Two corners for dipping. The regular has a system.'},
    {name:'After the seminar', cut:'Whole', finish:'Condensed milk', receipt:'One very sweet square for the walk back to campus.'},
    {name:'Breakfast for two', cut:'Triangles', finish:'Butter only', receipt:'Two forks, two halves. The corner with the butter goes first.'}
  ];
  function fresh(order = 0) { return {order, cut:'Whole', finish:'Butter only', served:false}; }
  function choose(plate, field, value) {
    const options = field === 'cut' ? cuts : field === 'finish' ? finishes : [];
    if (plate.served || !options.includes(value) || plate[field] === value) return plate;
    return {...plate, [field]:value};
  }
  function serve(plate) {
    const order = orders[plate.order];
    if (plate.served || plate.cut !== order.cut || plate.finish !== order.finish) return plate;
    return {...plate, served:true};
  }
  function next(plate) { return plate.served ? fresh((plate.order+1)%orders.length) : plate; }

  const halfWidth = .204, radius = .039;
  // Half a rounded square, cut from corner to corner along x + z = 0.
  function half(sign) {
    const h = halfWidth, c = h-radius, rim = [];
    for (const [cx,cz,from,to] of [[c,-c,-45,0],[c,c,0,90],[-c,c,90,135]]) {
      for (let angle=from; angle<=to; angle+=22.5) {
        const a = angle*Math.PI/180;
        rim.push([sign*(cx+radius*Math.cos(a)), sign*(cz+radius*Math.sin(a))]);
      }
    }
    const mesh = {positions:[], normals:[], uvs:[], indices:[]};
    function vertex(x,y,z,n,u,v) {
      mesh.positions.push(x,y,z); mesh.normals.push(...n); mesh.uvs.push(u,v);
      return mesh.uvs.length/2-1;
    }
    const base = .045, top = .169;
    for (const [y,up] of [[top,1],[base,-1]]) {
      const start = mesh.uvs.length/2;
      for (const [x,z] of rim) vertex(x,y,z,[0,up,0],.5+x/(2*h),(.5+z/(2*h))*.78);
      for (let i=1; i<rim.length-1; i++) {
        if (up>0) mesh.indices.push(start,start+i+1,start+i);
        else mesh.indices.push(start,start+i,start+i+1);
      }
    }
    rim.forEach(([x,z],i)=>{
      const [xx,zz] = rim[(i+1)%rim.length], length = Math.hypot(xx-x,zz-z);
      const n = [(zz-z)/length,0,(x-xx)/length], cut = i === rim.length-1;
      const v = cut ? .91 : .79, start = mesh.uvs.length/2;
      vertex(x,base,z,n,0,v+.085); vertex(x,top,z,n,0,v);
      vertex(xx,top,zz,n,Math.min(1,length/(2*h)),v);
      vertex(xx,base,zz,n,Math.min(1,length/(2*h)),v+.085);
      mesh.indices.push(start,start+1,start+2,start,start+2,start+3);
    });
    return mesh;
  }
  const separation = .039;
  const travel = [separation*(Math.cos(yaw)+Math.sin(yaw)),separation*(Math.cos(yaw)-Math.sin(yaw))];
  function build({group,saucer,put,slab}) {
    group(...origin,yaw,id,()=>{
      saucer(0,0,0,.349);
      put(half(1),0,0,0,'#ffffff',{part:parts.toastNear, print:'toastPlain'});
      put(half(-1),0,0,0,'#ffffff',{part:parts.toastFar, print:'toastPlain'});
      slab(.076,.188,.059,.112,.038,.086,.015,'#f8d477',.008,{ry:.22,part:parts.toastNear});
    });
  }
  const api = {id, origin, cuts, finishes, orders, fresh, choose, serve, next, half, travel, build};
  if (local) module.exports=api; else PocketPlaces.toast=api;
})();
