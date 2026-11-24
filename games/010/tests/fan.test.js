'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fan=require('../js/fan'), tea=require('../js/tea'), sim=require('../js/simulation');
const world=require('../js/world'), mesh=require('../js/mesh'), shaders=require('../js/shaders');
const {createRenderer}=require('../js/renderer');
const {openPage,key,ticks,surface}=require('./support/page');
const {rasterize}=require('./support/raster');
const near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,a+' vs '+b);

test('the motor accelerates and coasts the same distance at 30 and 120 fps',()=>{
  function run(fps) {
    const state=fan.create();
    for (const [mode,duration] of [['high',4],['off',1],['low',.5]]) {
      fan.setSpeed(state,mode);
      for (let i=0;i<fps*duration;i++) {
        fan.step(state,1/fps);
        assert.ok(state.angle>=0 && state.angle<2*Math.PI && state.wind>=0 && state.wind<=1);
      }
    }
    return state;
  }
  const a=run(30), b=run(120);
  near(a.angle,b.angle); near(a.wind,b.wind);
  const initial=fan.create(), motor=fan.create();
  fan.setSpeed(motor,'off'); fan.step(motor,.1);
  assert.ok(motor.wind<initial.wind && motor.wind>0 && motor.angle>0);
  const angle=motor.angle;
  fan.setSpeed(motor,'off',true); fan.step(motor,20);
  near(motor.angle,angle); assert.equal(motor.wind,0);
  for (const input of [-1,NaN,Infinity]) fan.step(motor,input);
  for (const input of [null,'constructor','gale']) fan.setSpeed(motor,input,true);
  assert.deepEqual(motor,{mode:'off',wind:0,angle});
});

test('airflow leaves steam attached to all three emitters and reaches the front cup most strongly',()=>{
  const deflection=[];
  for (const source of world.steam) {
    const at=(u,wind)=>sim.steamPoint(source,1,u,3.1,wind);
    assert.deepEqual(at(0,0),at(0,1));
    const tip=at(1,1), calm=at(1,0);
    assert.ok(tip.z>calm.z && tip.y<calm.y && tip.y>source.y);
    near((tip.z-calm.z)/2,at(1,.5).z-calm.z);
    assert.ok(at(.5,1).z-at(.5,0).z<(tip.z-calm.z)/2);
    deflection.push(tip.z-calm.z);
  }
  assert.ok(deflection[0]>deflection[1]*4 && deflection[1]>deflection[2]);
});

test('fan and cup part tags stay on the paddles and foreground liquid, with fixed geometry sharing their pick IDs',()=>{
  const scene=world.makeScene(), types=new Set(), guards=[], paddles=[];
  assert.equal(scene.batches.length,1);
  for (const {vertices:v,indices} of scene.batches) {
    for (let j=0;j<v.length;j+=mesh.STRIDE) {
      const [id,,part]=v.subarray(j+11,j+14);
      types.add(part);
      if (part===mesh.parts.fanBlade) {
        assert.equal(id,7); paddles.push(Math.hypot(v[j]-fan.hub[0],v[j+1]-fan.hub[1]));
        assert.ok(Math.abs(v[j+2]-fan.hub[2])<.05);
      } else if (part===mesh.parts.teaSurface) {
        assert.equal(id,1); assert.ok(Math.hypot(v[j]-tea.cup.x,v[j+2]-tea.cup.z)<.19);
      } else if (id===7) guards.push(Math.hypot(v[j]-fan.hub[0],v[j+1]-fan.hub[1]));
    }
    for (let i=0;i<indices.length;i+=3) {
      const part=k=>v[indices[k]*mesh.STRIDE+13];
      assert.equal(part(i),part(i+1)); assert.equal(part(i+1),part(i+2));
    }
  }
  assert.deepEqual([...types].sort(),Object.values(mesh.parts).sort());
  assert.ok(Math.max(...paddles)>.28 && Math.max(...paddles)<.32);
  assert.ok(guards.some(r=>r>.32 && r<.34));
  for (const pass of [shaders.surface,shaders.pick]) assert.match(pass.vertex,/posed\(a_position, a_material\.z\)/);
  assert.match(shaders.surface.vertex,/spin\(\) \* a_normal\.xy/);
  assert.match(shaders.shadow.vertex,/a_material\.z > 0\.5 \? vec4\(2\.0/);
});

test('a pixel looking through the wire guard picks the blade only at the displayed rotation',()=>{
  const p=openPage({noWebGL:true,rasterPick:true});
  p.doc.options.noWebGL=false;
  const canvas=p.$('scene'); canvas.width=300; canvas.height=236;
  const gl=canvas.getContext('webgl'), scene=world.makeScene();
  const renderer=createRenderer(gl,scene,p.context.PocketPlaces.art.makeAtlas());
  const view=sim.createView(false);
  sim.focusOn(view,world.notes[6].closeup,true);
  const camera=sim.camera(view,canvas.width,canvas.height);
  const room={fan:fan.create(),drink:tea.appearance(),pouredAt:-Infinity};
  const pose=angle=>({u_rotor:[Math.cos(angle),Math.sin(angle)],u_liquid:[1,0]});
  const at=angle=>rasterize(scene.batches,camera.matrix,canvas.width,canvas.height,pose(angle));
  const before=at(0), after=at(Math.PI/4);
  const changed=before.ids.findIndex((id,i)=>id!==7 && after.ids[i]===7);
  assert.ok(changed>=0,'a paddle sweeps an opening in the guard');
  const x=changed%canvas.width, y=canvas.height-1-Math.floor(changed/canvas.width);
  renderer.draw(camera,0,0,undefined,room);
  assert.equal(renderer.pick(camera,x,y),Math.max(0,before.ids[changed]));
  room.fan.angle=Math.PI/4;
  assert.equal(renderer.pick(camera,x,y),Math.max(0,before.ids[changed]),'pending simulation cannot move the displayed target');
  renderer.draw(camera,1,0,undefined,room);
  assert.equal(renderer.pick(camera,x,y),7);
  renderer.dispose();
});

test('fan button and shortcut change the motor with a single static batch and sleep when motion is reduced',()=>{
  const p=openPage(), initial=surface(p).u_rotor;
  const uploads=p.gl.uploads.filter(u=>u.static).length;
  assert.equal(p.$('fan-label').textContent,'Low');
  p.$('fan-speed').click(); assert.equal(p.$('fan-label').textContent,'High');
  key(p,'b',{repeat:true}); key(p,'b',{ctrlKey:true}); ticks(p,20);
  assert.equal(p.$('fan-label').textContent,'High');
  assert.notDeepEqual(surface(p).u_rotor,initial);
  key(p,'b'); assert.equal(p.$('fan-label').textContent,'Off');
  p.win.motion.matches=true; p.win.motion.emit('change'); p.win.tick();
  const still=surface(p).u_rotor;
  const steam=()=>Float32Array.from(p.gl.uploads.at(-1).buf.data);
  const calm=steam();
  key(p,'B'); p.win.tick();
  assert.deepEqual(surface(p).u_rotor,still); assert.notDeepEqual(steam(),calm);
  assert.equal(p.win.frames.size,0);
  assert.equal(p.gl.uploads.filter(u=>u.static).length,uploads);
  assert.equal(p.gl.draws.filter(d=>d.name==='shadow').length,1);
  key(p,'7'); assert.equal(p.$('note-title').textContent,'Counter fan');
  assert.equal(p.$('note-number').textContent,'07');
  assert.equal(p.gl.reads,0);
});
