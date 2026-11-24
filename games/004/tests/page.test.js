'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {html, loadPage}=require('./support/page.js');
const M = require('../js/math.js');
const F = require('../js/flight.js');
const Q = require('../js/quay.js');
const W = require('../js/weather.js');
const {lighting} = require('../js/atmosphere.js');

function environment(page) {
  const shader=page.globals.HarbourShaders.environment;
  return page.gl.draws.find(d=>page.gl.programs[d.program].fragment===shader && d.uniforms.uMirror[0]===1).uniforms;
}

test('the local scene menus expose every supported choice with a label and visible keyboard help', () => {
  for (const [id, values, shortcut] of [['weather', Object.keys(W.profiles), 'W'],
    ['lighting', Object.keys(lighting.profiles), 'T'], ['lookout', F.lookouts, 'L']]) {
    const menu = html.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
    assert.ok(menu);
    assert.deepEqual(Array.from(menu[1].matchAll(/<option value="([^"]+)">[^<]+<\/option>/g), m => m[1]), values);
    assert.ok(html.includes('<label for="' + id + '">'));
    assert.ok(html.includes('<kbd>' + shortcut + '</kbd>'));
  }
});

test('the local page starts flying and its buttons, hotkeys, chart and timeline share flight state', () => {
  const p=loadPage();
  p.ready();
  assert.equal(p.id('error-panel').hidden,true);
  assert.equal(p.id('play-label').textContent,'Pause flight');
  for (let i=0;i<12;i++) p.tick(100);
  assert.equal(p.id('elapsed').textContent,'00:01');
  assert.ok(environment(p).uTime[0]>1);
  p.key(' ');
  p.tick();
  assert.equal(p.id('flight-label').textContent,'PAUSED');
  assert.equal(p.frames.size,0);
  const before=p.gl.totalDraws;
  p.tick(5000);
  assert.equal(p.gl.totalDraws,before);
  const map=p.id('chart').ink.image;
  p.routes[1].emit('click');
  assert.equal(p.id('duration').textContent,'01:36');
  assert.equal(p.routes[1].getAttribute('aria-pressed'),'true');
  assert.notEqual(p.id('chart').ink.image,map);
  p.key('3');
  assert.equal(p.id('duration').textContent,'02:30');
  assert.equal(p.routes[2].getAttribute('aria-pressed'),'true');
  p.id('timeline').value=500;
  p.id('timeline').emit('input'); p.tick();
  assert.equal(p.id('elapsed').textContent,'01:15');
  assert.equal(p.id('timeline').getAttribute('aria-valuetext'),'01:15 of 02:30');
  assert.equal(p.frames.size,0);
  p.speeds[0].emit('click');
  assert.equal(p.speeds[0].getAttribute('aria-pressed'),'true');
  p.key('s'); p.key('s');
  assert.equal(p.speeds[2].getAttribute('aria-pressed'),'true');
  p.id('play').emit('click'); p.tick();
  const initial=environment(p).uTime[0];
  p.tick(100);
  assert.ok(Math.abs(environment(p).uTime[0]-initial-0.2)<1e-6);
  p.ready();
});

test('reduced-motion playback can look, recenter and resize while resting between interactions', () => {
  const p=loadPage({reduced:true});
  p.ready(); p.tick();
  const original=environment(p).uForward;
  assert.equal(p.id('flight-label').textContent,'PAUSED');
  assert.equal(p.frames.size,0);
  p.canvas.emit('pointerdown',{button:0,pointerId:7,clientX:170,clientY:90});
  assert.equal(p.canvas.captured,7);
  p.canvas.emit('pointermove',{pointerId:8,clientX:1,clientY:1});
  assert.equal(p.frames.size,0);
  p.canvas.emit('pointermove',{pointerId:7,clientX:80,clientY:102}); p.tick();
  assert.ok(environment(p).uForward[0]>original[0]);
  p.canvas.emit('lostpointercapture',{pointerId:7});
  p.canvas.emit('dblclick'); p.tick();
  assert.deepEqual(environment(p).uForward,original);
  assert.ok(p.key('ArrowLeft').defaultPrevented);
  p.tick(); p.tick();
  assert.ok(environment(p).uForward[0]<original[0]);
  p.win.emit('blur'); p.tick();
  assert.equal(p.frames.size,0);
  p.key('r'); p.tick();
  assert.deepEqual(environment(p).uForward,original);
  assert.equal(environment(p).uTime[0],0);
});

test('shortcuts preserve native button and range behaviour and ignore modifier combinations', () => {
  const p=loadPage({reduced:true}); p.ready(); p.tick();
  p.key(' ',{target:p.id('play')});
  p.key('2',{altKey:true});
  p.key('3',{repeat:true});
  assert.equal(p.key('ArrowRight',{target:p.id('timeline')}).defaultPrevented,false);
  assert.equal(p.frames.size,0);
  assert.equal(p.routes[0].getAttribute('aria-pressed'),'true');
  p.key('f');
  assert.equal(p.id('fullscreen').getAttribute('aria-label'),'Exit fullscreen');
  p.id('fullscreen').emit('click');
  assert.equal(p.id('fullscreen').getAttribute('aria-pressed'),'false');
});

test('a new seed updates the same local page, reuses GPU resources and preserves the selected shot', () => {
  const p=loadPage({reduced:true,address:'?seed=4294967295'});
  p.ready();
  p.key('2');
  p.id('timeline').value=250;
  p.id('timeline').emit('input'); p.tick();
  const previous=environment(p).uEye, oldTextures=[...p.gl.textures];
  const programs=p.gl.programs.length, targets=p.gl.framebuffers.length;
  p.id('regenerate').emit('click');
  assert.equal(p.location.hash,'#seed=0');
  p.win.emit('hashchange'); p.tick();
  p.ready();
  assert.deepEqual(environment(p).uEye,previous);
  assert.equal(p.id('elapsed').textContent,'00:24');
  assert.equal(p.id('flight-label').textContent,'PAUSED');
  assert.match(p.id('regenerate').title,/seed 0$/);
  assert.equal(p.gl.programs.length,programs);
  assert.equal(p.gl.framebuffers.length,targets);
  assert.equal(p.gl.textures.length,oldTextures.length);
  assert.equal(oldTextures.filter(t=>t.uploads===2).length,2);
  p.key('g'); p.win.emit('hashchange'); p.tick();
  assert.match(p.id('regenerate').title,/seed 1$/);
  p.location.hash='';
  p.win.emit('hashchange'); p.tick();
  assert.match(p.id('regenerate').title,/seed 4294967295$/);
});

test('hiding the page stops rendering and returning resumes at the same simulation time', () => {
  const p=loadPage(); p.ready();
  p.tick(); p.tick(50);
  const before=environment(p).uTime[0], draws=p.gl.totalDraws;
  p.document.hidden=true; p.document.emit('visibilitychange');
  p.tick(120000);
  assert.equal(p.gl.totalDraws,draws);
  p.document.hidden=false; p.document.emit('visibilitychange');
  p.tick();
  assert.equal(environment(p).uTime[0],before);
  p.tick();
  assert.ok(environment(p).uTime[0]>before);
});

test('missing WebGL produces a readable alert even when all canvas contexts are unavailable', () => {
  for (const no2D of [true,false]) {
    const p=loadPage({noWebGL:true,no2D,noFullscreen:true});
    assert.equal(p.canvas.dataset.status,'unavailable');
    assert.equal(p.id('error-panel').hidden,false);
    assert.match(p.id('error-title').textContent,/WebGL is unavailable/);
    assert.match(p.id('error-detail').textContent,/hardware acceleration/);
    assert.equal(p.id('error-panel').getAttribute('role'),'alert');
    assert.equal(p.id('fullscreen').hidden,true);
    assert.equal(p.id('fullscreen-hint').hidden,true);
    assert.ok([...p.routes, ...p.speeds, ...['play','timeline','regenerate','weather','lighting','lookout','next-event','postcard','glass'].map(p.id)].every(el=>el.disabled));
    assert.equal(p.frames.size,0);
  }
});

test('weather picker and W cycle the same conditions while paused, and native select keys keep their behaviour', () => {
  const p = loadPage({reduced:true}), weather = p.id('weather'), lookout = p.id('lookout');
  p.ready(); p.tick();
  assert.equal(weather.value, 'moonlit');
  p.key('w'); p.tick();
  assert.equal(weather.value, 'mist');
  assert.deepEqual(environment(p).uWeather, W.profiles.mist);
  assert.equal(p.frames.size, 0);
  weather.value = 'squall'; weather.emit('change'); p.tick();
  assert.deepEqual(environment(p).uWeather, W.profiles.squall);
  assert.equal(environment(p).uTime[0], 0);
  p.key('w', {target:weather}); p.key('l', {target:lookout}); p.key('w', {repeat:true});
  assert.equal(p.key('ArrowDown', {target:weather}).defaultPrevented, false);
  assert.equal(p.frames.size, 0);
  assert.equal(lookout.value, 'route');
  p.key('W'); p.tick();
  assert.equal(weather.value, 'moonlit');
  assert.deepEqual(environment(p).uWeather, W.profiles.moonlit);
});

test('changing weather in flight blends over successive frames, including when interrupted by a different forecast', () => {
  const p = loadPage(); p.ready(); p.tick();
  p.key('w'); p.tick(100);
  const first = environment(p).uWeather;
  assert.ok(first[0] > 0 && first[0] < 1 && first[1] === 0);
  p.key('w'); p.tick(100);
  const second = environment(p).uWeather;
  assert.ok(second[0] > first[0] && second[0] < W.profiles.squall[0]);
  assert.ok(second[1] > 0 && second[1] < 1);
  for (let i = 0; i < 22; i++) p.tick(100);
  assert.deepEqual(environment(p).uWeather, W.profiles.squall);
});

test('the lookout, camera, live chart and stop readout follow the same tram across arrival and departure', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const lookout = p.id('lookout'), chart = p.id('chart').ink, plate = chart.image;
  lookout.value = 'tram'; lookout.emit('change'); p.tick();
  assert.equal(p.id('lookout-call').hidden, false);
  function checkTracking() {
    const u = environment(p), car = Q.tramPose(u.uTime[0]);
    const direction = M.normalize(M.subtract([car.x, car.y + 2.1, car.z], u.uEye));
    direction.forEach((v, i) => assert.ok(Math.abs(v - u.uForward[i]) < 1e-9));
    const [mx, my] = [84 + 0.8 * car.x, 24 + 0.4 * car.z];
    assert.ok(chart.arcs.some(([x,y,r]) => r === 4.4 && Math.hypot(x - mx, y - my) < 1e-8));
    assert.ok(chart.rects.some(([x,y]) => Math.hypot(x + 2.3 - mx, y + 0.85 - my) < 1e-8));
    assert.equal(chart.image, plate);
    assert.equal(p.id('lookout-call').textContent, car.at ? 'At ' + car.at : 'To ' + car.next);
  }
  checkTracking();
  assert.equal(p.id('lookout-call').textContent, 'To Study Pier');
  p.key('s'); p.key(' '); p.tick();
  for (let i = 0; i < 52; i++) p.tick(100);
  checkTracking();
  assert.equal(p.id('lookout-call').textContent, 'At Study Pier');
  for (let i = 0; i < 29; i++) p.tick(100);
  checkTracking();
  assert.equal(p.id('lookout-call').textContent, 'To Lantern Market');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'junk');
  assert.ok(p.id('lookout-call').hidden);
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'lanterns');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'landing');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'beacon');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'cargo');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'cableway');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'timehouse');
  p.key('l'); p.tick();
  assert.equal(lookout.value, 'route');
  assert.ok(!chart.arcs.some(a => a[2] === 4.4));
});

test('regenerating or restoring graphics keeps the weather, tracked subject, clocks and paused view', () => {
  const p = loadPage({reduced:true, address:'#seed=852'}); p.ready(); p.tick();
  p.key('2'); p.key('l'); p.key('w'); p.key('w');
  p.id('timeline').value = 625; p.id('timeline').emit('input'); p.tick();
  const initial = environment(p);
  p.key('g'); p.win.emit('hashchange'); p.tick();
  assert.equal(p.location.hash, '#seed=853');
  assert.deepEqual(environment(p).uEye, initial.uEye);
  p.canvas.emit('webglcontextlost');
  assert.ok(p.id('lookout').disabled && p.id('weather').disabled);
  p.key('l'); p.key('w');
  p.canvas.emit('webglcontextrestored'); p.tick(); p.ready();
  assert.ok(!p.id('lookout').disabled && !p.id('weather').disabled);
  assert.equal(p.id('lookout').value, 'wheel');
  assert.equal(p.id('weather').value, 'squall');
  assert.equal(p.id('elapsed').textContent, '01:00');
  assert.equal(p.frames.size, 0);
  assert.deepEqual(environment(p), initial);
});

test('a stale pointer cannot interrupt a new drag after a blur, cancellation or context loss', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const down = id => p.canvas.emit('pointerdown', {button:0, pointerId:id, clientX:112, clientY:65});
  down(3); p.win.emit('blur');
  down(5); p.canvas.emit('pointercancel', {pointerId:5});
  down(7); p.canvas.emit('webglcontextlost'); p.canvas.emit('webglcontextrestored'); p.tick();
  down(8); p.canvas.emit('lostpointercapture', {pointerId:7});
  const before = environment(p).uForward;
  p.canvas.emit('pointermove', {pointerId:8, clientX:77, clientY:68}); p.tick();
  assert.notDeepEqual(environment(p).uForward, before);
  p.canvas.emit('pointerup', {pointerId:8});
  p.canvas.emit('pointermove', {pointerId:8, clientX:55, clientY:65});
  assert.equal(p.frames.size, 0);
});

test('shader and framebuffer setup errors stop the flight with a graphics-specific message', () => {
  for (const options of [{badShader:true},{badFramebuffer:true}]) {
    const p=loadPage(options);
    assert.equal(p.canvas.dataset.status,'unavailable');
    assert.equal(p.id('render-label').textContent,'RENDER OFFLINE');
    assert.match(p.id('error-title').textContent,/could not be drawn/);
    assert.equal(p.errors.length,1);
    assert.equal(p.frames.size,0);
  }
});

test('context restoration rebuilds resources and resumes the selected route, speed and seed', () => {
  const p=loadPage({address:'#seed=137'}); p.ready();
  p.key('3'); p.key('s'); p.tick();
  const lost=p.canvas.emit('webglcontextlost');
  assert.equal(lost.defaultPrevented,true);
  assert.equal(p.frames.size,0);
  assert.match(p.id('error-title').textContent,/interrupted/);
  assert.ok(p.id('play').disabled);
  for (const item of [...p.gl.buffers,...p.gl.textures,...p.gl.framebuffers]) item.deleted=true;
  p.location.hash='#seed=88'; p.win.emit('hashchange');
  p.canvas.emit('webglcontextrestored'); p.tick();
  p.ready();
  assert.equal(p.id('error-panel').hidden,true);
  assert.equal(p.routes[2].getAttribute('aria-pressed'),'true');
  assert.equal(p.speeds[2].getAttribute('aria-pressed'),'true');
  assert.match(p.id('regenerate').title,/seed 88$/);
  assert.equal(p.id('play').disabled,false);
  assert.equal(p.frames.size,1);
});

test('the chart jumps between formations, tide turns and tram arrivals while a paused camera holds its route position', () => {
  const p = loadPage({reduced:true, address:'#seed=852'}); p.ready(); p.tick();
  const menu = p.id('lookout'), button = p.id('next-event'), call = p.id('lookout-call');
  const choose = id => { menu.value = id; menu.emit('change'); p.tick(); };
  p.key('3');
  p.id('timeline').value = 600; p.id('timeline').emit('input'); p.tick();
  const eye = environment(p).uEye;
  assert.ok(button.hidden);
  p.key('n'); assert.equal(p.frames.size, 0);
  choose('lanterns');
  assert.ok(!button.hidden && !call.hidden);
  assert.equal(p.id('event-label').textContent, 'Next formation');
  for (const [time, name] of [[16,'Three Currents'], [32,'Night Bloom'], [48,'Twin Sails']]) {
    button.emit('click'); p.tick(2000);
    assert.equal(environment(p).uTime[0], time);
    assert.equal(call.textContent, name);
    assert.equal(p.frames.size, 0);
  }
  choose('landing');
  assert.equal(p.id('event-label').textContent, 'See low tide');
  p.key('n', {target:menu}); p.key('n', {repeat:true}); assert.equal(p.frames.size, 0);
  p.key('N'); p.tick();
  assert.equal(environment(p).uTime[0], 135);
  assert.equal(call.textContent, 'Low tide · −0.86 m');
  assert.equal(p.id('event-label').textContent, 'See high tide');
  p.key('n'); p.tick();
  assert.equal(call.textContent, 'High tide · +0.86 m');
  choose('tram');
  p.key('n'); p.tick();
  assert.equal(environment(p).uTime[0], 244);
  assert.equal(call.textContent, 'At Study Pier');
  assert.deepEqual(environment(p).uEye, eye);
  assert.equal(p.id('timeline').value, 600);
  assert.equal(p.id('elapsed').textContent, '01:30');
  choose('wheel');
  assert.ok(button.hidden && call.hidden);
});

test('a restored or regenerated sky retains a mid-blend palette, weather, tide level and the selected lantern formation', () => {
  const p = loadPage({address:'#seed=0'}); p.ready(); p.tick();
  p.id('lookout').value = 'lanterns'; p.id('lookout').emit('change');
  p.key('n'); p.key('t'); p.key('w'); p.tick(0); p.tick(100);
  const before = environment(p);
  assert.ok(before.uTwilight[0] > 0 && before.uTwilight[0] < 1);
  assert.ok(before.uWeather[0] > 0 && before.uWeather[0] < 1);
  p.key(' '); p.tick(0);
  p.key('g'); p.win.emit('hashchange'); p.tick(5000);
  p.canvas.emit('webglcontextlost');
  assert.ok(p.id('lighting').disabled && p.id('next-event').disabled);
  p.canvas.emit('webglcontextrestored'); p.tick(); p.ready();
  const after = environment(p);
  for (const k of ['uWeather','uTwilight','uTide','uTime','uEye','uForward']) assert.deepEqual(after[k], before[k]);
  assert.equal(p.id('lookout-call').textContent, 'Three Currents');
  assert.ok(!p.id('lighting').disabled && !p.id('next-event').disabled);
  assert.match(p.id('regenerate').title, /seed 1$/);
});
