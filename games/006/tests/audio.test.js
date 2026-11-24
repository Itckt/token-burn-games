'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {makePage} = require('./support/page.js');

class Parameter {
  constructor(value=0) { this.value=value; this.events=[]; }
  setTargetAtTime(value,t,constant) { this.value=value; this.events.push(['target',value,t,constant]); }
  setValueAtTime(value,t) { this.value=value; this.events.push(['set',value,t]); }
  linearRampToValueAtTime(value,t) { this.value=value; this.events.push(['linear',value,t]); }
  exponentialRampToValueAtTime(value,t) { this.value=value; this.events.push(['exponential',value,t]); }
}
class AudioNode {
  constructor() { this.gain=new Parameter(1); this.frequency=new Parameter(); }
  connect(next) { this.connected=next; }
  disconnect() { this.connected=null; }
  start(t=0) { this.started=t; }
  stop(t) { this.stopped=t; }
}
function audioFixture(resume=async()=>{}) {
  const contexts=[];
  class Context {
    constructor() {
      this.destination={}; this.currentTime=0; this.sampleRate=8000; this.gains=[]; this.tones=[]; this.filters=[];
      contexts.push(this);
    }
    createGain() { const g=new AudioNode(); this.gains.push(g); return g; }
    createOscillator() { const o=new AudioNode(); this.tones.push(o); return o; }
    createBuffer(channels,length,rate) {
      assert.equal(channels,1); assert.equal(rate,this.sampleRate); assert.ok(length>0);
      this.noise=new Float32Array(length); return {getChannelData:()=>this.noise};
    }
    createBufferSource() { this.rail=new AudioNode(); return this.rail; }
    createBiquadFilter() { this.filter=new AudioNode(); this.filters.push(this.filter); return this.filter; }
    resume() { return resume(); }
  }
  return {p:makePage({AudioContext:Context}),contexts};
}
test('sound starts on a user gesture, follows train speed and reuses its audio graph', async () => {
  const {p,contexts}=audioFixture(); p.run(); assert.equal(contexts.length,0);
  const button=p.id('sound'); await button.fire('click').done;
  assert.equal(button.getAttribute('aria-pressed'),'true'); assert.equal(p.id('sound-label').textContent,'Sound on');
  const ctx=contexts[0], master=ctx.gains[0], idleHz=ctx.tones[0].frequency.value;
  assert.equal(master.connected,ctx.destination); assert.ok(master.gain.value>0);
  assert.equal(ctx.rail.loop,true); assert.equal(ctx.rail.started,0);
  assert.ok(ctx.noise.some(n=>n>0.5) && ctx.noise.some(n=>n< -0.5));
  p.key('KeyW'); p.run(120);
  assert.ok(ctx.tones[0].frequency.value>idleHz); assert.ok(ctx.filter.frequency.value>150);
  p.key('KeyP'); assert.equal(master.gain.value,0);
  p.key('KeyP'); assert.ok(master.gain.value>0);
  p.doc.hidden=true; p.doc.fire('visibilitychange'); assert.equal(master.gain.value,0);
  p.doc.hidden=false; p.doc.fire('visibilitychange'); assert.ok(master.gain.value>0);
  p.key('KeyH'); assert.equal(master.gain.value,0); p.key('Escape'); assert.ok(master.gain.value>0);
  await button.fire('click').done; assert.equal(master.gain.value,0);
  await button.fire('click').done; assert.equal(contexts.length,1); assert.equal(ctx.tones.length,2);
});
test('doors sound one finite two-note cue per opening or closing transition', async () => {
  const {p,contexts}=audioFixture(); p.run(); await p.id('sound').fire('click').done;
  const ctx=contexts[0];
  p.button('doors').fire('click'); p.run(100);
  assert.equal(ctx.tones.length,4);
  assert.ok(ctx.tones[2].frequency.value<ctx.tones[3].frequency.value);
  p.button('doors').fire('click'); p.run(100);
  assert.equal(ctx.tones.length,6);
  assert.ok(ctx.tones[4].frequency.value>ctx.tones[5].frequency.value);
  for(const tone of ctx.tones.slice(2)) {
    assert.ok(tone.stopped>tone.started);
    const envelope=tone.connected;
    assert.ok(envelope.gain.events.some(ev=>ev[0]==='exponential'));
    tone.onended(); assert.equal(tone.connected,null); assert.equal(envelope.connected,null);
  }
});
test('a pending audio resume cannot undo a subsequent mute', async () => {
  let resolve;
  const {p,contexts}=audioFixture(()=>new Promise(r=>{resolve=r;}));
  const button=p.id('sound'), pending=button.fire('click').done;
  await button.fire('click').done; resolve(); await pending;
  assert.equal(button.getAttribute('aria-pressed'),'false');
  assert.equal(contexts[0].gains[0].gain.value,0);
});
test('unavailable or denied audio leaves the ride driveable', async () => {
  const missing=makePage(); assert.equal(missing.id('sound').disabled,true);
  const {p}=audioFixture(async()=>{throw new Error('audio device unavailable');});
  await p.id('sound').fire('click').done;
  assert.equal(p.id('sound').getAttribute('aria-pressed'),'false'); assert.match(p.id('notice').textContent,/Audio is unavailable/);
  p.key('KeyW'); p.run(100); assert.ok(p.samples.at(-1).ride.position>0);
});
test('a stale audio failure cannot override a later successful enable', async () => {
  const requests=[];
  const {p,contexts}=audioFixture(()=>new Promise((resolve,reject)=>requests.push({resolve,reject})));
  const button=p.id('sound'), first=button.fire('click').done;
  await button.fire('click').done;
  const latest=button.fire('click').done;
  requests[1].resolve(); await latest;
  requests[0].reject(new Error('earlier resume')); await first;
  assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.ok(contexts[0].gains[0].gain.value>0);
});

test('rail noise recedes in open air and returns in the next tunnel while the motor holds its pitch', async () => {
  const { p, contexts } = audioFixture(); p.run();
  await p.id('sound').fire('click').done;
  const ctx = contexts[0], railGain = ctx.filter.connected.gain;
  for (let i = 0; i < 3; i++) p.key('ArrowUp');
  function reach(position) {
    for (let i = 0; i < 600 && p.samples.at(-1).ride.position < position; i++) p.run(1, 100);
    assert.ok(p.samples.at(-1).ride.position >= position);
    p.run(2, 100);
    return [railGain.value, ctx.filter.frequency.value, ctx.tones[0].frequency.value];
  }
  const tunnel = reach(54), portal = reach(78), open = reach(110);
  assert.ok(tunnel[0] > portal[0] && portal[0] > open[0]);
  assert.ok(tunnel[1] > portal[1] && portal[1] > open[1]);
  assert.equal(tunnel[2], open[2]);
  assert.deepEqual(reach(340), tunnel);
  assert.equal(ctx.tones.length, 2);
});

test('rain and coasting change their own audio gains, leave wheel sound running and reuse the existing noise source', async () => {
  const { p, contexts } = audioFixture(); p.run();
  await p.id('sound').fire('click').done;
  const ctx = contexts[0], motor = ctx.tones[0].connected.gain, wheels = ctx.tones[1].connected.gain;
  const rain = ctx.filters.find(filter => filter.type === 'highpass').connected.gain;
  const dryMotor = motor.value, rolling = wheels.value, nodes = ctx.gains.length;
  p.key('KeyT'); p.run(25, 100); assert.equal(rain.value, 0);
  for (let i = 0; i < 6; i++) p.key('KeyW');
  p.run(150, 100); assert.ok(rain.value > 0);
  p.key('KeyC'); assert.ok(motor.value < dryMotor); assert.equal(wheels.value, rolling);
  p.key('KeyT'); assert.equal(rain.value, 0);
  p.key('KeyC'); assert.equal(motor.value, dryMotor);
  assert.equal(ctx.gains.length, nodes); assert.equal(ctx.tones.length, 2);
});

test('the shuttle rush rises and falls beside a stationary cab on its own filtered noise channel', async () => {
  const { p, contexts } = audioFixture(); p.run(); await p.id('sound').fire('click').done;
  const ctx = contexts[0], channel = ctx.filters.find(filter => filter.type === 'bandpass').connected.gain;
  const count = ctx.gains.length;
  assert.equal(channel.value,0);
  for (let i=0; i<8; i++) p.key('KeyW');
  while (p.samples.at(-1).ride.position < 85) p.run(1,100);
  p.key('Space');
  while (p.id('drive-state').textContent !== 'Stopped') p.run(1,100);
  let loudest = 0;
  for (let i=0; i<200; i++) {
    p.run(1,100);
    loudest = Math.max(loudest,channel.value);
  }
  assert.ok(loudest > 0.30); assert.equal(channel.value,0);
  assert.equal(ctx.gains.length,count); assert.equal(ctx.tones.length,2);
});

test('the guard bell gives two equal-pitch strokes once per clearance and never replays a muted dispatch', async () => {
  const {p,contexts} = audioFixture(); p.run();
  await p.id('sound').fire('click').done;
  const ctx = contexts[0];
  p.key('KeyJ'); p.key('KeyB'); assert.equal(ctx.tones.length, 2);
  function serveAndClose() {
    p.key('KeyD'); p.run(90,100); p.key('KeyD'); p.run(20,100);
    assert.equal(p.id('departure-bell').disabled, false);
  }
  serveAndClose(); const before = ctx.tones.length;
  p.key('KeyB'); p.key('KeyB'); p.run(5);
  const bells = ctx.tones.slice(before);
  assert.equal(bells.length, 2);
  assert.equal(bells[0].frequency.value, bells[1].frequency.value);
  assert.equal(bells[1].started - bells[0].started, 0.26);
  serveAndClose(); await p.id('sound').fire('click').done;
  const muted = ctx.tones.length; p.key('KeyB'); await p.id('sound').fire('click').done;
  assert.equal(ctx.tones.length, muted);
});

test('the approach motif sounds once per leg and enabling sound midway through a muted announcement is quiet', async () => {
  const { p, contexts } = audioFixture(); p.run();
  p.key('KeyI'); await p.id('sound').fire('click').done;
  for (let i = 0; i < 8; i++) p.key('KeyW');
  const ctx = contexts[0], motif = () => ctx.tones.filter(o => [554,740,659].includes(o.frequency.value));
  function reach(stage, station) {
    const wanted = stage + ' · ' + station;
    for (let i = 0; i < 800 && p.id('saloon-english').textContent !== wanted; i++) p.run(1, 100);
    assert.equal(p.id('saloon-english').textContent, wanted);
  }
  reach('Arriving', 'Campus Gate');
  assert.deepEqual(motif().map(o => o.frequency.value), [554,740,659]);
  assert.deepEqual(motif().map(o => o.started), [0,0.14,0.31]);
  p.key('KeyP'); p.run(2, 60000); p.key('KeyP'); p.run(5, 100);
  assert.equal(motif().length, 3);
  reach('Next stop', 'Junction Road');
  await p.id('sound').fire('click').done; reach('Arriving', 'Junction Road');
  await p.id('sound').fire('click').done; p.run(6, 100);
  assert.equal(motif().length, 3);
  reach('Arriving', 'Lok Fu'); assert.equal(motif().length, 6);
});
