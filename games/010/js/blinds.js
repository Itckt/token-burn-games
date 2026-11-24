/* A linen blind unwinds from each window roller. The weighted hem stays level. */
(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const {parts} = local ? require('./mesh.js') : PocketPlaces.mesh;
  const settings = [
    {name:'Raised', drop:0}, {name:'Halfway', drop:.5}, {name:'Lowered', drop:1}
  ];
  const top = 2.90, valance = .102, travel = 1.26;
  function build({group,cyl,box,panel}) {
    group(0,0,.286,0,2,()=>{
      for (const x of [-.92,.92]) box(x,top+.013,-.014,.058,.105,.13,'#8d7754');
      cyl(0,top,0,.049,.049,1.88,'#d7c9a0',12,{rz:Math.PI/2});
      panel(0,top-valance/2,.047,1.79,valance,'#ffffff','blind',{part:parts.blindCloth});
      const hem = top-valance;
      cyl(0,hem,.044,.022,.022,1.82,'#a58452',10,{rz:Math.PI/2,part:parts.blindHem});
      box(.63,hem-.039,.048,.043,.083,.015,'#e7c38c',0,{part:parts.blindHem});
    });
  }
  const api = {settings, top, valance, travel, build};
  if (local) module.exports=api; else PocketPlaces.blinds=api;
})();
