'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {root, html, scripts, loadPage} = require('./support/page.js');
const {declarations} = require('./support/graphics.js');
const C = require('../js/city.js');
const Q = require('../js/quay.js');
const L = require('../js/lanterns.js');
const T = require('../js/tide.js');
const B = require('../js/beacon.js');
const Cargo = require('../js/cargo.js');
const M = require('../js/math.js');

test('index loads every application module as a local, ordered classic script', () => {
  const tags = html.match(/<script\b[^>]*>/g);
  assert.equal(tags.length,scripts.length);
  assert.ok(tags.every(tag=>/\bdefer\b/.test(tag) && !/\b(async|module)\b/.test(tag)));
  const modules=fs.readdirSync(path.join(root,'js')).filter(n=>n.endsWith('.js')).map(n=>'js/'+n);
  assert.deepEqual([...scripts].sort(),modules.sort());
  assert.equal(scripts.at(-1),'js/app.js');
  const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for (const [,ref] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (ref === 'data:,') continue;
    assert.match(ref,/^[\w./-]+$/);
    assert.ok(fs.statSync(path.join(root,ref)).isFile());
  }
  const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
  assert.doesNotMatch(css,/@import|url\(\s*['"]?(?:https?:|\/\/)/i);
  for (const file of scripts) {
    const js=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(js,/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon\s*\(|import\s*\()/);
  }
  assert.match(html,/<noscript>[\s\S]*JavaScript is required/);
});

test('all seven GLSL programs have balanced sources, matching varyings and valid WebGL 1 stage outputs', () => {
  const page=loadPage();
  page.ready();
  assert.equal(page.gl.programs.length,7);
  const {HarbourShaders:shaders}=page.globals;
  const standalone = require('../js/shaders.js');
  for (const [name, source] of Object.entries(shaders)) assert.equal(standalone[name], source);
  for (const source of Object.values(shaders)) {
    const stripped=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
    const stack=[], pairs={')':'(',']':'[','}':'{'};
    for (const token of stripped.match(/[()[\]{}]/g)) {
      if ('([{'.includes(token)) stack.push(token);
      else assert.equal(stack.pop(),pairs[token]);
    }
    assert.equal(stack.length,0);
    assert.equal((stripped.match(/void main\(\)/g)||[]).length,1);
    assert.doesNotMatch(stripped,/#version 3|gl_VertexID|\bundefined\b/);
  }
  for (const {vertex,fragment,inputs} of page.gl.programs) {
    assert.match(vertex,/gl_Position\s*=/);
    assert.match(fragment,/precision (?:highp|mediump) float;/);
    assert.match(fragment,/gl_FragColor\s*=/);
    assert.ok(inputs.size <= 8);
    const outputs=declarations(vertex,'varying');
    assert.ok(outputs.size <= 8 && declarations(fragment,'uniform').size <= 16, 'fits WebGL 1 minimum limits');
    for (const [name,decl] of declarations(fragment,'varying')) assert.deepEqual(decl,outputs.get(name));
  }
});

test('a failed program link releases earlier programs and reports the graphics error', () => {
  const p = loadPage({badLinkAt:2});
  assert.equal(p.gl.programs.length, 3);
  assert.ok(p.gl.programs.every(program => program.deleted && program.shaders.every(s => s.deleteRequested)));
  assert.match(p.id('error-title').textContent, /could not be drawn/);
  assert.ok(p.errors.some(line => line.includes('Link failure')));
  assert.equal(p.frames.size, 0);
});

test('a frame draws reflected geometry, the harbour, then a two-axis bloom and final composite', () => {
  const p=loadPage();
  p.ready();
  const {gl}=p, shaders=p.globals.HarbourShaders;
  const screen=gl.draws.filter(d=>!d.indexed);
  const geometry=gl.draws.filter(d=>gl.programs[d.program].fragment===shaders.building);
  const stages=screen.map(d=>Object.keys(shaders).find(name=>shaders[name]===gl.programs[d.program].fragment));
  assert.deepEqual(stages,['environment','environment','extract','blur','blur','finish']);
  const [mirror,scene,extract,horizontal,vertical,finish]=screen;
  assert.deepEqual(mirror.uniforms.uMirror,[-1]);
  assert.deepEqual(scene.uniforms.uMirror,[1]);
  assert.ok(mirror.viewport[2]<scene.viewport[2] && mirror.viewport[3]<scene.viewport[3]);
  assert.ok(mirror.clip[3]>0 && mirror.clip[3]<mirror.viewport[3]);
  assert.equal(scene.clip,null);
  assert.equal(scene.sampled.uReflection,mirror.output);
  assert.equal(extract.sampled.uImage,scene.output);
  assert.equal(horizontal.sampled.uImage,extract.output);
  assert.equal(vertical.sampled.uImage,horizontal.output);
  assert.equal(vertical.output,extract.output);
  assert.equal(horizontal.uniforms.uStep[1],0);
  assert.equal(vertical.uniforms.uStep[0],0);
  assert.ok(horizontal.uniforms.uStep[0]>0 && vertical.uniforms.uStep[1]>0);
  assert.equal(finish.sampled.uImage,scene.output);
  assert.equal(finish.sampled.uBloom,vertical.output);
  assert.equal(finish.target,0);
  const reflected=geometry.filter(d=>d.target===mirror.target);
  const upright=geometry.filter(d=>d.target===scene.target);
  assert.equal(reflected.length,upright.length);
  const land = upright.filter(d => d.uniforms.uModel.every(v => v === 0));
  assert.ok(land.length >= 1 && land.length <= 3);
  assert.equal(upright.length, land.length + 9, 'three vessels, tram, wheel rim and cabins, cargo rig and two cable cars');
  assert.ok(reflected.every(d=>d.winding===gl.CW && d.clip && d.cull && d.depth));
  assert.ok(upright.every(d=>d.winding===gl.CCW && !d.clip && d.cull && d.depth));
  assert.deepEqual(reflected.map(d=>d.uniforms.uModel),upright.map(d=>d.uniforms.uModel));
  assert.deepEqual(upright.slice(-3).map(d=>d.uniforms.uScale[0]),[1,0.64,1]);
  const junk=C.junkPose(0);
  assert.deepEqual(upright.at(-1).uniforms.uModel,[junk.x,junk.y,junk.z,junk.angle]);
  assert.equal(upright[0].uniforms.uProjection.length,16);
  assert.ok(screen.every(d=>!d.depth && !d.cull));
  const lamps = gl.draws.filter(d => gl.programs[d.program].fragment === shaders.lantern);
  const beam = gl.draws.filter(d => gl.programs[d.program].fragment === shaders.beacon);
  assert.deepEqual(lamps.map(d => d.target), [mirror.target, scene.target]);
  assert.deepEqual(beam.map(d => d.target), [mirror.target, scene.target]);
  assert.equal(gl.draws.length, screen.length + geometry.length + lamps.length + beam.length);
  for (const lamp of [...lamps, ...beam]) {
    assert.ok(lamp.indexed && lamp.depth && !lamp.cull && !lamp.depthWrite);
    assert.deepEqual(lamp.blend, [gl.ONE, gl.ONE]);
    assert.ok(gl.draws.indexOf(lamp) > gl.draws.indexOf(geometry.filter(d => d.target === lamp.target).at(-1)));
  }
  assert.ok([...screen, ...geometry].every(d => !d.blend && d.depthWrite));
});

test('texture atlases contain windows and all painted bilingual signs, including on a constrained device', () => {
  const page=loadPage({textureLimit:512,renderLimit:400});
  page.ready();
  const textures=page.gl.textures.filter(t=>t.ink);
  assert.equal(textures.length,2);
  assert.ok(textures.every(t=>t.mip && t.width===512 && t.height===512 && t.ink.saves===0));
  const facades=textures.find(t=>!t.ink.words.length);
  const signs=textures.find(t=>t.ink.words.length);
  assert.ok(facades.ink.fills>16*16*24);
  for (const {han,latin} of C.signDesigns) {
    assert.ok(signs.ink.words.includes(latin));
    assert.ok(Array.from(han).every(ch=>signs.ink.words.includes(ch)));
  }
  assert.equal(page.canvas.width,400);
  assert.ok(page.gl.framebuffers.every(fb=>fb.texture.width<=400 && fb.texture.height<=400));
});

test('resizing retires old render targets, keeps mesh buffers and handles a collapsed viewport', () => {
  const p=loadPage({reduced:true});
  p.ready(); p.tick();
  const old=[...p.gl.framebuffers], bufferCount=p.gl.buffers.length;
  p.canvas.clientWidth=0; p.canvas.clientHeight=0;
  p.win.emit('resize'); p.tick();
  p.ready();
  assert.ok(old.every(fb=>fb.deleted && fb.texture.deleted && (!fb.depth || fb.depth.deleted)));
  assert.deepEqual([p.canvas.width,p.canvas.height],[1,1]);
  assert.ok(p.gl.draws.every(d=>d.viewport[2]===1 && d.viewport[3]===1));
  p.canvas.clientWidth=410; p.canvas.clientHeight=690;
  p.win.emit('resize'); p.tick();
  assert.deepEqual([p.canvas.width,p.canvas.height],[410,690]);
  assert.equal(p.gl.buffers.length,bufferCount);
  const allocated=p.gl.framebuffers.length;
  p.win.emit('resize'); p.tick();
  assert.equal(p.gl.framebuffers.length,allocated);
  assert.equal(p.gl.framebuffers.filter(fb=>!fb.deleted).length,4);
});

test('sustained slow frames lower the pixel budget and steady 60 Hz frames recover resolution', () => {
  const p=loadPage({width:1000,height:500});
  p.ready();
  const programs = p.gl.programs.length;
  for (let i=0;i<52;i++) p.tick(1000/30);
  p.ready();
  const reduced=p.canvas.width;
  assert.ok(reduced < 1000 && reduced >= 560);
  for (let i=0;i<440;i++) p.tick(1000/60);
  p.ready();
  assert.equal(p.canvas.width,1000);
  assert.equal(p.gl.programs.length,programs);
  assert.equal(p.gl.textures.filter(t=>!t.deleted).length,7);
});

test('the live and reflected quay agree on tram pose, spinning rim, upright cabin pivots and all three wakes', () => {
  const p = loadPage();
  p.ready(); p.tick(); p.tick(100);
  const screen = p.gl.draws.filter(d => !d.indexed);
  const [mirror, harbour] = screen, time = harbour.uniforms.uTime[0];
  const car = Q.tramPose(time), angle = Q.wheelAngle(time);
  for (const pass of [mirror, harbour]) {
    const geometry = p.gl.draws.filter(d => d.uniforms.uModel && d.target === pass.target);
    const tram = geometry.find(d => d.uniforms.uModel[0] === car.x);
    assert.deepEqual(tram.uniforms.uModel, [car.x, car.y, car.z, car.angle]);
    assert.deepEqual(tram.uniforms.uTramDirection, [car.direction]);
    const wheel = geometry.filter(d => d.uniforms.uWheel[2] !== 0);
    assert.equal(wheel.length, 2);
    wheel.forEach((d, i) => {
      assert.deepEqual(d.uniforms.uWheel, [Math.cos(angle), Math.sin(angle), i + 1]);
      assert.deepEqual(d.uniforms.uModel, [Q.wheel.x, Q.wheel.y, Q.wheel.z, 0]);
      assert.deepEqual(d.uniforms.uScale, [1]);
    });
    for (const [key, boat] of [['uFerryWake', C.ferryPose(time)], ['uLaunchWake', C.ferryPose(time, 1)], ['uJunkWake', C.junkPose(time)]]) {
      assert.deepEqual(pass.uniforms[key], [boat.x, boat.z, Math.cos(boat.angle), Math.sin(boat.angle)]);
    }
  }
});

test('changes of weather reach sky, buildings, reflections and rain composite without uploading geometry or textures', () => {
  const p = loadPage({reduced:true, width:600, height:400}), W = require('../js/weather.js');
  p.ready(); p.tick();
  const uploads = () => [...p.gl.buffers, ...p.gl.textures].map(r => r.uploads);
  const before = uploads(), targets = p.gl.framebuffers.length;
  const programs = p.gl.programs.length;
  p.id('play').emit('click'); p.tick(); p.tick(100);
  for (const id of ['squall', 'mist', 'moonlit']) {
    const weather = p.id('weather'); weather.value = id; weather.emit('change'); p.tick(100);
    const [mirror, scene] = p.gl.draws.filter(d => !d.indexed);
    const geometry = p.gl.draws.filter(d => d.indexed);
    for (const d of [mirror, scene, ...geometry]) assert.deepEqual(d.uniforms.uWeather, W.profiles[id]);
    assert.deepEqual(p.gl.draws.at(-1).uniforms.uRain, [W.profiles[id][1], scene.uniforms.uTime[0], 1.5]);
    assert.deepEqual(uploads(), before);
    assert.equal(p.gl.framebuffers.length, targets);
    assert.equal(p.gl.programs.length, programs);
  }
});

test('an allocation failure partway through a resize retires every partial render target', () => {
  const p = loadPage({reduced:true, badFramebufferAt:7});
  p.ready(); p.tick();
  p.canvas.clientWidth = 525;
  p.win.emit('resize'); p.tick();
  assert.equal(p.gl.framebuffers.length, 7);
  assert.ok(p.gl.framebuffers.every(f => f.deleted && f.texture.deleted && (!f.depth || f.depth.deleted)));
  assert.equal(p.frames.size, 0);
  assert.match(p.id('error-title').textContent, /could not be drawn/);
  assert.ok(p.id('lookout').disabled && p.id('weather').disabled);
});

test('aerial boat tracking carries its north-up basis into WebGL and covers the full visible water in the mirror', () => {
  const p = loadPage({reduced:true, width:1100, height:540});
  p.ready(); p.key('3');
  p.id('lookout').value = 'junk'; p.id('lookout').emit('change');
  p.id('timeline').value = 450; p.id('timeline').emit('input'); p.tick();
  const [mirror, scene] = p.gl.draws.filter(d => !d.indexed);
  const u = scene.uniforms;
  assert.ok(u.uUp[2] < -0.96 && u.uForward[1] < -0.95);
  assert.notEqual(u.uRight[1], 0);
  for (const x of [-1, 0, 1]) {
    for (let row = 0; row < mirror.viewport[3]; row++) {
      const y = (row + 0.5) * 2 / mirror.viewport[3] - 1;
      const rayY = u.uForward[1] + x * u.uLens[0] * u.uRight[1] + y * u.uLens[1] * u.uUp[1];
      if (rayY < 0) assert.ok(row < mirror.clip[3], 'water has a rendered reflection sample');
    }
  }
});

test('the reflection, water, floating hulls and lantern cues share the clock through a morph, a high tide and a pause', () => {
  const p = loadPage({reduced:true, address:'#seed=852'});
  p.ready(); p.tick();
  const lookout = p.id('lookout'), call = p.id('lookout-call');
  const uploads = () => [...p.gl.textures.filter(t => t.mip), ...p.gl.buffers].map(b => b.uploads);
  const original = uploads();
  function choose(subject) { lookout.value = subject; lookout.emit('change'); p.tick(0); }
  function check() {
    const [mirror, live] = p.gl.draws.filter(d => !d.indexed);
    const time = live.uniforms.uTime[0], height = T.heightAt(time);
    for (const pass of [mirror, live]) {
      const scenery = p.gl.draws.filter(d => d.target === pass.target);
      assert.ok(scenery.every(d => d.uniforms.uTide[0] === height));
      const lamp = scenery.find(d => d.uniforms.uWeights), u = lamp.uniforms;
      assert.equal(lamp.count, L.count * 6);
      assert.deepEqual(u.uOrigin, L.origin);
      assert.deepEqual(u.uWeights, L.cue(time).weights);
      assert.deepEqual(u.uMirror, pass.uniforms.uMirror);
      assert.deepEqual(u.uProjection, scenery[1].uniforms.uProjection);
      assert.deepEqual(u.uLampSize.slice(2), [4.6 / pass.viewport[2], 4.6 / pass.viewport[3]]);
      for (const hull of [C.ferryPose(time), C.ferryPose(time, 1), C.junkPose(time)]) {
        const model = scenery.find(d => d.uniforms.uModel?.[0] === hull.x).uniforms.uModel;
        assert.deepEqual(model.slice(0,3), [hull.x, hull.y, hull.z]);
        assert.ok(Math.abs(model[1] - height) < 0.071);
      }
    }
    return time;
  }
  choose('lanterns');
  assert.equal(check(), 0);
  assert.equal(call.textContent, 'Twin Sails');
  p.key('s'); p.key(' '); p.tick(0);
  for (let i = 0; i < 65; i++) p.tick(100);
  const morph = check();
  assert.ok(Math.abs(morph - 13) < 1e-8);
  assert.equal(call.textContent, 'Forming Three Currents');
  assert.ok(L.cue(morph).weights.every((v,i) => Math.abs(v - [0.5,0.5,0][i]) < 1e-8));
  choose('landing');
  for (let i = 0; i < 160; i++) p.tick(100);
  p.key(' '); p.tick(0);
  const high = check();
  assert.ok(Math.abs(high - 45) < 1e-8);
  assert.equal(call.textContent, 'High tide · +0.86 m');
  assert.deepEqual(uploads(), original);
  p.id('timeline').value = 972; p.id('timeline').emit('input'); p.tick(5000);
  assert.equal(check(), high);
  assert.equal(p.frames.size, 0);
});

test('an absent framebuffer, colour texture or depth handle stops rendering and releases partially built targets', () => {
  for (const resource of ['createFramebuffer', 'createTexture', 'createRenderbuffer']) {
    const p = loadPage({reduced:true}); p.ready(); p.tick();
    const existing = p.gl.textures.length;
    p.gl[resource] = () => null;
    p.canvas.clientWidth -= 100;
    p.win.emit('resize'); p.tick();
    assert.match(p.id('error-title').textContent, /could not be drawn/);
    assert.ok(p.errors.some(line => /allocation failed/.test(line)));
    assert.ok(p.gl.framebuffers.every(f => f.deleted));
    assert.ok(p.gl.textures.slice(existing).every(t => t.deleted));
    assert.ok([...p.gl.programs, ...p.gl.buffers, ...p.gl.textures].every(handle => handle.deleted));
    assert.equal(p.frames.size, 0);
  }
});

test('setup releases uploaded atlases and partial vertex/index pairs when another scene resource cannot be allocated', () => {
  for (const failure of [{missingTextureAt:2}, {missingBufferAt:2}, {missingBufferAt:11}]) {
    const p = loadPage(failure);
    assert.equal(p.canvas.dataset.status, 'unavailable');
    assert.ok(p.errors.some(line => /allocation failed/.test(line)));
    assert.ok([...p.gl.programs, ...p.gl.textures, ...p.gl.buffers].every(handle => handle.deleted));
    assert.equal(p.frames.size, 0);
  }
});

test('the beacon, chart ray, crane ropes and cargo share one tide and clock across both scene passes', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const resources = () => [...p.gl.buffers, ...p.gl.textures].map(item => item.uploads);
  const original = resources(), chart = p.id('chart').ink;
  const menu = p.id('lookout');
  function check(time) {
    const rig = Cargo.transfer(time), tide = T.heightAt(time), sweep = B.direction(time);
    for (const pass of p.gl.draws.filter(d => d.uniforms.uTime)) {
      const scenery = p.gl.draws.filter(d => d.target === pass.target);
      const beams = scenery.filter(d => d.uniforms.uContact);
      assert.equal(beams.length, 1);
      const [{count, uniforms:u}] = beams;
      assert.equal(count, 18);
      assert.deepEqual(u.uTide, [tide]);
      assert.deepEqual(u.uSweep, sweep);
      assert.deepEqual(u.uContact, B.waterContact(tide));
      assert.deepEqual(u.uOptics, [B.optics.range, B.optics.slope, B.optics.spread, B.optics.aperture]);
      assert.deepEqual(u.uLamp, B.lamp);
      assert.deepEqual(u.uEye, pass.uniforms.uEye);
      assert.deepEqual(u.uLens, pass.uniforms.uLens);
      assert.deepEqual(u.uMirror, pass.uniforms.uMirror);
      assert.deepEqual(u.uPhase, [M.wrap(time, M.TAU)]);
      const solids = scenery.filter(d => d.uniforms.uHoist);
      for (const solid of solids) {
        assert.deepEqual(solid.uniforms.uLamp, u.uLamp);
        assert.deepEqual(solid.uniforms.uSweep, u.uSweep);
        assert.deepEqual(solid.uniforms.uOptics, u.uOptics);
      }
      const moving = solids.filter(d => d.uniforms.uHoist[0] !== 0);
      assert.equal(moving.length, 1);
      assert.deepEqual(moving[0].uniforms.uModel, [rig.x, 0, rig.z, rig.angle]);
      assert.deepEqual(moving[0].uniforms.uHoist, [rig.hook, rig.bottom]);
      assert.ok(solids.filter(d => d !== moving[0]).every(d => d.uniforms.uHoist.every(n => n === 0)));
      assert.deepEqual(moving[0].uniforms.uProjection, u.uProjection);
    }
    assert.deepEqual(resources(), original);
  }
  menu.value = 'beacon'; menu.emit('change'); p.tick();
  for (const time of [0,1.5,9.5,17.5]) {
    if (time) { p.key('n'); p.tick(); }
    check(time);
    assert.equal(p.id('lookout-call').textContent, 'Lens bearing · ' + B.sector(time));
    const [lx,,lz] = B.lamp, [dx,dz] = B.direction(time), reach = B.waterContact(T.heightAt(time))[1];
    const x = 84 + lx * 0.8, y = 24 + lz * 0.4;
    assert.ok(chart.lines.some(line => line[0][0] === x && line[0][1] === y &&
      Math.abs(line[1][0] - x - dx*reach*0.8) < 1e-8 && Math.abs(line[1][1] - y - dz*reach*0.4) < 1e-8));
    assert.equal(p.frames.size, 0);
  }
  menu.value = 'cargo'; menu.emit('change');
  for (const [time, call] of [[48,'Landed on quay'], [84,'Landed on barge']]) {
    p.id('next-event').emit('click'); p.tick();
    check(time);
    assert.equal(p.id('lookout-call').textContent, call);
    const rig = Cargo.transfer(time);
    assert.ok(chart.arcs.some(([x,y,r]) => r === 4.4 && x === 84 + rig.x*0.8 && y === 24 + rig.z*0.4));
  }
});

test('a failed beacon link or partial cable car, beam or rig upload retires all handles from startup', () => {
  const ok = loadPage({reduced:true}); ok.ready();
  const cabin = ok.gl.draws.find(d => d.uniforms.uCabin?.[1] === 1);
  const cabinIndex = ok.gl.buffers.indexOf(cabin.indexBuffer) + 1;
  assert.ok(cabinIndex > 1);
  const last = ok.gl.buffers.length; // Screen triangle follows the two indexed batches.
  for (const fault of [{badLinkAt:6}, {missingBufferAt:cabinIndex}, {missingBufferAt:last-3}, {missingBufferAt:last-1}]) {
    const p = loadPage(fault);
    assert.equal(p.canvas.dataset.status, 'unavailable');
    assert.ok(p.id('lookout').disabled && p.routes[3].disabled);
    assert.ok([...p.gl.programs, ...p.gl.textures, ...p.gl.buffers].every(handle => handle.deleted));
    assert.equal(p.frames.size, 0);
  }
});
