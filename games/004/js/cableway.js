(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'));
  else root.HarbourCableway = factory(root.HarbourMath, root.HarbourMesh);
})(globalThis, function (M, G) {
  'use strict';
  const stations = [
    {name: 'Eave Street', x: 19, y: 29, z: -32},
    {name: 'Porcelain Rise', x: 81, y: 60, z: -52}
  ];
  const [lower, upper] = stations;
  const span = Math.hypot(upper.x - lower.x, upper.z - lower.z);
  const alongX = (upper.x - lower.x) / span, alongZ = (upper.z - lower.z) / span;
  const angle = Math.atan2(alongZ, alongX);
  const laneOffset = 2.42, sag = 3.8, floorDrop = 4.36, doorTravel = 0.71;
  const sheaveTile = -9;
  const dwell = 6, travel = 38, leg = dwell + travel, offset = 16;
  const period = 2 * leg;
  const nextArrival = time => M.nextOccurrence(time, leg, -offset);
  const jade = G.solid([0.13, 0.48, 0.43]), iron = G.solid([0.14, 0.23, 0.25]);
  const limestone = G.solid([0.65, 0.61, 0.50]), brass = G.solid([0.71, 0.51, 0.30]);
  const glass = G.light([0.96, 0.77, 0.49]), rim = G.light([0.48, 0.85, 0.76]);

  // Coordinates along and across the tracks, in metres. Both ropes use the same sag.
  function point(along, y, across) {
    return [lower.x + alongX * along - alongZ * across, y, lower.z + alongZ * along + alongX * across];
  }
  function ropeHeight(t) { return M.mix(lower.y, upper.y, t) - 4 * sag * t * (1 - t); }
  // Measure the drawn rope once. Coupled cars must take up equal lengths of cable
  // even when one is on the steep end of the span and the other on the shallow end.
  const rope = [{along:0, y:lower.y, distance:0}];
  for (let i = 1; i <= 24; i++) {
    const along = span * i / 24, y = ropeHeight(i / 24), last = rope[i-1];
    rope.push({along, y, distance:last.distance + Math.hypot(along-last.along, y-last.y)});
  }
  const cableLength = rope[rope.length - 1].distance;
  function grip(fraction, lane) {
    const distance = M.clamp(fraction, 0, 1) * cableLength;
    const i = Math.max(1, rope.findIndex(knot => knot.distance >= distance));
    const a = rope[i-1], b = rope[i], t = (distance - a.distance) / (b.distance - a.distance);
    return point(M.mix(a.along, b.along, t), M.mix(a.y, b.y, t), lane * laneOffset);
  }
  const sheaveAngle = fraction => -fraction * cableLength / laneOffset;
  function car(time, returning = false) {
    const arrival = nextArrival(time) - leg;
    const elapsed = time - arrival;
    const fromUpper = (M.wrap(arrival + offset, period) === leg) !== returning;
    const progress = M.ease((elapsed - dwell) / travel);
    const fraction = fromUpper ? 1 - progress : progress;
    const [x, y, z] = grip(fraction, returning ? -1 : 1);
    const at = time < arrival + dwell ? stations[Number(fromUpper)].name : null;
    // The paired leaves open after arrival and close before the car moves.
    const doors = M.ease(elapsed / 1.2) * (1 - M.ease((elapsed - dwell + 1.2) / 1.2));
    return {x, y: y - floorDrop, z, angle, fraction, doors, at, next: stations[Number(!fromUpper)].name};
  }

  // Fit the seeded town around the terminals. Under the line, low roofs can stay.
  // Project a padded lot onto the track axes, including projecting signs and eaves.
  function roofLimit(lot) {
    const dx = lot.x - lower.x, dz = lot.z - lower.z;
    const hw = lot.width / 2 + 1, hd = lot.depth / 2 + 2.3;
    const along = dx * alongX + dz * alongZ, across = -dx * alongZ + dz * alongX;
    const extent = hw * Math.abs(alongX) + hd * Math.abs(alongZ);
    const side = hw * Math.abs(alongZ) + hd * Math.abs(alongX);
    if (Math.abs(across) <= side + 5.9 &&
        (Math.abs(along) <= extent + 4.4 || Math.abs(along - span) <= extent + 4.4)) return 0;
    if (Math.abs(across) > side + laneOffset + 1.17 || along + extent < -1.85 || along - extent > span + 1.85) return Infinity;
    const floor = ropeHeight(M.clamp((along - extent - 1.85) / span, 0, 1)) - floorDrop;
    return (floor - 6.8) / (lot.setback ? 1.16 : 1);
  }

  function addSheave(mesh, along, y, end) {
    const hub = along + end * 1.55;
    const center = point(hub, y, 0);
    const pivot = [center[0], center[2]];
    const wheel = {tile:sheaveTile, color:brass.color, uv:pivot}, spoke = {...wheel, color:iron.color};
    const rimPoint = i => point(hub + laneOffset * Math.cos(i * M.TAU / 16), y, laneOffset * Math.sin(i * M.TAU / 16));
    mesh.beam(center, point(hub, y + 0.60, 0), 0.21, iron, 8);
    for (let i = 0; i < 16; i++) {
      mesh.beam(rimPoint(i), rimPoint(i + 1), 0.11, wheel, 6);
      if (i % 4 === 0) mesh.beam(center, rimPoint(i), 0.085, spoke);
    }
    for (const lane of [-1, 1])
      mesh.beam(point(along, y, lane * laneOffset), point(hub, y, lane * laneOffset), 0.083, iron);
  }
  function addStation(mesh, station, along) {
    const floor = station.y - floorDrop;
    // A fluted lift shaft carries a public gallery between two open boarding bays.
    mesh.boxInFrame(point, along, 1.32, 0, 7.4, 1.05, 8.9, limestone);
    mesh.boxInFrame(point, along, 2.37, 0, 5.9, floor - 2.88, 6.6, iron);
    for (const side of [-1, 1]) {
      for (const offset of [-2.52, -1.54, 1.54, 2.52]) {
        mesh.boxInFrame(point, along + offset, 2.37, side * 3.34, 0.29, floor - 2.88, 0.23, limestone);
      }
      for (let y = 4; y < floor - 1.3; y += 3.6)
        mesh.boxInFrame(point, along, y, side * 3.34, 2.38, 1.07, 0.10, glass);
    }
    mesh.boxInFrame(point, along, floor - 0.54, 0, 7.95, 0.43, 10.8, jade);
    mesh.boxInFrame(point, along, floor - 0.11, 0, 7.9, 0.11, 2.50, limestone);
    for (const side of [-1, 1]) {
      mesh.boxInFrame(point, along, floor - 0.11, side * 4.45, 7.9, 0.11, 1.85, limestone);
      for (const end of [-3.25, 3.25])
        mesh.boxInFrame(point, along + end, floor, side * 4.96, 0.22, floorDrop + 0.55, 0.22, brass);
      mesh.boxInFrame(point, along, station.y + 0.55, side * 2.9, 8.5, 0.32, 5.76, jade);
      mesh.boxInFrame(point, along, station.y + 0.56, side * 5.78, 8.3, 0.12, 0.08, rim);
    }
    addSheave(mesh, along, station.y, along === 0 ? -1 : 1);
  }
  function addLine(mesh) {
    addStation(mesh, lower, 0);
    addStation(mesh, upper, span);
    for (const lane of [-1, 1]) {
      const anchors = rope.map(knot => point(knot.along, knot.y, lane * laneOffset));
      for (let i = 1; i < anchors.length; i++) mesh.beam(anchors[i-1], anchors[i], 0.083, iron);
    }
  }
  function buildCar() {
    const mesh = new G.Mesh();
    // Solid UVs carry door travel and the strip of enamel that differs on the return car.
    const paint = {...jade, uv: [0, 1]}, metal = {...iron, uv: [0, 0]};
    const bronze = {...brass, uv: [0, 0]}, pane = {...glass, uv: [0, 0]};
    const band = {...rim, uv: [0, 0]};
    mesh.box(0, 0, 0, 3.30, 0.20, 1.94, metal);
    mesh.box(0, 2.11, 0, 3.58, 0.22, 2.12, paint);
    mesh.box(0, 2.33, 0, 2.78, 0.16, 1.78, bronze);
    for (const side of [-1, 1]) {
      const z = side * 1.012;
      mesh.box(side * 1.71, 0.20, 0, 0.11, 0.72, 2.06, paint);
      mesh.box(side * 1.65, 0.92, 0, 0.09, 1.19, 1.98, metal);
      mesh.box(side * 1.70, 1.05, 0, 0.045, 0.91, 1.73, pane);
      // A little open-book crest for the last car home from Kowloon Tong.
      for (const page of [-1, 1]) {
        const cover = [[0,0.39], [0.43,0.51], [0.43,0.77], [0,0.65]]
          .map(([u,h]) => [side * 1.771, h, u * page]);
        if (side === page) cover.reverse();
        mesh.face(cover, bronze);
      }
      for (const x of [-1.23, 1.23]) {
        mesh.box(x, 0.20, z, 1.03, 0.72, 0.088, paint);
        mesh.box(x, 0.92, z, 1.02, 1.19, 0.07, metal);
        mesh.box(x, 1.05, z + side * 0.041, 0.80, 0.91, 0.031, pane);
        mesh.box(x, 0.42, z + side * 0.043, 0.98, 0.08, 0.025, band);
      }
      mesh.box(side * 1.28, 0.20, 0, 0.25, 0.36, 1.57, metal);
      mesh.box(side * 1.28, 0.56, 0, 0.59, 0.12, 1.60, bronze);
      for (const leaf of [-1, 1]) {
        const move = [leaf, 1], x = leaf * 0.37;
        mesh.box(x, 0.22, side * 1.099, 0.72, 1.84, 0.067, {...paint, uv: move});
        mesh.box(x, 1.08, side * 1.14, 0.58, 0.85, 0.040, {...pane, uv: [leaf, 0]});
      }
      mesh.beam([side * 1.06, 2.49, 0], [0, 3.58, 0], 0.10, bronze, 6);
    }
    mesh.beam([0, 3.58, 0], [0, floorDrop, 0], 0.115, metal, 8);
    mesh.box(0, floorDrop - 0.11, 0, 0.62, 0.22, 0.27, metal);
    return mesh.finish();
  }
  return {stations, dwell, travel, period, floorDrop, laneOffset, doorTravel, sheaveTile, sheaveAngle,
    grip, car, nextArrival, roofLimit, addLine, buildCar};
});
