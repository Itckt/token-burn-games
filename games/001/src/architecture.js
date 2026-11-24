(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./terrain.js'));
  else root.Atlas.architecture = factory(root.Atlas.math, root.Atlas.mesh, root.Atlas.terrain);
})(globalThis, function (M, G, terrain) {
  'use strict';
  const {MAT} = G;
  const C = {ivory:'#f1dfb9', trim:'#fff0cf', sand:'#d9bf95', brick:'#c6805c', darkBrick:'#9f5944', glass:'#56878a', glass2:'#6d9a9a', frame:'#385859', copper:'#457c73', wood:'#735443'};

  function canopy(world, x, y, z, w, h, d, color) {
    world.mesh.box(x, y, z, w, h, d, color);
    world.shelters.push({x, z, w, d, height: y + h / 2});
  }

  // Facades have local horizontal and outward axes so all four elevations share geometry.
  function facade(world, x, z, nx, nz) {
    const mesh = world.mesh, tangent = [nz, 0, -nx], normal = [nx,0,nz];
    const point = (u, y, out = 0) => [x+nz*u+nx*out, y, z-nx*u+nz*out];
    function piece(u,y,o,w,h,d,color,mat) {
      const p = point(u,y,o);
      mesh.box(p[0], y, p[2], nz ? w : d, h, nz ? d : w, color, mat);
    }
    function sign(u,y,o,w,h,words,style) {
      world.signs.push({center:point(u,y,o), right:tangent, width:w, height:h, words, style});
    }
    return {mesh, point, piece, sign, normal, tangent};
  }
  function faces(world, x, z, w, d) {
    return [[facade(world,x,z+d/2,0,1),w],[facade(world,x+w/2,z,1,0),d],
      [facade(world,x,z-d/2,0,-1),w],[facade(world,x-w/2,z,-1,0),d]];
  }
  // A constant tint per pane keeps its illuminated room coherent after sunset.
  function glassColor(f, u, y, base) {
    const [x, , z] = f.point(u, y);
    return G.tint(base, 1 + .055 * Math.sin(x * 2.89 + z * 1.27 + y * 6.12));
  }
  function ribbon(f, span, y, h, bays, fins = false) {
    const w = (span-.94)/bays;
    f.piece(0,y,.026,span-.64,h+.21,.13,C.frame);
    for (let i=0; i<bays; i++) {
      const u = (i-(bays-1)/2)*w;
      f.piece(u,y,.112,w-.105,h,.065,glassColor(f,u,y,i%3 ? C.glass : C.glass2),MAT.glass);
      f.piece(u,y+h*.26,.154,w-.06,.052,.045,'#adc1ae');
      if (fins) f.piece(u-w*.5,y+.01,.28,.14,h+.28,.62,C.sand);
    }
    f.piece(0,y-h/2-.09,.18,span-.3,.15,.48,C.trim);
  }
  function pierWindows(f,span,y,h,n) {
    const step=span/n;
    for (let i=0;i<n;i++) {
      const u=(i-(n-1)/2)*step, w=Math.min(step*.64,2.35);
      f.piece(u,y,.055,w+.27,h+.29,.18,C.sand);
      f.piece(u,y,.16,w,h,.10,C.frame);
      const color=glassColor(f,u,y,i%3?C.glass:C.glass2);
      for (let j=0;j<2;j++) f.piece(u+(j-.5)*w*.49,y,.225,w*.45,h-.14,.045,color,MAT.glass);
      f.piece(u,y+h*.20,.26,w,.06,.05,'#8ca59a');
      f.piece(u,y-h/2-.1,.19,w+.40,.13,.45,C.trim);
    }
  }
  function arches(world,f,span,count,spring,top,wallColor) {
    const step=span/count, outer=step*.5-.19, r=outer-.18, thickness=.49;
    for(let i=0;i<=count;i++) {
      const u=-span/2+i*step;
      f.piece(u,top/2,0,.38,top,thickness,wallColor,MAT.brick);
      f.piece(u,spring/2,0,.73,spring,thickness+.08,C.ivory);
      f.piece(u,.21,.02,.88,.38,.69,C.sand);
      f.piece(u,spring,0,.88,.18,.70,C.trim);
      const p=f.point(u,0); world.block(p[0],p[2],.75,.75);
    }
    for(let i=0;i<count;i++) {
      const u=-span/2+(i+.5)*step;
      for(let j=0;j<12;j++) {
        const a=Math.PI*(1-j/12), b=Math.PI*(1-(j+1)/12);
        const at=(angle,radius,out) => f.point(u+Math.cos(angle)*radius,spring+Math.sin(angle)*radius,out);
        const p=at(a,outer,.25), q=at(b,outer,.25);
        f.mesh.face([p,q,[q[0],top,q[2]],[p[0],top,p[2]]],wallColor,MAT.brick,f.normal);
        f.mesh.face([at(a,r,.30),at(b,r,.30),at(b,outer,.30),at(a,outer,.30)],j===5||j===6?C.trim:C.ivory,MAT.stone,f.normal);
        f.mesh.face([at(a,r,-.25),at(b,r,-.25),at(b,r,.30),at(a,r,.30)],C.sand,MAT.stone);
        f.mesh.face([at(a,outer,-.25),f.point(u+Math.cos(a)*outer,top,-.25),f.point(u+Math.cos(b)*outer,top,-.25),at(b,outer,-.25)],wallColor,MAT.brick);
      }
    }
    f.piece(0,top+.09,.02,span+.6,.22,.89,C.ivory);
  }
  function library(world) {
    const m=world.mesh, x=-23, z=2, w=19, d=23;
    world.footprint(x,z,w,d,'library');
    world.block(x,z,w-2.2,d-2.2);
    m.box(x,1.68,z,w-2.2,3.34,d-2.2,'#bfaa86');
    for (const [f,span] of faces(world,x,z,w-2.2,d-2.2)) ribbon(f,span,1.62,2.75,Math.round(span/2.4));
    for (const [f,span] of faces(world,x,z,w,d)) {
      const n=Math.ceil(span/4.6);
      for(let i=0;i<n;i++) {
        const u=(i-(n-1)/2)*span/n;
        f.piece(u,1.79,0,.45,3.55,.55,C.sand);
        const p=f.point(u,0); world.block(p[0],p[2],.55,.55);
      }
    }
    canopy(world,x,3.53,z,w+1.8,.4,d+1.8,C.ivory);
    m.box(x,3.82,z,w+.76,.23,d+.76,C.darkBrick);
    m.box(x,6.16,z,w,4.58,d,C.ivory);
    for(const [f,span] of faces(world,x,z,w,d)) {
      ribbon(f,span,4.98,1.42,Math.round(span/1.85),true);
      ribbon(f,span,7.22,1.40,Math.round(span/1.85),true);
      f.piece(0,6.09,.3,span+.60,.31,.79,C.trim);
    }
    m.box(x,8.64,z,w+1.2,.40,d+1.2,C.trim);
    m.box(x,8.90,z,w+.54,.15,d+.54,C.sand);
    m.box(x-.95,9.8,z-1.65,w-2.8,1.8,d-4.5,C.brick,MAT.brick);
    for(const [f,span] of faces(world,x-.95,z-1.65,w-2.8,d-4.5)) ribbon(f,span,9.85,1.05,Math.round(span/2));
    m.box(x-.95,10.83,z-1.65,w-1.25,.32,d-3,C.trim);
    // Terracotta stair core and its inset ventilation slots.
    m.box(x-5.8,5.1,z+8.4,5.5,10.2,6.3,'#c58362',MAT.brick);
    const stair=facade(world,x-5.8,z+11.55,0,1);
    for(let i=0;i<5;i++) stair.piece((i-2)*.61,6.5,.11,.24,4.9,.23,'#865741');
    m.box(x-5.8,10.32,z+8.4,5.85,.26,6.65,C.sand);
    const front=facade(world,x,z+d/2+.94,0,1);
    front.piece(1.9,3.55,-.08,8.2,.74,.26,'#466863');
    front.sign(1.9,3.56,.066,7.4,.53,'JADE  LIBRARY','light');
    world.block(x-5.8,z+8.4,5.5,6.3);
  }
  function arcade(world) {
    const m=world.mesh, x=23.6,z=.3,w=18,d=20;
    world.footprint(x,z,w,d,'arcade');
    world.block(x,z,w-4.6,d-4.6);
    m.box(x,1.86,z,w-4.6,3.7,d-4.6,'#a0674e',MAT.brick);
    for(const [f,span] of faces(world,x,z,w-4.6,d-4.6)) ribbon(f,span,1.60,2.50,Math.round(span/2.9));
    for(const [f,span] of faces(world,x,z,w,d)) arches(world,f,span,Math.round(span/3.5),1.82,3.74,C.brick);
    canopy(world,x,4.02,z,w+.72,.28,d+.72,C.sand);
    m.box(x,5.64,z,w,3.10,d,C.brick,MAT.brick);
    for(const [f,span] of faces(world,x,z,w,d)) {
      pierWindows(f,span,5.72,1.78,Math.round(span/3.5));
      f.piece(0,6.94,.08,span,.12,.22,C.darkBrick);
    }
    m.box(x,7.22,z,w+.7,.35,d+.7,C.trim);
    m.box(x,7.48,z,w+1.08,.18,d+1.08,'#947254');
    m.frustum(x,7.57,z,w+1.16,d+1.16,w-5.6,d-5.6,1.72,'#b97653');
    m.box(x,9.34,z,w-5.44,.16,d-5.44,'#ecd0a0');
    const f=facade(world,x,z+d/2+.5,0,1);
    f.piece(0,4.0,-.03,7.6,.55,.19,'#976145');
    f.sign(0,4.02,.08,7.15,.44,'LANTERN  ARCADE','light');
  }
  function dial(f,y) {
    for (const [o,rad,col] of [[.23,1.55,'#775d47'],[.32,1.45,'#e9c687'],[.37,1.33,'#fcf0ce']]) {
      f.mesh.beam(f.point(0,y,o-.09),f.point(0,y,o),rad,rad,40,col);
    }
    for (let k=0;k<12;k++) {
      const a=k*Math.PI/6, s=Math.sin(a), c=Math.cos(a), w=k%3?.035:.055, inner=k%3?1.12:1.03;
      f.mesh.face([f.point(s*inner-c*w,y+c*inner+s*w,.385),f.point(s*1.23-c*w,y+c*1.23+s*w,.385),
        f.point(s*1.23+c*w,y+c*1.23-s*w,.385),f.point(s*inner+c*w,y+c*inner-s*w,.385)],'#435552',0,f.normal);
    }
    function hand(angle,length,width) {
      const s=Math.sin(angle),c=Math.cos(angle);
      f.mesh.face([f.point(-c*width,y+s*width,.406),f.point(s*length,y+c*length,.406),f.point(c*width,y-s*width,.406),f.point(-s*.20,y-c*.20,.406)],'#344c48',0,f.normal);
    }
    hand(-Math.PI/3,.81,.090); hand(Math.PI/3,1.08,.060);
    f.mesh.beam(f.point(0,y,.408),f.point(0,y,.435),.115,.115,12,'#a1744e');
  }
  function tower(world) {
    const m=world.mesh,x=3.9,z=-22.2;
    // A two-storey cloister forms the termination of the long court.
    const hx=-.5,hz=-26.8,hw=37.5,hd=8.6;
    world.footprint(hx,hz,hw,hd,'hall');
    world.block(hx,hz-.8,hw-.35,hd-1.95);
    m.box(hx,3.3,hz-.8,hw-.35,6.55,hd-1.95,'#c38d65',MAT.brick);
    arches(world,facade(world,hx,hz+hd/2,0,1),hw,12,1.7,3.5,'#d0a57a');
    m.box(hx,4.95,hz,hw,2.72,hd,'#d0a077',MAT.brick);
    for(const [f,span] of faces(world,hx,hz,hw,hd)) pierWindows(f,span,5.00,1.55,Math.round(span/3.15));
    canopy(world,hx,6.49,hz,hw+.8,.35,hd+.8,C.ivory);
    m.frustum(hx,6.65,hz,hw+1.06,hd+1.06,hw-3.4,2.8,1.1,'#63897c');
    world.footprint(x,z,5.6,5.8,'tower');
    world.block(x,z,5.9,6.1);
    m.box(x,.36,z,6.25,.72,6.44,C.sand);
    m.box(x,6.21,z,5.35,11.0,5.49,'#ce8965',MAT.brick);
    for(const [f] of faces(world,x,z,5.35,5.49)) {
      for(const u of [-2.48,2.48]) f.piece(u,6.20,.08,.34,10.92,.24,'#e1ab80');
      for(const u of [-.65,.65]) {
        f.piece(u,7.45,.082,.65,5.56,.19,'#ac7455');
        f.piece(u,7.59,.185,.32,4.83,.09,'#52716a');
      }
      f.piece(0,2.12,.056,2.14,3.04,.16,'#785a44');
      f.piece(0,2.08,.16,1.72,2.76,.09,'#46605a');
    }
    m.box(x,11.76,z,5.81,.34,5.99,C.sand);
    m.box(x,12.03,z,5.99,.20,6.16,C.trim);
    m.box(x,14.20,z,5.32,4.19,5.48,'#d5976f',MAT.brick);
    for(const [f] of faces(world,x,z,5.32,5.48)) {
      for(const u of [-2.43,2.43]) f.piece(u,14.23,.08,.37,4.22,.22,C.ivory);
      dial(f,14.19);
    }
    m.box(x,16.39,z,5.90,.37,6.04,C.trim);
    m.box(x,17.32,z,4.69,1.54,4.83,C.ivory);
    for(const [f] of faces(world,x,z,4.69,4.83)) {
      for(let i=-2;i<=2;i++) f.piece(i*.65,17.33,.05,.37,1.02,.15,'#566c62');
    }
    m.box(x,18.18,z,5.48,.20,5.64,'#a9845e');
    m.box(x,18.39,z,6.14,.24,6.28,'#345c56');
    m.frustum(x,18.50,z,6.24,6.4,3.16,3.32,1.12,'#629487');
    m.frustum(x,19.62,z,3.16,3.32,.51,.53,2.2,'#568779');
    m.beam([x,21.76,z],[x,22.13,z],.34,.20,8,'#b49b62');
    m.beam([x,22.1,z],[x,23.24,z],.076,.022,8,'#826d46');
  }
  function pavilion(world) {
    const m=world.mesh,x=31,z=-25;
    world.surfaces.push(terrain.pavilion);
    world.footprint(x,z,7.5,7.5,'pavilion');
    const floor = terrain.pavilion.high;
    m.box(x,floor/2,z,7.4,floor,7.4,'#d9c49f');
    for(const dx of [-3,3]) for(const dz of [-3,3]) {
      m.box(x+dx,1.66,z+dz,.31,3.22,.31,'#966949');
      world.block(x+dx,z+dz,.31,.31);
    }
    m.box(x,3.31,z,7,.31,7,'#aa7e56');
    m.frustum(x,3.45,z,8.45,8.45,3.15,3.15,1.47,C.copper);
    world.shelters.push({x,z,w:8.45,d:8.45,height:3.45});
    m.frustum(x,4.92,z,3.15,3.15,.46,.46,1.10,'#5d8e79');
    m.beam([x,5.99,z],[x,6.40,z],.17,.02,8,'#9e8156');
  }
  function terrace(world) {
    const m = world.mesh, {ramp, deck, heightOn} = terrain;
    const boards = ['#bd916a', '#c69e75', '#b68a62', '#c39971', '#c79c74'];
    for (const surface of [ramp, deck]) {
      world.surfaces.push(surface);
      const {west, east, north, south} = surface;
      const point = (x, z) => [x, heightOn(surface, x), z];
      const count = Math.ceil((east-west) / .32);
      for (let i = 0; i < count; i++) {
        const a = M.mix(west, east, i/count), b = M.mix(west, east, (i+1)/count);
        m.face([point(a,south),point(b,south),point(b,north),point(a,north)], boards[i % boards.length], MAT.timber);
      }
      for (const z of [north, south]) {
        m.face([[west,-.05,z],[east,-.05,z],point(east,z),point(west,z)], C.brick, MAT.brick, [0,0,z===north?-1:1]);
      }
      for (const x of [west, east]) {
        // Only the widened landing has an exposed return at the top of the ramp.
        const endZ = x === deck.west ? ramp.north : south;
        if (surface === ramp && x === ramp.east) continue;
        m.face([[x,-.05,north],[x,-.05,endZ],point(x,endZ),point(x,north)], C.brick, MAT.brick, [x===west?-1:1,0,0]);
      }
    }
    function railing(surface, x0, z0, x1, z1) {
      const at = (t, lift) => {
        const x = M.mix(x0,x1,t);
        return [x, heightOn(surface,x) + lift, M.mix(z0,z1,t)];
      };
      const bays = Math.ceil(Math.hypot(x1-x0,z1-z0)/1.7);
      for (let i=0; i<=bays; i++) m.beam(at(i/bays,0),at(i/bays,1.04),.055,.05,6,C.frame);
      for (const [lift,radius,color] of [[.38,.021,C.frame],[.68,.021,C.frame],[1.05,.066,'#b88555']]) {
        m.beam(at(0,lift),at(1,lift),radius,radius,8,color);
      }
      world.block((x0+x1)/2,(z0+z1)/2,Math.abs(x1-x0)+.13,Math.abs(z1-z0)+.13);
    }
    for (const surface of [ramp, deck]) {
      for (const z of [surface.north, surface.south]) railing(surface,surface.west,z,surface.east,z);
    }
    railing(deck,deck.east,deck.north,deck.east,deck.south);
    railing(deck,deck.west,deck.north,deck.west,ramp.north);

    const x=34.7, z=18.5, y=deck.high;
    m.frustum(x,y,z,1.65,1.52,1.28,1.18,.59,C.ivory);
    m.beam([x,y+.58,z],[x+.16,y+1.55,z],.17,.09,8,C.frame);
    world.block(x,z,1.65,1.52);
    const tip=[x+.64,y+5.33,z-.45], right=[x+1.69,y+3.37,z+.13];
    const foot=[x+.16,y+1.48,z], left=[x-1.41,y+3.51,z+.22], fold=[x+.24,y+3.65,z+.8];
    const edges = [tip,right,foot,left], patina = ['#509087','#bb8658','#d4ac74','#699d8a'];
    for (let i=0; i<4; i++) {
      const a=edges[i], b=edges[(i+1)%4];
      m.face([a,b,fold],patina[i],MAT.stone,[0,0,1]);
      m.face([b,a,[x+.13,y+3.46,z-.34]],patina[(i+1)%4],MAT.stone,[0,0,-1]);
      m.beam(a,b,.032,.032,6,'#c59a66');
    }
    for (const side of [-1,0,1]) m.box(x+side*.41,y+.43,z+.68,.21,.055,.03,'#f7cd86',MAT.light);
    const sign = facade(world,14.5,ramp.south+.08,0,1);
    const signY = heightOn(ramp,14.5)+.69;
    sign.piece(0,signY,0,2.1,.43,.06,C.frame);
    sign.sign(0,signY,.034,1.94,.32,'Kite Terrace  →','light');
  }
  function studio(world,x,z,w,d) {
    const m=world.mesh;
    world.footprint(x,z,w,d,'studio'); world.block(x,z,w,d);
    m.box(x,3.54,z,w,7.08,d,'#d7b997');
    for(const [f,span] of faces(world,x,z,w,d)) {
      for(const y of [1.67,4.93]) ribbon(f,span,y,1.96,Math.max(3,Math.round(span/2.4)));
      f.piece(0,3.35,.16,span+.42,.28,.46,C.ivory);
    }
    m.box(x,7.22,z,w+.78,.29,d+.78,C.trim);
  }
  function build(world) {
    world.shelters ??= [];
    world.surfaces ??= [];
    library(world); arcade(world); tower(world); pavilion(world); terrace(world);
    studio(world,-34,-23,11.1,14); studio(world,33,31.7,12.2,12.8);
    studio(world,-28.4,35.1,14,9.3);
  }
  return {facade, build};
});
