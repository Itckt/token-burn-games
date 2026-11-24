(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { openAir } = node ? require('./route.js') : Nightline.route;
  // The same dimensions locate the mesh, its pivot and the swept part of the glass.
  const BLADE = Object.freeze({ x: 0.86, y: 1.982, inner: 0.18, outer: 1.28, park: 0.065, arc: 0.94 });
  const SWEEP_TIME = 1.4, INTERVAL = 1.15;
  function createWeather() {
    return { rain: false, cloud: 0, water: 0, film: Array(8).fill(0), sweep: null, rest: 0 };
  }
  function wipe(w) { if (w.sweep === null) w.sweep = 0; }
  function reach(value, target, step) {
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
  }
  function travel(seconds) { return (1 - Math.cos(2 * Math.PI * seconds / SWEEP_TIME)) * 0.5; }
  function bladeAngle(w) { return w.sweep === null ? 0 : BLADE.arc * travel(w.sweep); }
  function active(w) { return w.sweep !== null || w.water > 0 || w.cloud !== Number(w.rain); }

  function advance(w, dt, position) {
    w.rest = Math.max(0, w.rest - dt);
    if (!active(w) && !w.rain) return;
    w.cloud = reach(w.cloud, Number(w.rain), 0.65 * dt);
    const rain = w.rain ? openAir(position) : 0;
    const collect = value => reach(value, rain, dt * (value < rain ? 0.72 : 0.14));
    w.water = collect(w.water);
    if (rain > 0.12 && w.water >= 0.30 && !w.rest) wipe(w);
    let low = Infinity, high = -Infinity;
    if (w.sweep !== null) {
      const start = w.sweep, end = Math.min(SWEEP_TIME, start + dt);
      const a = travel(start), b = travel(end);
      low = Math.min(a, b) - 0.012;
      high = (start <= SWEEP_TIME / 2 && end >= SWEEP_TIME / 2 ? 1 : Math.max(a, b)) + 0.012;
      w.sweep = end;
      if (end >= SWEEP_TIME - 1e-9) { w.sweep = null; w.rest = INTERVAL; }
    }
    for (let i = 0; i < w.film.length; i++) {
      const angle = i / (w.film.length - 1);
      w.film[i] = angle >= low && angle <= high ? 0 : collect(w.film[i]);
    }
  }

  const api = { BLADE, SWEEP_TIME, createWeather, advance, wipe, bladeAngle, active };
  if (node) module.exports = api;
  else Nightline.weather = api;
})();
