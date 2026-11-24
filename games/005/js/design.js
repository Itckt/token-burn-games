(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./math.js'), require('./meshes.js'), require('./packing.js'));
  } else root.CupDesign = factory(root.CupMath, root.CupMeshes, root.CupPacking);
})(globalThis, function (M, G, P) {
  'use strict';
  const closeMM = 0.5, nearMM = 2, sectors = 24;
  // Keep a small positive clearance distinct from contact in a 0.1 mm readout.
  const gapLabel = mm => mm > 1e-9 && mm < 0.05 ? '<0.1 mm' : mm.toFixed(1)+' mm';

  const minMassG = 20, maxMassG = 100, defaultMassG = 80;
  // A free-body diagram of a rigid block in a symmetric, frictionless section.
  // The two wall resultants are perpendicular to the lining. Their horizontal
  // components cancel and their vertical components sum to the weight.
  function supportForces(fit, massG = defaultMassG) {
    massG = M.clamp(Number.isFinite(massG) ? massG : defaultMassG, minMassG, maxMassG);
    const weightN = massG * 9.81 / 1000;
    const upN = fit.onFloor ? weightN : weightN / 2;
    const inwardN = fit.onFloor ? 0 : upN / (G.wallSlope * fit.taper);
    const reactionN = Math.hypot(upN, inwardN);
    const mid = (fit.top + fit.bottom) / 2;
    // Direction arrows use a fixed drawing length. Magnitudes are given in N.
    const arrows = [{kind:'weight', tail:[0,mid+0.62,0], tip:[0,mid,0]}];
    if (fit.onFloor) {
      arrows.push({kind:'support', tail:[0,G.FLOOR,0], tip:[0,G.FLOOR+0.28,0]});
    } else {
      const r = G.innerRadiusAt(fit.contactY,fit.taper);
      for (const side of [-1,1]) {
        const x = side * r, y = fit.contactY;
        arrows.push({kind:'support', tail:[x,y,0],
          tip:[x-side*0.64*inwardN/reactionN, y+0.64*upN/reactionN, 0]});
      }
    }
    return {massG, weightN, upN, inwardN, reactionN, arrows};
  }

  // Each sector records the least horizontal distance from a dry mesh vertex
  // to the lining at the same height. Angles use the seated block's rotation.
  function wallMap(mesh, fit) {
    const gaps = Array(sectors).fill(null), v = mesh.vertices;
    for (let i = 0; i < v.length; i += G.STRIDE) {
      const angle = Math.atan2(v[i],v[i+2]) + fit.rotation;
      const turn = angle / M.TAU;
      const bin = Math.min(sectors - 1, Math.floor((turn - Math.floor(turn)) * sectors));
      const height = v[i+1] * fit.scale + fit.offsetY;
      const radius = Math.hypot(v[i],v[i+2]) * fit.scale;
      const gap = Math.max(0, (G.innerRadiusAt(height,fit.taper) - radius) * P.mmPerUnit);
      if (gaps[bin] === null || gap < gaps[bin]) gaps[bin] = gap;
    }
    const measured = gaps.filter(mm => mm !== null);
    return {gaps, closestMM:Math.min(...measured), closeCount:measured.filter(mm => mm <= closeMM).length};
  }

  // These two readings depend on cup shape and diameter alone. Moving a
  // target across the chart can reuse the same 23 physical measurements.
  function measureSizes(profile, taper) {
    const sizes = [];
    for (let diameter = P.minDiameter; diameter <= P.maxDiameter; diameter++) {
      const fit = P.fit(profile,diameter,taper);
      sizes.push({diameter, capacityML:P.volumeBelow(fit.bottom,fit.taper), headroomMM:(G.HEIGHT-fit.top)*P.mmPerUnit});
    }
    return sizes;
  }
  const defaultPocketML = 100, defaultRoomMM = 30, maxPocketML = 250, maxRoomMM = 100;
  function findFits(sizes, pocketML = defaultPocketML, roomMM = defaultRoomMM) {
    pocketML = M.clamp(Number.isFinite(pocketML) ? pocketML : defaultPocketML, 0, maxPocketML);
    roomMM = M.clamp(Number.isFinite(roomMM) ? roomMM : defaultRoomMM, 0, maxRoomMM);
    const matches = sizes.filter(s => s.capacityML >= pocketML && s.headroomMM >= roomMM);
    return {sizes, matches, pocketML, roomMM};
  }
  return {wallMap, gapLabel, closeMM, nearMM, sectors, measureSizes, findFits, defaultPocketML, defaultRoomMM, maxPocketML, maxRoomMM,
    supportForces, minMassG, maxMassG, defaultMassG};
});
