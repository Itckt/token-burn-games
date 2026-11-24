(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'));
  else root.HarbourBeacon = factory(root.HarbourMath, root.HarbourMesh);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G) {
  'use strict';
  const lamp = [41, 10.2, 8], period = 32, phaseOffset = 14.5;
  const optics = {range: 78, slope: 0.17, spread: 0.069, aperture: 0.38};
  function direction(time) {
    const angle = M.TAU * (M.wrap(time, period) + phaseOffset) / period;
    return [Math.cos(angle), Math.sin(angle)];
  }
  function sector(time) {
    const [dx, dz] = direction(time);
    const bearing = M.wrap(Math.atan2(dx, -dz), M.TAU);
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing * 4 / Math.PI) % 8];
  }
  const nextBearing = time => M.nextOccurrence(time, period / 4, -phaseOffset);
  // The lower edge, axis and upper edge of the cone intersect the tide plane
  // at different ranges. The last one can fall beyond the reach of the lens.
  function waterContact(tide) {
    const height = lamp[1] - tide;
    const {range, slope, spread, aperture} = optics;
    return [(height - aperture) / (slope + spread), height / slope, (height + aperture) / (slope - spread)]
      .map(distance => M.clamp(distance, 0, range));
  }
  function addTower(mesh) {
    const [x, y, z] = lamp;
    const stone = G.solid([0.28, 0.32, 0.32]), salt = G.solid([0.79, 0.75, 0.61]);
    const painted = G.solid([0.65, 0.24, 0.16]), iron = G.solid([0.12, 0.23, 0.24]);
    const brass = G.solid([0.64, 0.45, 0.25]), honey = G.light([1, 0.78, 0.40]);
    const rim = (h, radius, sides) => G.horizontalRing(x, h, z, radius, sides);
    function drum(base, top, r1, r2, paint, sides) {
      mesh.rings(rim(base, r1, sides), rim(top, r2, sides), paint);
    }
    // A tide-stained stepped caisson supports the narrower masonry tower.
    drum(-1.8, 1.38, 3.72, 3.39, stone);
    drum(1.38, 1.70, 3.50, 3.50, salt);
    drum(1.70, 2.20, 2.04, 1.88, iron);
    drum(2.20, 4.88, 1.69, 1.43, salt);
    drum(4.88, 6.4, 1.43, 1.29, painted);
    drum(6.4, 8.45, 1.29, 1.15, salt);
    mesh.box(x, 1.75, z + 1.52, 0.84, 1.83, 0.28, iron);
    mesh.box(x, 3.59, z + 1.46, 1.02, 0.12, 0.45, brass);
    mesh.box(x, 7.0, z + 1.22, 0.47, 0.61, 0.11, honey);
    drum(8.45, 8.91, 1.16, 2.0, iron);
    drum(8.91, 9.08, 2.0, 2.0, brass);
    const posts = rim(9.08, 1.89);
    const rail = rim(9.89, 1.89);
    for (let i = 0; i < posts.length; i++) {
      mesh.beam(posts[i], rail[i], 0.046, iron);
      mesh.beam(rail[i], rail[(i + 1) % rail.length], 0.051, brass);
    }
    drum(9.08, 9.48, 1.35, 1.24, painted, 8);
    drum(9.54, 10.91, 0.62, 0.62, honey, 12);
    for (const h of [9.76, 10.09, 10.40, 10.72]) drum(h, h + 0.061, 0.67, 0.67, brass);
    for (const [px,,pz] of rim(0, 1.19, 8)) mesh.beam([px,9.45,pz], [px,11.04,pz], 0.064, iron);
    drum(11.01, 11.20, 1.51, 1.57, iron, 8);
    drum(11.20, 12.13, 1.57, 0.25, painted, 8);
    mesh.beam([x,12.1,z], [x,12.79,z], 0.083, brass, 6);
    for (const dx of [-0.27, 0.27]) mesh.beam([x+dx,-1.1,z+3.59], [x+dx,2.46,z+3.59], 0.063, brass);
    for (let i = 0; i < 10; i++) {
      const h = -0.87 + i * 0.34;
      mesh.beam([x-0.27,h,z+3.59], [x+0.27,h,z+3.59], 0.049, brass);
    }
  }
  // A shaft facing the observer, a lens flare and a pool lying on the water.
  function buildBeam() {
    return [{vertices: new Float32Array([
      0,-1,0, 1,-1,0, 1,1,0, 0,1,0,
      -1,-1,1, 1,-1,1, 1,1,1, -1,1,1,
      0,-1,2, 1,-1,2, 1,1,2, 0,1,2
    ]), indices: new Uint16Array([0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11])}];
  }
  return {lamp, optics, period, direction, sector, nextBearing, waterContact, addTower, buildBeam};
});
