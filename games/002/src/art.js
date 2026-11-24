(() => {
  "use strict";
  const node=typeof module === "object" && module.exports;
  const {Builder,TAU}=node ? require("./mesh.js") : Slipwake.mesh;
  const M=node ? require("./math.js") : Slipwake.math;
  const A=node ? require("./arena.js") : Slipwake.arena;
  const Relay=node ? require("./relay.js") : Slipwake.relay;
  const Signal=node ? require("./signal.js") : Slipwake.signal;
  const Freight=node ? require("./freight.js") : Slipwake.freight;
  const C={ink:"#243940",deep:"#354c51",steel:"#647a7b",edge:"#9caba3",white:"#d8d6b9",
    gold:"#efa948",pale:"#ffd375",cyan:"#5bdfcc",red:"#ff8666",tar:"#334448"};
  const teamPaint=[
    {shell:"#36ac9e",light:"#81ead1",dark:"#27676a",visor:"#bcffe9",trim:"#f8b352"},
    {shell:"#e56e4d",light:"#ffb47d",dark:"#984c42",visor:"#ffe6ae",trim:"#e8cf9a"}
  ];
  function cargo(b,w,h,d,paint) {
    const palette={
      green:["#387d79","#62a198","#285957"], gold:["#ce913a","#edb355","#996b33"],
      red:["#a85f4f","#d48162","#794e48"],blue:["#526f7f","#7f9ba2","#3f5867"]
    };
    const [base,light,dark]=palette[paint];
    b.bevel(0,h/2,0,w,h,d,base,0.095,0.04);
    const count=Math.floor(w/0.37);
    for (let i=0;i<count;i++) {
      const x=(i-(count-1)/2)*(w-0.48)/count;
      b.box(x,h+0.018,0,0.10,0.035,d-0.24,light);
      for (const side of [-1,1]) b.box(x,h*0.51,side*d/2,0.095,h-0.3,0.085,light);
    }
    for (const side of [-1,1]) {
      b.box(0,0.11,side*d/2,w,0.14,0.13,dark);
      b.box(0,h-0.07,side*d/2,w,0.12,0.13,base);
      for (const end of [-1,1]) {
        const x=end*(w/2-0.085),z=side*(d/2-0.055);
        b.box(x,h/2,z,0.16,h+0.06,0.18,dark);
        b.box(x,h+0.025,z,0.17,0.09,0.19,C.edge);
        b.box(end*(w/2+0.025),h*0.5,side*d*0.22,0.07,h*0.82,0.055,C.white);
      }
    }
    b.tile(-w*0.30,h+0.043,0,0.65,d*0.6,dark);
    for (let i=0;i<3;i++) b.tile(-w*0.30+(i-1)*0.14,h+0.048,0,0.056,d*0.34,C.white);
    b.box(w*0.25,h*0.64,d/2+0.053,0.69,0.24,0.018,C.white);
    b.box(w*0.25-0.07,h*0.65,d/2+0.066,0.4,0.052,0.012,dark);
  }
  function crate(b,w,h,d,small=false) {
    const amber=small ? "#82918b" : "#d69d4e", frame=small ? "#485e61" : "#855f3a";
    b.bevel(0,h/2,0,w,h,d,amber,0.12,0.08);
    for (const side of [-1,1]) {
      b.box(side*(w/2-0.13),h/2,0,0.14,h+0.025,d,frame);
      b.box(0,h/2,side*(d/2-0.10),w,h+0.02,0.12,frame);
      b.box(0,h*0.16,side*d/2,w,0.20,0.075,C.ink);
      b.box(0,h*0.86,side*d/2,w,0.13,0.075,amber);
    }
    const v=w/2-0.23,k=d/2-0.2;
    b.line(-v,-k,v,k,0.11,C.pale,h+0.027);
    b.line(-v,k,v,-k,0.11,C.pale,h+0.029);
    b.beam([-v,0.25,d/2+0.015],[v,h-0.19,d/2+0.015],0.07,0.12,frame);
    b.beam([-v,h-0.19,d/2+0.016],[v,0.25,d/2+0.016],0.07,0.12,frame);
    b.tile(0,h+0.035,0,0.34,0.26,C.white);
  }
  function cooler(b,w,h,d) {
    b.bevel(0,h/2,0,w,h,d,"#516b70",0.15,0.09);
    b.bevel(0,h*0.88,0,w+0.035,0.20,d+0.035,"#9caaa1",0.12,0.045);
    for (const s of [-1,1]) {
      b.box(0,h*0.5,s*d/2,w-0.3,0.43,0.045,C.ink);
      for (let i=0;i<10;i++) b.box((i-4.5)*(w-0.4)/10,h*0.5,s*(d/2+0.035),0.08,0.39,0.045,C.steel);
    }
    for (const x of [-w*0.225,w*0.225]) {
      b.drum(x,h+0.045,0,0.52,0.11,0.52,16,C.deep);
      b.ring(x,h+0.11,0,0.43,0.50,20,C.edge);
      for (let i=0;i<6;i++) b.at(x,h+0.106,0,i*TAU/6,()=>{
        b.quad([-0.05,0,0.09],[-0.19,0,0.30],[0.03,0,0.41],[0.11,0,0.13],"#819394");
      });
      b.drum(x,h+0.135,0,0.12,0.07,0.12,8,C.tar);
    }
    b.box(0,h*0.6,d/2+0.07,0.30,0.23,0.035,C.gold);
  }
  function barrier(b,w,h,d) {
    b.bevel(0,h/2,0,w,h,d,"#9ba9a0",0.16,0.12);
    b.box(0,h*0.70,d/2,w-0.3,h*0.32,0.025,C.ink);
    for (let i=-2;i<=2;i++) {
      const x=i*0.47,y=h*0.70,z=d/2+0.022;
      b.quad([x-0.17,y-0.15,z],[x+0.02,y-0.15,z],[x+0.2,y+0.15,z],[x+0.01,y+0.15,z],C.gold);
    }
    b.tile(0,h+0.008,0,w-0.45,0.16,C.white);
    for (const s of [-1,1]) b.box(s*(w/2-0.34),0.12,0,0.47,0.22,d+0.28,C.deep);
  }
  function bolt(b,x,y,z,r=0.065) { b.drum(x,y,z,r,0.045,r,6,C.deep); }
  function bollard(b,x,y,z) {
    b.drum(x,y+0.08,z,0.34,0.16,0.34,8,C.tar);
    b.drum(x,y+0.28,z,0.20,0.39,0.20,8,C.gold);
    b.drum(x,y+0.51,z,0.26,0.13,0.26,8,C.ink);
  }
  function rail(b,x,z,len,yaw=0) {
    b.at(x,0,z,yaw,()=>{
      for (const px of [-len/2,0,len/2]) {
        b.box(px,0.03,0,0.27,0.12,0.27,C.ink);
        b.box(px,0.32,0,0.105,0.63,0.105,C.edge);
      }
      b.box(0,0.59,0,len+0.1,0.09,0.1,C.gold);
      b.box(0,0.30,0,len,0.045,0.055,C.steel);
    });
  }
  function chevrons(b,x,z,yaw,col,count=3,scale=1,y=0.035) {
    b.at(x,y,z,yaw,()=>{
      for (let i=0;i<count;i++) {
        const v=(i-(count-1)/2)*0.48*scale;
        b.line(v-0.20*scale,-0.45*scale,v+0.16*scale,0,0.13*scale,col,0);
        b.line(v+0.16*scale,0,v-0.20*scale,0.45*scale,0.13*scale,col,0);
      }
    });
  }
  function digits(b,value,x,z,size,col) {
    const parts=[[-0.32,-0.56,0.32,-0.56],[0.36,-0.5,0.36,-0.05],[0.36,0.05,0.36,0.50],
      [-0.32,0.56,0.32,0.56],[-0.36,0.05,-0.36,0.50],[-0.36,-0.5,-0.36,-0.05],[-0.32,0,0.32,0]];
    const glyphs={"0":[0,1,2,3,4,5],"1":[1,2],"2":[0,1,6,4,3],"6":[0,5,6,4,2,3]};
    [...value].forEach((char,i)=>{
      for (const k of glyphs[char]) {
        const [ax,az,bx,bz]=parts[k],off=(i-(value.length-1)/2)*size*0.95;
        b.line(x+off+ax*size,z+az*size,x+off+bx*size,z+bz*size,0.12*size,col,0.035);
      }
    });
  }
  function deck(b) {
    const rand=M.rng(81244);
    b.bevel(0,-1.02,0,30.35,1.86,18.95,"#425b60",0.68,0.20);
    b.bevel(0,-0.36,0,30.6,0.48,19.17,"#52696b",0.64,0.1);
    b.bevel(0,-0.13,0,30.42,0.22,19.05,"#89948a",0.63,0.04);
    b.bevel(0,-0.085,0,27.95,0.165,16.82,"#465b5c",0.22,0.025);
    const shades=["#788983","#7b8c86","#7a8a85","#788984","#7e8c85","#778984"];
    for (let j=0;j<6;j++) for (let i=0;i<8;i++) {
      const w=3.46,d=2.75,x=(i-3.5)*w,z=(j-2.5)*d;
      b.tile(x,0.002,z,w-0.023,d-0.023,shades[Math.floor(rand()*shades.length)]);
      if ((i+j)%2===0) for (const s of [-1,1]) b.tile(x+s*(w/2-0.12),0.009,z+d/2-0.14,0.064,0.064,"#50635f");
    }
    // Court paint is cut around the access panels and worn in the traffic lanes.
    for (const s of [-1,1]) {
      const tint=s<0 ? "#537f78" : "#987d6c";
      b.tile(s*11.67,0.012,0,3.15,15.9,tint);
      b.tile(s*9.99,0.016,0,0.11,15.9,C.white);
      b.tile(s*13.28,0.015,0,0.10,15.9,C.white);
      for (let i=-6;i<=6;i+=2) b.tile(s*10.18,0.024,i,0.35,0.06,C.white);
      digits(b,s<0 ? "01" : "02",s*11.66,0,1.48,"#c3c9b6");
      chevrons(b,s*11.45,3.0,s<0 ? 0 : Math.PI,s<0 ? "#8fc4ae" : "#d3ab8b",3,0.9);
      for (const side of [-1,1]) {
        b.line(s*9.85,side*7.86,s*1.45,side*7.86,0.07,C.white);
        b.line(s*9.88,side*7.79,s*9.88,side*6.6,0.10,C.white);
        b.line(s*1.45,side*7.86,s*0.98,side*7.35,0.08,C.white);
      }
    }
    b.drum(0,0.007,0,2.62,0.012,2.62,48,"#697c79");
    b.ring(0,0.023,0,2.45,2.52,64,"#c5c7ae");
    for (let k=0;k<4;k++) {
      b.ring(0,0.029,0,2.13,2.22,14,k%2 ? "#d5ad66" : "#adb8a7",k*Math.PI/2+0.12,(k+1)*Math.PI/2-0.12);
      b.at(0,0,0,k*Math.PI/2,()=>b.tile(0,0.031,2.46,0.19,0.42,C.white));
    }
    // The crossed relay mark is stencilled into the centre plate.
    for (const s of [-1,1]) {
      b.at(0,0,0,s<0 ? Math.PI : 0,()=>{
        b.quad([-0.96,0.035,-0.18],[-0.32,0.035,0.55],[0.83,0.035,0.55],[0.45,0.035,0.15],"#c5c8b2");
      });
      for (let z=3.12;z<7.45;z+=0.83) b.tile(0,0.021,s*z,0.075,0.47,"#c0c3a9");
    }
    for (let i=0;i<82;i++) {
      const x=(rand()-0.5)*26,z=(rand()-0.5)*15,len=0.09+rand()*0.48;
      b.line(x,z,x+len,z+len*0.18,0.014+rand()*0.018,"#81928a",0.038);
    }
    for (const sz of [-1,1]) {
      b.box(0,-0.53,sz*9.53,28.7,0.15,0.10,C.ink);
      for (let x=-12;x<=12;x+=4) {
        b.bevel(x,-0.8,sz*9.52,0.55,1.58,0.31,C.deep,0.08,0.05);
        b.box(x,-0.48,sz*9.69,0.36,0.36,0.05,C.gold);
        bolt(b,x,-0.008,sz*8.72,0.07);
      }
      for (const x of [-10.8,-4.4,4.4,10.8]) {
        b.tile(x,-0.012,sz*8.72,3.65,0.43,C.tar);
        for (let k=-3;k<=3;k++) b.line(x+k*0.47-0.14,sz*8.72-0.19,x+k*0.47+0.14,sz*8.72+0.19,0.205,C.gold,-0.005);
      }
      for (const x of [-10,0,10]) rail(b,x,sz*9.22,x===0 ? 4.8 : 4.1);
    }
    for (const sx of [-1,1]) {
      const team=sx<0 ? C.cyan : C.red;
      for (const sz of [-1,1]) {
        rail(b,sx*14.81,sz*5.83,3.35,Math.PI/2);
        b.bevel(sx*14.33,0.19,sz*2.4,0.71,0.46,0.72,C.deep,0.12);
        b.bevel(sx*14.33,0.57,sz*2.4,0.46,0.42,0.51,C.steel,0.08);
        b.box(sx*14.33,0.83,sz*2.4,0.43,0.17,0.47,team,0.66);
        bollard(b,sx*14.24,-0.016,sz*8.6);
      }
      b.tile(sx*14.27,-0.013,0,0.67,3.78,C.tar);
      for (let i=-4;i<=4;i++) b.tile(sx*14.27,-0.006,i*0.40,0.59,0.13,C.steel);
      b.box(sx*15.21,-0.85,0,0.15,0.55,2.65,C.ink);
    }
    for (const x of [-6.25,6.25]) {
      for (const side of [-1,1]) b.box(x+side*0.28,-0.78,9.71,0.07,1.68,0.11,C.gold);
      for (let y=-1.45;y<0;y+=0.29) b.box(x,y,9.77,0.62,0.058,0.065,C.steel);
    }
    for (const block of A.blocks) {
      const {x,z,w,h,d,kind}=block;
      b.at(x,0,z,0,()=>{
        b.tile(0,0.042,0,w+0.18,d+0.18,"#566963");
        if (kind==="cargo") cargo(b,w,h,d,block.paint);
        if (kind==="vent") cooler(b,w,h,d);
        if (kind==="crate" || kind==="case") crate(b,w,h,d,kind==="case");
        if (kind==="barrier") barrier(b,w,h,d);
      });
    }
  }
  function pier(b,w,d) {
    b.bevel(0,-0.66,0,w,1.08,d,"#455e60",0.22,0.12);
    b.bevel(0,-0.10,0,w+0.15,0.16,d+0.16,"#88938a",0.20,0.035);
    for (const x of [-w*0.39,w*0.39]) for (const z of [-d*0.35,d*0.35]) {
      b.drum(x,-1.57,z,0.36,1.25,0.36,8,C.deep);
      bollard(b,x,-0.025,z);
    }
  }
  function crane(b) {
    pier(b,4.95,4);
    for (const x of [-1.1,1.1]) {
      b.box(x,0.16,0,0.62,0.33,2.5,C.ink);
      for (const z of [-0.88,0.88]) b.beam([x,0.19,z],[x*0.68,1.92,z*0.74],0.30,0.30,C.gold);
    }
    b.bevel(0,1.96,0,2.5,0.41,2.04,C.deep);
    b.drum(0,2.20,0,0.82,0.19,0.82,12,C.gold);
    b.bevel(-0.38,2.72,0,1.98,0.94,1.59,"#d69d49",0.12);
    b.box(-0.7,2.85,0.80,0.78,0.50,0.05,"#415e64");
    b.box(-1.38,2.85,0,0.055,0.50,1.22,"#456369");
    b.bevel(-0.62,3.25,0,1.67,0.115,1.73,C.white,0.07);
    // Twin lattice girders carry the hoist line.
    for (const z of [-0.34,0.34]) {
      b.beam([0.0,3.05,z],[5.4,5.35,z],0.12,0.14,C.gold);
      b.beam([0.0,3.82,z],[5.4,5.69,z],0.13,0.14,C.pale);
      for (let i=0;i<7;i++) {
        const a=i/7,c=(i+1)/7;
        const low=t=>[5.4*t,3.05+2.30*t,z], high=t=>[5.4*t,3.82+1.87*t,z];
        b.beam(low(a),high(a),0.07,0.09,C.gold);
        b.beam(i%2 ? high(a) : low(a),i%2 ? low(c) : high(c),0.083,0.085,C.gold);
      }
      b.beam([-1.05,3.14,z],[0.23,4.86,z],0.10,0.10,C.ink);
      b.beam([0.23,4.86,z],[4.52,5.43,z],0.035,0.035,C.ink);
    }
    b.box(5.35,5.44,0,0.28,0.38,0.87,C.deep);
    for (const s of [-1,1]) b.beam([5.35,5.42,s*0.19],[5.35,2.28,s*0.19],0.033,0.033,C.ink);
    b.bevel(5.35,2.18,0,0.40,0.35,0.56,C.gold,0.08);
    b.beam([5.35,2.1,0],[5.35,1.77,0],0.10,0.11,C.ink);
    b.beam([5.35,1.77,0],[5.58,1.81,0],0.11,0.11,C.ink);
  }
  function tug(b) {
    const hull=[[-0.98,-2.18],[-1.07,0.95],[-0.68,1.95],[0,2.54],[0.68,1.95],[1.07,0.95],[0.98,-2.18]];
    b.layers(0,0,[[-0.45,hull.map(([x,z])=>[x*0.76,z*0.92])],[0.16,hull]],"#993f35");
    b.layers(0,0,[[0.16,hull],[0.40,hull]],C.deep);
    b.layers(0,0,[[0.40,hull.map(([x,z])=>[x*0.94,z*0.96])],[0.44,hull.map(([x,z])=>[x*0.94,z*0.96])]],"#a89c7e");
    b.bevel(0,0.86,-0.32,1.46,0.82,1.64,"#d6c8a8",0.17);
    b.bevel(0,1.24,-0.32,1.38,0.42,1.50,"#3d5962",0.14);
    b.bevel(0,1.5,-0.32,1.62,0.14,1.70,"#e8b263",0.17);
    b.box(0,1.23,0.44,0.10,0.41,0.03,C.white);
    b.drum(0.3,1.85,-0.61,0.13,0.59,0.13,8,C.ink);
    for (const s of [-1,1]) for (const z of [-1.42,-0.20,1.05]) b.bevel(s*1.03,0.33,z,0.32,0.44,0.52,C.ink,0.12);
    bollard(b,0,0.45,1.49);
  }
  function surroundings(b) {
    b.at(-13.6,0,-12.30,-0.08,()=>crane(b));
    b.at(10.6,0,-13.2,0,()=>{
      pier(b,11.4,4.35);
      b.at(-2.65,0,0.06,0,()=>cargo(b,4.36,1.63,1.82,"red"));
      b.at(-2.50,1.65,-0.05,0,()=>cargo(b,4.26,1.54,1.75,"blue"));
      b.at(2.64,0,-0.30,0,()=>cargo(b,4.36,1.67,1.82,"green"));
    });
    b.at(-12.65,-1.72,12.24,1.74,()=>tug(b));
    b.at(18.65,0,3.5,0,()=>{
      pier(b,3.49,10.05);
      b.at(0,0,-2.4,Math.PI/2,()=>cargo(b,3.92,1.60,1.71,"blue"));
      b.at(-0.26,0,1.48,0,()=>crate(b,1.65,1.4,1.55));
      for (const x of [-0.62,0.43]) {
        b.drum(x,0.43,3.28,0.41,0.86,0.41,12,"#b66b50");
        b.ring(x,0.87,3.28,0.31,0.38,12,C.white);
      }
    });
    b.at(-22.3,0,-2.4,0,()=>{
      pier(b,4.8,14);
      b.at(0,0,-3.6,Math.PI/2,()=>cargo(b,4.6,1.75,2,"gold"));
      b.at(0.05,0,2.8,Math.PI/2,()=>cargo(b,4.5,1.8,2,"green"));
    });
    for (const [x,z] of [[-18,7.6],[7.0,13.85],[18.2,-9.4],[-3,-13.1],[23,12]]) {
      b.drum(x,-1.63,z,0.5,0.35,0.5,12,C.deep);
      b.drum(x,-1.28,z,0.29,0.59,0.29,8,"#d78146");
      b.drum(x,-1.04,z,0.294,0.18,0.294,8,C.white);
      b.drum(x,-0.75,z,0.078,0.43,0.078,6,C.ink);
      b.drum(x,-0.49,z,0.105,0.12,0.105,8,C.gold,0.75);
    }
  }
  function world() {
    const b=new Builder();
    deck(b); surroundings(b);
    return b.finish();
  }
  function relayCore() {
    const b=new Builder();
    const hex=r=>Array.from({length:6},(_,i)=>[Math.sin(i*TAU/6)*r,Math.cos(i*TAU/6)*r]);
    b.layers(0,0,[[-0.38,hex(0.09)],[-0.12,hex(0.34)],[0.15,hex(0.34)],[0.41,hex(0.08)]],C.gold,0.8);
    b.drum(0,0.035,0,0.36,0.115,0.36,6,C.ink);
    b.drum(0,0.046,0,0.37,0.034,0.37,6,"#fff0b8",1);
    for (let i=0;i<3;i++) b.at(0,0,0,i*TAU/3,()=>{
      b.beam([0,-0.33,0.14],[0,-0.19,0.46],0.082,0.085,C.steel);
      b.beam([0,-0.19,0.46],[0,0.22,0.46],0.082,0.085,C.white);
      b.beam([0,0.22,0.46],[0,0.36,0.13],0.082,0.085,C.steel);
      b.box(0,0.025,0.49,0.075,0.17,0.03,C.cyan,0.85);
    });
    return b.finish();
  }
  function relayGates() {
    const b=new Builder(), r=Relay.RULES.gateRadius;
    Relay.gates.forEach((gate,team)=>{
      const color=team ? C.red : C.cyan;
      b.at(gate.x,0.055,gate.z,team ? 0 : Math.PI,()=>{
        b.ring(0,0,0,r-0.14,r,48,C.ink);
        for (let i=0;i<8;i++) {
          const start=i*TAU/8;
          b.ring(0,0.006,0,r-0.095,r-0.025,6,color,start+0.06,start+TAU/8-0.06,0.65);
        }
        chevrons(b,0,0,0,color,2,1,0.012);
        for (const side of [-1,1]) {
          b.bevel(0,0.10,side*(r+0.15),0.72,0.20,0.27,C.ink,0.06);
          b.box(0,0.22,side*(r+0.15),0.54,0.055,0.13,color,0.85);
        }
      });
    });
    return b.finish();
  }
  function signalPads() {
    const b=new Builder(), r=Signal.RULES.radius;
    for (const site of Signal.stations) b.at(site.x,0.048,site.z,0,()=>{
      b.drum(0,0.016,0,r,0.032,r,48,"#475659");
      b.ring(0,0.039,0,r-0.18,r,48,C.ink);
      b.ring(0,0.043,0,r-0.065,r-0.035,48,"#96a3a4");
      // Inlaid radio tracks keep the footing level across the whole capture circle.
      for (let i=0;i<4;i++) b.at(0,0,0,i*TAU/4,()=>{
        b.ring(0,0.042,0,r-0.38,r-0.34,10,i%2===0 ? "#8d929f" : "#a8ada2",0.10,1.38);
        b.bevel(0,0.035,r+0.07,0.49,0.07,0.22,C.deep,0.045);
        b.tile(0,0.074,r+0.07,0.30,0.075,"#c7b8f0",0.5);
      });
      b.drum(0,0.045,0,0.17,0.022,0.17,8,"#ded5ed");
      for (const angle of [-Math.PI/2,Math.PI/2]) for (const radius of [0.39,0.67]) {
        b.ring(0,0.044,0,radius-0.07,radius,10,"#a9a2b5",angle-0.79,angle+0.79);
      }
    });
    return b.finish();
  }
  function supplyCrate() {
    const b=new Builder(), shell="#467e99", lamp="#b9efff";
    b.bevel(0,0.12,0,1.14,0.18,0.92,C.ink,0.12);
    b.bevel(0,0.42,0,1.08,0.58,0.88,shell,0.12,0.065);
    b.bevel(0,0.72,0,1.17,0.13,0.97,"#c4d4ca",0.11);
    for (const side of [-1,1]) {
      b.box(side*0.40,0.43,0,0.085,0.61,0.91,C.deep);
      b.box(side*0.40,0.79,0,0.085,0.033,0.86,C.ink);
      b.box(0,0.44,side*0.45,0.36,0.075,0.035,lamp,0.8);
      b.box(0,0.44,side*0.45,0.082,0.28,0.038,lamp,0.8);
      b.beam([side*0.24,0.78,0],[side*0.14,1.02,0],0.075,0.10,C.deep);
    }
    b.beam([-0.16,1.02,0],[0.16,1.02,0],0.08,0.10,lamp,0.45);
    return b.finish();
  }
  function freightTrack() {
    const b = new Builder(), end = Freight.RULES.terminal;
    const sleepers = Math.floor(end/0.75);
    for (let i=-sleepers; i<=sleepers; i++) b.tile(i*0.75,0.046,0,0.15,0.97,C.deep);
    for (const side of [-1,1]) {
      b.tile(0,0.050,side*0.35,2*end+1.8,0.13,C.ink);
      b.tile(0,0.054,side*0.35,2*end+1.8,0.045,C.edge);
      const x = side*end, color = side>0 ? C.cyan : C.red;
      for (const z of [-0.78,0.78]) {
        b.bevel(x,0.12,z,1.65,0.15,0.26,C.deep,0.05);
        b.tile(x,0.198,z,1.4,0.09,color,0.85);
      }
      chevrons(b,x-side*1.25,0,side>0 ? 0 : Math.PI,color,2,0.65,0.057);
    }
    return b.finish();
  }
  function freightCart() {
    const b = new Builder();
    for (const side of [-1,1]) {
      b.bevel(0,0.18,side*0.35,1.7,0.24,0.22,C.ink,0.09);
      b.box(0,0.17,side*0.47,1.35,0.055,0.04,"#bce7d6",0.65);
    }
    b.bevel(0,0.37,0,1.94,0.25,1.22,"#de8e52",0.16);
    b.bevel(0,0.51,0,1.77,0.10,1.07,C.deep,0.12);
    // A pair of insulated lunch tins rides in the sling.
    for (const side of [-1,1]) {
      const x = side*0.40;
      b.drum(x,0.75,0,0.37,0.42,0.37,12,side>0 ? "#66aaa0" : "#d19b63");
      for (const y of [0.63,0.81,0.95]) b.drum(x,y,0,0.38,0.043,0.38,12,C.white);
      b.drum(x,1.00,0,0.29,0.08,0.29,12,C.steel);
      b.bevel(x,1.07,0,0.21,0.085,0.095,C.ink,0.03);
      for (const z of [-0.49,0.49]) b.box(side*0.77,0.53,z,0.15,0.11,0.085,"#fff1af",0.9);
    }
    return b.finish();
  }
  function runner(team,variant=0) {
    const p=teamPaint[team],body=new Builder(),leg=new Builder(),gun=new Builder();
    // A short, broad silhouette keeps the visor and shoulders readable from above.
    body.bevel(0,0.71,0,0.66,0.34,0.50,C.ink,0.11,0.065);
    body.bevel(0,1.00,0,0.90,0.58,0.59,p.shell,0.15,0.09);
    body.bevel(0,1.02,0.28,0.55,0.32,0.13,p.dark,0.07,0.04);
    body.box(-0.12,1.10,0.36,0.18,0.075,0.042,p.visor,0.50);
    body.box(0,0.74,0.24,0.58,0.105,0.13,"#3b4342");
    body.box(0.03,0.74,0.32,0.16,0.12,0.045,p.trim);
    body.bevel(0,1.10,-0.36,0.66,0.58,0.34,C.deep,0.09);
    for (const s of [-1,1]) {
      body.drum(s*0.23,1.11,-0.49,0.126,0.58,0.13,8,p.trim);
      body.bevel(s*0.46,1.02,0.055,0.31,0.47,0.41,p.dark,0.08);
      body.bevel(s*0.48,1.16,0.03,0.36,0.28,0.46,s<0 ? p.light : p.shell,0.09,0.065);
      body.bevel(s*0.47,0.90,0.23,0.22,0.22,0.27,"#344448",0.07);
    }
    body.bevel(0,1.56,0.02,0.85,0.66,0.71,p.shell,0.17,0.1);
    body.bevel(0,1.55,0.13,0.875,0.27,0.62,"#26373b",0.17,0.035);
    body.bevel(0,1.57,0.36,0.65,0.13,0.21,p.visor,0.065,0.024,0.55);
    body.bevel(0,1.77,-0.008,0.84,0.23,0.74,p.light,0.17,0.078);
    body.bevel(-0.18,1.885,-0.03,0.11,0.045,0.43,p.trim,0.035,0.016);
    for (const s of [-1,1]) body.bevel(s*0.425,1.55,0,0.12,0.26,0.32,C.deep,0.046);
    if (variant===0) {
      body.beam([-0.32,1.73,-0.23],[-0.36,2.03,-0.27],0.064,0.066,C.ink);
      body.box(-0.36,2.035,-0.27,0.082,0.075,0.081,p.trim,0.4);
    } else if (variant===1) {
      body.bevel(0,1.88,-0.02,0.34,0.17,0.6,p.dark,0.1);
      body.bevel(-0.49,0.98,0.17,0.22,0.65,0.63,p.shell,0.10);
    } else {
      for (const s of [-1,1]) body.bevel(s*0.33,1.82,-0.10,0.14,0.27,0.40,p.trim,0.055);
    }
    leg.bevel(0,0.45,0,0.33,0.49,0.38,p.dark,0.075);
    leg.bevel(0,0.39,0.13,0.32,0.27,0.24,p.shell,0.065);
    leg.bevel(0,0.17,0.075,0.38,0.29,0.57,C.ink,0.075,0.047);
    leg.box(0,0.12,0.32,0.24,0.075,0.061,C.steel);
    gun.bevel(0.43,0.97,0.47,0.25,0.26,0.58,"#293b40",0.055);
    gun.bevel(0.43,1.045,0.65,0.275,0.21,0.51,p.trim,0.06,0.038);
    gun.bevel(0.43,1.05,0.93,0.21,0.185,0.23,C.deep,0.035,0.02);
    gun.box(0.43,1.05,1.053,0.132,0.11,0.028,p.visor,0.85);
    gun.box(0.43,1.16,0.59,0.083,0.055,0.24,C.ink);
    return {body:body.finish(),leg:leg.finish(),gun:gun.finish()};
  }
  const api={world,runner,teamPaint,relayCore,relayGates,signalPads,supplyCrate,freightCart,freightTrack};
  if (node) module.exports=api;
  else (globalThis.Slipwake ||= {}).art=api;
})();
