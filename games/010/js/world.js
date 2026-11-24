/* The café is built in metres. Each prop carries the same ID as its order slip. */
(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const M = local ? require('./math.js') : PocketPlaces.math;
  const G = local ? require('./mesh.js') : PocketPlaces.mesh;
  const art = local ? require('./art.js') : PocketPlaces.art;
  const fan = local ? require('./fan.js') : PocketPlaces.fan;
  const tea = local ? require('./tea.js') : PocketPlaces.tea;
  const cat = local ? require('./shop-cat.js') : PocketPlaces.shopCat;
  const radio = local ? require('./radio.js') : PocketPlaces.radio;
  const blinds = local ? require('./blinds.js') : PocketPlaces.blinds;
  const toast = local ? require('./toast.js') : PocketPlaces.toast;
  const till = local ? require('./till.js') : PocketPlaces.till;
  const PI = Math.PI, TAU = 2*PI;
  const notes = [
    {id:1,title:'House milk tea',short:'Milk tea',chinese:'港式奶茶',caption:'Strong enough to carry an entire HKBU group project.',anchor:[1.33,1.43,1.79],seatedAnchor:[1.33,1.30,1.79],
      closeup:{center:[1.33,1.39,1.79],span:.82,yaw:.46,pitch:.49}},
    {id:2,title:'Window booth',short:'Window booth',action:'Draw the blinds',chinese:'窗邊卡座',caption:'A table for two. Or one person and a tote bag with very strong opinions.',anchor:[-2.85,1.33,2.86],
      closeup:{center:[-3.12,.94,1.63],span:1.85,yaw:1.05,pitch:.60}},
    {id:3,title:'Pineapple bun',short:'Pineapple bun',chinese:'菠蘿包',caption:'The pineapple is purely a management position. It works remotely.',anchor:[-2.82,1.35,1.39],
      closeup:{center:[-2.82,1.19,1.39],span:.63,yaw:.38,pitch:.62}},
    {id:4,title:'Wall clock',short:'Wall clock',chinese:'掛鐘',caption:'I stopped at half past three. As far as I’m concerned, it’s still tea time.',anchor:[3.49,3.02,-3.04],
      closeup:{center:[3.49,2.615,-3.04],span:.72,yaw:.16,pitch:.24}},
    {id:5,title:'Tea urn',short:'Tea urn',chinese:'大茶壺',caption:'I’ve heard every order since breakfast. I’m under a little pressure.',anchor:[3.27,2.19,-2.17],
      closeup:{center:[3.27,1.76,-2.17],span:.91,yaw:.43,pitch:.34}},
    {id:cat.id,title:'Shop cat',short:'Shop cat',action:'Call the cat',chinese:'店貓',caption:'My three-player team? Me, the sunny patch, and whoever drops the toast.',anchor:[3.50,.60,2.69],
      closeup:{center:[3.43,.39,2.58],span:.74,yaw:.37,pitch:.34}},
    {id:7,title:'Counter fan',short:'Counter fan',chinese:'座檯風扇',caption:'Every time I turn up for work, the milk tea goes round the bend.',anchor:[fan.hub[0],fan.hub[1],fan.hub[2]+.14],
      closeup:{center:[fan.hub[0],fan.hub[1]-.04,fan.hub[2]],span:.67,yaw:.28,pitch:.27}},
    {id:radio.id,title:'Booth radio',short:'Booth radio',action:'Tune in',chinese:'枱頭收音機',
      caption:'Three stations and one volume knob. The auntie at the till still gets the last word.',
      anchor:[-2.14,1.32,1.48],closeup:{center:[-2.17,1.25,1.36],span:.52,yaw:.28,pitch:.39}},
    {id:toast.id,title:'French toast',short:'French toast',action:'Dress a plate',chinese:'西多士',
      caption:'Please cut me on the diagonal. I booked two corner tables.',
      anchor:[.784,1.251,1.461],closeup:{center:[.756,1.207,1.414],span:.48,yaw:.39,pitch:.68}},
    {id:till.id,title:'Counter till',short:'Counter till',action:'Count change',chinese:'收銀機',
      caption:'I remember every cent. Who borrowed the pencil is another matter.',
      anchor:[.69,1.553,-2.225],closeup:{center:[.69,1.382,-2.12],span:.54,yaw:.25,pitch:.44}}
  ];
  const steam = [
    {x:tea.cup.x,y:tea.cup.base+tea.levels[tea.capacity][0],z:tea.cup.z,height:.77,phase:.2,draft:1,adjustable:true},
    {x:-2.85,y:1.325,z:-1.46,height:.58,phase:2.4,draft:.17},
    {x:3.27,y:2.22,z:-2.17,height:.38,phase:4.9,draft:.09}
  ];
  const P = {
    green:'#306c5b',dark:'#244f44',mint:'#83b39c',foam:'#a4c6ad',ivory:'#ffedc9',
    china:'#fff2d7',honey:'#dbac66',brass:'#c59b5c',chrome:'#c9cabe',iron:'#46564e',
    wood:'#936444',toast:'#b87c45',red:'#c95037',tomato:'#dd664b',ink:'#353e35'
  };

  function createRoom() {
    return {fan:fan.create(), drink:tea.appearance(), pouredAt:-Infinity, cat:cat.create(), tuning:{dial:0,playing:false},
      blind:blinds.settings[0], plate:toast.fresh(), bill:till.fresh(), atTill:false, drop:0, split:0, drawer:0};
  }
  function moveFixtures(room,seconds,instant=false) {
    if (!instant && (!Number.isFinite(seconds) || seconds<=0)) return;
    function slide(from,to,speed) {
      if (instant || Math.abs(to-from)<=seconds*speed) return to;
      return from+Math.sign(to-from)*seconds*speed;
    }
    room.drop=slide(room.drop,room.blind.drop,.94);
    room.split=slide(room.split,Number(room.plate.cut==='Triangles'),3.8);
    room.drawer=slide(room.drawer,Number(room.atTill && !room.bill.settled),2.9);
  }

  function makeScene() {
    const batch = new G.Batcher(), cache = new Map();
    let parent = M.identity(), currentId = 0, currentPart = G.parts.fixed;
    function cached(key,fn) { if (!cache.has(key)) cache.set(key,fn()); return cache.get(key); }
    function transform(x,y,z,opts) {
      let m=M.translation(x,y,z);
      if(opts?.ry) m=M.multiply(m,M.rotation('y',opts.ry));
      if(opts?.rx) m=M.multiply(m,M.rotation('x',opts.rx));
      if(opts?.rz) m=M.multiply(m,M.rotation('z',opts.rz));
      return M.multiply(parent,m);
    }
    function group(x,y,z,yaw,id,build,part=currentPart) {
      const previous=parent, previousId=currentId, previousPart=currentPart;
      parent=transform(x,y,z,{ry:yaw}); currentId=id; currentPart=part;
      build(); parent=previous; currentId=previousId; currentPart=previousPart;
    }
    function put(shape,x,y,z,color,opts) {
      batch.add(shape,transform(x,y,z,opts),color,currentId,opts?.gloss ?? .12,art.regions[opts?.print],opts?.part ?? currentPart);
    }
    function box(x,y,z,w,h,d,color,r=0,opts) {
      put(cached('b'+[w,h,d,r],()=>G.box(w,h,d,r)),x,y,z,color,opts);
    }
    function slab(x,y,z,w,h,d,r,color,b=.025,opts) {
      put(cached('s'+[w,h,d,r,b],()=>G.roundedSlab(w,h,d,r,b)),x,y,z,color,opts);
    }
    function cyl(x,y,z,lo,hi,h,color,sides=24,opts) {
      put(cached('c'+[lo,hi,h,sides],()=>G.cylinder(lo,hi,h,sides)),x,y,z,color,opts);
    }
    function turned(x,y,z,profile,color,opts,sides=32) {
      put(cached('l'+sides+JSON.stringify(profile),()=>G.lathe(profile,sides)),x,y,z,color,opts);
    }
    function oval(x,y,z,rx,ry,rz,color,opts) {
      put(cached('e'+[rx,ry,rz],()=>G.ellipsoid(rx,ry,rz)),x,y,z,color,opts);
    }
    function pipe(points,r,color,opts,sides=8) { put(G.tube(points,r,sides),0,0,0,color,opts); }
    function ring(x,y,z,r,t,color) {
      const pts=[];
      for(let i=0;i<=32;i++) pts.push([x+r*Math.cos(i*TAU/32),y,z+r*Math.sin(i*TAU/32)]);
      pipe(pts,t,color,{gloss:.48});
    }
    function panel(x,y,z,w,h,color,print,opts) {
      put(cached('p'+[w,h],()=>G.panel(w,h)),x,y,z,color,{...opts,print});
    }

    // Stepped ceramic and terracotta plinth, with a maker's plate on its lip.
    slab(0,-.445,0,9.30,.16,6.96,.17,'#915f46',.035);
    slab(0,-.285,0,9.45,.27,7.09,.18,'#c48360',.037);
    slab(0,-.134,0,9.46,.09,7.10,.17,'#e6bc8c',.018);
    slab(0,-.052,0,9.40,.105,7.04,.14,'#fff0cf',.018);
    slab(0,.003,0,9.19,.068,6.86,.07,'#c2b69a',.011);
    const tileW=9.04/16, tileD=6.72/12;
    const pale=['#efdfbd','#f2e3c4','#eddfbe'], jade=['#afbd9e','#b4c2a6','#b8c4a7'];
    for(let ix=0;ix<16;ix++) for(let iz=0;iz<12;iz++) {
      const tint=(ix*17+iz*7)%3;
      panel((ix-7.5)*tileW,.041,(iz-5.5)*tileD,tileW-.012,tileD-.012,
        (ix+iz)%2 ? jade[tint] : pale[tint],null,{rx:-PI/2});
    }
    box(-.48,-.277,3.552,2.23,.218,.030,P.brass,.018);
    panel(-.48,-.277,3.569,2.17,.190,'#ffffff','plaque');

    function tiledWall(x,z,w,yaw) {
      group(x,0,z,yaw,0,()=>{
        box(0,1.635,0,w,3.21,.16,'#b4b69a',.022);
        const courses=[[.12,1.24,4,.55,['#a7c6ad','#a3c2a9','#accaaf']],
          [1.38,3.18,4,.60,['#ebe1c2','#eee4c7','#e8ddbd']]];
        for(const [low,high,rows,tw,colors] of courses) {
          const th=(high-low)/rows;
          for(let j=0;j<rows;j++) {
            const shift=j%2 ? tw/2 : 0;
            for(let k=-1;k<=Math.ceil(w/tw);k++) {
              const a=Math.max(-w/2,-w/2+k*tw+shift), b=Math.min(w/2,-w/2+(k+1)*tw+shift);
              if(b-a<.035) continue;
              panel((a+b)/2,low+(j+.5)*th,.082,b-a-.009,th-.010,colors[(k+4*j+3)%3]);
            }
          }
        }
        box(0,.103,.086,w,.134,.115,P.green,.012);
        box(0,1.295,.092,w,.095,.091,P.dark,.010);
        box(0,1.353,.102,w,.040,.093,'#d4ad70',.006);
        box(0,3.195,.015,w+.035,.15,.225,P.green,.018);
        box(0,3.292,.002,w+.072,.076,.27,'#a8bea2',.018);
        for(const s of [-1,1]) box(s*(w/2-.022),1.62,.012,.064,3.15,.182,P.green,.012);
      });
    }
    tiledWall(0,-3.28,9.10,0); tiledWall(-4.47,.01,6.72,PI/2);

    // Three painted street views, set into thick sash frames and a continuous sill.
    for(let i=0;i<3;i++) {
      const z=2.14-i*2.06;
      group(-4.47,0,z,PI/2,0,()=>{
        box(0,2.16,.106,1.98,1.53,.13,P.dark,.026);
        panel(0,2.16,.177,1.83,1.37,'#fffcee','window'+i);
        for(const s of [-1,1]) {
          box(s*.944,2.16,.204,.068,1.51,.085,P.mint,.010);
          box(0,2.16+s*.713,.208,1.94,.064,.10,P.mint,.010);
        }
        box(-.20,2.16,.210,.043,1.39,.066,P.green,.005);
        box(0,2.40,.211,1.84,.042,.072,P.green,.005);
        box(-.12,1.79,.25,.11,.028,.06,P.brass,.008);
        box(0,1.398,.171,2.055,.078,.34,'#f3d6a3',.018);
        blinds.build({group,cyl,box,panel});
      });
    }
    // Two wall-mounted enamel reading lamps.
    for(const z of [-1.03,1.08]) {
      cyl(-4.33,3.025,z,.095,.095,.065,P.brass,24,{rz:PI/2});
      pipe([[-4.31,3.03,z],[-4.13,3.12,z],[-3.95,3.14,z],[-3.84,3.09,z],[-3.80,2.98,z]],.029,P.brass);
      turned(-3.80,2.84,z,[[.238,0],[.242,.025],[.155,.078],[.084,.121],[.063,.148]],'#dfac5b');
      cyl(-3.80,2.836,z,.219,.219,.012,'#fff1c6');
      oval(-3.80,2.824,z,.068,.047,.068,'#fff4d3');
    }
    // A little jade plant on the end of the window ledge.
    turned(-4.18,1.44,2.70,[[.103,0],[.137,.19],[.151,.198],[.151,.235]],'#b96d4c');
    cyl(-4.18,1.671,2.70,.127,.127,.016,'#67523c');
    for(let i=0;i<8;i++) {
      const a=i*TAU/8;
      oval(-4.18+.099*Math.sin(a),1.77+(i%3)*.037,2.70+.099*Math.cos(a),.066,.134,.058,
        i%2 ? '#739b68' : '#538465',{ry:a,rx:.58});
    }

    // Porcelain is turned from a hollow profile. The tea sits inside the lip.
    function saucer(x,y,z,r) {
      turned(x,y,z,[[r*.49,.004],[r*.73,.009],[r*.95,.032],[r,.050],[r*.96,.061],[r*.56,.032]],P.china,{gloss:.45});
      ring(x,y+.054,z,r*.916,.006,P.green);
    }
    function cup(x,y,z,yaw,adjustable=false) {
      group(x,y,z,yaw,1,()=>{
        saucer(0,0,0,.298);
        turned(0,.03,0,[[.108,.003],[.125,.020],[.139,.051],[.184,.148],[.204,.245],
          [.208,.278],[.201,.290],[.190,.288],[.186,.269],[.179,.216],[.167,.153],
          [.142,.092],[.101,.030]],P.china,{gloss:.5});
        const handle=[];
        for(let i=0;i<=14;i++) {
          const a=i*PI/14;
          handle.push([.164+.151*Math.sin(a),.201-.094*Math.cos(a),0]);
        }
        pipe(handle,.027,P.china,{gloss:.45});
        turned(0,.03,0,[[.201,.237],[.203,.247]],P.green,{gloss:.4});
        const part=adjustable ? G.parts.teaSurface : G.parts.fixed;
        cyl(0,.299,0,.186,.188,.006,'#ce9768',36,{gloss:.52,part});
        cyl(0,.303,0,.176,.176,.006,'#ad7148',36,{gloss:.40,part});
        for(let i=0;i<6;i++) {
          const a=.5+i*.41; cyl(Math.cos(a)*.161,.307,Math.sin(a)*.161,.008,.008,.002,'#ecd0a1',8,{part});
        }
      });
    }
    function bun(x,y,z,scale=1) {
      const a=.260*scale,b=.165*scale,c=.233*scale;
      oval(x,y+b*.58,z,a,b,c,'#d79243');
      // Follow the dome so the baked diamond pattern is actual raised crust.
      for(const direction of [-1,1]) for(const offset of [-.87,-.40,.07,.54,.99]) {
        const pts=[];
        for(let k=0;k<=40;k++) {
          const u=-1+k/20,v=direction*u+offset,t=1-u*u-v*v;
          if(t>.06) pts.push([x+u*a,y+b*.58+b*Math.sqrt(t)+.003,z+v*c]);
        }
        if(pts.length>1) pipe(pts,.009*scale,'#b57b3d',null,5);
      }
    }
    function pot(x,y,z,color,capColor) {
      turned(x,y,z,[[.059,0],[.076,.021],[.075,.151],[.049,.181],[.045,.216]],color,{gloss:.34},16);
      cyl(x,y+.232,z,.052,.049,.044,capColor,16);
    }
    function napkins(x,y,z) {
      box(x,y+.137,z,.31,.269,.158,P.chrome,.035,{gloss:.66});
      box(x,y+.248,z+.025,.242,.045,.113,P.dark,.012);
      box(x,y+.281,z+.021,.215,.073,.015,P.china,.006,{rx:-.15});
      box(x,y+.068,z+.08,.245,.020,.009,P.ivory,.004);
    }
    function pedestal(x,z,height,id) {
      group(x,0,z,0,id,()=>{
        slab(0,.095,0,.75,.10,.53,.095,P.iron);
        slab(0,.153,0,.61,.038,.42,.062,P.chrome,.01);
        cyl(0,height*.52,0,.079,.069,height-.18,P.chrome,20,{gloss:.65});
        cyl(0,height-.083,0,.14,.19,.11,P.iron,24);
      });
    }
    function table(x,z,w,d,y,id,yaw=0) {
      group(x,0,z,yaw,id,()=>{
        pedestal(0,0,y,id);
        slab(0,y-.080,0,w,.114,d,.155,'#876946',.021);
        slab(0,y-.035,0,w+.012,.061,d+.012,.16,'#d8bb85',.014);
        slab(0,y-.006,0,w,.040,d,.154,'#fae7bf',.013);
      });
    }
    function bench(z,angle) {
      group(-2.96,0,z,angle,2,()=>{
        slab(0,.225,.005,2.39,.34,.66,.11,P.wood,.028);
        box(0,.306,.337,2.23,.036,.018,P.brass,.005);
        slab(0,.494,0,2.59,.249,.78,.14,'#5b9780',.059);
        slab(0,.615,.012,2.58,.086,.78,.12,'#8ec0a0',.028);
        box(0,.869,-.30,2.57,.873,.191,P.dark,.082);
        box(0,.921,-.349,2.43,.666,.134,'#50846f',.060);
        for(let k=0;k<8;k++) {
          box((k-3.5)*.309,.953,-.203,.316,.646,.183,k%3===0 ? '#78aa90' : '#80b398',.073,{rx:-.075,gloss:.3});
        }
        box(0,1.287,-.275,2.45,.037,.079,'#b7cc9f',.016);
        for(const x of [-1.19,1.19]) {
          box(x,.432,0,.054,.135,.688,P.brass,.016);
          cyl(x,.32,.32,.032,.032,.03,P.brass,12,{rx:PI/2});
        }
      });
    }
    bench(-2.57,0); bench(-.45,PI); bench(.42,0); bench(2.60,PI);
    table(-2.90,-1.48,2.19,1.02,1.008,2); table(-2.90,1.49,2.19,1.02,1.008,2);
    cup(-2.85,1.022,-1.46,-.29);
    group(-3.68,1.025,-1.69,0,2,()=>{napkins(0,0,0);pot(.27,0,.04,'#975937',P.red);});
    group(-3.72,1.025,1.37,0,2,()=>{napkins(0,0,0);pot(.24,0,0,P.ivory,P.chrome);});
    group(-2.82,1.022,1.39,-.14,3,()=>{saucer(0,0,0,.346);bun(0,.031,0,1.05);});
    group(-2.09,1.029,-1.48,-.21,2,()=>{
      box(0,.017,0,.324,.025,.416,'#c19a6a',.011);
      panel(0,.034,0,.301,.391,'#ffffff','pad',{rx:-PI/2});
      pipe([[.176,.026,-.17],[.210,.026,.16]],.012,P.red);
    });

    // The enamel shop sign, handbill, menu and stopped clock.
    for(const x of [-2.74,2.36]) box(x,3.51,-3.27,.113,.60,.138,P.iron,.012);
    box(-.17,3.923,-3.26,6.03,1.018,.213,'#8d5139',.085);
    box(-.17,3.923,-3.145,5.99,.986,.093,'#f2d49e',.046);
    panel(-.17,3.923,-3.095,5.89,.900,'#ffffff','marquee');
    box(-2.65,2.144,-3.144,1.96,1.48,.109,'#856347',.03);
    panel(-2.65,2.144,-3.084,1.87,1.391,'#ffffff','menu');
    box(-4.00,2.124,-3.141,.569,.846,.056,'#a88561',.01);
    panel(-4.00,2.124,-3.109,.538,.809,'#ffffff','poster');
    group(3.49,2.615,-3.148,0,4,()=>{
      cyl(0,0,.039,.403,.403,.095,P.red,48,{rx:PI/2});
      cyl(0,0,.089,.372,.372,.042,P.brass,48,{rx:PI/2});
      panel(0,0,.112,.724,.724,'#ffffff','clock');
    });

    // Open serving hatch with a striped canvas canopy and stacks of crockery.
    group(.71,0,-3.112,0,0,()=>{
      box(0,1.994,0,3.69,1.39,.110,P.wood,.036);
      box(0,1.994,.06,3.52,1.25,.063,'#577c69',.012);
      for(let i=0;i<9;i++) box(-1.55+i*.385,1.97,.099,.014,1.13,.011,'#668b77');
      for(const sy of [1.46,2.079]) {
        box(0,sy,.202,3.52,.065,.304,'#c89964',.016);
        box(0,sy+.035,.20,3.47,.017,.289,'#ead2a1',.004);
      }
      for(const x of [-1.36,-.80]) {
        for(let i=0;i<(x< -1 ? 5 : 3);i++) {
          turned(x,1.498+i*.036,.21,[[.142,0],[.197,.023],[.202,.036]],P.china,{gloss:.34},20);
        }
      }
      for(let i=0;i<6;i++) {
        const x=-1.42+i*.49, h=.22+(i%3)*.036;
        cyl(x,2.127+h/2,.206,.115,.123,h,i%2 ? '#d9b684' : P.ivory,18);
        cyl(x,2.134+h,.206,.128,.128,.033,i%2 ? P.green : P.red,18);
        box(x,2.126+h*.48,.321,.105,.075,.016,i%2 ? '#c87a51' : '#83a18a',.005);
      }
      for(let i=0;i<4;i++) {
        const x=-.07+i*.403;
        turned(x,1.501,.211,[[.066,0],[.088,.033],[.110,.187]],P.china,null,20);
        pipe([[x+.09,1.65,.21],[x+.148,1.654,.21],[x+.162,1.607,.21],[x+.15,1.56,.21],[x+.091,1.556,.21]],.014,P.china);
      }
      const stripe=.319;
      for(let i=0;i<12;i++) {
        const x=(i-5.5)*stripe, color=i%2 ? '#fae6bd' : '#cc5c44';
        box(x,2.740,.219,stripe+.002,.050,.639,color,.006,{rx:.28});
        slab(x,2.583,.529,stripe+.002,.038,.174,.066,color,.006,{rx:PI/2});
      }
      for(const x of [-1.83,1.83]) pipe([[x,2.36,.040],[x,2.59,.507]],.018,P.brass);
      box(0,2.655,.386,3.26,.042,.079,P.brass,.009);
      box(0,2.628,.386,3.16,.018,.063,'#fff0ba',.006);
    });
    group(1.36,0,-2.29,0,0,()=>{
      slab(0,.133,0,5.49,.16,1.35,.085,P.dark);
      slab(0,.624,0,5.43,.91,1.28,.070,'#659b85');
      box(0,.664,.652,5.13,.649,.031,'#9bb99a',.018);
      for(let i=0;i<33;i++) {
        box((i-16)*.153,.661,.675,.033,.598,.026,'#85a98e',.010);
      }
      box(0,.313,.674,5.14,.048,.036,P.brass,.008);
      slab(0,1.076,0,5.63,.115,1.47,.116,'#896843',.020);
      slab(0,1.141,0,5.67,.083,1.50,.117,'#ebc894',.019);
      slab(0,1.183,0,5.64,.040,1.49,.114,P.ivory,.012);
      pipe([[-2.56,.283,.822],[2.56,.283,.822]],.036,P.brass,{gloss:.49});
      for(const x of [-2.42,0,2.42]) pipe([[x,.24,.622],[x,.24,.749],[x,.28,.822]],.025,P.brass);
    });
    function stool(x,z,seatColor,baseId) {
      group(x,0,z,0,baseId,()=>{
        turned(0,.044,0,[[.245,.003],[.266,.027],[.246,.052],[.141,.077],[.080,.103]],P.chrome,{gloss:.62});
        cyl(0,.35,0,.067,.055,.481,P.chrome,24,{gloss:.64});
        ring(0,.276,0,.158,.019,P.chrome);
        for(let i=0;i<3;i++) {
          const a=i*TAU/3;
          pipe([[Math.cos(a)*.044,.267,Math.sin(a)*.044],[Math.cos(a)*.156,.276,Math.sin(a)*.156]],.012,P.chrome);
        }
        turned(0,.561,0,[[.098,0],[.243,.020],[.263,.053]],P.brass,{gloss:.4});
        turned(0,.604,0,[[.253,0],[.275,.023],[.282,.065],[.272,.107],[.244,.123]],seatColor,{gloss:.34});
        ring(0,.635,0,.277,.009,'#e8b18a');
      });
    }
    for(const x of [-.13,1.47,3.09]) stool(x,-.865,P.tomato,0);
    // Countertop details include a pastry tray, a till and a working spout.
    group(-.66,1.207,-2.10,-.08,3,()=>{
      slab(0,.030,0,1.04,.061,.618,.082,P.wood,.015);
      slab(0,.067,0,.96,.024,.552,.066,P.ivory,.007);
      bun(-.234,.073,.014,.79); bun(.237,.073,-.012,.78);
    });
    till.build({group,slab,box,cyl,panel});
    group(3.27,1.207,-2.17,0,5,()=>{
      turned(0,0,0,[[.252,.016],[.326,.075],[.322,.131],[.261,.158]],P.iron,{gloss:.4});
      turned(0,0,0,[[.246,.137],[.306,.181],[.321,.271],[.317,.763],[.287,.819]],
        '#bec4b8',{gloss:.77},40);
      for(const y of [.238,.731]) cyl(0,y,0,.327,.327,.033,'#dfdac3',32,{gloss:.62});
      turned(0,.804,0,[[.270,0],[.341,.024],[.340,.048],[.231,.092],[.115,.115]],P.chrome,{gloss:.69});
      oval(0,.957,0,.071,.057,.071,P.iron);
      box(0,.503,.317,.259,.177,.014,P.brass,.012);
      panel(0,.503,.327,.244,.161,'#ffffff','urn');
      pipe([[0,.279,.295],[0,.279,.445],[0,.232,.478]],.033,P.brass,{gloss:.56});
      box(0,.345,.407,.151,.035,.042,P.ink,.014);
      for(const s of [-1,1]) box(s*.343,.682,0,.10,.098,.166,P.iron,.030);
    });
    group(2.31,1.205,-2.45,.04,0,()=>{
      for(let i=0;i<5;i++) turned(0,i*.035,0,[[.177,.005],[.231,.028],[.236,.040]],P.china,null,24);
      cyl(-.407,.138,.010,.114,.114,.26,'#f3be75');
      cyl(-.407,.277,.010,.118,.118,.021,P.chrome);
      panel(-.407,.136,.125,.165,.118,'#ffffff','tin');
    });
    fan.build({group,slab,oval,cyl,pipe},G.parts.fanBlade);

    // The tabletop gives the foreground tea setting a generous touch target.
    table(1.40,1.54,2.31,1.34,1.066,1,-.075);
    cup(tea.cup.x,tea.cup.base,tea.cup.z,-.44,true);
    toast.build({group,saucer,put,slab});
    group(2.186,1.081,1.299,-.11,0,()=>{
      napkins(0,0,0);pot(-.259,0,-.008,'#8f5435',P.red);
      pipe([[-.26,.012,.29],[-.59,.012,.325]],.013,P.chrome);
      oval(-.601,.015,.328,.062,.011,.036,P.chrome,{gloss:.6});
    });
    stool(1.20,2.75,'#80a88a',0); stool(1.76,.35,'#84aa8c',0);

    cat.build({group,oval,pipe,put});
    radio.build({group,box,cyl,panel,pipe});
    return {batches:batch.finish(),notes,steam};
  }

  const api={notes,steam,createRoom,moveFixtures,makeScene};
  if(local) module.exports=api; else PocketPlaces.world=api;
})();
