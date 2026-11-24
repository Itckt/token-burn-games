'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Renderer,shaders} = require('../src/renderer.js');
const {create} = require('../src/campus.js');
const {STRIDE} = require('../src/mesh.js');
const {makeState} = require('../src/simulation.js');
const weather = require('../src/weather.js');
const {page} = require('./support/page.js');
const world = create(), state = () => makeState(world.places[0].view);

function varyings(source, defaultPrecision) {
  const result = {};
  for (const match of source.matchAll(/\bvarying\s+(?:(lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g)) {
    for (const name of match[3].split(',')) result[name.trim()] = [match[1] || defaultPrecision, match[2]];
  }
  return result;
}
function balanced(source) {
  const stack=[], closes={')':'(',']':'[','}':'{'};
  for (const ch of source) {
    if ('([{'.includes(ch)) stack.push(ch);
    if (')]}'.includes(ch)) assert.equal(stack.pop(),closes[ch],ch);
  }
  assert.equal(stack.length,0);
}
test('shader pairs have complete GLSL ES entry points, balanced source and matching varying interfaces', () => {
  for (const [vs,fs] of [[shaders.screenVert,shaders.skyFrag],[shaders.worldVert,shaders.worldFrag(true,world.shelters)],
    [shaders.worldVert,shaders.worldFrag(false)],[shaders.depthVert,shaders.depthFrag],[shaders.labelVert,shaders.labelFrag],
    [shaders.rainVert(world.shelters),shaders.rainFrag],[shaders.rainVert(),shaders.rainFrag]]) {
    for (const src of [vs,fs]) {
      assert.match(src,/void\s+main\s*\(\s*\)\s*\{/);
      assert.doesNotMatch(src,/undefined|\$\{/);
      balanced(src);
    }
    assert.match(vs,/gl_Position\s*=/);
    assert.match(fs,/gl_FragColor\s*=/);
    const precision = fs.match(/precision (\w+) float;/)[1];
    assert.deepEqual(varyings(vs,'highp'),varyings(fs,precision));
  }
  assert.match(shaders.worldFrag(true),/^#extension GL_OES_standard_derivatives : enable\n/);
  assert.match(shaders.worldFrag(true),/fwidth/);
  assert.doesNotMatch(shaders.worldFrag(false),/#extension|fwidth/);
  const lightCount = Number(shaders.worldFrag(false).match(/uniform vec2 uLamps\[(\d+)\]/)[1]);
  assert.equal(lightCount,world.lamps.length);
});

test('rain draws one depth-tested translucent batch, clipped at the same eaves that protect the paving', () => {
  const h=page(), r=new Renderer(h.canvas,world,h.gl), s=state();
  const initialUploads=h.gl.uploads.length;
  s.weather.shower=true;
  for (const light of [0,.45,1]) {
    s.light=light;
    weather.step(s.weather,1/60,false);
    r.draw(s);
    const [sky,campus,labels,rain]=h.gl.draws.slice(-4);
    assert.deepEqual([sky.program,campus.program,labels.program,rain.program],
      [r.sky.p.id,r.scene.p.id,r.lettering.p.id,r.rain.p.id]);
    assert.ok(rain.depth && rain.blend && !rain.writeDepth && !rain.offscreen);
    assert.equal(rain.count,weather.DROPS*3);
    assert.equal(r.rain.p.uniforms.uTime[0],s.weather.time);
    assert.equal(r.rain.p.uniforms.uNight[0],light);
    for (const shader of [r.rain,r.scene,r.sky]) assert.equal(shader.p.uniforms.uWet[0],s.weather.wet);
    assert.equal(h.gl.uploads.length,initialUploads+1);
    assert.ok(h.gl.writeDepth && !h.gl.flags.has(h.gl.BLEND));
  }
  const expectedRoofs=world.shelters.map(s=>[s.x-s.w/2,s.z-s.d/2,s.x+s.w/2,s.z+s.d/2,s.height]
    .map(n=>Number(n.toFixed(5))));
  for (const shader of [r.rain.p.shaders[0],r.scene.p.shaders[1]]) {
    const rectangles=[...shader.source.matchAll(/insideRoof\(p,vec4\(([^)]+)\)\)\) h=max\(h,([\d.]+)\)/g)];
    assert.deepEqual(rectangles.map(m=>[...m[1].split(','),m[2]].map(Number)),expectedRoofs);
  }
  weather.step(s.weather,1/60,true);
  const before=h.gl.draws.length;
  r.draw(s);
  assert.equal(h.gl.draws.length-before,3);
  assert.equal(r.scene.p.uniforms.uWet[0],1);
  s.weather.shower=false; weather.step(s.weather,1/60,true); r.draw(s);
  s.weather.shower=true; weather.step(s.weather,1/60,false); r.draw(s);
  assert.equal(h.gl.uploads.length,initialUploads+1);
  assert.equal(h.gl.draws.filter(d=>d.offscreen).length,1);
});

test('a non-power-of-two driver limit still produces a complete mipmapped sign atlas', () => {
  const h=page({maxSize:768}), r=new Renderer(h.canvas,world,h.gl);
  assert.equal(r.labels.texture.width,512);
  assert.ok(Number.isInteger(Math.log2(r.labels.texture.height)));
  r.draw(state());
  assert.equal(h.gl.draws.at(-1).count,world.signs.length*6);
});

test('one static shadow bake serves the sky, opaque campus and blended signs across successive frames', () => {
  const h=page(), gl=h.gl, r=new Renderer(h.canvas,world,gl), s=state();
  const [bake]=gl.draws;
  assert.ok(bake.offscreen && bake.depth && !bake.dither);
  assert.equal(bake.start,world.casterStart);
  assert.equal(bake.count+world.casterStart,world.vertices.length/STRIDE);
  assert.equal(gl.buffers.length,3);
  const uploads=gl.uploads.length;
  for (const light of [0,0.45,1]) {
    s.light=light; r.draw(s);
    const [sky,grounds,signs] = gl.draws.slice(-3);
    assert.ok(!sky.offscreen && !sky.depth && !sky.writeDepth);
    assert.equal(sky.count,3);
    assert.ok(grounds.depth && grounds.writeDepth && !grounds.blend);
    assert.equal(grounds.count,world.vertices.length/STRIDE);
    assert.ok(signs.depth && signs.blend && !signs.writeDepth);
    assert.equal(signs.count,world.signs.length*6);
    assert.equal(gl.programs[grounds.program].uniforms.uNight[0],light);
    assert.equal(gl.programs[sky.program].uniforms.uNight[0],light);
    assert.equal(gl.programs[signs.program].uniforms.uNight[0],light);
  }
  assert.equal(gl.uploads.length,uploads);
  assert.equal(gl.draws.filter(d=>d.offscreen).length,1);
  assert.equal(gl.programs[0].uniforms['uLamps[0]'].length,world.lamps.length*2);
  assert.ok(gl.writeDepth && !gl.flags.has(gl.BLEND));
});

test('the local sign atlas packs upright text and correctly sized world-space quads', () => {
  const h=page(), r=new Renderer(h.canvas,world,h.gl), labels=r.labels;
  const text=labels.texture.source.pen.text, data=labels.buffer.data;
  for (const [i,sign] of world.signs.entries()) {
    for (const line of sign.words.split('|')) assert.ok(text.includes(line));
    const offset=i*6*5, a=data.subarray(offset,offset+5), b=data.subarray(offset+5,offset+10);
    const c=data.subarray(offset+10,offset+15);
    assert.ok(Math.abs(Math.hypot(a[0]-b[0],a[2]-b[2])-sign.width)<1e-5);
    assert.ok(Math.abs(c[1]-b[1]-sign.height)<1e-5);
    assert.ok(a[4]>c[4] && a[3]<b[3]);
    for (let j=0; j<6; j++) {
      const uv=data.subarray(offset+j*5+3,offset+j*5+5);
      assert.ok(uv.every(n=>n>=0 && n<=1));
    }
  }
});

test('the scene draws with smaller textures, an incomplete shadow framebuffer and no derivatives extension', () => {
  const h=page({maxSize:256,shadow:false,derivatives:false}), r=new Renderer(h.canvas,world,h.gl);
  assert.equal(r.shadowOK,false);
  assert.equal(h.gl.draws.length,0);
  r.draw(state());
  assert.equal(h.gl.draws.length,3);
  assert.equal(r.scene.p.uniforms.uHasShadow[0],0);
  assert.equal(r.shadow.width,1);
  assert.ok(r.labels.texture.height<=256);
  assert.doesNotMatch(r.scene.p.shaders[1].source,/fwidth/);
});

test('resize follows the canvas aspect, caps the pixel budget and adapts to sustained slow frames', () => {
  const h=page({dpr:3}),r=new Renderer(h.canvas,world,h.gl);
  h.canvas.clientWidth=3840; h.canvas.clientHeight=2160;
  assert.equal(r.resize(),true);
  assert.ok(h.canvas.width*h.canvas.height<2310000);
  assert.ok(Math.abs(r.aspect-16/9)<0.003);
  assert.equal(r.resize(),false);
  const before=h.canvas.width;
  // A single pause does not downscale. Sustained pressure does.
  r.measureFrame(0.8); r.measureFrame(NaN);
  assert.equal(r.quality,1);
  for (let i=0; i<160; i++) r.measureFrame(1/25);
  r.resize();
  assert.ok(r.quality>=0.65 && h.canvas.width<before);
  const low=r.quality;
  for (let i=0; i<600; i++) r.measureFrame(1/100);
  assert.ok(r.quality>low && r.quality<=1);
  h.canvas.clientWidth=0; h.canvas.clientHeight=0;
  r.resize();
  assert.equal(h.canvas.width,1); assert.equal(h.canvas.height,1);
  assert.ok(r.projection.every(Number.isFinite));
});

test('graphics driver compile and link failures surface a diagnostic and release the failed program', () => {
  for (const flag of ['compileFailure','linkFailure']) {
    const h=page({[flag]:true});
    assert.throws(()=>new Renderer(h.canvas,world,h.gl),/simulated/);
    assert.ok(h.gl.programs[0].deleted);
  }
  const h=page();
  h.gl.getProgramParameter=p=>p.id!==1;
  assert.throws(()=>new Renderer(h.canvas,world,h.gl),/simulated/);
  assert.equal(h.gl.programs.length,2);
  assert.ok(h.gl.programs.every(p=>p.deleted));
});

test('pre-shower world and view data still render a clear campus', () => {
  const h=page(), originalView=state(), originalWorld={...world};
  delete originalView.weather;
  delete originalWorld.shelters;
  const r=new Renderer(h.canvas,originalWorld,h.gl);
  r.draw(originalView);
  assert.equal(r.scene.p.uniforms.uWet[0],0);
  assert.equal(r.sky.p.uniforms.uWet[0],0);
  assert.equal(h.gl.draws.length,4);
});

test('interrupted program lookup, atlas uploads and shadow baking release partial resources before retry',()=>{
  for (const method of ['getUniformLocation','generateMipmap','bufferData','drawArrays']) {
    const h=page(), gl=h.gl, original=gl[method];
    gl[method]=function (...args) {
      if (method==='bufferData' && gl.buffers.length<3) return original.apply(this,args);
      throw Error('interrupted '+method);
    };
    assert.throws(()=>new Renderer(h.canvas,world,gl),/interrupted/);
    for (const objects of [gl.programs,gl.textures,gl.buffers,gl.framebuffers,gl.renderbuffers]) {
      assert.ok(objects.every(obj=>obj.deleted),method+' abandoned an allocation');
    }
    assert.equal(gl.framebuffer,null);
    assert.ok(gl.flags.has(gl.DITHER) && gl.writeDepth && !gl.flags.has(gl.BLEND));
    gl[method]=original;
    const r=new Renderer(h.canvas,world,gl);
    r.draw(state());
    assert.ok(!gl.draws.at(-1).offscreen);
    r.dispose();
  }
});

test('a missing offscreen attachment falls back to daylight without a shadow pass',()=>{
  for (const name of ['createFramebuffer','createRenderbuffer']) {
    const h=page(), gl=h.gl;
    gl[name]=()=>null;
    const r=new Renderer(h.canvas,world,gl);
    assert.equal(r.shadowOK,false);
    assert.equal(r.shadow.width,1);
    assert.ok(gl.framebuffers.every(fb=>fb.deleted) && gl.renderbuffers.every(rb=>rb.deleted));
    r.draw(state());
    assert.equal(gl.draws.length,3);
    assert.ok(gl.draws.every(d=>!d.offscreen));
  }
});
