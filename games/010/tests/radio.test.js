'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const radio=require('../js/radio');
const {openPage,key,surface}=require('./support/page');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// The device owns the loop. Keep every scheduled source so overlapping playback
// and a late permission response are observable without opening an audio device.
function audioDevice({deferred=false,rejectFirst=false}={}) {
  const devices=[], pending=[];
  class AudioContext {
    constructor() {
      this.state='suspended'; this.currentTime=0; this.destination={};
      this.sources=[]; this.buffers=[]; this.params=[]; this.resumes=0; devices.push(this);
    }
    createGain() {
      const gain={value:1,setTargetAtTime:(value,time,ramp)=>{
        assert.ok(value>=0 && value<=1 && time>=0 && ramp>0); gain.value=value;
      }};
      this.params.push(gain);
      return {gain,connect:target=>assert.equal(target,this.destination)};
    }
    createBuffer(channels,length,rate) {
      assert.equal(channels,1); assert.equal(rate,22050);
      const samples=new Float32Array(length);
      const buffer={getChannelData:i=>{ assert.equal(i,0); return samples; }};
      this.buffers.push(buffer); return buffer;
    }
    createBufferSource() {
      const source={started:false,stopped:false,connected:false,
        connect(){ this.connected=true; },
        start(){ assert.ok(this.buffer && this.loop && this.connected); this.started=true; },
        stop(){ assert.ok(this.started && !this.stopped); this.stopped=true; },
        disconnect(){ this.connected=false; }};
      this.sources.push(source); return source;
    }
    resume() {
      this.resumes++;
      if (rejectFirst && this.resumes===1) return Promise.reject(new Error('Audio permission denied'));
      if (deferred) return new Promise((resolve,reject)=>pending.push({resolve:()=>{this.state='running';resolve();},reject}));
      this.state='running'; return Promise.resolve();
    }
    suspend() { this.state='suspended'; return Promise.resolve(); }
  }
  return {AudioContext,devices,pending};
}

test('three original PCM loops have the advertised tempo, a bounded signal and a smooth loop seam',()=>{
  const beginnings=new Set();
  for (const [i,station] of radio.stations.entries()) {
    const rate=8000, wave=radio.synthesize(station,rate);
    assert.equal(station.melody.length,station.roots.length*station.beats*2);
    assert.equal(wave.length,Math.round(rate*60/station.bpm*station.roots.length*station.beats));
    assert.ok(wave instanceof Float32Array && wave.every(x=>Number.isFinite(x) && Math.abs(x)<1));
    assert.ok(wave.reduce((n,x)=>n+x*x,0)/wave.length>.001);
    assert.ok(Math.abs(wave[0]-wave.at(-1))<.06);
    assert.deepEqual(wave,radio.synthesize(station,rate));
    const hz=440*2**((station.melody[0]-69)/12);
    let sine=0, cosine=0;
    for (let j=40;j<840;j++) {
      sine+=wave[j]*Math.sin(j*2*Math.PI*hz/rate);
      cosine+=wave[j]*Math.cos(j*2*Math.PI*hz/rate);
    }
    assert.ok(Math.hypot(sine,cosine)/800>.04,'opening note is audible at its scored pitch');
    beginnings.add(wave.slice(30,75).join(','));
    assert.ok(radio.dialPosition(i)>=0 && radio.dialPosition(i)<=1);
  }
  assert.equal(beginnings.size,3);
  for (const rate of [0,7999,Infinity,NaN,44100.4]) assert.throws(()=>radio.synthesize(radio.stations[0],rate),RangeError);
});

test('tuning the illustrated dial, cycling stations or reloading never starts audio without Listen',()=>{
  const device=audioDevice(),p=openPage({AudioContext:device.AudioContext,reduced:true});
  key(p,'8'); p.win.tick();
  assert.equal(p.$('radio-name').textContent,radio.stations[0].name);
  assert.equal(p.$('radio-status').textContent,'Radio off'); assert.ok(!p.$('radio-panel').hidden);
  const positions=new Set();
  for (const i of [2,1,0]) {
    p.$('station-prev').click(); p.win.tick(); positions.add(p.$('radio-needle').style.left);
    assert.equal(p.$('radio-name').textContent,radio.stations[i].name);
    assert.equal(p.$('radio-frequency').textContent,radio.stations[i].frequency+' FM');
    assert.deepEqual(surface(p).u_tuning,[radio.dialPosition(i),0]);
  }
  assert.equal(positions.size,3); assert.equal(device.devices.length,0);
  assert.equal(p.win.frames.size,0); assert.ok(p.$('radio-quiet').hidden);
  openPage({AudioContext:device.AudioContext,noWebGL:true}); assert.equal(device.devices.length,0);
});

test('Listen creates one looping source, volume adjusts it and returning to a station reuses its buffer',async()=>{
  const device=audioDevice(), p=openPage({AudioContext:device.AudioContext,reduced:true});
  key(p,'8'); p.$('radio-power').click(); await flush(); p.win.tick();
  const ctx=device.devices[0], current=()=>ctx.sources.at(-1);
  const first=current().buffer;
  assert.ok(current().started && !current().stopped); assert.equal(p.$('radio-status').textContent,'On air');
  assert.deepEqual(surface(p).u_tuning,[0,1]);
  for (const v of ['0','70','100']) {
    p.$('radio-volume').value=v; p.$('radio-volume').emit('input');
    assert.equal(ctx.params[0].value,(Number(v)/100)**2);
  }
  const firstSource=current(); p.$('station-next').click(); await flush();
  assert.ok(firstSource.stopped && !firstSource.connected); assert.notEqual(current().buffer,first);
  p.$('station-prev').click(); await flush(); assert.equal(current().buffer,first);
  assert.equal(ctx.buffers.length,2); assert.equal(ctx.sources.filter(s=>s.connected).length,1);
  key(p,'5'); assert.ok(!p.$('radio-quiet').hidden && p.$('radio-panel').hidden);
  p.$('radio-quiet').focus(); p.$('radio-quiet').click(); await flush(); p.win.tick();
  assert.equal(ctx.state,'suspended'); assert.ok(ctx.sources.every(s=>s.stopped && !s.connected));
  assert.ok(p.$('radio-quiet').hidden); assert.equal(p.doc.activeElement,p.$('ticket-toggle'));
  assert.equal(p.$('radio-power').getAttribute('aria-pressed'),'false');
  assert.deepEqual(surface(p).u_tuning,[0,0]); assert.equal(p.win.frames.size,0);
});

test('a delayed audio permission cannot resurrect a stopped source or play a superseded station',async()=>{
  const device=audioDevice({deferred:true}), p=openPage({AudioContext:device.AudioContext,noWebGL:true});
  p.$('object-list').children[7].click(); p.$('radio-power').click();
  const ctx=device.devices[0];
  p.$('radio-power').click(); device.pending.shift().resolve(); await flush();
  assert.equal(ctx.sources.length,0); assert.equal(ctx.state,'suspended');
  assert.equal(p.$('radio-status').textContent,'Radio off');
  p.$('radio-power').click(); p.$('station-next').click();
  device.pending[1].resolve(); await flush();
  device.pending[0].reject(new Error('Old resume')); await flush();
  assert.equal(ctx.sources.length,1); assert.equal(p.$('radio-name').textContent,radio.stations[1].name);
  assert.equal(p.$('radio-status').textContent,'On air'); assert.equal(ctx.buffers.length,1);
});

test('hidden tabs and page cache visits silence active radio and resume only the listener’s choice',async()=>{
  const device=audioDevice(),p=openPage({AudioContext:device.AudioContext,noWebGL:true});
  p.$('object-list').children[7].click(); p.$('radio-power').click(); await flush();
  const ctx=device.devices[0];
  p.doc.hidden=true; p.doc.emit('visibilitychange'); await flush();
  assert.ok(ctx.sources[0].stopped); assert.equal(ctx.state,'suspended');
  p.win.emit('pagehide'); p.doc.hidden=false; p.doc.emit('visibilitychange'); await flush();
  assert.equal(ctx.sources.length,1);
  p.win.emit('pageshow'); await flush(); assert.equal(ctx.sources.length,2);
  assert.ok(ctx.sources[1].started); p.$('radio-power').click();
  p.doc.hidden=true; p.doc.emit('visibilitychange'); p.doc.hidden=false; p.doc.emit('visibilitychange');
  await flush(); assert.equal(ctx.sources.length,2);
});

test('unavailable audio explains the silent dial and a blocked start can be retried from the slip',async()=>{
  const silent=openPage({noWebGL:true});
  silent.$('object-list').children[7].click(); assert.ok(silent.$('radio-power').disabled);
  assert.match(silent.$('radio-status').textContent,/unavailable/);
  silent.$('station-next').click(); assert.equal(silent.$('radio-name').textContent,radio.stations[1].name);
  const device=audioDevice({rejectFirst:true}), p=openPage({AudioContext:device.AudioContext,noWebGL:true});
  p.$('object-list').children[7].click(); p.$('radio-power').click(); await flush();
  assert.match(p.$('radio-status').textContent,/try again/); assert.equal(p.$('radio-power').textContent,'Listen');
  assert.equal(device.devices[0].sources.length,0);
  p.$('radio-power').click(); await flush(); assert.equal(device.devices[0].sources.length,1);
  assert.equal(p.$('radio-status').textContent,'On air'); assert.deepEqual(p.errors,[]);
});
