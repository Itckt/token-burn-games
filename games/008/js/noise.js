(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.FieldAtlas ||= {}).noise = factory();
})(globalThis, function () {
  "use strict";

  function seedNumber(text) {
    let hash = 2166136261;
    for (const ch of String(text)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
    return hash >>> 0;
  }
  function scramble(value) {
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  }
  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x9e3779b9) >>> 0;
      return scramble(state) / 4294967296;
    };
  }
  const diagonal = Math.SQRT1_2;
  const gx = [1, -1, 0, 0, diagonal, -diagonal, diagonal, -diagonal];
  const gy = [0, 0, 1, -1, diagonal, diagonal, -diagonal, -diagonal];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function gradientNoise(seed) {
    function gradient(ix, iy, dx, dy) {
      const i = scramble(seed ^ Math.imul(ix, 0x1f1f1f1f) ^ Math.imul(iy, 0x6c8e9cf5)) & 7;
      return gx[i] * dx + gy[i] * dy;
    }
    return (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const dx = x - ix, dy = y - iy, u = fade(dx), v = fade(dy);
      const a = gradient(ix, iy, dx, dy), b = gradient(ix + 1, iy, dx - 1, dy);
      const c = gradient(ix, iy + 1, dx, dy - 1), d = gradient(ix + 1, iy + 1, dx - 1, dy - 1);
      const low = a + u * (b - a), high = c + u * (d - c);
      return 1.42 * (low + v * (high - low));
    };
  }
  // Rotate successive octaves so the lattice axes do not accumulate into straight ridges.
  function fractal(noise, x, y, octaves = 4) {
    let total = 0, weights = 0, amplitude = 1;
    for (let i = 0; i < octaves; i++) {
      total += noise(x, y) * amplitude;
      weights += amplitude;
      const nextX = 1.64 * x - 1.19 * y + 13.1;
      y = 1.19 * x + 1.64 * y - 7.4;
      x = nextX;
      amplitude *= 0.51;
    }
    return weights ? total / weights : 0;
  }
  return { seedNumber, scramble, random, gradientNoise, fractal };
});
