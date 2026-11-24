(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, clamp, mix } = common ? require("./math.js") : root.Isobar.math;
  const lighting = common ? require("./lighting.js") : root.Isobar.lighting;

  const MAX_CLOUDS = 1800;
  const MAX_RAIN = 2800;
  const DEFAULT_SIGNAL = 5;
  const ARM_REACH = [11.6, 9.2, 10.7];
  const LEVELS = ["Light", "Breezy", "Fresh", "Brisk", "Strong", "Gale", "High gale", "Storm", "Violent", "Extreme"];
  const normalized = level => (level - 1) / 9;

  function randomSource(seed) {
    let bits = seed >>> 0;
    return function next() {
      bits = (bits + 0x6d2b79f5) >>> 0;
      let n = Math.imul(bits ^ (bits >>> 15), bits | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeState() {
    return { signal: DEFAULT_SIGNAL, strength: normalized(DEFAULT_SIGNAL),
      time: 0, phase: 0, rainTravel: 0, playing: true, speed: 1,
      imagery: "cloud", comparing: false, cloudPercent: 50, lightMinutes: lighting.DEFAULT_MINUTES,
      radarSite: null, drift: null, layers: { clouds: true, rain: true, grid: true },
      section: { enabled: false, bearing: 90, distance: 0 } };
  }

  function setSignal(state, input) {
    const number = Number(input);
    if (!Number.isFinite(number)) return false;
    const signal = clamp(Math.round(number), 1, 10);
    if (signal === state.signal) return false;
    state.signal = signal;
    if (!state.playing) state.strength = normalized(signal);
    return true;
  }

  const spinRate = strength => 0.050 + 0.165 * strength;
  const fallRate = strength => 0.42 + 1.48 * strength;
  const cloudCount = strength => Math.round(mix(740, MAX_CLOUDS, clamp(strength, 0, 1)));
  const rainCount = strength => Math.round(mix(140, MAX_RAIN, Math.pow(clamp(strength, 0, 1), 1.25)));

  function advance(state, dt) {
    const elapsed = dt * state.speed;
    if (!state.playing || !(dt > 0) || !(elapsed > 0) || !Number.isFinite(elapsed)) return;
    const target = normalized(state.signal);
    const error = state.strength - target;
    const response = -Math.expm1(-3.2 * elapsed);
    state.strength += (target - state.strength) * response;
    // Integrate the exponential response, so storm travel is independent of frame rate.
    const average = target + error * response / (3.2 * elapsed);
    state.time += elapsed;
    state.phase = (state.phase + spinRate(average) * elapsed) % TAU;
    state.rainTravel += fallRate(average) * elapsed;
  }

  function readings(strength, time) {
    const wave = (t, phase) => Math.sin(t * 0.43 + phase) * 0.49
      + Math.sin(t * 0.97 + phase * 2) * 0.28 + Math.sin(t * 1.83 - phase) * 0.15
      + Math.sin(t * 3.91 + phase) * 0.08;
    return {
      wind: 32 + 154 * Math.pow(strength, 1.12) + wave(time, 0.4) * (1.6 + 2.2 * strength),
      rain: 2.4 + 83.6 * Math.pow(strength, 1.58) + wave(time * 0.86, 2.3) * (0.46 + 1.34 * strength),
      pressure: 1006 - 87 * Math.pow(strength, 1.11) + wave(time * 0.57, 4.7) * (0.95 + strength)
    };
  }

  const spiral = r => 2.4 * Math.log(1 + 0.90 * r) + 0.065 * r;
  const armAngle = (r, arm) => spiral(r) + arm * TAU / 3 + 2.48 + 0.19 * Math.sin(r * 0.77 + arm * 1.8);
  const radialScale = strength => 1.055 - 0.105 * strength;
  const bandTurn = (r, phase, strength) => -phase + 0.12 * Math.sin(phase - r * 0.56) - strength * r * 0.032;

  function makeClouds(seed = 0x15ab47, count = MAX_CLOUDS) {
    const random = randomSource(seed);
    const normal = () => random() + random() + random() - 1.5;
    const clouds = [];
    for (let i = 0; i < count; i++) {
      const choice = random();
      let r, theta, y, size, stretch;
      if (choice < 0.22) {
        // A raised, scalloped eyewall surrounds a genuinely open centre.
        r = 1.48 + 1.83 * Math.pow(random(), 1.35);
        theta = TAU * random();
        r += 0.09 * Math.sin(3 * theta + 0.5);
        y = 1.41 + 0.82 * Math.exp(-Math.pow((r - 1.83) / 0.75, 2)) + normal() * 0.23;
        size = 0.43 + 0.39 * random();
        stretch = 1.0 + 0.46 * random();
      } else if (choice < 0.325) {
        const t = random();
        r = 2.12 + 3.15 * t;
        theta = armAngle(r, Math.floor(random() * 3)) + normal() * 0.83;
        y = 0.85 + 0.69 * (1 - t) + random() * 0.34;
        size = (0.64 + 0.50 * random()) * (1 - 0.25 * t);
        stretch = 1.13 + 0.53 * random();
      } else {
        const arm = Math.floor(random() * 3);
        const filament = choice > 0.84;
        const t = Math.pow(random(), 0.94);
        const length = ARM_REACH[arm];
        r = mix(filament ? 3.6 : 1.75, length, t);
        theta = armAngle(r, arm) + normal() * (0.15 + 0.62 / r);
        if (filament) theta += 0.42 + 0.13 * Math.sin(r * 1.12);
        r += normal() * 0.38;
        y = 0.70 + 0.94 * (1 - t) + 0.24 * Math.sin(r * 1.24 + arm) + normal() * 0.27;
        size = (0.52 + 0.60 * random()) * (1.12 - 0.48 * t);
        stretch = 1.18 + 0.53 * random() + 0.28 * t;
        if (filament) { size *= 0.57; y -= 0.16; stretch += 0.44; }
      }
      clouds.push({ r, theta, y, size, stretch, tile: Math.floor(random() * 4), variation: random() });
    }
    return clouds;
  }

  // Write into caller-owned storage. The two final components are a horizontal tangent.
  function cloudPose(particle, phase, strength, output, offset = 0) {
    const r = particle.r;
    const angle = particle.theta + bandTurn(r, phase, strength);
    const radius = r * radialScale(strength);
    const c = Math.cos(angle), s = Math.sin(angle);
    output[offset] = radius * c;
    output[offset + 1] = particle.y * (0.80 + 0.38 * strength) + 0.07 * Math.sin(angle * 3 + r);
    output[offset + 2] = radius * s;
    output[offset + 3] = -s + 0.22 * c;
    output[offset + 4] = c + 0.22 * s;
  }

  function makeRain(seed = 0x905aa1, count = MAX_RAIN) {
    const random = randomSource(seed);
    const drops = [];
    for (let i = 0; i < count; i++) {
      const r = 1.32 + 10.65 * Math.sqrt(random());
      const arm = Math.floor(random() * 3);
      drops.push({ r, theta: armAngle(r, arm) + (random() - 0.5) * 1.45,
        start: random(), rate: 0.72 + 0.6 * random(), height: 1.0 + 1.48 * random(),
        length: 0.11 + 0.25 * random(), brightness: random() });
    }
    return drops;
  }

  function rainPose(drop, state, output, offset = 0) {
    const travel = drop.start + state.rainTravel * drop.rate;
    const fraction = travel - Math.floor(travel);
    const strength = state.strength;
    const shear = 0.10 + 0.19 * strength;
    const theta = drop.theta - state.phase - fraction * shear;
    const c = Math.cos(theta), s = Math.sin(theta);
    const y = (1 - fraction) * drop.height;
    const length = Math.min(drop.height - y + 0.008, drop.length * (0.80 + 1.50 * strength));
    const slant = length * shear * drop.r / drop.height;
    output[offset] = drop.r * c;
    output[offset + 1] = y;
    output[offset + 2] = drop.r * s;
    output[offset + 3] = drop.r * c - slant * s;
    output[offset + 4] = y + length;
    output[offset + 5] = drop.r * s + slant * c;
  }

  const api = { MAX_CLOUDS, MAX_RAIN, DEFAULT_SIGNAL, ARM_REACH, LEVELS, normalized, randomSource, makeState,
    setSignal, spinRate, fallRate, cloudCount, rainCount, advance, readings, spiral, armAngle, radialScale, bandTurn,
    makeClouds, cloudPose, makeRain, rainPose };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).storm = api;
})(globalThis);
