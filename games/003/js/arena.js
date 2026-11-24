(function(root,factory){
  const common=typeof module==='object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api=factory(load('math'),load('mesh'),load('battle'),load('signal'),load('coils'));
  if (common) module.exports=api; else (root.Rift=root.Rift||{}).arena=api;
})(globalThis,function(M,mesh,B,Signal,Coils) {
  'use strict';
  const {Builder}=mesh;
  const colors=['#5be5e0','#f967ae'];
  const dockZ = laneZ => laneZ + Math.sign(laneZ) * 1.42;
  function cachePosition(cache, age) {
    const dock = dockZ(B.LANES[cache.lane]);
    const from = cache.opensAt === Signal.FIRST ? 0 : -dock;
    const travel = M.clamp(1 - (cache.opensAt - age) / 8, 0, 1);
    const ease = travel * travel * (3 - 2 * travel);
    return [0, .89 + Math.sin(travel * Math.PI) * .88, M.lerp(from, dock, ease)];
  }
  function city(seed=842) {
    const b=new Builder(), rand=M.seeded(seed);
    b.box(0,-7.25,0,140,.28,140,'#231c3c');
    const building=['#332949','#302841','#3b2e50','#282941','#392b49','#3b2e52'];
    const windows=['#65527e','#57486c','#72547e','#77598e','#514b70','#8b668c','#657694'];
    const choose=a=>a[Math.floor(rand()*a.length)];
    for (let i=-8;i<=8;i++) for (let j=-8;j<=6;j++) {
      const x=i*2.92+(rand()-.5)*1.3, z=j*2.72+(rand()-.5)*1.1;
      if (Math.abs(x)<10.6 && Math.abs(z)<5.5) continue;
      const w=.85+rand()*1.50, d=.9+rand()*1.05;
      const behind=z<-6.3, far=z<-13;
      let h=behind?3.2+rand()*(far?8.3:5.4):1.45+rand()*3.4;
      if (behind && rand()>.86) h+=1.6;
      const y=-7+h, col=choose(building);
      b.box(x,-7+h/2,z,w,h,d,col,.09,.055);
      b.box(x,y-.1,z,w+.09,.22,d+.09,'#4a395e',.09,.042);
      if (rand()>.36) {
        const rw=w*(.42+rand()*.26), rh=.24+rand()*.54;
        b.box(x+.06,y+rh/2,z-.06,rw,rh,d*.57,'#443650',.07,.04);
        if (behind && rand()>.64) {
          b.tube([x+.06,y+rh,z],[x+.06,y+rh+.65,z],.031,.016,4,'#8c659d');
          b.box(x+.06,y+rh+.69,z,.07,.09,.07,'#ed90c8',0,0,.65);
        }
      }
      const floors=Math.floor(h/.61), cols=Math.max(2,Math.floor(w/.34));
      for (let f=0;f<floors;f++) {
        const wy=y-.47-f*.60;
        for (let n=0;n<cols;n++) {
          if (rand()<.54) continue;
          const wx=x-w/2+w*(n+.5)/cols, wz=z+d/2+.005;
          const tint=choose(windows), ww=.067+rand()*.058, wh=.055+rand()*.065;
          b.quad([wx-ww,wy-wh,wz],[wx+ww,wy-wh,wz],[wx+ww,wy+wh,wz],[wx-ww,wy+wh,wz],tint,.19);
        }
        if (rand()>.36) {
          const xx=x+w/2+.006, zz=z+d*.06, length=d*(.13+rand()*.17);
          b.quad([xx,wy-.04,zz+length],[xx,wy-.04,zz-length],[xx,wy+.04,zz-length],[xx,wy+.04,zz+length],choose(windows),.15);
        }
      }
      if (behind && rand()>.83) {
        const neon=choose(['#ab63b6','#7d84c6','#d276b5','#9d6dcc']);
        b.box(x-w*.27,y-h*.23,z+d/2+.019,.074,Math.min(1.85,h*.32),.032,neon,0,0,.46);
      }
    }
    for (let i=-6;i<=6;i++) {
      b.box(i*3+1.4,-7.08,0,.035,.02,70,'#715375',0,0,.17);
      b.box(0,-7.08,i*3+1.25,70,.02,.026,'#594668',0,0,.16);
    }
    return b.finish();
  }
  function board() {
    const b=new Builder(), rand=M.seeded(57);
    const purples=['#48405a','#443c57','#49415e','#413b55','#4b415d'];
    const pick=a=>a[Math.floor(rand()*a.length)];
    // The open center channel exposes the illuminated machinery below the bridges.
    b.box(0,-.83,0,18.80,.43,8.91,'#252036',.90,.13);
    b.box(0,-.63,0,18.95,.12,8.98,'#825294',.88,.035,.16);
    b.box(0,-.51,0,18.88,.22,8.91,'#392c4d',.87,.06);
    b.box(0,-.43,0,1.57,.09,8.81,'#51386a',.18);
    for (const x of [-.41,-.22,.22,.41]) b.box(x,-.367,0,.044,.04,8.75,'#bc68d3',0,0,.68);
    for (let i=-7;i<=7;i++) b.box(0,-.34,i*.57,1.29,.07,.085,'#784a93',.018);
    for (let team=0;team<2;team++) {
      const s=team===0?-1:1, cx=s*4.92, accent=colors[team], trim=team?'#a44b78':'#367e87';
      b.box(cx,-.32,0,8.84,.54,8.78,'#3d324e',.57,.11);
      b.box(cx,-.095,0,8.81,.18,8.77,'#6d587e',.56,.055);
      b.box(cx,-.009,0,8.73,.084,8.69,'#39314b',.55,.026);
      for (let col=0;col<7;col++) for (let row=0;row<7;row++) {
        if ((col===6) && (row===0||row===6)) continue;
        b.box(s*(1.21+col*1.19),.043,(row-3)*1.20,1.167,.035,1.174,pick(purples),.036,.008);
      }
      for (const front of [-1,1]) {
        const z=front*4.19;
        b.box(cx,.11,z,7.74,.16,.23,'#746583',.075,.04);
        for (let i=0;i<4;i++) {
          const x=s*(1.62+i*1.93);
          b.box(x,.202,z,1.60,.035,.058,accent,.014,0,.81);
          b.box(x,-.32,front*4.405,1.53,.18,.10,'#26223a',.034,.026);
          b.box(x,-.31,front*4.463,1.07,.050,.017,accent,0,0,.89);
          b.box(x-.68,-.32,front*4.466,.086,.093,.018,trim);
        }
        for (const x of [s*.86,s*8.89]) {
          b.box(x,.17,front*3.89,.55,.28,.62,'#5d526d',.09,.055);
          b.box(x,.32,front*3.89,.40,.08,.43,trim,.08,.02);
          b.box(x,.368,front*3.89,.22,.028,.24,accent,.045,0,1);
        }
      }
      b.box(s*9.05,.135,0,.22,.20,6.84,'#746381',.075,.04);
      for (const z of [-2.4,0,2.4]) b.box(s*9.05,.245,z,.069,.025,1.52,accent,0,0,.77);
      for (const z of B.LANES) {
        b.box(s*4.52,.082,z,7.87,.062,2.27,'#332f47',.23,.02);
        for (let i=0;i<7;i++) {
          const x=s*(1.15+i*1.06);
          b.box(x,.128,z,1.033,.043,1.89,team?pick(['#655066','#695367','#634e63']):pick(['#4c5968','#515d6c','#505665']),.036,.009);
          if (i>4) continue;
          b.box(x,.155,z,.31,.014,.039,'#968497');
          for (const edge of [-1,1]) b.box(x,.16,z+edge*.88,.38,.019,.035,'#8a788a');
        }
        for (const edge of [-1,1]) {
          b.box(s*4.44,.129,z+edge*1.07,7.57,.082,.077,trim,.02,.01);
          for (let i=0;i<4;i++) b.box(s*(1.38+i*1.74),.180,z+edge*1.07,1.35,.018,.043,accent,0,0,.58);
        }
        // A pair of inset chevrons marks the direction of deployment.
        for (const x of [s*4.70,s*4.98]) for (const edge of [-1,1]) {
          b.group(x,.165,z+edge*.15,-edge*s*.55,0,0,g=>g.box(0,0,0,.082,.018,.38,accent));
        }
        b.cylinder(s*B.TOWER_X,.135,z,1.28,1.20,.16,8,'#383042',0,Math.PI/8);
        b.cylinder(s*B.TOWER_X,.223,z,1.19,1.17,.028,8,trim,.24,Math.PI/8);
        b.cylinder(s*B.TOWER_X,.246,z,1.10,1.10,.044,8,'#514554',0,Math.PI/8);
      }
      for (const x of [s*3.2,s*6.95]) {
        b.box(x,.091,0,1.63,.064,.57,'#302c40',.12,.02);
        for (let i=0;i<7;i++) b.group(x-.57+i*.185,.139,0,-.32,0,0,g=>g.box(0,0,0,.070,.026,.38,'#65596e'));
      }
      for (const front of [-1,1]) for (let i=0;i<3;i++) {
        const x=s*(2.22+i*2.34), z=front*3.68;
        b.box(x,.089,z,1.09,.041,.23,'#332f42',.055);
        for (let k=0;k<3;k++) b.group(x+(k-1)*.22,.117,z,-.46,0,0,g=>g.box(0,0,0,.080,.017,.16,'#ab8c83'));
      }
    }
    for (const z of B.LANES) {
      b.box(0,-.075,z,2.15,.39,2.38,'#3c324f',.16,.07);
      b.box(0,.105,z,2.11,.11,2.27,'#7a6687',.12,.028);
      for (let i=-3;i<=3;i++) b.box(i*.282,.18,z,.246,.055,1.94,i%2?'#5f536e':'#6f5e78',.032,.011);
      for (const edge of [-1,1]) {
        b.box(0,.24,z+edge*1.09,2.20,.21,.16,'#65506f',.046,.035);
        b.box(0,.36,z+edge*1.09,1.32,.039,.09,'#d8a3e4',.018,0,.70);
        for (const x of [-.91,.91]) b.box(x,.36,z+edge*1.09,.23,.055,.15,x<0?colors[0]:colors[1],.026,0,.83);
      }
      const dock = dockZ(z);
      b.box(0, .19, dock, 1.26, .20, .60, '#514451', .13, .04);
      b.box(0, .30, dock, 1.13, .064, .48, '#ad8158', .10, .018);
      b.cylinder(0, .36, dock, .23, .20, .07, 6, '#ffcf80', .75);
      for (const end of [-1, 1]) {
        b.box(end * .49, .42, dock, .13, .22, .33, '#7f685f', .04, .02);
        b.box(end * .49, .55, dock, .105, .045, .23, '#ffe3a2', .02, 0, .85);
      }
    }
    b.cylinder(0,-.19,0,.82,.75,.27,8,'#493455',0,Math.PI/8);
    b.cylinder(0,-.035,0,.63,.63,.07,8,'#dd8ee7',.68,Math.PI/8);
    b.cylinder(0,.035,0,.53,.45,.085,8,'#5d4975',0,Math.PI/8);
    b.cylinder(0,.09,0,.29,.25,.055,4,'#bc8fda',.46);
    return b.finish();
  }
  function camera(width,height,view=0,drift=0) {
    const aspect=Math.max(1,width)/Math.max(1,height), yaw=M.lerp(.31,.045,view)+drift, pitch=M.lerp(.555,1.105,view);
    const nearWidth=Math.cos(yaw)*9.55+Math.sin(yaw)*4.7;
    const nearDepth=(Math.sin(yaw)*9.55+Math.cos(yaw)*4.7)*Math.sin(pitch);
    const halfH=Math.max((nearWidth+1.08)/aspect,nearDepth+1.26);
    const target=[0,.47,0];
    const eye=[32*Math.sin(yaw)*Math.cos(pitch),target[1]+32*Math.sin(pitch),32*Math.cos(yaw)*Math.cos(pitch)];
    const vp=M.multiply(M.ortho(-halfH*aspect,halfH*aspect,-halfH,halfH,.1,92),M.lookAt(eye,target));
    return {vp,inverse:M.inverse(vp),eye};
  }
  function pickLane(point) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[2])) return null;
    if (Math.abs(point[0])>9.42 || Math.abs(point[2])>4.43 || Math.abs(point[2])<.57) return null;
    return point[2]<0?0:1;
  }
  function pickSite(point) {
    const lane = pickLane(point);
    return lane === null ? null : {lane, socket:Coils.nearestSocket(point[0])};
  }
  function portraitCamera(vertices,aspect) {
    const eye=[6.75,4.6,7.65], view=M.lookAt(eye,[0,1.27,0]);
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for (let i=0;i<vertices.length;i+=mesh.STRIDE) {
      const [x,y]=M.transformPoint(view,[vertices[i],vertices[i+1],vertices[i+2]]);
      left=Math.min(left,x);right=Math.max(right,x);
      bottom=Math.min(bottom,y);top=Math.max(top,y);
    }
    const cx=(left+right)/2, cy=(bottom+top)/2;
    const halfH=Math.max(top-bottom,(right-left)/aspect)*.55, halfW=halfH*aspect;
    const vp=M.multiply(M.ortho(cx-halfW,cx+halfW,cy-halfH,cy+halfH,.1,30),view);
    return {vp,eye};
  }
  return {board,city,camera,pickLane,pickSite,portraitCamera,cachePosition};
});
