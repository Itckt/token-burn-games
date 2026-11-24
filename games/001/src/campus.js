(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./architecture.js'), require('./places.js'), require('./moon-pool.js'), require('./terrain.js'));
  else root.Atlas.campus = factory(root.Atlas.math, root.Atlas.mesh, root.Atlas.architecture, root.Atlas.places, root.Atlas.moonPool, root.Atlas.terrain);
})(globalThis, function (M, G, A, places, moonPool, terrain) {
  'use strict';
  const {MAT} = G;
  const bounds = Object.freeze({west:-42,east:43,north:-39,south:45});
  const treeColors=['#779849','#648e51','#93a854','#7a9c60','#849d4a','#688e57'];

  function ground(world) {
    const m=world.mesh;
    function flat(x,z,w,d,y,c,mat) {
      m.face([[x-w/2,y,z+d/2],[x+w/2,y,z+d/2],[x+w/2,y,z-d/2],[x-w/2,y,z-d/2]],c,mat);
    }
    flat(0,0,980,980,-.09,'#a3b487',MAT.grass);
    flat(.5,2.3,88.6,87.2,-.025,'#d5c9af',MAT.paving);
    flat(.5,3.2,13,80.8,-.005,'#e0d3b8',MAT.paving);
    for(const x of [-6.04,-5.56,6.56,7.04]) flat(x,3.2,Math.abs(x)<6||x===6.56?.12:.28,80.8,.007,'#bc9272',MAT.brick);
    for(const z of [-14.8,-12.9,5.7,7.6,22.8,24.2,38.5]) {
      flat(.5,z,87,.23,.014,'#c9a98b',MAT.brick);
    }
    // A radial stone inlay at the junction is flush with the walking surface.
    for(let i=0;i<32;i++) {
      const a=i*M.TAU/32,b=(i+1)*M.TAU/32;
      const point=(t,r) => [.5+Math.cos(t)*r,.022,-5.2+Math.sin(t)*r];
      m.face([point(a,3.55),point(b,3.55),point(b,3.39),point(a,3.39)],'#aa9274',0,[0,1,0]);
      if(i%4===0) m.face([point(a-.045,3.31),point(a+.045,3.31),point(a,i%8===0?1.82:2.62)],'#ad997c',0,[0,1,0]);
    }
    world.paths.push({x:.5,z:3,w:12.9,d:81},{x:0,z:6.7,w:86,d:5},{x:0,z:-14.0,w:86,d:5},{x:0,z:23.4,w:86,d:5});
  }
  function landscape(world,rng) {
    const m=world.mesh;
    // Three independently triangulated ridgelines surround the campus in every direction.
    for(let layer=0;layer<3;layer++) {
      const n=58,rad=[127,188,251][layer], rings=[[],[],[]];
      const palette=['#73947b','#82a396','#94aea6'];
      for(let i=0;i<n;i++) {
        const a=i*M.TAU/n;
        const wave=Math.sin(3*a+layer*1.7)*.20+Math.cos(7*a+layer*.8)*.14+Math.sin(13*a+layer)*.09;
        const h=rad*(.19+layer*.047+wave*.31+(rng()-.5)*.064);
        const peak=rad*(1+rng()*.045);
        for(let k=0;k<3;k++) {
          const angle=a+(k===1?.024:0),r=peak*[.70,.87,1][k];
          rings[k].push([Math.sin(angle)*r,k===0?-1.4:k===1?h*.42:h,-Math.cos(angle)*r]);
        }
      }
      for(let k=0;k<2;k++) for(let i=0;i<n;i++) {
        const j=(i+1)%n;
        for(const p of [[rings[k][i],rings[k+1][i],rings[k+1][j]],[rings[k][i],rings[k+1][j],rings[k][j]]]) {
          m.face(p,G.tint(palette[layer],.94+rng()*.11),MAT.distant,[-p[0][0],45,-p[0][2]]);
        }
      }
    }
    for(let i=0;i<51;i++) {
      const a=(i+rng()*.54)*M.TAU/51, r=76+rng()*32,x=Math.sin(a)*r,z=-Math.cos(a)*r;
      if(Math.abs(x)<17 && z<0) continue;
      const w=3.7+rng()*4.9,d=4+rng()*5,h=7+rng()*12.4;
      const col=['#b8b9a4','#c4baa6','#b3c1b7','#b7bbab'][i%4];
      m.box(x,h/2,z,w,h,d,col,MAT.distant);
      m.box(x+.27,h+.64,z,w*.65,1.28,d*.64,col,MAT.distant);
      const f=A.facade(world,x,z+(z<0?d/2:-d/2),0,z<0?1:-1);
      for(let y=2.2;y<h-.4;y+=2.1) f.piece(0,y,.035,w*.89,.31,.10,'#99aaa1',MAT.distant);
    }
    const cloudGroups=[[-71,39,-162,1.02],[66,44,-183,1.0],[15,64,-205,.65],[-143,44,-80,1.2],
      [159,46,-31,1.1],[124,43,122,1.1],[-55,57,153,1.1],[-164,45,48,.9]];
    for(const [x,y,z,s] of cloudGroups) {
      for(let j=0;j<5;j++) {
        const h=[2.4,4.1,5.7,3.4,1.9][j]*s;
        m.crown(x+(j-2)*6.8*s,y+h*.59,z+(rng()-.5)*4,(8+rng()*3)*s,h,(4+rng()*3)*s,'#fff6de',rng,MAT.cloud,8);
      }
    }
  }
  function clippedOutline(x,z,w,d,ch) {
    const a=x-w/2,b=x+w/2,n=z-d/2,s=z+d/2;
    return [[a+ch,s],[b-ch,s],[b,s-ch],[b,n+ch],[b-ch,n],[a+ch,n],[a,n+ch],[a,s-ch]];
  }
  function bed(world,x,z,w,d,h=.46,fill='#91a66a') {
    const m=world.mesh,ch=Math.min(.65,w*.15,d*.15);
    const rings=[[w-.10,d-.10,.006],[w-.10,d-.10,h-.12],[w+.11,d+.11,h-.12],[w+.11,d+.11,h],[w-.48,d-.48,h],[w-.48,d-.48,h-.057]]
      .map(([width,depth,y])=>clippedOutline(x,z,width,depth,ch).map(p=>[p[0],y,p[1]]));
    for(let k=1;k<rings.length;k++) for(let i=0;i<8;i++) {
      const j=(i+1)%8;
      m.face([rings[k-1][i],rings[k-1][j],rings[k][j],rings[k][i]],k===1?'#c6af8d':k===4?'#f2e5c7':'#e1cfab');
    }
    m.face(rings[5],fill,MAT.grass,[0,1,0]);
    world.block(x,z,w+.10,d+.10); world.beds.push({x,z,w,d});
    return h;
  }
  function tree(world,x,z,h,color,rng,simple=false,floor=0) {
    const m=world.mesh,lean=(rng()-.5)*h*.08,base=[x,floor,z],fork=[x+lean,floor+h*.44,z+.13];
    m.beam(base,fork,h*.051,h*.029,7,'#826d53');
    const n=simple?3:5, phase=rng()*M.TAU;
    for(let i=0;i<n;i++) {
      const a=i*M.TAU/n+phase, reach=(.21+rng()*.12)*h, y=floor+h*(.69+rng()*.09);
      const tip=[x+Math.cos(a)*reach,y,z+Math.sin(a)*reach];
      const elbow=[M.mix(fork[0],tip[0],.5),y-h*.14,M.mix(fork[2],tip[2],.5)];
      m.beam([fork[0],fork[1]-rng()*.45,fork[2]],elbow,h*.031,h*.021,6,'#87755a');
      m.beam(elbow,tip,h*.023,h*.012,6,'#89785c');
      m.crown(tip[0],y,tip[2],h*(.26+rng()*.06),h*.19,h*(.25+rng()*.08),G.tint(color,.93+rng()*.13),rng,MAT.leaf,simple?6:8);
    }
    m.crown(x+lean,floor+h*.83,z,h*.34,h*.225,h*.32,G.tint(color,1.045),rng,MAT.leaf,simple?7:9);
    if (!simple) {
      for(let i=0;i<3;i++) {
        const a=phase+i*2.13;
        m.beam([x+Math.cos(a)*h*.095,floor+.03,z+Math.sin(a)*h*.095],[x+lean*.4,floor+h*.24,z+.03],h*.026,h*.038,5,'#837058');
      }
    }
    world.trees.push({x,z,r:h*.42});
    world.round(x,z,h*.057);
  }
  function palm(world,x,z,h,rng) {
    const m=world.mesh, end=[x+.38,h,z-.23];
    m.beam([x,0,z],[x+.07,h*.49,z-.06],.25,.20,9,'#9b8c6b');
    m.beam([x+.07,h*.49,z-.06],end,.20,.14,9,'#aa9873');
    for(let i=0;i<8;i++) {
      const y=(i+1)*h/9;
      m.beam([x+.38*(y/h)**2,y,z-.23*y/h],[x+.38*(y/h)**2,y+.079,z-.23*y/h],.216-.06*y/h,.215-.06*y/h,9,'#887f60');
    }
    const phase=rng()*M.TAU;
    for(let i=0;i<12;i++) {
      const a=i*M.TAU/12+phase,ux=Math.cos(a),uz=Math.sin(a),len=h*(i%2?.49:.39);
      const col=['#5a8458','#678f59','#799a5f','#517f5b'][i%4];
      const at=(t,side=0,drop=0)=>[end[0]+ux*t*len-uz*side,end[1]+Math.sin(t*Math.PI)*len*.24+(.06-t*.22)*len-drop,end[2]+uz*t*len+ux*side];
      for(let k=0;k<9;k++) {
        const t=k/9,q=(k+1)/9, w=Math.sin((t+.05)*Math.PI)*len*.145;
        m.face([at(t,-.045),at(q,-.02),at(q,.02),at(t,.045)],'#849b64',MAT.leaf,[0,1,0]);
        for(const side of [-1,1]) {
          m.face([at(t),at(q+.048,w*side,w*.48),at(t+.088)],G.tint(col,1-k*.012),MAT.leaf,[0,1,0]);
        }
      }
    }
    world.round(x,z,.26); world.trees.push({x,z,r:h*.33});
  }
  function rosette(m,x,y,z,size,rng,color) {
    const phase=rng()*M.TAU;
    for(let i=0;i<9;i++) {
      const a=phase+i*2.4,dx=Math.cos(a),dz=Math.sin(a),l=size*(.51+rng()*.57),w=l*.13;
      const mid=[x+dx*l*.38,y+l*.43,z+dz*l*.38],tip=[x+dx*l*.78,y+l*(.48+rng()*.58),z+dz*l*.78];
      for(const side of [-1,1]) {
        const edge=[mid[0]-side*dz*w,mid[1]-.06,mid[2]+side*dx*w];
        const shade=G.tint(color,side===1?1.06:.91);
        m.face([[x,y,z],edge,mid],shade,MAT.leaf,[0,1,0]);
        m.face([edge,tip,mid],shade,MAT.leaf,[0,1,0]);
      }
    }
  }
  function plantBed(world,rng,x,z,w,d,treeSpec) {
    const h=bed(world,x,z,w,d);
    if(treeSpec) tree(world,x+treeSpec[0],z+treeSpec[1],treeSpec[2],treeSpec[3],rng,false,h-.05);
    const n=Math.ceil(w*d*.19);
    for(let i=0;i<n;i++) {
      const px=x+(rng()-.5)*(w-1.65),pz=z+(rng()-.5)*(d-1.65);
      if(i%3===0) rosette(world.mesh,px,h-.045,pz,.45+rng()*.81,rng,i%2?'#689573':'#8ca361');
      else world.mesh.crown(px,h+.17,pz,.48+rng()*.63,.27+rng()*.46,.43+rng()*.44,i%4===0?'#a5ad63':i%4===1?'#739954':'#8fa358',rng,MAT.leaf,6);
    }
  }
  function bench(world,x,z,angle) {
    const m=world.mesh,co=Math.cos(angle),si=Math.sin(angle);
    const p=(u,y,v)=>[x+co*u+si*v,y,z-si*u+co*v];
    function part(u,y,v,w,h,d,color) {
      const q=p(u,y,v); m.box(q[0],y,q[2],Math.abs(co)*w+Math.abs(si)*d,h,Math.abs(si)*w+Math.abs(co)*d,color);
    }
    for(const u of [-.88,.88]) {
      for(const v of [-.23,.23]) part(u,.225,v,.11,.42,.12,'#435e55');
      part(u,.42,0,.14,.12,.73,'#37544d');
      part(u,.77,-.29,.11,.78,.095,'#486056');
      part(u,.68,0,.09,.078,.61,'#527166');
    }
    for(let i=0;i<4;i++) part(0,.509,(i-1.5)*.15,2.56,.10,.127,i%2?'#b78552':'#c2935f');
    for(let i=0;i<2;i++) part(0,.86+i*.20,-.30,2.54,.155,.105,i?'#bd8c5a':'#ae7c4d');
    world.block(x,z,Math.abs(co)*2.56+Math.abs(si)*.76,Math.abs(si)*2.56+Math.abs(co)*.76);
  }
  function lamp(world,x,z) {
    const m=world.mesh, foot=[x,.03,z];
    m.beam(foot,[x,.24,z],.27,.22,8,'#7d8071');
    m.beam([x,.23,z],[x,3.72,z],.102,.072,8,'#46635b');
    m.beam([x,3.66,z],[x,3.85,z],.12,.25,8,'#46635b');
    m.frustum(x,3.79,z,.37,.37,.50,.50,.55,'#fff0bc',MAT.light);
    for(const dx of [-1,1]) for(const dz of [-1,1]) m.beam([x+dx*.18,3.81,z+dz*.18],[x+dx*.246,4.35,z+dz*.246],.024,.029,4,'#4a5d52');
    m.box(x,4.37,z,.65,.08,.65,'#415d54');
    m.frustum(x,4.41,z,.66,.66,.14,.14,.23,'#507066');
    m.beam([x,4.61,z],[x,4.76,z],.072,.026,6,'#6a765f');
    world.round(x,z,.24); world.lamps.push([x,z]);
  }
  function wayfinder(world,x,z) {
    const m=world.mesh; m.box(x,1.52,z,.15,3.02,.16,'#47625a');
    m.box(x,.12,z,.42,.24,.40,'#c1b395');
    const f=A.facade(world,x,z,0,1);
    f.piece(.18,2.64,0,2.30,.46,.15,'#547369');
    f.sign(.18,2.64,.082,2.13,.35,'Meridian Tower   ↑','light');
    f.piece(-.16,2.09,0,2.15,.43,.15,'#a6644b');
    f.sign(-.16,2.09,.082,2.00,.33,'←   Jade Library','light');
    f.piece(-.19,1.55,0,2.30,.43,.15,'#497970');
    f.sign(-.19,1.55,.082,2.15,.33,'←   Moon Gate Pool','light');
    world.round(x,z,.18);
  }
  function stampPress(world, place, index) {
    const {at, ink, strokes, floor = 0} = place.stamp;
    const [x, approachZ] = at, z = approachZ - 1;
    const m = world.mesh;
    // A flush octagonal tile marks the standing spot in front of the hand press.
    m.beam([x,floor+.023,approachZ],[x,floor+.033,approachZ],.46,.46,8,'#c2a477');
    m.beam([x,floor+.033,approachZ],[x,floor+.040,approachZ],.38,.38,8,'#ecdec2');
    m.frustum(x,floor+.02,z,.82,.64,.70,.54,.18,'#bfaa8a');
    m.box(x,floor+.58,z,.57,.80,.42,ink);
    m.box(x,floor+.99,z,.76,.09,.56,'#d9bd84');
    m.box(x,floor+1.19,z-.18,.18,.41,.15,'#53645a');
    m.beam([x,floor+1.29,z-.13],[x+.23,floor+1.35,z+.16],.042,.055,6,'#8c6650');
    m.beam([x,floor+1.61,z-.21],[x,floor+1.61,z-.13],.365,.365,12,'#c8aa78');
    m.beam([x,floor+1.61,z-.13],[x,floor+1.61,z-.105],.319,.319,12,ink);
    for (const stroke of strokes) {
      const points = stroke.map(([u,v]) => [x+u*.27,floor+1.61+v*.27,z-.091]);
      for (let i=1; i<points.length; i++) m.beam(points[i-1],points[i],.015,.015,5,'#fff0c9');
    }
    A.facade(world,x,z,0,1).sign(0,floor+.71,.218,.49,.14,'PRESS '+String(index+1).padStart(2,'0'),'light');
    world.block(x,z,.82,.64);
  }
  function lookoutTile(world, [x,z,yaw]) {
    const m=world.mesh, y=terrain.heightAt(x,z,world.surfaces)+.035;
    const {right,forward}=M.basis(yaw);
    const point=(u,v,lift) => [x+u*right[0]+v*forward[0], y+lift, z+u*right[2]+v*forward[2]];
    function tile(u,v,w,d,lift,color) {
      m.face([[u-w/2,v-d/2],[u+w/2,v-d/2],[u+w/2,v+d/2],[u-w/2,v+d/2]]
        .map(([px,pz]) => point(px,pz,lift)),color,MAT.stone,[0,1,0]);
    }
    tile(0,0,.67,.48,0,'#bca173');
    tile(0,0,.63,.44,.002,'#41625a');
    for (const u of [-1,1]) for (const v of [-1,1]) {
      tile(u*.18,v*.13,.105,.019,.004,'#ead5a5');
      tile(u*.223,v*.10,.019,.078,.004,'#ead5a5');
    }
    m.face([point(-.05,-.045,.004),point(.05,-.045,.004),point(0,.07,.004)],'#ead5a5',0,[0,1,0]);
  }
  function grounds(world,rng) {
    plantBed(world,rng,-12.15,19.1,9.0,5.35,[-.55,.45,9.25,'#7e9f50']);
    plantBed(world,rng,13.7,18.9,9.4,4.3,[1.0,.1,8.55,'#769954']);
    plantBed(world,rng,-13.1,31.2,8.1,5.1,[-1.15,.34,10.55,'#879f52']);
    plantBed(world,rng,14.45,31.2,8.5,5.1,[1.72,.76,9.45,'#769c56']);
    plantBed(world,rng,-9.6,1.0,4.0,7.0,[0,-.3,6.5,'#8fa85f']);
    plantBed(world,rng,10.4,-3.4,3.6,6.8,[.2,-.75,6.25,'#8ea655']);
    plantBed(world,rng,-12.0,-17.2,7.4,3.7,[-1.3,-.16,7.9,'#73965a']);
    plantBed(world,rng,14.7,-16.9,6.4,4.1,[1.2,0,7.2,'#8ca65b']);
    plantBed(world,rng,33.8,-16,6.1,4.5);
    plantBed(world,rng,25.9,-31,7.5,4.3);
    for(const p of [[-10.1,-9.7,7.55],[12.65,7.7,7.85],[18.8,-20.5,7.85],[-32,17.2,8.4],[23.2,-27.9,7.1]]) palm(world,...p,rng);
    for(const [x,z,angle] of [[-10.7,22.62,0],[-8.98,15.86,Math.PI], [10.8,21.72,0],[8.88,16,Math.PI/2],
      [-10.8,27.96,Math.PI],[11.56,28.1,Math.PI],[8.04,-3.8,Math.PI/2],[-7.0,1.4,-Math.PI/2],[29.6,-25.0,0],[32.35,-25,0]]) bench(world,x,z,angle);
    for(const p of [[-7.35,24.9],[8.12,24.7],[-7.35,8.6],[8.25,8.2],[-7.35,-10.1],[8.25,-11.1],
      [-6.94,-19.2],[19.25,-13.5],[24.7,-23.4],[-20.5,19.0],[-7.35,38.3],[8.12,38.3]]) lamp(world,...p);
    wayfinder(world,-6.62,19.65);
    // A student club has borrowed the arcade noticeboard for the evening.
    const notice=A.facade(world,20.7,10.94,0,1);
    notice.piece(0,1.05,0,.11,2.1,.14,'#795e47');
    notice.piece(0,1.62,.01,1.32,1.16,.12,'#926b4e');
    notice.sign(0,1.64,.085,1.14,.87,'TACTICS CLUB|Three-a-side|Friday · 17:00','poster');
    world.block(20.7,10.94,1.32,.18);
    const grove=[[-36,25],[-37,32],[-35,10],[-39,-8],[-26,-13],[-23,-34],[-15,-35],[-2,-34],[9,-35],[20,-34],[31,-35],
      [38,-26],[39,-18],[38,-7],[38,6],[39,16],[23,28],[19,36],[10,43],[-6,42],[-15,38]];
    for(let i=0;i<grove.length;i++) tree(world,...grove[i],6.9+rng()*2.8,treeColors[i%treeColors.length],rng,true);
    for(let i=0;i<46;i++) {
      const a=i*M.TAU/46,r=52+rng()*9;
      tree(world,Math.sin(a)*r,Math.cos(a)*r,7+rng()*5,treeColors[i%6],rng,true);
    }
    // Low perimeter walls give the walkable grounds a physical edge.
    for(const [x,z,w,d] of [[-42.25,3,.54,85],[43.25,3,.54,85],[.5,-39.25,86,.54],[.5,45.25,86,.54]]) {
      world.mesh.box(x,.48,z,w,.95,d,'#d6c3a1');
      world.mesh.box(x,.99,z,w+.12,.12,d+.12,'#ecdcb9');
    }
  }
  function create(seed=407) {
    const world={mesh:new G.Mesh(),colliders:[],buildings:[],shelters:[],surfaces:[],paths:[],beds:[],trees:[],signs:[],lamps:[],places,bounds,
      block(x,z,w,d) { this.colliders.push({kind:'box',x,z,w,d}); },
      round(x,z,r) { this.colliders.push({kind:'circle',x,z,r}); },
      footprint(x,z,w,d,id) { this.buildings.push({x,z,w,d,id}); }
    };
    const rng=M.random(seed);
    ground(world); landscape(world,rng);
    world.casterStart=world.mesh.vertexCount;
    A.build(world); grounds(world,rng); moonPool.build(world);
    places.forEach((place, index) => stampPress(world, place, index));
    for (const place of places) if (place.study) lookoutTile(world,place.view);
    world.vertices=world.mesh.finish();
    delete world.mesh;
    return world;
  }
  return {create, places, bounds, clippedOutline};
});
