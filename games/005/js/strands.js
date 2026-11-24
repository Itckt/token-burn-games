(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./math.js'), require('./meshes.js'), require('./packing.js'));
  } else root.CupStrands = factory(root.CupMath, root.CupMeshes, root.CupPacking);
})(globalThis, function (M, G, P) {
  'use strict';

  // A sloping segment gains submerged length at a constant rate between its
  // endpoints. A level segment enters the pool all at once. Sweep those events
  // once so a moving waterline needs only a binary search and interpolation.
  function immersionProfile(strands) {
    const events = new Map();
    function event(height) {
      if (!events.has(height)) events.set(height, {height, change:0, levelLength:0});
      return events.get(height);
    }
    let total = 0;
    for (const {path, closed} of strands) {
      const count = closed ? path.length : path.length - 1;
      for (let i = 0; i < count; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const length = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
        if (!Number.isFinite(length)) throw new RangeError('Strand coordinates must be finite');
        if (length === 0) continue;
        const low = Math.min(a[1], b[1]), high = Math.max(a[1], b[1]);
        total += length;
        if (low === high) event(low).levelLength += length;
        else {
          const rate = length / (high - low);
          event(low).change += rate;
          event(high).change -= rate;
        }
      }
    }
    if (!total) throw new RangeError('The specimen needs measurable strand length');
    const ordered = [...events.values()].sort((a,b) => a.height - b.height);
    let previous = ordered[0].height, length = 0, rate = 0;
    const knots = ordered.map(e => {
      length += rate * (e.height - previous) + e.levelLength;
      rate += e.change;
      previous = e.height;
      return {height:e.height, length, rate};
    });
    knots.at(-1).length = total;
    return {knots, total};
  }

  function lowerBound(items, predicate) {
    let lo = 0, hi = items.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (predicate(items[mid])) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  function fractionBelow({knots, total}, height) {
    if (!(height >= knots[0].height)) return 0;
    if (height >= knots.at(-1).height) return 1;
    const k = knots[lowerBound(knots, p => p.height > height) - 1];
    return M.clamp((k.length + k.rate * (height - k.height)) / total, 0, 1);
  }
  function heightAtFraction({knots, total}, fraction) {
    if (!(fraction > 0)) return knots[0].height;
    if (fraction >= 1) return knots.at(-1).height;
    const target = total * fraction;
    const i = lowerBound(knots, p => p.length >= target);
    if (i === 0) return knots[0].height;
    const prev = knots[i-1], end = knots[i].height;
    return prev.rate > 0 ? Math.min(end, prev.height + (target - prev.length) / prev.rate) : end;
  }

  function track(strand, softness) {
    const soft = M.clamp(Number.isFinite(softness) ? softness : 0, 0, 1);
    const dry = strand.path[strand.mark], wet = strand.wet[strand.mark];
    const point = dry.map((v,i) => M.lerp(v, wet[i], soft));
    const packedMM = (dry[1] - G.FLOOR) * P.mmPerUnit;
    const heightMM = (point[1] - G.FLOOR) * P.mmPerUnit;
    return {strand, soft, point, packedMM, heightMM, dropMM:packedMM-heightMM};
  }
  return {immersionProfile, fractionBelow, heightAtFraction, track};
});
