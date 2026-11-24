'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const campus=require('../src/campus.js');
const sim=require('../src/simulation.js');
const {gate,waterY}=require('../src/moon-pool.js');
const {MAT,STRIDE}=require('../src/mesh.js');
const {canWalk,canStand}=require('../src/collision.js');
const {firstHit}=require('./support/sightline.js');
const {Renderer}=require('../src/renderer.js');
const {page}=require('./support/page.js');
const {running,advance}=require('./support/walk.js');
const weather=require('../src/weather.js');
const world=campus.create();

test('two visible water surfaces fill the blocked basins and leave a level through passage',()=>{
  assert.equal(world.pools.length,2);
  const surface=[];
  for (let i=0;i<world.vertices.length;i+=STRIDE) {
    if (world.vertices[i+9]===MAT.water) surface.push(Array.from(world.vertices.slice(i,i+6)));
  }
  assert.equal(surface.length,12);
  for (const pool of world.pools) {
    const wet=surface.filter(([x,,z])=>Math.abs(x-pool.x)<=pool.w/2 && Math.abs(z-pool.z)<=pool.d/2);
    assert.equal(wet.length,6);
    for (const [,y,,nx,ny,nz] of wet) {
      assert.ok(Math.abs(y-waterY)<1e-6);
      assert.deepEqual([Math.abs(nx),ny,Math.abs(nz)],[0,1,0]);
    }
    const x=pool.x+2;
    const hit=firstHit(world,[x,1,pool.z],[x,waterY,pool.z]);
    assert.equal(hit.material,MAT.water,'paving and the basin floor sit below the water');
    assert.ok(!canStand(x,pool.z,world));
    assert.ok(!canWalk(x,gate.z,x,pool.z,world));
  }
  const from=[-18.9,gate.z], to=[-33.15,gate.z];
  assert.ok(canWalk(...from,...to,world));
  const s=sim.makeState([from[0],from[1],-Math.PI/2,0]);
  sim.move(s,to[0]-from[0],0,world);
  assert.ok(Math.abs(s.x-to[0])<1e-6);
  assert.equal(sim.eyePosition(s,world)[1],sim.EYE);
  assert.equal(firstHit(world,[from[0],sim.EYE,from[1]],[to[0],sim.EYE,to[1]]).t,Infinity,'the gate opening clears the walker');
});

test('rain disturbs the reflected gate on the existing opaque draw and freezes with the rain clock',()=>{
  const h=page(), r=new Renderer(h.canvas,world,h.gl);
  const s=sim.makeState(world.places.at(-1).view);
  const shader=r.scene.p.shaders[1].source;
  assert.ok(shader.includes('('+gate.x.toFixed(2)+'-vPosition.x)/ray.x'));
  assert.match(shader,/reflect\(incident/);
  const uploads=h.gl.uploads.length;
  for (const phase of [0,.25,.99,.01]) {
    s.weather.wet=.8; s.weather.time=phase*weather.PERIOD;
    const before=h.gl.draws.length;
    r.draw(s);
    assert.equal(r.scene.p.uniforms.uRainPhase[0],phase);
    assert.equal(h.gl.draws.length-before,3);
    assert.equal(h.gl.uploads.length,uploads);
  }
});

test('an unfocused visible window pauses both rain effects, then resumes without a time jump',()=>{
  const h=running();
  h.key('KeyR'); advance(h,160);
  const phase=h.uniform('uRainPhase')[0];
  assert.equal(h.uniform('uTime')[0]/weather.PERIOD,phase);
  h.win.emit('blur'); h.settle(); h.tick(6000);
  assert.equal(h.uniform('uRainPhase')[0],phase);
  assert.equal(h.frames.size,0);
  h.win.emit('focus'); h.tick();
  assert.ok(Math.abs(h.uniform('uRainPhase')[0]-phase)<.02);
  assert.notEqual(h.uniform('uRainPhase')[0],phase);
});
