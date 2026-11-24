'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {samples,loops,levels,Footsteps,Soundscape,RATE}=require('../src/soundscape.js');
const {makeState}=require('../src/simulation.js');
const {RecordingAudio}=require('./support/audio.js');
const {running,advance,selectInGuide}=require('./support/walk.js');
const world=require('../src/campus.js').create();
const audioTurn=()=>new Promise(resolve=>setImmediate(resolve));

test('all four environmental loops and both footfalls synthesize repeatable bounded mono PCM',()=>{
  const clips=new Map();
  for (const kind of [...loops,'stone','timber']) {
    const pcm=samples(kind,8000);
    assert.deepEqual(pcm,samples(kind,8000));
    let power=0, peak=0;
    for (const value of pcm) {
      assert.ok(Number.isFinite(value));
      power+=value*value;
      peak=Math.max(peak,Math.abs(value));
    }
    assert.ok(peak<=1 && Math.sqrt(power/pcm.length)>.01);
    if (!loops.includes(kind)) {
      assert.ok(pcm.length<=1600 && Math.abs(pcm[0])+Math.abs(pcm.at(-1))<1e-8);
    }
    clips.set(kind,pcm);
  }
  assert.notDeepEqual(clips.get('stone').slice(0,1000),clips.get('timber').slice(0,1000));
  assert.throws(()=>samples('distant radio'),RangeError);
  for (const bad of [-1,0,NaN,Infinity,440.5]) assert.throws(()=>samples('garden',bad),RangeError);
});

test('birdsong follows the garden, evening insects follow the light, and eave drips follow the roof edge',()=>{
  const s=makeState(world.places[0].view), court=levels(s,world);
  assert.equal(court.evening+court.rain+court.eaves,0);
  [s.x,s.z]=world.places[4].point;
  const garden=levels(s,world);
  assert.ok(garden.garden>court.garden*2);
  s.light=.5;
  const dusk=levels(s,world);
  assert.equal(dusk.garden,garden.garden/2);
  s.light=1;
  assert.equal(levels(s,world).evening,dusk.evening*2);
  s.weather.wet=1;
  const roof=world.shelters.at(-1);
  s.x=roof.x+roof.w/2; s.z=roof.z;
  const covered=levels(s,world);
  s.x+=.001;
  const exposed=levels(s,world);
  assert.ok(covered.rain<exposed.rain/3 && covered.eaves>0);
  assert.equal(exposed.eaves,0);
  assert.ok(covered.evening<dusk.evening);
  s.light=0; s.weather.wet=.5;
  assert.equal(levels(s,world).rain,exposed.rain/2);
});

test('footfalls count distance independently of refresh rate and discard position jumps',()=>{
  for (const brisk of [false,true]) {
    const count=hz=>{
      const feet=new Footsteps();
      let steps=0;
      for (let i=0; i<hz*4; i++) steps+=Number(feet.advance(3.55/hz,brisk));
      for (let i=0; i<hz; i++) assert.equal(feet.advance(0,brisk),false);
      return steps;
    };
    for (const hz of [30,60,144]) assert.equal(count(hz),brisk?7:9);
  }
  const feet=new Footsteps();
  feet.advance(.9,false);
  for (const jump of [20,-1,NaN,Infinity]) {
    assert.equal(feet.advance(jump,false),false);
    assert.equal(feet.phase,0);
  }
});

test('a late audio resume after muting creates no voices and leaves the device suspended',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const options={resume:()=>gate};
  class Device extends RecordingAudio { constructor(){super(options);} }
  const sound=new Soundscape(Device,()=>{});
  const pending=sound.setEnabled(true);
  const ctx=sound.ctx;
  await sound.setEnabled(false);
  release(); await pending;
  assert.equal(sound.audible,false);
  assert.equal(ctx.sources.length,0);
  assert.equal(ctx.state,'suspended');
  await sound.setEnabled(true);
  assert.ok(sound.audible && ctx.sources.length===4);
  await sound.setPaused(true); await sound.setPaused(false);
  assert.equal(ctx.sources.length,4);
});

test('sound is opt-in, shares four loop buffers across pauses, and footsteps follow the actual walking surface',async()=>{
  const h=running({audio:{},reduced:true});
  assert.equal(h.audioContexts.length,0);
  assert.equal(h.id('sound').disabled,false);
  h.key('KeyV'); await audioTurn(); h.settle();
  const [ctx]=h.audioContexts, loopsOnly=ctx.sources.filter(s=>s.loop);
  assert.equal(loopsOnly.length,4);
  assert.ok(loopsOnly.every(s=>s.started && s.output.output.output===ctx.destination));
  assert.equal(h.id('sound').getAttribute('aria-pressed'),'true');
  assert.equal(h.frames.size,0,'ambient loops run on the audio clock');
  h.key('KeyV',{repeat:true}); advance(h,20);
  assert.equal(ctx.sources.length,4);
  h.key('KeyW'); advance(h,40); h.up('KeyW'); h.settle();
  const stone=ctx.sources.find(s=>!s.loop);
  assert.equal(stone.buffer.length,Math.round(RATE*.16));
  const oldCount=ctx.sources.length;
  selectInGuide(h,world.places[5]); await audioTurn();
  assert.equal(ctx.state,'suspended');
  assert.ok(stone.stopped);
  h.key('KeyV');
  assert.equal(h.id('sound').getAttribute('aria-pressed'),'true');
  h.id('travel').emit('click'); await audioTurn(); h.settle();
  assert.equal(ctx.state,'running');
  assert.equal(ctx.sources.length,oldCount,'teleport adds no step');
  h.key('KeyA'); advance(h,36); h.up('KeyA'); h.settle();
  assert.equal(ctx.sources.at(-1).buffer.length,Math.round(RATE*.20));
  h.key('KeyR'); h.key('KeyN'); h.settle();
  assert.equal(loopsOnly[0].output.gain.value,0);
  assert.ok(loopsOnly[2].output.gain.value>.5);
  h.doc.hidden=true; h.doc.emit('visibilitychange'); await audioTurn();
  assert.equal(ctx.state,'suspended');
  h.doc.hidden=false; h.doc.emit('visibilitychange'); await audioTurn(); h.settle();
  assert.equal(ctx.state,'running');
  h.win.emit('blur'); await audioTurn(); assert.equal(ctx.state,'suspended');
  h.win.emit('focus'); await audioTurn(); assert.equal(ctx.state,'running');
  h.gl.lost=true; h.canvas.emit('webglcontextlost'); await audioTurn();
  assert.ok(h.id('sound').disabled && ctx.state==='suspended');
  h.gl.lost=false; h.canvas.emit('webglcontextrestored'); await audioTurn(); h.settle();
  assert.ok(!h.id('sound').disabled && ctx.state==='running');
  h.key('KeyC'); h.key('Space'); await audioTurn();
  assert.equal(ctx.state,'suspended');
  h.key('Escape'); await audioTurn(); assert.equal(ctx.state,'running');
  h.id('sound').emit('click'); await audioTurn(); h.settle();
  assert.equal(ctx.state,'suspended');
  assert.equal(ctx.sources.filter(s=>s.loop).length,4);
  assert.equal(ctx.buffers.length,6);
  assert.equal(h.errors.length,0);
});

test('an unavailable, denied or interrupted audio device leaves walking usable and supports retry',async()=>{
  const silent=running();
  assert.ok(silent.id('sound').disabled);
  silent.key('KeyV'); silent.key('KeyN'); silent.settle();
  assert.equal(silent.uniform('uNight')[0],1);
  const audio={deny:true}, h=running({audio,reduced:true});
  h.key('KeyV'); await audioTurn();
  assert.equal(h.id('sound').getAttribute('aria-pressed'),'false');
  assert.match(h.id('toast').textContent,/Select Sound/);
  assert.equal(h.audioContexts[0].state,'closed');
  audio.deny=false; h.id('sound').emit('click'); await audioTurn(); h.settle();
  assert.equal(h.audioContexts[1].sources.length,4);
  audio.failStep=true;
  h.key('KeyW'); advance(h,45); h.up('KeyW'); h.settle(); await audioTurn();
  assert.equal(h.id('sound').getAttribute('aria-pressed'),'false');
  assert.ok(h.id('unavailable').hidden && h.audioContexts[1].state==='closed');
  assert.equal(h.errors.length,0);
});
