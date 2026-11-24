(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { randomSource } = common ? require("./storm.js") : root.Isobar.storm;
  const { clamp, mix, TAU } = common ? require("./math.js") : root.Isobar.math;
  const smooth = t => t * t * (3 - 2 * t);

  function noiseSource(random) {
    const table = Float32Array.from({ length: 128 * 128 }, random);
    return function noise(x, y, period = 128) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const ax = smooth(x - ix), ay = smooth(y - iy);
      const mask = period - 1;
      const x0 = ix & mask, x1 = (ix + 1) & mask;
      const y0 = (iy & mask) * 128, y1 = ((iy + 1) & mask) * 128;
      return mix(mix(table[y0 + x0], table[y0 + x1], ax), mix(table[y1 + x0], table[y1 + x1], ax), ay);
    };
  }

  function oceanNoise(size = 128) {
    const noise = noiseSource(randomSource(0x0cea42));
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        const octave = (f, shift) => noise(u * f + shift, v * f, f);
        const i = (y * size + x) * 4;
        data[i] = 255 * (0.54 * octave(8, 0) + 0.30 * octave(16, 5) + 0.16 * octave(32, 9));
        data[i + 1] = 255 * (0.62 * octave(4, 1) + 0.25 * octave(16, 11) + 0.13 * octave(64, 17));
        data[i + 2] = 255 * octave(64, 23);
        data[i + 3] = 255;
      }
    }
    return { width: size, height: size, data };
  }

  // Build four different billows. RG encodes surface normals, B encodes
  // small-scale albedo and A encodes optical thickness at the ragged edges.
  function cloudAtlas(tileSize = 128) {
    const random = randomSource(0xc10dd5);
    const noise = noiseSource(random);
    const width = tileSize * 2;
    const data = new Uint8Array(width * width * 4);
    const height = new Float32Array(tileSize * tileSize);
    const alpha = new Float32Array(height.length);
    const tone = new Float32Array(height.length);
    const step = 2 / tileSize;
    for (let tile = 0; tile < 4; tile++) {
      const lobes = [{ x: 0, y: 0, r: 0.62, z: 0.03 }];
      for (let i = 0; i < 19; i++) {
        const angle = i * TAU / 8.2 + random() * 0.49;
        const spread = i < 9 ? 0.37 + 0.10 * random() : 0.57 * Math.sqrt(random());
        lobes.push({ x: spread * Math.cos(angle), y: spread * Math.sin(angle),
          r: i < 9 ? 0.31 + 0.12 * random() : 0.13 + 0.22 * random(),
          z: i < 9 ? 0.03 + 0.16 * random() : 0.22 + 0.21 * random() });
      }
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const px = (x + 0.5) * step - 1, py = (y + 0.5) * step - 1;
          const sx = px + tile * 7.6, sy = py + tile * 3.2;
          const n1 = noise(sx * 3.8, sy * 3.8);
          const n2 = noise(sx * 9.4 + 6.3, sy * 9.4 + 2.4);
          const n3 = noise(sx * 23.2, sy * 23.2 + 3.8);
          const wx = px + (n1 - 0.5) * 0.17 + (n3 - 0.5) * 0.031;
          const wy = py + (noise(sx * 4.2 + 3.4, sy * 4.2) - 0.5) * 0.18;
          let surface = 0, edge = -1;
          for (const lobe of lobes) {
            const dx = wx - lobe.x, dy = wy - lobe.y;
            const distance2 = dx * dx + dy * dy;
            const radial = lobe.r * lobe.r - distance2;
            edge = Math.max(edge, radial / (2 * lobe.r));
            if (radial > 0) {
              const dome = Math.sqrt(radial) + lobe.z * smooth(Math.min(1, radial * 18));
              const blend = Math.max(0, 0.082 - Math.abs(surface - dome));
              surface = Math.max(surface, dome) + blend * blend / 0.328;
            }
          }
          const i = y * tileSize + x;
          height[i] = surface + 0.19 * n1 + 0.078 * n2 + 0.028 * n3;
          const border = clamp((0.98 - Math.max(Math.abs(px), Math.abs(py))) / 0.09, 0, 1);
          alpha[i] = smooth(clamp((edge + 0.040 + (n2 - 0.5) * 0.071) / 0.19, 0, 1)) * border;
          tone[i] = 0.41 * n1 + 0.36 * n2 + 0.23 * n3;
        }
      }
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const i = y * tileSize + x;
          const dx = (height[y * tileSize + Math.max(0, x - 1)] - height[y * tileSize + Math.min(tileSize - 1, x + 1)]) / (2 * step);
          const dy = (height[Math.max(0, y - 1) * tileSize + x] - height[Math.min(tileSize - 1, y + 1) * tileSize + x]) / (2 * step);
          const inv = 1 / Math.hypot(dx, dy, 1);
          const out = ((y + (tile >> 1) * tileSize) * width + x + (tile & 1) * tileSize) * 4;
          data[out] = (0.5 + 0.5 * dx * inv) * 255;
          data[out + 1] = (0.5 + 0.5 * dy * inv) * 255;
          data[out + 2] = tone[i] * 255;
          data[out + 3] = alpha[i] * 255;
        }
      }
    }
    return { width, height: width, data };
  }

  const api = { noiseSource, oceanNoise, cloudAtlas };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).textures = api;
})(globalThis);
