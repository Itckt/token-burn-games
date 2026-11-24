(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./weather.js'), require('./terrain.js'));
  else root.Atlas.soundscape = factory(root.Atlas.math, root.Atlas.weather, root.Atlas.terrain);
})(globalThis, function (M, weather, terrain) {
  'use strict';
  const RATE = 22050;
  const loops = ['garden','evening','rain','eaves'];
  const durations = {garden:8, evening:6, rain:4, eaves:5, stone:.16, timber:.20};
  const seeds = {garden:93, evening:223, rain:807, eaves:574, stone:59, timber:16};
  const sin = Math.sin, tau = M.TAU;

  function chirp(t, start, duration, pitch, sweep) {
    const u=t-start;
    if (u<0 || u>duration) return 0;
    return sin(Math.PI*u/duration)**2 * sin(tau*(pitch*u+sweep*u*u/2));
  }
  // Generate mono PCM locally. Blend the extra tail into the head of each loop
  // so wind and rain remain continuous when the audio clock wraps the buffer.
  function samples(kind, rate = RATE) {
    if (!Object.hasOwn(durations,kind) || !Number.isInteger(rate) || rate<8000 || rate>96000) {
      throw new RangeError('Invalid sound clip or sample rate');
    }
    const count=Math.round(durations[kind]*rate), loop=loops.includes(kind);
    const overlap=loop ? Math.round(rate*.12) : 0;
    const data=new Float32Array(count+overlap), rng=M.random(seeds[kind]);
    let low=0, mid=0;
    for (let i=0; i<data.length; i++) {
      const t=i/rate, noise=rng()*2-1;
      low+=(noise-low)*.035;
      mid+=(noise-mid)*.26;
      let value;
      switch (kind) {
        case 'garden':
          value=low*.45 + .34*(chirp(t,.84,.19,1850,3600)+chirp(t,1.08,.13,2400,-2800)
            +chirp(t,5.15,.22,1930,2600)+chirp(t,5.52,.16,2270,-3200));
          break;
        case 'evening': {
          const trill=Math.max(0,sin(tau*24*t))**2;
          const phrase=Math.max(0,sin(tau*(.87*t+.08*sin(tau*t/3))))**2;
          value=low*.28+.17*trill*phrase*(sin(tau*2790*t)+.36*sin(tau*3320*t));
          break;
        }
        case 'rain':
          value=(mid*.57+noise*.23)*(.87+.09*sin(t*1.8)+.04*sin(t*4.3));
          break;
        case 'eaves': {
          const drop=t%.47, drip=t%.713;
          value=low*.83+.23*Math.exp(-44*drop)*sin(tau*(710*drop-1800*drop*drop))
            +.13*Math.exp(-57*drip)*sin(tau*1230*drip);
          break;
        }
        default: {
          const wood=kind==='timber', pitch=wood?176:99;
          const impact=sin(tau*(pitch*t-135*t*t))*Math.exp(-(wood?25:52)*t);
          const envelope=Math.min(1,t/.003,(count-1-i)/(rate*.012));
          value=envelope*(impact*.48+mid*Math.exp(-44*t)*(wood ? .48 : .88));
        }
      }
      data[i]=M.clamp(value,-1,1);
    }
    for (let i=0; i<overlap; i++) data[i]=M.mix(data[count+i],data[i],i/overlap);
    return data.subarray(0,count);
  }
  function levels(state, world) {
    const garden=world.places.find(p=>p.id==='garden');
    const near=garden ? Math.max(0,1-Math.hypot(state.x-garden.point[0],state.z-garden.point[1])/35) : 0;
    const wet=state.weather.wet, dry=1-.94*wet;
    const roof=wet>0 && weather.coverAt(state.x,state.z,world.shelters);
    return {
      garden:(1-state.light)*dry*(.32+.57*near),
      evening:state.light*dry*(.48+.38*near),
      rain:wet*(roof ? .12 : .63),
      eaves:roof ? wet*.72 : 0
    };
  }
  class Footsteps {
    constructor() { this.phase=0; }
    advance(distance, brisk) {
      // A full simulation substep covers less than one metre, even at a run.
      if (!Number.isFinite(distance) || distance<0 || distance>1) { this.phase=0; return false; }
      this.phase+=distance/(brisk?1.95:1.48);
      if (this.phase<1) return false;
      this.phase-=1;
      return true;
    }
  }
  class Soundscape {
    constructor(Context, changed) {
      this.Context=Context;
      this.changed=changed;
      this.enabled=false;
      this.paused=false;
      this.audible=false;
      this.revision=0;
      this.footsteps=new Footsteps();
      this.mix={garden:0,evening:0,rain:0,eaves:0};
      this.stems=new Map();
      this.buffers=new Map();
      this.steps=new Set();
      this.left=false;
    }
    buffer(kind) {
      if (!this.buffers.has(kind)) {
        const pcm=samples(kind), clip=this.ctx.createBuffer(1,pcm.length,RATE);
        clip.copyToChannel(pcm,0);
        this.buffers.set(kind,clip);
      }
      return this.buffers.get(kind);
    }
    prepare() {
      this.master=this.ctx.createGain();
      this.master.gain.value=0;
      this.master.connect(this.ctx.destination);
      for (const kind of loops) {
        const gain=this.ctx.createGain(), source=this.ctx.createBufferSource();
        gain.gain.value=this.mix[kind];
        gain.connect(this.master);
        source.buffer=this.buffer(kind);
        source.loop=true;
        source.connect(gain);
        source.start();
        this.stems.set(kind,gain);
      }
    }
    setEnabled(value) {
      if (!this.Context || this.enabled===value) return;
      this.enabled=value;
      this.changed();
      return this.sync();
    }
    setPaused(value) {
      if (this.paused===value) return;
      this.paused=value;
      return this.sync();
    }
    async sync() {
      const revision=++this.revision;
      this.audible=false;
      this.footsteps.phase=0;
      if (!this.enabled || this.paused) {
        if (this.master) {
          this.master.gain.cancelScheduledValues(0);
          this.master.gain.value=0;
        }
        for (const step of this.steps) step.stop();
        this.steps.clear();
        if (this.ctx) {
          try { await this.ctx.suspend(); } catch { /* The master is already silent. */ }
        }
        return;
      }
      try {
        const ctx=this.ctx ??= new this.Context();
        await ctx.resume();
        if (revision!==this.revision) {
          if (ctx===this.ctx && (!this.enabled || this.paused) && ctx.state==='running') await ctx.suspend();
          return;
        }
        if (!this.master) this.prepare();
        for (const [kind,node] of this.stems) {
          node.gain.cancelScheduledValues(0);
          node.gain.value=this.mix[kind];
        }
        this.master.gain.setTargetAtTime(.56,this.ctx.currentTime,.035);
        this.audible=true;
      } catch {
        if (revision===this.revision) this.failed();
      }
    }
    failed() {
      const old=this.ctx;
      this.revision++;
      this.enabled=this.audible=false;
      this.ctx=this.master=null;
      this.stems.clear(); this.buffers.clear(); this.steps.clear();
      // Detach a partial graph before notifying so a retry can start immediately.
      if (old) old.close().catch(()=>{});
      this.changed('Campus sound could not play. Select Sound to try again.');
    }
    update(state,world,distance,brisk) {
      if (!this.enabled || this.paused) return;
      const mix=levels(state,world);
      try {
        if (this.audible) this.play(state,world,mix,distance,brisk);
      } catch { this.failed(); }
      this.mix=mix;
    }
    play(state,world,mix,distance,brisk) {
      for (const [kind,node] of this.stems) {
        if (mix[kind]!==this.mix[kind]) node.gain.setTargetAtTime(mix[kind],this.ctx.currentTime,.16);
      }
      if (!this.footsteps.advance(distance,brisk)) return;
      const material=terrain.surfaceAt(state.x,state.z,world.surfaces)?.material || 'stone';
      const step=this.ctx.createBufferSource();
      step.buffer=this.buffer(material);
      step.playbackRate.value=this.left ? .96 : 1.04;
      this.left=!this.left;
      this.steps.add(step);
      step.onended=()=>{ this.steps.delete(step); step.disconnect(); };
      step.connect(this.master);
      step.start();
    }
  }
  return {RATE, loops, samples, levels, Footsteps, Soundscape};
});
