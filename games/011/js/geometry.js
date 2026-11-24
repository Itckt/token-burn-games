(function (root) {
  "use strict";
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  const plane = () => new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]);

  function writeIndices(indices, order) {
    for (let i = 0; i < order.length; i++) {
      const vertex = order[i] * 4;
      const index = i * 6;
      indices[index] = vertex;
      indices[index + 1] = vertex + 1;
      indices[index + 2] = vertex + 2;
      indices[index + 3] = vertex;
      indices[index + 4] = vertex + 2;
      indices[index + 5] = vertex + 3;
    }
    return indices;
  }

  function billboards(particles) {
    if (particles.length > 16384) throw new RangeError("Too many quads for 16-bit indices");
    const profiles = new Float32Array(particles.length * 4 * 6);
    let cursor = 0;
    for (const particle of particles) {
      for (let k = 0; k < 4; k++) {
        profiles[cursor++] = corners[2 * k];
        profiles[cursor++] = corners[2 * k + 1];
        profiles[cursor++] = particle.size;
        profiles[cursor++] = particle.stretch;
        profiles[cursor++] = particle.tile;
        profiles[cursor++] = particle.variation;
      }
    }
    const indices = new Uint16Array(particles.length * 6);
    writeIndices(indices, particles.map((_, i) => i));
    return { profiles, indices };
  }

  const api = { plane, billboards, writeIndices };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Isobar ||= {}).geometry = api;
})(globalThis);
