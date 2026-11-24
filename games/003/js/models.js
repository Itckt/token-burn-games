(function (root,factory) {
  const common=typeof module==='object' && module.exports;
  const api=factory(common?require('./mesh.js'):root.Rift.mesh);
  if (common) module.exports=api;
  else (root.Rift=root.Rift||{}).models=api;
})(globalThis,function (mesh) {
  'use strict';
  const {Builder}=mesh;
  const TEAM=['#5bfff0','#ff5ca6'];
  const PAINT={
    strider:['#19364a','#207e91','#51caca','#b2f4dd','#6ffff1'],
    ram:['#492c42','#a84d3e','#e98b55','#ffd09b','#ffb34e'],
    wasp:['#32294e','#6f51a6','#b48be6','#e7c5ff','#f1a1ff'],
    mortar:['#363b44','#83734a','#d4ac61','#ffdf95','#ffed87'],
    tender:['#243c39','#427e69','#83ba86','#d1f0b5','#bdff87'],
    splitpin:['#24344e','#4168a0','#81a9dc','#d0e6ff','#a2f2ff'],
    skiff:['#443341','#9e5943','#df9566','#ffe3b2','#ffce84'],
    carrier:['#283743','#876347','#e8ad68','#ffe3aa','#b3ff97']
  };
  const iron='#28283f', steel='#62617b', joint='#171b31', glass='#182c40';
  function wheel(b,x,y,z,r,side,p) {
    const tip=z+side*.085;
    b.tube([x,y,z],[x,y,tip],r,r*.92,10,iron);
    b.tube([x,y,tip],[x,y,tip+side*.023],r*.64,r*.58,8,p[1]);
    b.tube([x,y,tip+side*.024],[x,y,tip+side*.04],r*.25,r*.25,6,p[3]);
  }
  function strider(b,p,lamp) {
    for (const side of [-1,1]) {
      const z=side*.40, step=side*.19;
      b.box(step+.11,.16,z,.83,.28,.50,p[0],.11,.055);
      b.box(step+.28,.24,z,.61,.22,.52,p[2],.09,.05);
      b.group(step,.60,z,0,0,side*.14,g=>{
        g.box(0,0,0,.40,.68,.41,iron,.08,.045);
        g.box(.10,.04,side*.035,.37,.55,.45,p[2],.08,.055);
        g.box(.293,.06,0,.025,.27,.20,p[3],.01,0);
        g.box(.01,.01,side*.254,.19,.33,.023,p[1]);
      });
      wheel(b,step+.06,.88,z+side*.18,.205,side,p);
      b.tube([step,.91,z],[.015,1.28,side*.31],.18,.21,8,steel);
      b.box(step*.5,1.1,z,.39,.35,.47,p[1],.07,.05);
    }
    b.box(-.04,1.23,0,.68,.26,.99,iron,.11,.055);
    b.box(.03,1.55,0,.82,.54,1.08,p[1],.15,.08);
    b.box(.18,1.66,0,.67,.38,.97,p[2],.12,.07);
    b.box(.529,1.65,0,.028,.11,.48,glass,.01);
    b.box(.546,1.65,0,.018,.055,.34,lamp,0,0,.9);
    b.box(-.49,1.65,0,.34,.69,.65,p[0],.08,.04);
    for (const side of [-1,1]) {
      const z=side*.72;
      b.tube([0,1.67,side*.46],[0,1.67,z],.22,.21,8,steel);
      b.box(-.015,1.78,z,.72,.41,.49,p[2],.11,.08);
      b.box(.02,1.88,z+side*.012,.48,.19,.51,p[3],.075,.035);
      b.box(.15,1.76,z+side*.251,.22,.045,.018,lamp,0,0,.85);
      b.tube([-.04,1.63,z],[.17,1.27,z+side*.06],.14,.16,8,iron);
      b.group(.23,1.23,z+side*.06,0,0,-.4,g=>{
        g.box(0,0,0,.41,.32,.35,p[1],.075,.045);
        g.box(.17,-.065,0,.24,.24,.31,iron,.055,.035);
        g.tube([.14,-.19,0],[.84,-.38,0],.10,.012,4,lamp,.74);
      });
    }
    b.box(-.02,1.91,0,.42,.24,.53,iron,.06);
    b.box(.03,2.14,0,.82,.55,.79,p[2],.13,.075);
    b.box(.09,2.29,0,.68,.24,.84,p[3],.12,.052);
    b.box(.42,2.13,0,.13,.24,.67,glass,.045,.017);
    b.box(.494,2.17,0,.026,.095,.56,lamp,.01,0,1.15);
    b.box(.42,1.99,0,.13,.13,.45,p[0],.04,.025);
    for (const side of [-1,1]) {
      b.box(.26,2.15,side*.374,.38,.13,.066,glass,.024);
      b.box(.29,2.174,side*.415,.25,.042,.013,lamp,0,0,.85);
    }
    b.tube([-.20,2.33,-.25],[-.31,2.71,-.27],.035,.024,6,steel);
    b.tube([-.31,2.70,-.27],[-.324,2.78,-.27],.036,.022,6,lamp,1);
  }
  function ram(b,p,lamp) {
    for (const s of [-1,1]) {
      const z=s*.71;
      b.box(-.08,.39,z,2.13,.66,.51,joint,.19,.12);
      for (let i=0;i<4;i++) wheel(b,-.76+i*.45,.38,z+s*.239,.235,s,p);
      for (let i=0;i<7;i++) b.box(-.89+i*.266,.68,z,.085,.09,.53,steel,.012);
      b.box(-.11,.82,z,2.07,.28,.59,p[1],.16,.064);
      b.box(.01,.95,z,1.77,.16,.61,p[2],.14,.054);
      b.box(.35,1.037,z,.095,.018,.53,p[3]);
      b.box(.54,1.037,z,.052,.018,.50,p[3]);
      b.box(-.48,.83,z+s*.30,.64,.072,.022,p[0]);
      b.box(-.43,.832,z+s*.315,.37,.035,.011,lamp,0,0,.85);
      b.group(.88,.56,z,0,0,-.13,g=>{
        g.box(.04,0,0,.43,.40,.45,p[2],.085,.065);
        g.tube([.19,.01,0],[.51,.09,0],.17,.026,4,p[3]);
      });
    }
    b.box(0,.72,0,1.83,.62,1.25,p[0],.24,.10);
    b.box(.08,1.08,0,1.76,.42,1.33,p[2],.26,.085);
    b.group(.16,1.38,0,0,0,-.08,g=>{
      g.box(-.03,0,0,1.19,.51,1.01,p[1],.19,.095);
      g.box(-.06,.18,0,1.10,.26,1.06,p[2],.19,.062);
      g.box(.54,.04,0,.12,.25,.77,glass,.05,.025);
      g.box(.611,.069,0,.025,.096,.65,'#fff1a0',.009,0,1.20);
      g.box(.54,-.15,0,.21,.15,.48,p[0],.055,.03);
      for (const s of [-1,1]) {
        g.box(.25,.035,s*.489,.49,.17,.074,p[0],.025);
        g.box(.32,.065,s*.53,.27,.054,.012,lamp,0,0,.8);
      }
    });
    for (const s of [-1,1]) {
      b.tube([-.72,1.16,s*.38],[-.85,1.67,s*.38],.13,.13,8,iron);
      b.tube([-.83,1.57,s*.38],[-.87,1.71,s*.38],.155,.155,8,steel);
      b.tube([-.868,1.705,s*.38],[-.88,1.725,s*.38],.092,.092,8,p[0]);
    }
    b.box(.92,.91,0,.26,.32,.82,iron,.07,.05);
    for (let i=-2;i<=2;i++) b.box(1.06,.92,i*.137,.028,.14,.055,p[3]);
  }
  function wasp(b,p,lamp) {
    for (const s of [-1,1]) {
      const mirror=points=>s===1?points:points.map(([x,z])=>[x,-z]).reverse();
      b.poly(mirror([[.64,.32],[-.34,.27],[-1.12,1.45],[-.72,1.62],[.25,1.05]]),.79,.92,p[1]);
      b.poly(mirror([[.48,.39],[-.28,.35],[-.96,1.41],[-.73,1.48],[.15,.99]]),.922,.993,p[2]);
      b.poly(mirror([[.21,.66],[-.11,.61],[-.67,1.38],[-.50,1.30]]),.995,1.012,p[3]);
      b.tube([-.62,.83,s*1.24],[-1.11,.83,s*1.47],.113,.074,7,lamp,.95);
      b.tube([-.63,.79,s*.86],[.48,.79,s*.69],.20,.16,8,p[0]);
      b.tube([.39,.79,s*.71],[.82,.79,s*.66],.12,.09,8,steel);
      b.tube([.79,.79,s*.665],[.91,.79,s*.65],.12,.11,8,lamp,.85);
      b.cylinder(-.35,.66,s*.86,.24,.29,.19,10,p[0]);
      b.cylinder(-.35,.55,s*.86,.17,.24,.06,10,lamp,1.05);
    }
    b.box(-.05,.88,0,1.89,.42,.73,p[0],.29,.08);
    b.box(.12,1.09,0,1.51,.37,.78,p[2],.29,.09);
    b.box(.34,1.23,0,.94,.34,.57,p[1],.20,.085);
    b.box(.55,1.24,0,.64,.24,.52,'#513457',.19,.06);
    b.box(.76,1.24,0,.28,.135,.41,lamp,.10,.038,1.12);
    b.box(.96,1.02,0,.26,.15,.39,p[3],.08,.03);
    for (const s of [-1,1]) b.group(-.69,1.18,s*.20,0,s*.32,.38,g=>{
      g.box(0,0,0,.37,.66,.11,p[2],.035,.038);
      g.box(0,.17,s*.06,.215,.08,.017,lamp,0,0,.9);
    });
    b.tube([-.82,.85,0],[-1.30,.92,0],.21,.09,8,p[1]);
    b.tube([-1.25,.91,0],[-1.42,.94,0],.085,.018,6,lamp,1);
  }
  function mortar(b,p,lamp) {
    for (const s of [-1,1]) for (const end of [-1,1]) {
      const x=end*.64, z=s*.70;
      b.tube([end*.35,.75,s*.35],[x,.67,z],.19,.20,8,iron);
      b.box(x,.70,z,.47,.42,.45,p[2],.075,.07);
      b.tube([x,.65,z],[end*.80,.26,s*.90],.165,.135,8,p[0]);
      b.box(end*.82,.17,s*.92,.61,.25,.45,p[1],.10,.05);
      b.box(end*.88,.14,s*.93,.46,.18,.49,p[2],.09,.035);
      b.box(x,.74,z+s*.23,.26,.065,.023,lamp,0,0,.9);
    }
    b.box(-.13,.90,0,1.70,.48,1.18,p[0],.20,.08);
    b.box(-.12,1.10,0,1.55,.34,1.36,p[2],.17,.07);
    for (const s of [-1,1]) {
      b.box(-.21,1.28,s*.53,1.10,.24,.39,p[1],.10,.04);
      for (let i=0;i<3;i++) b.box(-.53+i*.22,1.404,s*.53,.075,.018,.26,p[3]);
      b.box(.69,1.12,s*.36,.064,.13,.26,glass,.02);
      b.box(.731,1.14,s*.36,.018,.061,.17,lamp,0,0,1);
    }
    b.cylinder(-.10,1.30,0,.50,.43,.21,10,steel);
    b.group(-.16,1.48,0,0,0,.32,g=>{
      g.box(-.26,0,0,.80,.63,.77,p[1],.13,.075);
      g.tube([-.38,0,0],[.88,0,0],.32,.27,8,iron);
      for (let i=0;i<4;i++) {
        const x=.04+i*.178;
        g.tube([x,0,0],[x+.081,0,0],.35,.34,8,p[2]);
        g.tube([x+.082,0,0],[x+.103,0,0],.29,.29,8,lamp,.88);
      }
      g.tube([.75,0,0],[1.36,0,0],.29,.37,8,p[2]);
      g.tube([1.30,0,0],[1.44,0,0],.38,.38,8,p[3]);
      g.tube([1.442,0,0],[1.452,0,0],.277,.277,8,joint);
      g.tube([1.454,0,0],[1.46,0,0],.16,.16,8,lamp,1.04);
      g.box(.03,.36,0,.40,.11,.16,p[0],.025);
    });
    b.tube([-.77,1.14,-.32],[-.82,1.86,-.32],.032,.02,6,steel);
    b.cylinder(-.82,1.88,-.32,.045,.03,.08,6,lamp,1);
  }
  // The upright bobbin and two sewing arms make the repair crew readable at board scale.
  function tender(b, p, lamp) {
    b.box(0, .47, 0, 1.30, .42, .94, p[0], .21, .09);
    for (const side of [-1, 1]) {
      for (const x of [-.39, .39]) wheel(b, x, .31, side * .44, .28, side, p);
      b.box(.01, .62, side * .48, 1.21, .18, .29, p[2], .08, .035);
      b.tube([.20,.78,side*.34], [.70,1.32,side*.63], .11,.09,6, p[1]);
      b.tube([.70,1.32,side*.63], [.99,1.12,side*.51], .09,.035,6, p[3]);
      b.tube([.99,1.12,side*.51], [1.15,1.03,side*.44], .044,.012,5, lamp, 1);
    }
    b.cylinder(-.18, .75, 0, .44, .44, .14, 10, p[1]);
    b.cylinder(-.18, 1.13, 0, .26, .26, .72, 10, p[0]);
    for (let ring = 0; ring < 4; ring++) {
      b.cylinder(-.18, .88 + ring * .15, 0, .32, .33, .082, 10, '#b4f695', .64);
    }
    b.cylinder(-.18, 1.51, 0, .43, .39, .14, 10, p[2]);
    b.cylinder(-.18, 1.63, 0, .23, .11, .12, 8, p[3]);
    b.box(.47, .88, 0, .35, .34, .58, p[2], .10, .045);
    b.box(.65, .91, 0, .034, .10, .39, lamp, .01, 0, 1);
  }
  function splitpin(b, p, lamp) {
    b.box(-.12, .45, 0, 1.28, .28, .53, p[0], .19, .07);
    b.box(-.20, .67, 0, .94, .37, .59, p[2], .16, .085);
    for (const side of [-1, 1]) {
      wheel(b, -.40, .32, side * .26, .31, side, p);
      b.tube([.17,.46,side*.20], [.96,.22,side*.42], .105,.042,5,p[3]);
      b.box(.78, .16, side * .42, .58,.115,.12, lamp, .035,.02,.64);
      b.tube([-.45,.77,side*.17], [-.91,1.14,side*.29], .10,.018,4, p[1]);
    }
    b.box(.23,.75,0,.43,.22,.42,p[1],.08,.045);
    b.box(.452,.76,0,.024,.086,.30,lamp,.008,0,1);
  }
  function skiff(b, p, lamp) {
    b.box(0,.50,0,1.65,.38,.66,p[0],.24,.08);
    for (const side of [-1, 1]) {
      const z = side * .49;
      b.tube([-.67,.34,z],[.72,.34,z],.21,.12,8,p[1]);
      b.tube([-.76,.34,z],[-.68,.34,z],.14,.18,8,lamp,.90);
      b.box(.02,.50,z,.95,.14,.24,p[3],.08,.03);
    }
    b.box(.34,.76,0,.88,.32,.60,p[2],.15,.065);
    b.box(.81,.78,0,.11,.12,.33,lamp,.028,.016,1);
    b.cylinder(-.31,.80,0,.27,.19,.33,8,steel);
    // The screen opens like a folding fan. Each rib has a lit copper tip.
    for (let rib = -3; rib <= 3; rib++) {
      b.group(-.31,.88,0,0,rib * .34,.16,g => {
        const length = 1.23 - Math.abs(rib) * .055;
        g.tube([0,.04,0],[-.04,length,0],.048,.073,5,p[1]);
        g.box(-.055,length*.72,0,.13,length*.55,.26,p[rib % 2 ? 2 : 3],.045,.04);
        g.box(-.07,length,0,.18,.21,.34,p[2],.055,.04);
        g.box(.03,length,0,.028,.102,.24,lamp,.015,.008,.9);
      });
    }
    b.tube([-.35,.91,0],[.02,.91,0],.20,.14,8,p[3]);
    b.tube([.02,.91,0],[.053,.91,0],.105,.09,8,lamp,1);
  }
  function carrier(b, p, lamp) {
    b.box(0,.42,0,1.72,.35,1.09,p[0],.17,.08);
    for (const side of [-1, 1]) {
      for (const x of [-.53,.53]) wheel(b,x,.31,side*.48,.27,side,p);
      b.box(.02,.57,side*.54,1.61,.14,.14,lamp,.045,.025,.48);
    }
    b.box(-.14,.95,0,1.12,.72,.89,'#daa368',.065,.055);
    b.box(-.14,1.33,0,1.17,.105,.94,'#ffdaa0',.056,.023);
    for (const x of [-.47,.20]) b.box(x,.99,0,.10,.82,.96,'#6e5261',.018,.028);
    b.box(.58,.78,0,.46,.35,.78,p[2],.11,.065);
    b.box(.822,.81,0,.023,.096,.56,lamp,.01,0,.9);
  }
  const machines={strider,ram,wasp,mortar,tender,splitpin,skiff,carrier};
  function unit(id,team=null) {
    const b=new Builder(), base=PAINT[id];
    if (!Object.hasOwn(machines,id)) throw new RangeError('Unknown unit '+id);
    const p=team===null?base:team===0?['#193449','#276477','#55a8ae','#afe6d7',TEAM[0]]:['#412642','#803f64','#d4759c','#f6bad3',TEAM[1]];
    machines[id](b,p,team===null?base[4]:TEAM[team]);
    return b.finish();
  }
  function portrait(id) {
    if (id !== 'splitpin') return unit(id);
    const b = new Builder(), p = PAINT.splitpin;
    b.group(.48, 0, -.61, -.08, 0, 0, g => splitpin(g, p, p[4]));
    b.group(-.38, 0, .59, .13, 0, 0, g => splitpin(g, p, p[4]));
    return b.finish();
  }
  function deliveryGate() {
    const b = new Builder(), lamp = '#c9ff9b';
    for (const side of [-1, 1]) {
      const z = side * 1.04;
      b.box(0,.09,z,.60,.18,.33,'#42524c',.07,.03);
      b.box(0,.64,z,.20,1.03,.23,'#779082',.045,.035);
      b.box(-.11,.73,z,.03,.73,.10,lamp,.009,0,.85);
      b.tube([0,1.11,z],[0,1.45,z*.78],.12,.10,6,'#abcc9c');
    }
    b.box(0,1.47,0,.18,.13,1.65,'#728d81',.044,.024);
    b.box(-.10,1.47,0,.028,.055,.96,lamp,.009,0,.95);
    return b.finish();
  }
  function tower(team) {
    const b=new Builder(), t=TEAM[team], dark=team?'#56334e':'#264353', armor=team?'#b76391':'#579cab', pale=team?'#d88cba':'#8bc2ce';
    b.box(0,.12,0,2.08,.24,1.97,'#212034',.36,.075);
    b.box(0,.24,0,1.96,.09,1.84,t,.33,.018,.85);
    b.box(0,.40,0,1.94,.31,1.82,dark,.32,.085);
    b.cylinder(0,.59,0,.88,.77,.26,8,armor,0,Math.PI/8);
    b.cylinder(0,.76,0,.76,.66,.18,8,iron,0,Math.PI/8);
    b.cylinder(0,.885,0,.65,.59,.09,8,t,.84,Math.PI/8);
    b.cylinder(0,1.03,0,.59,.47,.21,8,dark,0,Math.PI/8);
    for (const side of [-1,1]) for (const end of [-1,1]) {
      const x=end*.62, z=side*.59;
      b.group(x,.89,z,0,side*.16,-end*.15,g=>{
        g.box(0,0,0,.36,.85,.35,armor,.07,.065);
        g.box(0,.48,0,.32,.32,.31,pale,.07,.055);
        g.box(0,.16,side*.18,.14,.51,.02,t,0,0,.85);
      });
      b.box(end*.72,.44,side*.733,.18,.15,.055,pale,.014);
    }
    for (const s of [-1,1]) {
      b.box(0,.40,s*.90,.70,.15,.085,'#22223b',.02);
      for (let i=-1;i<2;i++) b.box(i*.18,.41,s*.947,.088,.06,.012,t,0,0,.78);
    }
    return b.finish();
  }
  function crystal(team) {
    const b=new Builder(), t=TEAM[team], pale=team?'#ffe4ed':'#d9fffc', mid=team?'#f981b9':'#89f9f2';
    b.cylinder(0,.19,0,.085,.42,.39,5,t,.46);
    b.cylinder(0,.64,0,.42,.295,.51,5,mid,.32);
    b.cylinder(0,1.05,0,.295,.028,.31,5,pale,.53);
    return b.finish();
  }
  function signalCache() {
    const b = new Builder(), frame = '#584555', brass = '#d49450', light = '#ffe4a1';
    // Suspended induction cell with three separate fins around its luminous core.
    b.cylinder(0, .05, 0, .10, .34, .28, 6, '#f4b95b', .55);
    b.cylinder(0, .26, 0, .34, .30, .14, 6, light, .92);
    b.cylinder(0, .46, 0, .30, .06, .26, 6, '#ffd07a', .62);
    for (let fin = 0; fin < 3; fin++) {
      b.group(0, 0, 0, fin * Math.PI * 2 / 3, 0, 0, g => {
        g.tube([.11, -.19, 0], [.44, .08, 0], .085, .09, 5, frame);
        g.box(.44, .22, 0, .13, .36, .20, brass, .025, .025);
        g.box(.51, .24, 0, .025, .18, .095, light, .008, 0, 1);
        g.tube([.44, .41, 0], [.32, .53, 0], .08, .038, 5, '#ffe2a2');
      });
    }
    return b.finish();
  }
  function snareCoil() {
    const b = new Builder();
    // Two induction heads straddle the track, leaving the machines visible.
    for (const side of [-1, 1]) {
      const z = side * .91;
      b.box(0, .07, z, .58, .14, .30, '#343345', .065, .025);
      b.cylinder(0, .23, z, .11, .08, .29, 8, '#a781ac');
      for (const y of [.19, .29, .39]) b.cylinder(0, y, z, .17, .15, .05, 8, '#eee1ff', .86);
      b.cylinder(0, .47, z, .13, .04, .12, 6, '#fff4ff', 1);
    }
    return b.finish();
  }
  function freightCart() {
    const b = new Builder();
    b.box(0,.16,0,1.28,.22,.63,'#374351',.15,.04);
    for (const side of [-1,1]) {
      b.box(0,.095,side*.32,.98,.09,.10,'#96e6f0',.035,.018,.67);
      b.box(0,.28,side*.29,1.13,.095,.10,'#daa774',.035,.02);
    }
    for (const x of [-.29,.29]) {
      b.box(x,.47,0,.50,.43,.47,'#d38a53',.05,.035);
      b.box(x,.71,0,.53,.07,.50,'#ffe1a6',.04,.016);
      b.box(x,.47,0,.09,.46,.485,'#714f59',.01,.008);
    }
    return b.finish();
  }
  function freightTrack(dock) {
    const b = new Builder();
    for (const side of [-1,1]) {
      b.box(0,.055,side*.205,2*dock+.60,.08,.065,'#ccab80',.022,.012,.28);
    }
    for (let i=-6;i<=6;i++) {
      const x = i*dock/6;
      b.box(x,.018,0,.13,.045,.52,'#5b5364');
      if (i % 3 === 0) b.box(x,-.23,0,.25,.46,.31,'#514d5d',.04,.015);
    }
    for (const end of [-1,1]) {
      const x = end*dock, color = TEAM[end < 0 ? 0 : 1];
      b.box(x,.10,0,.77,.13,.80,'#4d4859',.09,.025);
      for (const side of [-1,1]) {
        b.box(x,.23,side*.39,.72,.21,.11,'#816b6e',.04,.02);
        b.box(x,.352,side*.39,.61,.045,.095,color,.022,.008,.90);
      }
    }
    return b.finish();
  }
  function fuse() {
    const b = new Builder();
    b.cylinder(0,.20,0,.102,.102,.27,6,'#ffc478',.95);
    for (const y of [.065,.337]) b.cylinder(0,y,0,.15,.15,.10,6,'#fff1bc',.38);
    b.box(.112,.20,0,.035,.18,.05,'#855334');
    return b.finish();
  }
  function uplink() {
    const b = new Builder();
    b.cylinder(0,.12,0,.57,.46,.23,8,'#594354');
    b.cylinder(0,.31,0,.35,.24,.18,8,'#e7b47e');
    b.cylinder(0,.69,0,.13,.10,.70,6,'#907480');
    for (const y of [.48,.66,.84]) b.cylinder(0,y,0,.17,.17,.052,6,'#ffce90',.76);
    for (let n = 0; n < 3; n++) {
      b.group(0,.71,0,n*2*Math.PI/3,0,0,g => {
        g.tube([.08,0,0],[.38,.40,0],.085,.062,5,'#c89772');
        g.tube([.38,.40,0],[.27,.61,0],.064,.029,5,'#ffdb98',.90);
      });
    }
    b.cylinder(0,1.14,0,.11,.06,.26,6,'#fff2bc',1);
    return b.finish();
  }
  return {unit,portrait,deliveryGate,tower,crystal,signalCache,snareCoil,freightCart,freightTrack,fuse,uplink,TEAM};
});
