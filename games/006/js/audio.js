(function () {
  'use strict';

  // The two oscillators follow wheel speed. A filtered, looping noise bed supplies rail sound.
  function createAudio(Context) {
    let ctx, master, motor, wheels, rumble, railGain, rainGain, shuttleGain;
    let enabled = false, muted = true, previousPhase = '', heardBells = 0, lastApproach = -1;

    function initialize() {
      ctx = new Context();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      function oscillator(type, level) {
        const source = ctx.createOscillator(), gain = ctx.createGain();
        source.type = type;
        source.frequency.value = 38;
        gain.gain.value = level;
        source.connect(gain); gain.connect(master); source.start();
        return { source, levelControl: gain.gain };
      }
      motor = oscillator('sine', 0.085);
      wheels = oscillator('triangle', 0.014);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = noise.getChannelData(0);
      const random = Nightline.math.seeded(404);
      for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = noise; source.loop = true;
      function noiseChannel(type, frequency) {
        const filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        filter.type = type; filter.frequency.value = frequency; gain.gain.value = 0;
        source.connect(filter); filter.connect(gain); gain.connect(master);
        return { filter, gain };
      }
      rainGain = noiseChannel('highpass', 2200).gain;
      shuttleGain = noiseChannel('bandpass', 740).gain;
      const rail = noiseChannel('lowpass', 150);
      rumble = rail.filter; railGain = rail.gain;
      source.start();
    }

    function quiet(value) {
      if (!ctx || muted === value) return;
      muted = value;
      master.gain.setTargetAtTime(value ? 0 : 0.48, ctx.currentTime, 0.038);
    }

    // Always resume inside the click handler. A later mute takes precedence over an outstanding resume.
    async function setEnabled(value) {
      if (value && !Context) throw new Error('Audio unavailable');
      enabled = value;
      if (!value) { quiet(true); return; }
      if (!ctx) initialize();
      await ctx.resume();
    }

    function chime(frequency, delay) {
      const tone = ctx.createOscillator(), envelope = ctx.createGain();
      const t = ctx.currentTime + delay;
      tone.frequency.value = frequency; envelope.gain.value = 0;
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(0.075, t + 0.016);
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      tone.connect(envelope); envelope.connect(master);
      tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
      tone.start(t); tone.stop(t + 0.4);
    }

    function update(ride, suspended) {
      const previous = previousPhase;
      previousPhase = ride.phase;
      const dispatchBell = heardBells !== ride.guard.bells;
      heardBells = ride.guard.bells;
      const approaching = Nightline.saloon.message(ride).stage.key === 'arriving' && lastApproach !== ride.sheet.count;
      if (approaching) lastApproach = ride.sheet.count;
      if (!ctx) return;
      quiet(!enabled || suspended || ride.paused);
      if (muted) return;
      const t = ctx.currentTime, v = ride.speed;
      const outside = Nightline.route.openAir(ride.position);
      motor.source.frequency.setTargetAtTime(34 + 3.3 * v, t, 0.12);
      motor.levelControl.setTargetAtTime(ride.coasting ? 0.014 : 0.085, t, 0.17);
      wheels.source.frequency.setTargetAtTime(68 + 6.7 * v, t, 0.12);
      rainGain.gain.setTargetAtTime(ride.weather.rain ? 0.060 * outside * ride.weather.cloud : 0, t, 0.24);
      let passing = 0;
      if (outside) for (const car of Nightline.shuttle.carsAt(ride.position, ride.time)) {
        const separation = (car.at - ride.position) / 12;
        passing = Math.max(passing, 1 / (1 + separation * separation));
      }
      shuttleGain.gain.setTargetAtTime(0.32 * outside * passing, t, 0.09);
      rumble.frequency.setTargetAtTime((150 + 23 * v) * (1 - 0.18 * outside), t, 0.16);
      railGain.gain.setTargetAtTime((0.026 + 0.006 * v) * (1 - 0.32 * outside), t, 0.16);
      if (dispatchBell) { chime(784, 0); chime(784, 0.26); }
      if (approaching) { chime(554, 0); chime(740, 0.14); chime(659, 0.31); }
      if (previous !== ride.phase && (ride.phase === 'opening' || ride.phase === 'closing')) {
        const opening = ride.phase === 'opening';
        chime(opening ? 494 : 622, 0);
        chime(opening ? 622 : 494, 0.18);
      }
    }

    return { setEnabled, update };
  }

  Nightline.audio = { createAudio };
})();
