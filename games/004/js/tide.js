(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'));
  else root.HarbourTide = factory(root.HarbourMath, root.HarbourMesh);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G) {
  'use strict';
  const period = 180, amplitude = 0.86;
  const landing = {x: 19, z: -11.7, width: 16.8, depth: 4.1, freeboard: 0.86, gateX: 14.4};
  const phase = time => M.TAU * M.wrap(time, period) / period;
  const nextTurn = time => M.nextOccurrence(time, period / 2, period / 4);
  function heightAt(time) { return amplitude * Math.sin(phase(time)); }
  function reading(time) {
    const angle = phase(time), height = amplitude * Math.sin(angle);
    const rising = Math.cos(angle);
    const label = Math.abs(rising) < 0.1 ? (height > 0 ? 'High tide' : 'Low tide') :
      (rising > 0 ? 'Rising tide' : 'Falling tide');
    const cm = Math.round(height * 100);
    return {height, label, level: (cm < 0 ? '−' : cm > 0 ? '+' : '') + (Math.abs(cm) / 100).toFixed(2) + ' m'};
  }

  // The two spare solid-material UVs carry vertical displacement per metre of
  // tide and its derivative along z. The shader also tilts the gangway normals.
  function tidal(material, uv) { return {tile: material.tile - 4, color: material.color, uv}; }
  const afloat = material => tidal(material, [1, 0]);
  function gangway(shoreZ) {
    const start = shoreZ(landing.gateX) - 0.12;
    const end = landing.z - landing.depth / 2 + 0.32;
    const weight = z => M.clamp((z - start) / (end - start), 0, 1);
    const height = (z, tide) => M.mix(1.35, landing.freeboard + tide, weight(z));
    return {start, end, weight, height};
  }
  function addGangway(mesh, shoreZ, iron, brass) {
    const {start, end, weight, height} = gangway(shoreZ);
    const uv = point => [weight(point[2]), 1 / (end - start)];
    const frame = tidal(iron, uv), handrail = tidal(brass, uv);
    const x = landing.gateX;
    const surface = offset => [[-1, end], [1, end], [1, start], [-1, start]]
      .map(([dx, z]) => [x + dx, height(z, 0) + offset, z]);
    mesh.rings(surface(-0.14), surface(0), frame, tidal(G.solid([0.42, 0.33, 0.23]), uv));
    for (const side of [-0.96, 0.96]) {
      for (const z of [start, (start + end) / 2, end]) {
        mesh.box(x + side, height(z, 0), z, 0.075, 0.91, 0.075, frame);
      }
      for (const h of [0.48, 0.91]) {
        mesh.beam([x + side, height(start, 0) + h, start], [x + side, height(end, 0) + h, end],
          0.055, h > 0.5 ? handrail : frame);
      }
    }
  }
  function addLanding(mesh, shoreZ) {
    const {x, z, width, depth, freeboard} = landing;
    const iron = G.solid([0.16, 0.25, 0.26]), brass = G.solid([0.65, 0.47, 0.28]);
    const trim = afloat(iron), amber = afloat(G.light([1, 0.69, 0.36]));
    const teal = afloat(G.solid([0.16, 0.43, 0.39])), boards = afloat(G.solid([0.42, 0.30, 0.21]));
    const footprint = (y, w, d) => [[-w, d], [w, d], [w, -d], [-w, -d]].map(([dx, dz]) => [x + dx, y, z + dz]);
    mesh.rings(footprint(-0.38, width / 2 - 0.4, depth / 2 - 0.3),
      footprint(freeboard - 0.14, width / 2, depth / 2), trim);
    mesh.box(x, freeboard - 0.14, z, width + 0.12, 0.14, depth + 0.12, boards);
    mesh.box(x, freeboard - 0.27, z + depth / 2 - 0.04, width - 0.8, 0.095, 0.10, amber);
    for (const dx of [-7.4, -3.5, 0.4, 4.3, 7.4]) {
      mesh.box(x + dx, freeboard - 0.64, z + depth / 2, 0.36, 0.72, 0.27, trim);
    }

    // A shallow butterfly canopy catches the sky over the passenger bench.
    const shelterX = x + 2.9, span = 4.35, roofY = freeboard + 2.85;
    for (const dx of [-3.85, 3.85]) for (const dz of [-1.35, 1.35]) {
      mesh.box(shelterX + dx, freeboard, z + dz, 0.13, 2.89, 0.13, trim);
    }
    for (const side of [-1, 1]) {
      const panel = [[-span, 0], [span, 0], [span, side * 1.82], [-span, side * 1.82]]
        .map(([dx, dz]) => [shelterX + dx, roofY + Math.abs(dz) * 0.16, z + dz]);
      if (side === 1) panel.reverse();
      mesh.rings(panel, panel.map(([a, b, c]) => [a, b + 0.16, c]), teal);
      mesh.box(shelterX, roofY + 0.21, z + side * 1.74, span * 2, 0.07, 0.11, amber);
    }
    for (const dx of [-2.3, 2.3]) mesh.box(shelterX + dx, freeboard, z, 0.22, 0.48, 0.51, trim);
    mesh.box(shelterX, freeboard + 0.48, z, 6.2, 0.12, 0.72, boards);
    mesh.box(shelterX, freeboard + 0.60, z - 0.32, 6.2, 0.43, 0.13, teal);

    // Three milk teas on the seaward table for the late study group.
    const tableX = shelterX - 1.7, tableZ = z + 1.00, tableY = freeboard + 0.73;
    mesh.box(tableX, freeboard, tableZ, 0.18, 0.65, 0.18, trim);
    mesh.box(tableX, tableY - 0.08, tableZ, 1.54, 0.08, 0.70, boards);
    const porcelain = afloat(G.solid([0.85, 0.81, 0.64]));
    for (const dx of [-0.46, 0, 0.46]) {
      const ring = (h, radius) => G.horizontalRing(tableX + dx, tableY + h, tableZ, radius, 8);
      mesh.rings(ring(0, 0.115), ring(0.32, 0.156), porcelain, afloat(brass));
    }

    // Fixed guide piles and a quarter-metre staff make changes in level visible.
    for (const dx of [-width / 2 - 0.42, width / 2 + 0.42]) {
      const px = x + dx, pz = z + 1.35;
      mesh.box(px, -1.35, pz, 0.52, 4.35, 0.52, iron);
      mesh.box(px, 3.0, pz, 0.55, 0.18, 0.55, G.light([0.95, 0.65, 0.35]));
      mesh.box(px, freeboard - 0.04, pz, 0.75, 0.21, 0.75, afloat(brass));
      for (let tick = -4; tick <= 10; tick++) {
        mesh.box(px, tick / 4, pz + 0.266, tick % 4 === 0 ? 0.44 : 0.23, 0.064, 0.02,
          G.solid([0.89, 0.82, 0.65]));
      }
    }
    addGangway(mesh, shoreZ, iron, brass);
  }
  return {period, amplitude, landing, heightAt, reading, nextTurn, gangway, addLanding, afloat};
});
