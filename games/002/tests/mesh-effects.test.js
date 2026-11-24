"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Builder, rgb, outline, STRIDE, TAU } = require("../src/mesh.js");
const art = require("../src/art.js");
const arena = require("../src/arena.js");
const fx = require("../src/effects.js");
const { RULES } = require("../src/game.js");
const Relay = require("../src/relay.js");
const Signal = require("../src/signal.js");
const Freight = require("../src/freight.js");

// Use the actual interleaved buffer. This checks winding after transforms and Float32 conversion.
function inspect(data) {
  assert.ok(data instanceof Float32Array);
  assert.ok(data.length>0 && data.length%(3*STRIDE)===0);
  const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
  for (let i=0;i<data.length;i+=STRIDE*3) {
    const j=i+STRIDE, k=j+STRIDE;
    const ux=data[j]-data[i], uy=data[j+1]-data[i+1], uz=data[j+2]-data[i+2];
    const vx=data[k]-data[i], vy=data[k+1]-data[i+1], vz=data[k+2]-data[i+2];
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const area=Math.hypot(nx,ny,nz);
    assert.ok(area>1e-9,"nondegenerate triangle at float "+i);
    for (const start of [i,j,k]) {
      const alignment=nx*data[start+3]+ny*data[start+4]+nz*data[start+5];
      assert.ok(Math.abs(alignment/area-1)<3e-5,"normal agrees with winding");
      assert.ok(Math.abs(Math.hypot(data[start+3],data[start+4],data[start+5])-1)<1e-5);
      for (let axis=0;axis<3;axis++) {
        const value=data[start+axis];
        assert.ok(Number.isFinite(value));
        lo[axis]=Math.min(lo[axis],value); hi[axis]=Math.max(hi[axis],value);
      }
      for (let channel=6;channel<10;channel++) assert.ok(data[start+channel]>=0 && data[start+channel]<=1);
    }
  }
  return {lo,hi};
}

test("hand-built primitives produce finite oriented triangles in the common vertex layout", () => {
  const b=new Builder();
  b.box(0,0,0,2,4,6,"#ff8800",0.5);
  const box=b.finish();
  assert.equal(box.length,12*3*STRIDE);
  assert.deepEqual(inspect(box),{lo:[-1,-2,-3],hi:[1,2,3]});
  for (let i=0;i<box.length;i+=STRIDE) assert.ok(box[i]*box[i+3]+box[i+1]*box[i+4]+box[i+2]*box[i+5]>0);
  assert.deepEqual(rgb("#0080ff"),[0,128/255,1]);
  assert.deepEqual(rgb([1,0,1]),[1,0,1]);
  assert.equal(outline(2,1,0).length,4);
  assert.equal(outline(2,1,20).length,8);
  const other=new Builder();
  other.bevel(0,1,0,2,1,3,"#889990");
  other.drum(0,0,0,1,1,1,9,"#eebbaa");
  other.beam([0,0,0],[1,3,4],0.4,0.8,"#334455");
  other.beam([0,0,0],[0,2,0],0.2,0.6,"#ffffff");
  inspect(other.finish());
});

test("decals, line paint and annular sectors face the overhead camera", () => {
  const b=new Builder();
  b.tile(0,0,0,3,2,"#333333");
  b.line(3,1,-3,4,0.5,"#eeeeee");
  b.ring(0,0.3,0,0.5,1,12,"#ffbb33",TAU/5,TAU/2);
  const data=b.finish();
  assert.equal(data.length,(2+2+2*12)*3*STRIDE);
  inspect(data);
  for (let i=0;i<data.length;i+=STRIDE) assert.equal(data[i+4],1);
});

test("builder nests transforms and restores its parent even if a draw callback throws", () => {
  const b=new Builder();
  b.at(3,2,4,Math.PI/2,() => b.at(0,0,2,0,() => b.tile(0,0,0,1,1,"#ffffff")));
  assert.deepEqual(inspect(b.finish()),{lo:[4.5,2,3.5],hi:[5.5,2,4.5]});
  assert.throws(()=>b.at(4,0,0,1,()=>{throw Error("test error");}),/test error/);
  b.tri([0,0,0],[0,0,0],[1,0,0],"#ffffff");
  b.beam([1,2,3],[1,2,3],1,1,"#ffffff");
  b.line(0,0,0,0,1,"#ffffff");
  assert.equal(b.data.length,6*STRIDE);
  b.tile(0,0,0,1,1,"#ffffff");
  assert.deepEqual(inspect(b.finish()).lo,[-0.5,0,-0.5]);
});

test("the complete harbor is deterministic and each physical blocker has raised geometry", () => {
  const stage=art.world();
  const bounds=inspect(stage);
  assert.deepEqual(stage,art.world());
  assert.ok(bounds.lo[0]<-arena.halfW && bounds.hi[0]>arena.halfW);
  assert.ok(bounds.lo[1]<-1 && bounds.hi[1]>4);
  for (const b of arena.blocks) {
    let top=false;
    for (let i=0;i<stage.length;i+=STRIDE) {
      if (Math.abs(stage[i]-b.x)<b.w/2 && Math.abs(stage[i+2]-b.z)<b.d/2 &&
          stage[i+1]>=b.h-0.02 && stage[i+4]>0.8) { top=true; break; }
    }
    assert.ok(top,"missing cover mesh at "+b.x+","+b.z);
  }
});

test("both teams have three visibly distinct runner rigs with articulated legs and forward weapons", () => {
  const rigs=[];
  for (const team of [0,1]) {
    for (const variant of [0,1,2]) {
      const rig=art.runner(team,variant);
      const bounds=inspect(rig.body), legs=inspect(rig.leg), gun=inspect(rig.gun);
      assert.ok(bounds.hi[1]>1.8 && legs.hi[1]<0.8 && legs.lo[1]>=0);
      assert.ok(gun.hi[2]>0.95 && gun.lo[1]>0.75);
      if (variant>0) assert.notDeepEqual(rig.body,rigs.at(-1));
      rigs.push(rig.body);
    }
  }
  assert.notDeepEqual(rigs[0],rigs[3]);
});

test("the relay mesh has a luminous suspended core and two low gates aligned with the scoring circles", () => {
  const core=art.relayCore(), gates=art.relayGates(), bounds=inspect(core);
  assert.ok(bounds.lo[1]<-0.3 && bounds.hi[1]>0.4 && bounds.hi[0]<0.6);
  assert.ok(core.some((v,i)=>i%STRIDE===9 && v>0.8));
  assert.ok(inspect(gates).hi[1]<0.35);
  for (const gate of Relay.gates) {
    let circle=false;
    for (let i=0;i<gates.length;i+=STRIDE) {
      const d=Math.hypot(gates[i]-gate.x,gates[i+2]-gate.z);
      if (Math.abs(d-Relay.RULES.gateRadius)<1e-4) { circle=true; break; }
    }
    assert.ok(circle,"gate ring follows simulation radius");
  }
});

const event=(type,extra={})=>({type,x:-1.25,z:4.4,yaw:Math.PI/2,team:0,source:0,...extra});
test("the freight trolley fits its escort ring and both lit depots are aligned with the rail terminals", () => {
  const cart=art.freightCart(), track=art.freightTrack();
  const bounds=inspect(cart), rails=inspect(track);
  assert.ok(bounds.lo[1]>=0 && bounds.hi[1]>1);
  assert.ok(Math.hypot(bounds.hi[0],bounds.hi[2])<Freight.RULES.radius);
  assert.ok(rails.hi[1]<0.2 && rails.lo[1]>0.035);
  assert.deepEqual(cart,art.freightCart());
  for (const side of [-1,1]) {
    const lamp=track.some((x,i)=>i%STRIDE===0 && Math.abs(x-side*Freight.RULES.terminal)<0.8 && track[i+9]>0.8);
    assert.ok(lamp);
  }
});

test("vane sparks, bolt returns and depot flares share the bounded effects pool and expire", () => {
  const f=fx.create();
  for (let i=0;i<30;i++) for (const kind of ["vane","boltReturn","freightDock"]) fx.emit(f,event(kind));
  assert.equal(f.bits.length,fx.MAX); assert.ok(f.rings.length<=24);
  assert.ok(f.bits.some(p=>p.signal) && f.bits.some(p=>!p.signal));
  assert.ok(f.bits.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)));
  fx.step(f,1);
  assert.equal(f.rings.length+f.bits.length,0);
});
test("the supply crate has a raised lifting eye and lit panels, and all station pads match their scoring rings", () => {
  const crate=art.supplyCrate(), bounds=inspect(crate);
  assert.ok(bounds.hi[1]>1 && bounds.lo[1]>=0);
  assert.ok(crate.some((value,i)=>i%STRIDE===9 && value>=0.79));
  const pads=art.signalPads();
  assert.ok(inspect(pads).hi[1]<0.2);
  for (const site of Signal.stations) {
    assert.ok(pads.some((x,i)=>i%STRIDE===0 && Math.abs(Math.hypot(x-site.x,pads[i+2]-site.z)-Signal.RULES.radius)<1e-5));
  }
});
test("particle origins, pulse radius and dash trail follow simulation events", () => {
  for (const type of ["shot","hit","impact","ko","respawn","pulse","dash"]) {
    const f=fx.create(3);
    fx.emit(f,event(type,type==="dash" ? {dx:1,dz:0} : {}));
    assert.ok(f.bits.length>0);
    assert.ok(f.bits.every(p=>p.x===-1.25 && p.z===4.4 && p.life>0 && p.size>0));
    if (type==="pulse") assert.equal(f.rings[0].end,RULES.pulseRadius);
    if (type==="shot") assert.ok(f.bits.every(p=>p.vx>0));
    if (type==="dash") {
      const still=fx.create(3); fx.emit(still,event("dash",{dx:0,dz:0}));
      f.bits.forEach((p,i)=>assert.equal(p.vx,still.bits[i].vx-2));
    }
    const first={...f.bits[0]};
    fx.step(f,0.03);
    assert.ok(f.bits[0].vy<first.vy);
    assert.ok(Math.abs(f.bits[0].x-(first.x+0.03*first.vx))<1e-8);
    assert.equal(f.bits[0].age,0.03);
    fx.step(f,1);
    assert.equal(f.bits.length+f.rings.length,0);
  }
});

test("effects remain bounded under heavy fire and seeded effects replay identically", () => {
  const a=fx.create(7), b=fx.create(7);
  for (let i=0;i<120;i++) {
    const e=event(i%2 ? "ko" : "pulse",{team:i%2});
    for (const f of [a,b]) { fx.emit(f,e); fx.step(f,1/120); }
  }
  assert.ok(a.bits.length<=fx.MAX && a.rings.length<=24);
  assert.deepEqual(a.bits,b.bits); assert.deepEqual(a.rings,b.rings);
  const untouched=fx.create(); fx.emit(untouched,{type:"end"});
  assert.deepEqual(untouched.bits,[]); assert.deepEqual(untouched.rings,[]);
});

test("field signals, repairs and neutral core returns share the bounded effects batch", () => {
  for (const type of ["fork","repair","rally","net","intercept","relayPickup","relayDrop","relayReturn","delivery"]) {
    const f=fx.create(44);
    fx.emit(f,event(type,type==="relayReturn" ? {team:undefined} : {}));
    assert.ok(f.bits.length>0 && f.bits.length<=fx.MAX);
    if (type.startsWith("relay") || type==="delivery") assert.ok(f.bits.every(p=>p.gold));
    fx.step(f,0.03);
    assert.ok(f.bits.every(p=>[p.x,p.y,p.z,p.vx,p.vz].every(Number.isFinite)));
    fx.step(f,1);
    assert.equal(f.bits.length+f.rings.length,0);
  }
});
