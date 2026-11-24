'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {makePage,html,scripts,read,root} = require('./support/page.js');
const {RecordingGL} = require('./support/recording-gl.js');

test('the file entry point references every script once and has no external dependencies', () => {
  const files=fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>'js/'+f).sort();
  assert.deepEqual([...scripts].sort(),files);
  assert.equal(scripts.at(-1),'js/app.js');
  assert.equal([...html.matchAll(/<script\b[^>]*\bdefer\b[^>]*>/g)].length,scripts.length);
  assert.doesNotMatch(html,/\btype=["']module["']|(?:https?:)?\/\//i);
  const stylesheet=html.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
  assert.doesNotMatch(read(stylesheet),/@import|url\s*\(/i);
  for(const script of scripts) {
    assert.doesNotMatch(read(script),/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(|\bimport\s*[(\w{*]/);
  }
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.match(html,/<noscript>/);
});
test('startup builds the complete bilingual route, icons, instruments and idle cab', () => {
  const p=makePage(); p.run();
  assert.equal(p.id('scene-error').hidden,true); assert.equal(p.frames.size,0);
  assert.equal(p.samples.length,1); assert.equal(p.samples[0].ride.berth,0);
  assert.equal(p.id('speed-value').textContent,'00'); assert.equal(p.id('drive-state').textContent,'Ready');
  assert.equal(p.id('segments').children.length,8);
  const rows=p.id('stations').children; assert.equal(rows.length,5);
  assert.equal(rows[0].getAttribute('aria-current'),'step'); assert.equal(rows[0].children[2].textContent,'Here');
  rows.forEach((row,i)=>{
    assert.equal(row.children[1].children[0].textContent,p.api.ride.STATIONS[i].name);
    assert.equal(row.children[1].children[1].textContent,p.api.ride.STATIONS[i].chinese);
    assert.equal(row.children[1].children[1].lang,'zh-HK');
  });
  const icons=p.doc.querySelectorAll('[data-icon]');
  assert.equal(p.icons.length,icons.length);
  assert.ok(p.icons.every(i=>i.path.startsWith('M') && !i.path.includes('undefined')));
  assert.ok(p.id('guide').textContent.includes('Switch between the cab and platform views'));
});
test('keys and dashboard buttons drive the same train and maintain live route progress', () => {
  const p=makePage(); p.run();
  assert.ok(p.key('ArrowUp').defaultPrevented); p.key('ArrowUp','keyup');
  p.button('faster').fire('click',{detail:1});
  assert.equal(p.doc.activeElement,p.scene);
  p.key('KeyW'); p.key('KeyW','keyup');
  assert.equal(p.id('target-value').textContent,'30'); assert.equal(p.id('segments').children.filter(el=>el.classList.contains('on')).length,3);
  p.run(660); assert.equal(p.id('speed-value').textContent,'30'); assert.equal(p.id('drive-state').textContent,'Cruising');
  const progress=Number(p.id('leg-progress').getAttribute('aria-valuenow'));
  assert.ok(progress>0 && progress<100); assert.equal(p.id('leg-fill').style.width,progress+'%');
  assert.equal(p.id('stations').children[1].getAttribute('aria-current'),'step');
  assert.equal(p.id('stations').children[1].children[2].textContent,'Next');
  assert.ok(parseInt(p.id('distance').textContent)<432);
  p.key('KeyS'); p.key('ArrowDown'); p.key('KeyS','keyup'); p.key('ArrowDown','keyup');
  assert.equal(p.id('target-value').textContent,'10');
  p.key('Space'); p.run(300); assert.equal(p.id('target-value').textContent,'0');
  assert.equal(p.id('drive-state').textContent,'Stopped'); assert.equal(p.id('speed-value').textContent,'00');
  p.key('KeyD'); assert.match(p.id('notice').textContent,/berthed/); assert.equal(p.id('notice').hidden,false);
  p.run(1,3000); assert.equal(p.id('notice').hidden,true);
});
test('the route monitor switches to the following leg at arrival and shows actual door states', () => {
  const p=makePage(); p.run();
  for(let i=0;i<8;i++) p.key('ArrowUp');
  for(let i=0;i<500 && p.id('door-state').textContent!=='Opening';i++) p.run(1,100);
  assert.equal(p.id('drive-state').textContent,'Boarding'); assert.equal(p.id('door-state').textContent,'Opening');
  assert.equal(p.id('speed-value').textContent,'00'); assert.equal(p.id('next-name').textContent,'Junction Road');
  assert.equal(p.id('distance').textContent,'432 m'); assert.equal(p.id('leg-fill').style.width,'0%');
  assert.equal(p.id('stations').children[1].children[2].textContent,'Here');
  p.run(16,100); assert.equal(p.id('door-state').textContent,'Open');
  p.button('doors').fire('click'); assert.equal(p.id('door-state').textContent,'Closing');
  p.run(25,100); assert.equal(p.id('door-state').textContent,'Closed'); assert.equal(p.id('drive-state').textContent,'Powering');
});
test('pause, resume, help, focus, shortcut modifiers and repeated toggles behave predictably', () => {
  const p=makePage(); p.run(); p.key('KeyW'); p.run(90);
  p.key('KeyP'); p.key('KeyP','keydown',{repeat:true}); p.run();
  assert.equal(p.id('pause-screen').hidden,false); assert.equal(p.id('pause-label').textContent,'Resume');
  assert.equal(p.id('service-text').textContent,'Paused'); const samples=p.samples.length;
  p.run(10,100); assert.equal(p.samples.length,samples);
  p.key('ArrowUp'); assert.equal(p.id('target-value').textContent,'10'); assert.match(p.id('notice').textContent,/Resume/);
  p.id('guide-open').fire('click'); assert.equal(p.id('guide').open,true);
  assert.equal(p.key('KeyP').defaultPrevented,false); p.key('Escape');
  assert.equal(p.id('guide').open,false); assert.equal(p.id('pause-screen').hidden,false);
  p.id('pause-screen').querySelector('button').fire('click'); assert.equal(p.id('pause-screen').hidden,true);
  p.key('Slash'); assert.equal(p.id('guide').open,true);
  p.key('KeyH'); assert.equal(p.id('guide').open,false);
  assert.equal(p.key('KeyW','keydown',{ctrlKey:true}).defaultPrevented,false);
  assert.equal(p.key('KeyW','keydown',{metaKey:true}).defaultPrevented,false);
  p.button('doors').focus(); assert.equal(p.key('Space').defaultPrevented,false);
  assert.equal(p.id('target-value').textContent,'10');
});
test('platform and front views, captured pointer drags, cancel and held look keys work', () => {
  const p=makePage(); p.run();
  p.id('view-platform').fire('click',{detail:1}); p.run(100);
  const cam=()=>p.samples.at(-1).camera;
  assert.equal(p.id('view-platform').getAttribute('aria-pressed'),'true'); assert.ok(cam().yaw>2.2);
  p.key('KeyV'); p.run(100); assert.equal(cam().yaw,0); assert.equal(p.id('view-front').getAttribute('aria-pressed'),'true');
  p.scene.fire('pointerdown',{button:0,pointerId:3,clientX:100,clientY:120});
  assert.ok(p.scene.hasPointerCapture(3));
  p.scene.fire('pointermove',{pointerId:9,clientX:200,clientY:60}); p.run(20); assert.equal(cam().yaw,0);
  p.scene.fire('pointermove',{pointerId:3,clientX:200,clientY:60}); p.run(30);
  assert.ok(cam().yaw>0 && cam().pitch>0); assert.equal(cam().preset,'free');
  p.scene.fire('pointercancel',{pointerId:3}); assert.equal(p.scene.hasPointerCapture(3),false);
  p.key('KeyR'); p.run(100); assert.equal(cam().yaw,0); assert.equal(cam().pitch,0);
  p.key('ArrowLeft'); p.run(40); p.key('ArrowLeft','keyup'); p.run(90);
  assert.ok(cam().yaw < -0.8); const left=cam().yaw;
  p.key('ArrowRight'); p.run(20); p.win.fire('blur'); p.run(90); assert.ok(cam().yaw>left);
  assert.equal(p.frames.size,0);
});
test('time spent hidden or reading the guide does not advance the train on return', () => {
  const p=makePage(); p.run(); p.key('KeyW'); p.run(100);
  const last=()=>p.samples.at(-1).ride.position;
  const before=last(); p.doc.hidden=true; p.doc.fire('visibilitychange');
  assert.equal(p.frames.size,0); p.run(1,600000);
  p.doc.hidden=false; p.doc.fire('visibilitychange'); p.run();
  assert.equal(last(),before); p.run(2); assert.ok(last()>before);
  p.key('KeyH'); const atGuide=last(); p.run(1,60000);
  p.id('guide-close').fire('click'); p.run(); assert.equal(last(),atGuide);
  p.run(5); assert.ok(last()>atGuide);
});
test('missing WebGL and shader initialization errors produce a readable, usable fallback', () => {
  for(const gl of [null,new RecordingGL({badShader:1}),new RecordingGL({badLink:true})]) {
    const p=makePage({gl,capture:false}); p.run();
    assert.equal(p.id('scene-error').hidden,false); assert.match(p.id('error-detail').textContent,/Enable WebGL/);
    assert.equal(p.id('feed-text').textContent,'Offline'); assert.equal(p.id('drive-state').textContent,'Offline');
    assert.ok(p.button('faster').disabled && p.id('view-platform').disabled);
    assert.equal(p.frames.size,0); assert.equal(p.key('ArrowUp').defaultPrevented,false);
    p.key('KeyH'); assert.ok(p.id('guide').open);
  }
});
test('a graphics interruption preserves train position and target for restoration', () => {
  const p=makePage(); p.run(); p.key('KeyW'); p.run(200);
  const before=p.samples.at(-1).ride;
  assert.ok(p.scene.fire('webglcontextlost').defaultPrevented);
  assert.equal(p.frames.size,0); assert.match(p.id('error-detail').textContent,/interrupted/);
  assert.equal(p.id('scene-error').hidden,false); p.run(1,10000);
  p.scene.fire('webglcontextrestored'); p.run();
  assert.equal(p.id('scene-error').hidden,true); assert.equal(p.button('faster').disabled,false);
  assert.equal(p.samples.at(-1).ride.position,before.position); assert.equal(p.id('target-value').textContent,'10');
  p.run(5); assert.ok(p.samples.at(-1).ride.position>before.position);
});
test('fullscreen reflects actual state and handles unavailable APIs and denied requests', async () => {
  const p=makePage(), full=p.id('fullscreen');
  await full.fire('click').done; assert.equal(full.getAttribute('aria-label'),'Exit fullscreen');
  assert.equal(full.querySelector('canvas').dataset.icon,'collapse');
  await full.fire('click').done; assert.equal(full.getAttribute('aria-label'),'Enter fullscreen');
  const unavailable=makePage({fullscreen:false}); assert.equal(unavailable.id('fullscreen').disabled,true);
  const denied=makePage({fullscreenError:true}); await denied.id('fullscreen').fire('click').done;
  assert.match(denied.id('notice').textContent,/Fullscreen is unavailable/);
});

test('a driver can select manual stops, cross College Viaduct, brake on the HUD cue and read the result', () => {
  const p = makePage(); p.run();
  const mode = p.button('mode');
  assert.equal(mode.getAttribute('aria-pressed'), 'false');
  assert.equal(p.id('brake-cue').hidden, true);
  assert.equal(p.id('sheet-results').hidden, true);
  assert.equal(p.id('elapsed-time').textContent, '0:00');
  assert.equal(p.id('booked-time').textContent, '0:42');
  p.key('KeyM'); p.key('KeyM', 'keydown', { repeat: true }); p.key('KeyM', 'keyup');
  assert.equal(mode.getAttribute('aria-pressed'), 'true');
  assert.match(p.id('brake-cue').textContent, /within 1 m/);
  assert.equal(p.id('brake-cue').hidden, false);
  mode.fire('click', { detail: 1 }); assert.equal(mode.getAttribute('aria-pressed'), 'false');
  mode.fire('click', { detail: 1 }); assert.equal(p.doc.activeElement, p.scene);
  for (let i = 0; i < 6; i++) p.key('ArrowUp');
  p.run(10); mode.fire('click');
  const departedAt = p.samples.at(-1).ride.sheet.departedAt;
  assert.match(p.id('notice').textContent, /while berthed/);
  let sawBridge = false, sawGauge = false;
  for (let i = 0; i < 4000 && p.id('brake-cue').textContent !== 'Brake now'; i++) {
    p.run();
    sawBridge ||= p.id('track-place').textContent === 'College Viaduct';
    sawGauge ||= !p.id('brake-gauge').hidden;
  }
  assert.ok(sawBridge && sawGauge);
  assert.ok(p.id('brake-cue').classList.contains('urgent'));
  assert.ok(Math.abs(parseFloat(p.id('brake-pointer').style.left) - 50) <= 4.2);
  p.key('Space'); p.key('Space', 'keyup');
  assert.match(p.id('brake-cue').textContent, /Braking/);
  for (let i = 0; i < 900 && p.id('sheet-rows').children.length === 0; i++) p.run();
  assert.equal(p.id('drive-state').textContent, 'Boarding');
  assert.equal(p.id('door-state').textContent, 'Opening');
  assert.equal(p.id('target-value').textContent, '0');
  assert.equal(p.id('brake-gauge').hidden, true);
  assert.equal(p.id('sheet-results').hidden, false);
  assert.equal(p.id('sheet-empty').hidden, true);
  const [row] = p.id('sheet-rows').children;
  const [station, time, booked, timing, mark] = row.children.map(el => el.textContent);
  assert.equal(station, 'Campus Gate'); assert.equal(booked, '0:42');
  const elapsed = Math.round(p.samples.at(-1).ride.time - departedAt);
  assert.ok(elapsed >= 36 && elapsed <= 41);
  assert.equal(time, '0:' + elapsed); assert.equal(timing, 'On time'); assert.match(mark, /^On mark/);
  assert.equal(p.id('sheet-summary').textContent, '1 stop · Campus Gate · On time');
  assert.equal(p.id('elapsed-time').textContent, '0:00');
  p.run(100, 100);
  assert.equal(p.id('sheet-rows').children[0], row, 'unchanged rows keep their identity for readers');
  assert.equal(p.frames.size, 0);
});

test('a stationary train times its leg without repainting, and every suspension preserves the clock and mode', () => {
  const p = makePage(); p.run(); p.key('KeyM'); p.key('KeyW'); p.run(70, 100);
  p.key('Space'); p.run(30, 100);
  assert.equal(p.id('drive-state').textContent, 'Stopped');
  const draws = p.samples.length, before = p.id('elapsed-time').textContent;
  p.run(30, 100);
  assert.equal(p.samples.length, draws);
  assert.notEqual(p.id('elapsed-time').textContent, before);
  p.key('KeyP');
  const frozen = p.id('elapsed-time').textContent;
  p.run(2, 60000); p.key('KeyP'); p.run();
  assert.equal(p.id('elapsed-time').textContent, frozen);
  p.key('KeyH'); p.run(1, 60000); p.key('Escape'); p.run();
  assert.equal(p.id('elapsed-time').textContent, frozen);
  p.doc.hidden = true; p.doc.fire('visibilitychange'); p.run(1, 60000);
  p.doc.hidden = false; p.doc.fire('visibilitychange'); p.run();
  assert.equal(p.id('elapsed-time').textContent, frozen);
  p.scene.fire('webglcontextlost'); p.run(1, 60000);
  assert.equal(p.button('mode').disabled, true);
  assert.equal(p.id('track-caption').hidden, true);
  p.scene.fire('webglcontextrestored'); p.run();
  assert.equal(p.button('mode').disabled, false);
  assert.equal(p.button('mode').getAttribute('aria-pressed'), 'true');
  assert.equal(p.id('elapsed-time').textContent, frozen);
  p.run(20, 100); assert.notEqual(p.id('elapsed-time').textContent, frozen);
});

test('Space on the run sheet keeps native activation, and ending a drag leaves independently held keys down', () => {
  const p = makePage(); p.run();
  p.doc.querySelector('summary').focus();
  p.key('KeyW');
  assert.equal(p.key('Space').defaultPrevented, false);
  assert.equal(p.id('target-value').textContent, '10');
  p.key('ArrowRight'); p.run(5);
  p.scene.fire('pointerdown', { button: 0, pointerId: 4, clientX: 20, clientY: 50 });
  p.scene.fire('pointerup', { pointerId: 4 });
  assert.equal(p.scene.hasPointerCapture(4), false);
  assert.ok(p.button('faster').classList.contains('pressed'));
  const yaw = p.samples.at(-1).camera.goalYaw;
  p.run(10); assert.ok(p.samples.at(-1).camera.goalYaw > yaw + 0.2);
  p.key('ArrowRight', 'keyup'); p.key('KeyW', 'keyup');
  assert.equal(p.button('faster').classList.contains('pressed'), false);
});

test('passengers cross under the platform camera during a stationary dwell and keep their place through a graphics interruption', () => {
  const p = makePage(); p.run();
  p.key('KeyV'); p.run(100);
  assert.equal(p.id('load-value').textContent, '6 / 18');
  assert.match(p.id('exchange-state').textContent, /6 waiting/);
  p.button('doors').fire('click'); p.run(18, 100);
  const car = () => p.samples.at(-1).ride.car;
  const crossing = car().call.crossing.elapsed, frames = p.samples.length;
  assert.ok(crossing > 0);
  p.scene.fire('webglcontextlost'); p.run(1, 120000);
  p.scene.fire('webglcontextrestored'); p.run();
  assert.equal(car().call.crossing.elapsed, crossing);
  p.run(2, 100);
  assert.ok(p.samples.length > frames + 1);
  assert.ok(p.samples.slice(-2).every(sample => sample.ride.position === 0 && sample.ride.door === 1));
  p.run(15, 100);
  assert.ok(parseInt(p.id('load-value').textContent) > 6);
  p.run(80, 100);
  assert.equal(p.id('load-value').textContent, '12 / 18');
  assert.equal(p.id('exchange-state').textContent, 'Boarding complete');
  assert.equal(p.frames.size, 0);
  p.key('KeyW'); p.run(3, 100);
  assert.equal(p.id('exchange-state').textContent, '4 to alight at Campus Gate');
});

test('coast controls, the signed power instrument, carriage load and run sheet agree on a complete leg', () => {
  const p = makePage(); p.run();
  p.button('coast').fire('click');
  assert.match(p.id('notice').textContent, /depart/);
  for (let i = 0; i < 8; i++) p.key('KeyW');
  p.run(140, 100);
  assert.ok(parseInt(p.id('power-value').textContent) > 0);
  const drawn = p.id('energy-drawn').textContent;
  p.key('KeyC'); p.key('KeyC', 'keydown', { repeat: true }); p.run(5, 100);
  assert.equal(p.id('coast').getAttribute('aria-pressed'), 'true');
  assert.equal(p.id('drive-state').textContent, 'Coasting');
  assert.equal(p.id('power-value').textContent, '0 kW');
  assert.equal(p.id('energy-drawn').textContent, drawn);
  assert.equal(p.id('target-value').textContent, '80');
  let sawRegen = false;
  for (let i = 0; i < 450 && !p.id('sheet-rows').children.length; i++) {
    p.run(1, 100);
    sawRegen ||= parseInt(p.id('power-value').textContent) < 0 &&
      p.id('power-bar').classList.contains('returning') && parseFloat(p.id('power-bar').style.width) > 0;
  }
  const cells = p.id('sheet-rows').children[0].children;
  assert.ok(sawRegen);
  assert.equal(cells[5].textContent, p.id('energy-drawn').textContent);
  assert.equal(cells[6].textContent, p.id('energy-returned').textContent);
  assert.ok(parseFloat(cells[6].textContent) > 0);
  assert.equal(p.id('coast').getAttribute('aria-pressed'), 'false');
  assert.equal(p.id('campus-group').hidden, false);
  p.run(60, 100); assert.equal(p.id('campus-group').hidden, true);
});

test('weather and wiper controls wake a parked cab, freeze in the guide and pause, then let the cab idle again', () => {
  const p = makePage(); p.run();
  const w = () => p.samples.at(-1).ride.weather;
  const rain = p.id('rain-toggle');
  rain.fire('click', { detail: 1 }); p.run(25, 100);
  assert.equal(rain.getAttribute('aria-pressed'), 'true');
  assert.equal(w().cloud, 1); assert.equal(w().water, 0);
  assert.equal(p.frames.size, 0, 'sheltered cab sleeps once the sky settles');
  p.key('KeyX'); p.run(4, 100);
  const phase = w().sweep; assert.ok(phase > 0);
  p.key('KeyH'); p.run(1, 60000); p.key('Escape'); p.run();
  assert.equal(w().sweep, phase);
  p.key('KeyP'); p.run(); const draws = p.samples.length;
  p.run(1, 60000); p.key('KeyT'); assert.equal(rain.getAttribute('aria-pressed'), 'true');
  assert.equal(p.samples.length, draws);
  p.key('KeyP'); p.run(); assert.equal(w().sweep, phase);
  p.run(20, 100); assert.equal(w().sweep, null); assert.equal(p.frames.size, 0);
  p.key('KeyT'); p.key('KeyT', 'keydown', { repeat: true }); p.run(20, 100);
  assert.equal(rain.getAttribute('aria-pressed'), 'false'); assert.equal(w().cloud, 0);
  p.button('wipe').fire('click'); p.run(6, 100); assert.ok(w().sweep > 0);
  const offline = makePage({ gl: null, capture: false });
  assert.ok(['coast', 'wipe'].every(action => offline.button(action).disabled));
  assert.ok(offline.id('rain-toggle').disabled && offline.id('scene-error').hidden === false);
});

test('releasing one speed key keeps its held alias highlighted and releasing an opposing look key resumes panning', () => {
  const p = makePage(); p.run();
  p.key('KeyW'); p.key('ArrowUp'); p.key('KeyW', 'keyup');
  assert.ok(p.button('faster').classList.contains('pressed'));
  p.key('ArrowUp', 'keyup'); assert.equal(p.button('faster').classList.contains('pressed'), false);
  p.key('Space'); p.run();
  p.key('ArrowLeft'); p.key('ArrowRight'); p.run(120);
  assert.equal(p.frames.size, 0);
  p.key('ArrowLeft', 'keyup'); p.run(10);
  assert.ok(p.samples.at(-1).camera.goalYaw > 0);
  p.win.fire('blur'); p.run(120); assert.equal(p.frames.size, 0);
});
