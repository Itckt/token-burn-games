(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./architecture.js'));
  else root.Atlas.moonPool = factory(root.Atlas.math, root.Atlas.mesh, root.Atlas.architecture);
})(globalThis, function (M, G, architecture) {
  'use strict';
  const gate = {x:-26, y:1.42, z:24, inner:1.96, outer:2.52, depth:.74};
  const basinWidth = 11.6, basinDepth = 3.25, crossingWidth = 2.7;
  const waterY = .115;
  const stones = ['#c58a64','#cf9670','#bd805d','#d39c74','#c98d65'];

  function buildGate(mesh) {
    const {x,y,z,inner,outer,depth} = gate;
    // Build individual voussoirs on either side of the open throat. The foot of
    // the circle disappears into the coping, leaving the whole causeway level.
    const at = (angle, radius, side) => [x+side*depth/2, y+Math.cos(angle)*radius, z+Math.sin(angle)*radius];
    const count = 25, step = M.TAU/count;
    for (let i=0; i<count; i++) {
      const angle = i*step, a = angle-step/2+.003, b = angle+step/2-.003;
      const key = i === 0, rim = key ? outer+.085 : outer;
      const color = key ? '#77a396' : stones[i % stones.length];
      for (const side of [-1,1]) {
        mesh.face([at(a,inner,side),at(b,inner,side),at(b,rim,side),at(a,rim,side)],color,0,[side,0,0]);
        mesh.face([at(a,inner,side*1.006),at(b,inner,side*1.006),
          at(b,inner+.075,side*1.006),at(a,inner+.075,side*1.006)],'#ebc294',0,[side,0,0]);
      }
      const out = [0,Math.cos(angle),Math.sin(angle)];
      mesh.face([at(a,rim,-1),at(b,rim,-1),at(b,rim,1),at(a,rim,1)],color,0,out);
      mesh.face([at(a,inner,1),at(b,inner,1),at(b,inner,-1),at(a,inner,-1)],'#b78261',0,M.scale(out,-1));
      for (const end of [a,b]) {
        mesh.face([at(end,inner,-1),at(end,inner,1),at(end,rim,1),at(end,rim,-1)],'#9b745d');
      }
    }
  }

  function reeds(mesh, x, z, rng) {
    for (let i=0; i<12; i++) {
      const px=x+(rng()-.5)*.85, pz=z+(rng()-.5)*.64;
      const a=rng()*M.TAU, h=.42+rng()*.68, lean=.13+rng()*.32;
      const tip=[px+Math.sin(a)*lean,waterY+h,pz+Math.cos(a)*lean];
      const edge=[px+.07*Math.cos(a),waterY+h*.32,pz-.07*Math.sin(a)];
      const mid=[px+.04*Math.sin(a),waterY+h*.46,pz+.04*Math.cos(a)];
      mesh.face([[px,waterY,pz],edge,tip],'#849767',G.MAT.leaf);
      mesh.face([[px,waterY,pz],mid,tip],'#577c65',G.MAT.leaf);
      if (i%4 === 0) {
        mesh.beam([px,waterY,pz],tip,.019,.014,5,'#77845e');
        mesh.beam(tip,[tip[0]+.018,tip[1]+.18,tip[2]],.038,.029,6,'#a1754c');
      }
    }
  }
  function build(world) {
    const m=world.mesh, {x,z}=gate, rng=M.random(684);
    world.pools = [];
    for (const side of [-1,1]) {
      const cz=z+side*(crossingWidth+basinDepth)/2;
      world.pools.push({x,z:cz,w:basinWidth,d:basinDepth});
      world.block(x,cz,basinWidth,basinDepth);
      m.box(x,.035,cz,basinWidth,.07,basinDepth,'#79897a');
      const w=basinWidth/2-.18, d=basinDepth/2-.18;
      m.face([[x-w,waterY,cz+d],[x+w,waterY,cz+d],[x+w,waterY,cz-d],[x-w,waterY,cz-d]],'#42847c',G.MAT.water);
      for (const end of [-1,1]) {
        m.box(x,.14,cz+end*(d+.09),basinWidth,.28,.18,'#d6c6a8');
        m.box(x+end*(w+.09),.14,cz,.18,.28,2*d,'#dbceb2');
      }
      for (const offset of [-4.4,1.4,4.65]) reeds(m,x+offset,cz+side*(.44+rng()*.5),rng);
      for (let i=0; i<13; i++) {
        const px=x+(rng()-.5)*(basinWidth-1.2), pz=cz+(rng()-.5)*(basinDepth-.7);
        const radius=.15+rng()*.16, phase=rng()*M.TAU, points=[[px,waterY+.013,pz]];
        for (let j=0; j<=9; j++) {
          const a=phase+j*(M.TAU-.43)/9;
          points.push([px+Math.cos(a)*radius,waterY+.013,pz+Math.sin(a)*radius*.84]);
        }
        m.face(points,i%2 ? '#8ba781' : '#72977b',G.MAT.leaf,[0,1,0]);
      }
    }
    world.paths.push({x,z,w:basinWidth+1,d:crossingWidth});
    const slabs=10, width=basinWidth/slabs;
    for (let i=0; i<slabs; i++) {
      m.box(x-basinWidth/2+(i+.5)*width,.021,z,width-.023,.051,crossingWidth,
        i%3 ? '#d5c6aa' : '#dfcfaf',G.MAT.stone);
    }
    buildGate(m);
    const plaque=architecture.facade(world,x+basinWidth/2-.09,z-2.72,1,0);
    plaque.piece(0,.52,0,2.1,.49,.16,'#406b65');
    plaque.sign(0,.53,.084,1.92,.29,'Moon Gate Pool','light');
    // Small glazed guides pick out both banks at night.
    for (const dx of [-4.9,4.9]) for (const dz of [-1.44,1.44]) {
      m.box(x+dx,.303,z+dz,.51,.05,.12,'#f8d69a',G.MAT.light);
    }
  }
  return {gate, waterY, build};
});
