(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./meshes.js'), require('./packing.js'));
  } else root.CupSlices = factory(root.CupMeshes, root.CupPacking);
})(globalThis, function (G, P) {
  'use strict';

  // Intersect each triangle with a horizontal plane in mesh coordinates.
  // Classifying points on the plane with the lower half gives a consistent
  // edge at a vertex and skips coplanar faces. Each pair of points is a stroke.
  function intersect(mesh, level) {
    const {vertices, indices} = mesh, strokes = [];
    function point(a, b) {
      const t = (level - vertices[a+1]) / (vertices[b+1] - vertices[a+1]);
      return [vertices[a] + t * (vertices[b] - vertices[a]),
        vertices[a+2] + t * (vertices[b+2] - vertices[a+2])];
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * G.STRIDE, b = indices[i+1] * G.STRIDE, c = indices[i+2] * G.STRIDE;
      const aboveA = vertices[a+1] > level, aboveB = vertices[b+1] > level, aboveC = vertices[c+1] > level;
      if (aboveA === aboveB && aboveA === aboveC) continue;
      // Both crossed edges meet at the vertex on its own side of the plane.
      const lone = aboveA === aboveB ? c : aboveA === aboveC ? b : a;
      const p = point(lone, lone === a ? b : a), q = point(lone, lone === c ? b : c);
      if (p[0] !== q[0] || p[1] !== q[1]) strokes.push(...p, ...q);
    }
    return strokes;
  }

  function scan(mesh, fit, heightMM) {
    const mm = Math.min(100, Math.max(0, Number.isFinite(heightMM) ? heightMM : 50));
    const height = G.FLOOR + mm / P.mmPerUnit;
    const inBlock = height >= fit.bottom && height <= fit.top;
    const strokes = inBlock ? intersect(mesh, (height - fit.offsetY) / fit.scale) : [];
    // Apply the same seating rotation and scale as the WebGL block transform.
    const cos = Math.cos(fit.rotation) * fit.scale, sin = Math.sin(fit.rotation) * fit.scale;
    for (let i = 0; i < strokes.length; i += 2) {
      const x = strokes[i], z = strokes[i+1];
      strokes[i] = cos * x + sin * z;
      strokes[i+1] = cos * z - sin * x;
    }
    let region = 'Between strands';
    if (mm === 0) region = fit.onFloor ? 'Floor contact' : 'Cup floor';
    else if (height < fit.bottom) region = 'Air pocket';
    else if (height > fit.top) region = 'Above the block';
    else if (strokes.length) region = 'Noodle contours';
    const heightLabel = mm > 0 && mm < 0.0005 ? '<0.001 mm' : Number(mm.toFixed(3))+' mm';
    return {height, heightMM:mm, heightLabel, radius:G.innerRadiusAt(height,fit.taper), region, strokes};
  }
  return {intersect, scan};
});
