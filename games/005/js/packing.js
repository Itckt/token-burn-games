(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./meshes.js'));
  else root.CupPacking = factory(root.CupMath, root.CupMeshes);
})(globalThis, function (M, G) {
  'use strict';
  const minDiameter = 72, maxDiameter = 94, defaultDiameter = 88;
  const mmPerUnit = 100 / (G.HEIGHT - G.FLOOR);
  const mlPerCubicUnit = mmPerUnit ** 3 / 1000;
  const maxPressMM = 8;
  const boundedTaper = value => M.clamp(Number.isFinite(value) ? value : 1, 0, 1);

  // A vertex can bound an intermediate pose only if another vertex does not
  // already beat it in both endpoint poses. Keep just those candidates.
  function heightLimits(vertices, wet, order) {
    const dryY = i => vertices[i*G.STRIDE+1], wetY = i => wet[i*6+1];
    const lower = [], upper = [];
    let low = Infinity, high = -Infinity;
    for (let j = 0; j < order.length; j++) {
      const a = order[j], b = order[order.length-j-1];
      if (wetY(a) < low) { low = wetY(a); lower.push([dryY(a), low]); }
      if (wetY(b) > high) { high = wetY(b); upper.push([dryY(b), high]); }
    }
    return {lower, upper};
  }

  function posedBounds(profile, soft) {
    if (soft === 0) return {bottom:profile.bottom, top:profile.top};
    if (soft === 1 || !profile.limits) return {
      bottom:M.lerp(profile.bottom, profile.wetBottom ?? profile.bottom, soft),
      top:M.lerp(profile.top, profile.wetTop ?? profile.top, soft)
    };
    let bottom = Infinity, top = -Infinity;
    for (const [dry,wet] of profile.limits.lower) bottom = Math.min(bottom, M.lerp(dry,wet,soft));
    for (const [dry,wet] of profile.limits.upper) top = Math.max(top, M.lerp(dry,wet,soft));
    return {bottom, top};
  }

  // For any linear taper, the vertex with the largest r - slope*y touches
  // the lining first as the cake descends.
  function measure(mesh) {
    const v = mesh.vertices, wet = mesh.hydrated;
    if (!v.length || v.length % G.STRIDE || (wet && wet.length !== v.length / G.STRIDE * 6)) {
      throw new RangeError('A complete strand mesh is required');
    }
    let bottom = Infinity, top = -Infinity, radius = 0, intercept = -Infinity;
    let wetBottom = Infinity, wetTop = -Infinity;
    let contactIndex = 0, bottomIndex = 0;
    const radii = new Float64Array(v.length / G.STRIDE);
    for (let i = 0; i < v.length; i += G.STRIDE) {
      const r = Math.hypot(v[i], v[i + 2]), y = v[i + 1];
      radii[i / G.STRIDE] = r;
      const wetY = wet ? wet[i / G.STRIDE * 6 + 1] : y;
      if (!Number.isFinite(r) || !Number.isFinite(y) || !Number.isFinite(wetY)) {
        throw new RangeError('Block dimensions must be finite');
      }
      wetBottom = Math.min(wetBottom, wetY);
      wetTop = Math.max(wetTop, wetY);
      radius = Math.max(radius, r);
      if (y < bottom) { bottom = y; bottomIndex = i; }
      top = Math.max(top, y);
      if (r - G.wallSlope * y > intercept) {
        intercept = r - G.wallSlope * y;
        contactIndex = i;
      }
    }
    if (!(radius > 0 && top > bottom)) throw new RangeError('The block needs a width and a thickness');
    // Keep the widest point in each height band for the illustrated cross section.
    // Include both tips and the support point even if their bands are wider elsewhere.
    const bands = Array(12), outline = [];
    const order = Array.from(radii.keys()).sort((a,b) => v[a*G.STRIDE+1] - v[b*G.STRIDE+1] || radii[b] - radii[a]);
    const supports = [];
    let widest = -Infinity;
    for (const index of order) {
      const i = index * G.STRIDE, y = v[i + 1], r = radii[index];
      // A higher point can only touch first if it projects farther out.
      if (r > widest) {
        supports.push({radius:r, point:Array.from(v.subarray(i,i+3))});
        widest = r;
      }
      const band = Math.min(bands.length - 1, Math.floor(bands.length * (y - bottom) / (top - bottom)));
      if (!bands[band] || r > bands[band][0]) bands[band] = [r, y];
      if (y === bottom || y === top || i === contactIndex) outline.push([r, y]);
    }
    outline.push(...bands.filter(Boolean));
    outline.sort((a,b) => a[1] - b[1] || b[0] - a[0]);
    return {bottom, top, wetBottom, wetTop, radius, intercept, supports, limits:wet ? heightLimits(v,wet,order) : null,
      lowestPoint:Array.from(v.subarray(bottomIndex,bottomIndex+3)), contact: Array.from(v.subarray(contactIndex, contactIndex + 3)),
      outline: outline.filter((p,i) => !i || p[1] !== outline[i-1][1])};
  }

  function fit(profile, width = defaultDiameter, taper = 1) {
    const diameter = M.clamp(Number.isFinite(width) ? width : defaultDiameter, minDiameter, maxDiameter);
    taper = boundedTaper(taper);
    const slope = G.wallSlope * taper;
    const scale = diameter / (2 * profile.radius * mmPerUnit);
    let {intercept, contact} = profile;
    if (taper !== 1) {
      intercept = -Infinity;
      for (const {radius, point} of profile.supports) {
        const reach = radius - slope * point[1];
        if (reach > intercept) { intercept = reach; contact = point; }
      }
    }
    const wallGapAtFloor = G.innerRadiusAt(G.FLOOR,taper) - scale * (intercept + slope * profile.bottom);
    const onFloor = wallGapAtFloor >= 0;
    // Every selectable diameter fits through the rim. At zero slope the
    // floor always wins, so no division is needed in the cylindrical limit.
    const rise = onFloor ? 0 : -wallGapAtFloor / slope;
    const bottom = G.FLOOR + rise, offsetY = bottom - scale * profile.bottom;
    // Turn the contact point towards the exposed edge so its height is visible.
    const [x, y, z] = contact;
    let outline = profile.outline;
    if (contact !== profile.contact) {
      const point = [Math.hypot(x,z),y];
      outline = [...outline.filter(p => p[1] !== y), point].sort((a,b) => a[1]-b[1]);
    }
    return {
      diameter, taper, scale, offsetY, contact, rotation: G.EDGE_R + 0.015 - Math.atan2(x, z),
      bottom, top: profile.top * scale + offsetY, contactY: y * scale + offsetY,
      gapMM: rise * mmPerUnit, onFloor,
      outline: outline.map(([r,h]) => [r * scale, h * scale + offsetY])
    };
  }

  // Below the lowest curl, all the space inside the circular taper is available.
  function volumeBelow(height, taper = 1) {
    const top = M.clamp(Number.isFinite(height) ? height : G.FLOOR, G.FLOOR, G.HEIGHT);
    taper = boundedTaper(taper);
    const r = G.innerRadiusAt(top,taper), floorRadius = G.innerRadiusAt(G.FLOOR,taper);
    return Math.PI * (top - G.FLOOR) / 3 *
      (floorRadius ** 2 + floorRadius * r + r ** 2) * mlPerCubicUnit;
  }

  function heightAtVolume(doseML, taper = 1) {
    taper = boundedTaper(taper);
    const amount = M.clamp(Number.isFinite(doseML) ? doseML : 0, 0, volumeBelow(G.HEIGHT,taper));
    const volume = amount / mlPerCubicUnit;
    // Solve the frustum volume for its upper radius, then for depth. This form
    // also resolves a tiny dose without subtracting two nearly equal radii.
    const floorRadius = G.innerRadiusAt(G.FLOOR,taper);
    const r = Math.cbrt(floorRadius ** 3 + 3 * G.wallSlope * taper * volume / Math.PI);
    const depth = 3 * volume / (Math.PI * (floorRadius ** 2 + floorRadius * r + r ** 2));
    return Math.min(G.HEIGHT, G.FLOOR + depth);
  }

  function meteredPour(fit, doseML) {
    const capacityML = volumeBelow(fit.bottom,fit.taper);
    const amountML = M.clamp(Number.isFinite(doseML) ? doseML : 0, 0, capacityML);
    const surfaceY = amountML === capacityML ? fit.bottom : heightAtVolume(amountML,fit.taper);
    return {amountML, capacityML, surfaceY, depthMM:(surfaceY - G.FLOOR) * mmPerUnit};
  }

  // A level test pad spans the inside of the cup. Its travel first uses up
  // clearance, then lifts the rigid specimen straight out of its seat.
  function press(fit, requestedMM) {
    const travelMM = M.clamp(Number.isFinite(requestedMM) ? requestedMM : 0, 0, maxPressMM);
    const liftMM = Math.max(0, travelMM - fit.gapMM);
    const clearanceMM = Math.max(0, fit.gapMM - travelMM);
    return {travelMM, liftMM, clearanceMM, touching:travelMM >= fit.gapMM,
      rise:travelMM / mmPerUnit, lift:liftMM / mmPerUnit, surfaceY:G.FLOOR + travelMM / mmPerUnit};
  }
  return {minDiameter, maxDiameter, defaultDiameter, mmPerUnit, measure, posedBounds, fit, volumeBelow, heightAtVolume, meteredPour, maxPressMM, press};
});
