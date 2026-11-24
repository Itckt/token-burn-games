(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./terrain"));
  else root.FieldAtlas.erosion = factory(root.FieldAtlas.terrain);
})(globalThis, function (T) {
  "use strict";

  const settings = {
    fresh: { passes: 0 },
    talus: { passes: 24, grade: 0.54 },
    worn: { passes: 64, grade: 0.30 }
  };

  function weatherGrid(original, setting) {
    if (!Object.hasOwn(settings, setting)) throw new RangeError("Unknown weathering setting");
    const { passes, grade } = settings[setting];
    if (!passes) return original;
    const { side, step } = original;
    const bed = Float64Array.from(original.heights), change = new Float64Array(bed.length);
    const faces = new Uint8Array(bed.length);
    T.visitTriangles(original, (a, b, c) => { faces[a]++; faces[b]++; faces[c]++; });
    const rise = grade * step, diagonalRise = rise * Math.SQRT2;

    function exchange(a, b) {
      const span = Math.abs(a - b);
      const limit = span === 1 || span === side ? rise : diagonalRise;
      const drop = bed[a] - bed[b];
      if (Math.abs(drop) <= limit) return;
      const sediment = 0.24 * (drop - Math.sign(drop) * limit);
      change[a] -= sediment;
      change[b] += sediment;
    }
    // All fluxes use the previous bed. A vertex's share of the physical surface
    // area is proportional to its incident face count, including at the boundary.
    for (let pass = 0; pass < passes; pass++) {
      change.fill(0);
      T.visitTriangles(original, (a, b, c) => { exchange(a, b); exchange(b, c); exchange(c, a); });
      for (let i = 0; i < bed.length; i++) bed[i] += change[i] / faces[i];
    }
    return original.withHeights(Float32Array.from(bed));
  }
  return { weatherGrid };
});
