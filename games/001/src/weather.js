(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.Atlas.weather = factory(root.Atlas.math);
})(globalThis, function (M) {
  'use strict';
  // Each seed is repeated for the three corners of a tapered, wind-slanted streak.
  const SPAN = 30, HEIGHT = 15, PERIOD = 2, DROPS = 560;
  function makeRainMesh(count = DROPS) {
    const rng = M.random(1719), vertices = new Float32Array(count * 3 * 5);
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const x = rng() * SPAN, y = rng() * HEIGHT, z = rng() * SPAN;
      for (const [side, tail] of [[-1, 0], [1, 0], [0, 1]]) {
        vertices.set([x, y, z, side, tail], offset);
        offset += 5;
      }
    }
    return vertices;
  }
  function create() {
    return {shower: false, wet: 0, time: 0, drops: false};
  }
  function step(w, seconds, reduced, paused = false) {
    if (!(seconds > 0 && Number.isFinite(seconds))) return false;
    const dt = Math.min(seconds, 0.1), target = Number(w.shower);
    const oldWet = w.wet, hadDrops = w.drops;
    w.wet = reduced ? target : M.mix(w.wet, target, 1 - Math.exp(-3.6 * dt));
    if (Math.abs(target - w.wet) < 0.001) w.wet = target;
    w.drops = w.wet > 0 && !reduced;
    const moving = w.drops && !paused;
    if (moving) w.time = (w.time + dt) % PERIOD;
    if (!w.wet) w.time = 0;
    return moving || hadDrops !== w.drops || oldWet !== w.wet;
  }
  function coverAt(x, z, shelters) {
    return shelters.find(s => x >= s.x - s.w/2 && x <= s.x + s.w/2 &&
      z >= s.z - s.d/2 && z <= s.z + s.d/2);
  }
  return {SPAN, HEIGHT, PERIOD, DROPS, makeRainMesh, create, step, coverAt};
});
