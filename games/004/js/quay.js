(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'),
    require('./tide.js'), require('./beacon.js'), require('./cargo.js'), require('./timehouse.js'));
  else root.HarbourQuay = factory(root.HarbourMath, root.HarbourMesh, root.HarbourTide, root.HarbourBeacon, root.HarbourCargo, root.HarbourTimehouse);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G, Tide, Beacon, Cargo, Timehouse) {
  'use strict';
  const iron = G.solid([0.12, 0.20, 0.22]);
  const enamel = G.solid([0.38, 0.49, 0.47]);
  const jade = G.light([0.38, 0.88, 0.77]);
  const ivory = G.light([1.0, 0.80, 0.51]);
  const timber = G.solid([0.30, 0.23, 0.18]);
  const deckHeight = 1.3;
  const wheel = {x: -26, y: 14.6, z: -12.5, radius: 10.7, cabins: 12, period: 84};
  const stops = [
    {x: -78, name: 'Salt Steps'}, {x: 8, name: 'Study Pier'}, {x: 86, name: 'Lantern Market'}
  ];
  const calls = [0, 1, 2, 1];
  const dwell = 5, travel = 34, leg = dwell + travel;
  const tramPeriod = leg * calls.length;
  const scheduleOffset = 29;
  const nextArrival = time => M.nextOccurrence(time, leg, -scheduleOffset);

  function shoreZ(x) { return -21 + 2.5 * Math.sin(x / 49) + 1.8 * Math.cos(x / 26); }
  function trackZ(x) { return shoreZ(x) - 2.10; }
  function tramPose(time) {
    // Open just west of Study Pier. The double-ended car reverses cabs at each terminus.
    const arrival = nextArrival(time) - leg;
    const index = M.wrap((arrival + scheduleOffset) / leg, calls.length);
    const stop = stops[calls[index]], next = stops[calls[(index + 1) % calls.length]];
    const elapsed = time - arrival;
    const t = M.clamp((elapsed - dwell) / travel, 0, 1);
    const x = M.mix(stop.x, next.x, M.ease(t));
    const tangent = 2.5 / 49 * Math.cos(x / 49) - 1.8 / 26 * Math.sin(x / 26);
    return {x, y: deckHeight + 0.115, z: trackZ(x), angle: Math.atan(tangent),
      direction: Math.sign(next.x - stop.x), at: time < arrival + dwell ? stop.name : null, next: next.name};
  }
  function wheelAngle(time) { return M.TAU * M.wrap(time, wheel.period) / wheel.period; }
  function hanger(index, angle = 0) {
    const a = angle + M.TAU * index / wheel.cabins;
    return [wheel.radius * Math.cos(a), wheel.radius * Math.sin(a)];
  }

  function addStop(mesh, stop) {
    const x = stop.x, z = shoreZ(x);
    mesh.box(x, 0.88, z + 0.54, 10.4, 0.47, 2.8, iron);
    for (const dx of [-4.1, 4.1]) {
      mesh.box(x + dx, -1.2, z + 1.4, 0.32, 2.1, 0.34, timber);
      mesh.box(x + dx, 1.35, z + 1.46, 0.17, 2.55, 0.17, enamel);
    }
    mesh.box(x, 3.9, z + 0.9, 9.4, 0.2, 2.5, iron);
    mesh.box(x, 3.9, z + 2.16, 9.0, 0.085, 0.05, jade);
    mesh.box(x, 3.82, z + 0.32, 7.7, 0.09, 0.13, ivory);
    mesh.box(x, 1.73, z + 1.13, 3.6, 0.15, 0.52, timber);
    for (const dx of [-1.4, 1.4]) mesh.box(x + dx, 1.35, z + 1.13, 0.14, 0.38, 0.37, iron);
  }
  function addTramway(mesh) {
    const rail = G.solid([0.47, 0.49, 0.45]);
    for (let x = -84; x < 92; x += 4) {
      for (const dz of [-0.73, 0.73]) {
        mesh.beam([x, 1.365, trackZ(x) + dz], [x + 4, 1.365, trackZ(x + 4) + dz], 0.05, rail);
      }
      const wireY = 6.47;
      mesh.beam([x, wireY, trackZ(x)], [x + 4, wireY, trackZ(x + 4)], 0.032, iron);
      if ((x + 84) % 16 === 0) {
        mesh.box(x, deckHeight, trackZ(x) + 1.70, 0.13, 5.38, 0.13, enamel);
        mesh.beam([x, 6.63, trackZ(x) + 1.70], [x, wireY, trackZ(x)], 0.052, iron);
      }
    }
    stops.forEach(stop => addStop(mesh, stop));
  }
  function buildTram() {
    const mesh = new G.Mesh();
    const green = G.solid([0.12, 0.39, 0.35]), cream = G.solid([0.78, 0.72, 0.52]);
    const glass = G.solid([0.079, 0.155, 0.175]);
    const cabLamp = {tile: -4, color: [1, 0.86, 0.61]};
    mesh.box(0, 0.17, 0, 8.6, 0.5, 1.75, iron);
    mesh.box(0, 0.48, 0, 9.4, 0.78, 2.06, green);
    mesh.box(0, 1.26, 0, 9.22, 0.99, 2.0, glass);
    mesh.box(0, 2.25, 0, 9.45, 0.52, 2.08, cream);
    mesh.box(0, 2.77, 0, 9.20, 1.04, 1.99, glass);
    mesh.box(0, 3.81, 0, 9.55, 0.20, 2.19, green);
    mesh.box(0, 4.01, 0, 6.84, 0.13, 1.64, iron);
    const pane = [ivory, G.light([0.71, 0.82, 0.66]), G.light([0.90, 0.63, 0.38])];
    for (const side of [-1, 1]) {
      for (let bay = 0; bay < 8; bay++) {
        const x = (bay - 3.5) * 1.12;
        for (const y of [1.34, 2.84]) {
          mesh.box(x, y, side * 1.004, 0.94, 0.78, 0.035, pane[(bay + (side + 1)) % 3]);
          if (bay % 3 === 1) mesh.box(x + 0.21, y, side * 1.025, 0.22, 0.38, 0.027, glass);
        }
      }
      for (const dx of [-3.1, 3.1]) mesh.box(dx, 0.0, side * 0.73, 0.61, 0.45, 0.18, iron);
      for (const y of [1.39, 2.91]) mesh.box(side * 4.622, y, 0, 0.075, 0.72, 1.70, pane[1]);
      for (const dz of [-0.65, 0.65]) mesh.box(side * 4.71, 0.84, dz, 0.075, 0.19, 0.20, cabLamp);
    }
    // The collector reaches the continuous overhead wire from either driving cab.
    mesh.beam([-1.85, 4.14, 0], [-0.44, 4.64, 0], 0.066, enamel);
    mesh.beam([-0.44, 4.64, 0], [-1.31, 5.04, 0], 0.066, enamel);
    mesh.box(-1.31, 5.01, 0, 0.24, 0.06, 0.72, iron);
    return mesh.finish();
  }

  function addWheelPier(mesh) {
    const {x, y, z} = wheel;
    const back = Math.min(shoreZ(x - 12.4), shoreZ(x + 12.4)) - 0.12, front = z + 4.2;
    mesh.box(x, 0.77, (front + back) / 2, 24.8, deckHeight + 0.035 - 0.77, front - back, timber);
    for (const dx of [-11.6, -5.8, 0, 5.8, 11.6]) {
      mesh.box(x + dx, -1.2, front - 0.55, 0.42, 2.0, 0.46, iron);
      mesh.box(x + dx, deckHeight, front - 0.22, 0.13, 0.77, 0.13, enamel);
    }
    mesh.beam([x - 11.6, 2.07, front - 0.22], [x + 11.6, 2.07, front - 0.22], 0.065, enamel);
    for (const side of [-1, 1]) {
      const az = z + side * 1.63;
      for (const dx of [-5.8, 5.8]) {
        mesh.box(x + dx, deckHeight, z + side * 2.68, 1.55, 0.38, 1.28, iron);
        mesh.beam([x + dx, 1.68, z + side * 2.68], [x, y, az], 0.32, enamel, 6);
      }
    }
    mesh.beam([x, y, z - 2.10], [x, y, z + 2.10], 0.56, iron, 12);
    mesh.beam([x, y, z + 2.10], [x, y, z + 2.17], 0.39, ivory, 12);
  }
  function buildWheelRotor() {
    const mesh = new G.Mesh(), segments = wheel.cabins * 4;
    const point = (i, radius, z) => {
      const a = i * M.TAU / segments;
      return [radius * Math.cos(a), radius * Math.sin(a), z];
    };
    for (let i = 0; i < segments; i++) {
      for (const side of [-1, 1]) {
        const z = side * 1.0;
        mesh.beam(point(i, wheel.radius, z), point(i + 1, wheel.radius, z), 0.116, side === 1 ? jade : enamel);
        mesh.beam(point(i, wheel.radius - 0.55, z), point(i + 1, wheel.radius - 0.55, z), 0.077, iron);
        if (i % 4 === 0) {
          mesh.beam([0, 0, z * 0.32], point(i, wheel.radius, z), 0.095, side === 1 ? enamel : iron);
          mesh.beam(point(i, 2.55, z * 0.42), point(i + 4, wheel.radius - 0.55, z), 0.043, enamel);
        }
      }
      if (i % 4 === 0) mesh.beam(point(i, wheel.radius, -1.08), point(i, wheel.radius, 1.08), 0.095, iron);
    }
    return mesh.finish();
  }
  function buildWheelCabins() {
    const mesh = new G.Mesh();
    for (let i = 0; i < wheel.cabins; i++) {
      // The rotor and cabins share an axle. Each cabin keeps its local vertical
      // axis while its suspension point (stored in the spare solid UVs) orbits.
      const uv = hanger(i);
      const body = {tile: -1, color: i % 3 ? [0.62, 0.24, 0.16] : [0.19, 0.42, 0.39], uv};
      const window = {...ivory, uv}, trim = {...iron, uv};
      for (const side of [-1, 1]) mesh.beam([0, 0, side * 0.85], [0, -0.42, side * 0.70], 0.064, trim);
      mesh.box(0, -1.68, 0, 1.54, 0.53, 1.36, body);
      mesh.box(0, -1.15, 0, 1.43, 0.64, 1.26, window);
      mesh.box(0, -0.51, 0, 1.70, 0.16, 1.48, body);
      for (const side of [-1, 1]) mesh.box(0, -1.15, side * 0.64, 0.11, 0.64, 0.04, trim);
    }
    return mesh.finish();
  }
  function addWaterfront(mesh) {
    const quay = G.solid([0.16, 0.192, 0.185]), paving = G.solid([0.103, 0.157, 0.168]);
    const railing = G.solid([0.28, 0.31, 0.29]), warm = G.light([1, 0.68, 0.36]);
    const steel = G.solid([0.125, 0.185, 0.197]);
    for (let x = -285; x < 285; x += 5) {
      const r = x + 5, z = shoreZ(x), rz = shoreZ(r);
      mesh.face([[x,-2,z], [r,-2,rz], [r,1.3,rz], [x,1.3,z]], quay);
      mesh.face([[x,1.3,z], [r,1.3,rz], [r,1.3,-155], [x,1.3,-155]], paving);
      // Leave access from the promenade onto each boarding platform.
      const platform = stops.some(stop => Math.abs(x + 2.5 - stop.x) < 4.2) || Math.abs(x + 2.5 - wheel.x) < 10;
      const cargoGate = Math.abs(x + 2.5 - Cargo.berth.x) < 5;
      const clockGate = Math.abs(x + 2.5 - Timehouse.center[0]) < 3.6;
      if (!platform && !cargoGate && !clockGate && Math.abs(x + 2.5 - Tide.landing.gateX) > 3.5) {
        mesh.beam([x,1.9,z-0.15], [r,1.9,rz-0.15], 0.055, railing);
        mesh.box(x, 1.3, z-0.15, 0.13, 0.63, 0.13, railing);
      }
      if (x % 15 === 0 && Math.abs(x - Tide.landing.gateX) > 1.2) {
        mesh.box(x, 1.3, z - 0.7, 0.11, 2.2, 0.11, steel);
        mesh.box(x, 3.5, z - 0.7, 0.36, 0.21, 0.31, warm);
        mesh.box(x, 0.55, z + 0.055, 1.1, 0.105, 0.08, warm);
      }
    }
    addTramway(mesh);
    addWheelPier(mesh);
    Tide.addLanding(mesh, shoreZ);
    Cargo.addBerth(mesh, shoreZ);
    Beacon.addTower(mesh);
    Timehouse.addTower(mesh, shoreZ);
  }
  return {shoreZ, trackZ, stops, dwell, travel, tramPeriod, tramPose, nextArrival, wheel, wheelAngle, hanger,
    addWaterfront, buildTram, buildWheelRotor, buildWheelCabins};
});
