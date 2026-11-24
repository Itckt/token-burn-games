(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./tide.js'));
  else root.HarbourCargo = factory(root.HarbourMath, root.HarbourMesh, root.HarbourTide);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G, Tide) {
  'use strict';
  const berth = {x: -57, y: 0, z: -17, angle: Math.atan2(4, 3)};
  const reach = 23, rail = 15.6, halfGauge = 3.48, quayTop = 1.52, freeboard = 1.12, boxHeight = 2.45;
  const leg = 36, start = -18, setDown = 30;
  const ochre = G.solid([0.79, 0.43, 0.19]), iron = G.solid([0.16, 0.23, 0.25]);
  const brass = G.solid([0.67, 0.52, 0.32]), ivory = G.light([1, 0.80, 0.53]);
  const green = G.solid([0.17, 0.39, 0.37]);

  // Along points out along the jib. Across runs parallel to the cargo hatch.
  function point(along, y, across = 0) {
    return [berth.x + 0.6 * along - 0.8 * across, y, berth.z + 0.8 * along + 0.6 * across];
  }
  function transfer(time) {
    const departure = M.nextOccurrence(time, leg, start) - leg;
    const t = time - departure, outbound = M.wrap(departure - start, 2 * leg) === 0;
    const deck = freeboard + Tide.heightAt(time);
    const from = outbound ? quayTop : deck, to = outbound ? deck : quayTop;
    const source = outbound ? 'quay' : 'barge', destination = outbound ? 'barge' : 'quay';
    const traverse = M.ease((t - 12) / 12);
    const along = reach * (outbound ? traverse : 1 - traverse);
    const lifted = M.mix(from, 7.4, M.ease((t - 6) / 6));
    const bottom = M.mix(lifted, to, M.ease((t - 24) / (setDown - 24)));
    const top = bottom + boxHeight;
    let hook = top, label;
    if (t < 4) {
      hook = M.mix(11.8, top, M.ease(t / 4));
      label = 'Hook to ' + source;
    } else if (t < 6) label = 'Locking on · ' + source;
    else if (t < 12) label = 'Hoisting from ' + source;
    else if (t < 24) label = 'Crossing to ' + destination;
    else if (t < setDown) label = 'Lowering to ' + destination;
    else {
      hook = M.mix(top, 11.8, M.ease((t - 31) / 5));
      label = 'Landed on ' + destination;
    }
    const [x, y, z] = point(along, 0);
    return {x, y, z, angle: berth.angle, along, bottom, hook, label};
  }
  const nextSetDown = time => M.nextOccurrence(time, leg, start + setDown);
  function addBarge(mesh) {
    const afloat = Tide.afloat;
    const outline = [[-2.6,6.6], [-1.8,8.1], [1.8,8.1], [2.6,6.6],
      [2.6,-6.5], [1.7,-8.15], [-1.7,-8.15], [-2.6,-6.5]];
    const ring = (y, scale) => outline.map(([along, across]) => point(reach + along * scale, y, across * scale));
    mesh.rings(ring(-0.68, 0.85), ring(freeboard, 1), afloat(green), afloat(iron));
    mesh.rings(ring(freeboard - 0.29, 1.006), ring(freeboard - 0.17, 1.009), afloat(brass));
    for (const side of [-1, 1]) {
      mesh.boxInFrame(point, reach + side * 2.48, freeboard, 0, 0.13, 0.33, 12.0, afloat(iron));
      mesh.boxInFrame(point, reach, freeboard, side * 4.95, 3.2, 1.25, 2.38, afloat(side === 1 ? ochre : green));
      mesh.boxInFrame(point, reach, freeboard + 1.25, side * 4.95, 3.33, 0.14, 2.52, afloat(brass));
      mesh.boxInFrame(point, reach, freeboard, side * 7.53, 0.2, 0.83, 0.2, afloat(iron));
      mesh.boxInFrame(point, reach, freeboard + 0.83, side * 7.53, 0.29, 0.22, 0.29, afloat(ivory));
    }
  }
  function addBerth(mesh, shoreZ) {
    const back = Math.min(shoreZ(-65), shoreZ(-49)) - 0.20, front = -10.0;
    mesh.box(berth.x, 0.74, (front + back) / 2, 16, quayTop - 0.74, front - back, iron);
    for (const dx of [-7, 0, 7]) mesh.box(berth.x + dx, -1.6, front - 0.7, 0.64, 2.34, 0.64, iron);
    const heel = -5.2, panel = 4.45;
    for (let i = 0; i <= 7; i++) {
      const x = heel + i * panel;
      mesh.beam(point(x, rail + 1.95, -halfGauge), point(x, rail + 1.95, halfGauge), 0.11, iron);
    }
    for (const side of [-1, 1]) {
      const cross = side * halfGauge;
      const strut = (a, b, radius, material) => mesh.beam(point(a[0], a[1], cross), point(b[0], b[1], cross), radius, material);
      for (const foot of [-3.8, 4.5]) {
        mesh.boxInFrame(point, foot, quayTop, cross, 1.15, 0.43, 1.05, iron);
        strut([foot, quayTop + 0.43], [foot * 0.61, rail], 0.34, ochre);
      }
      strut([-3.55, 3.0], [3.1, 13.1], 0.16, iron);
      strut([4.22, 3.0], [-2.62, 13.1], 0.16, iron);
      strut([heel, rail], [heel + 7 * panel, rail], 0.25, ochre);
      strut([heel, rail + 1.95], [heel + 7 * panel, rail + 1.95], 0.17, brass);
      for (let i = 0; i < 7; i++) {
        const x = heel + i * panel, top = rail + 1.95;
        strut([x, rail], [x + panel / 2, top], 0.13, ochre);
        strut([x + panel / 2, top], [x + panel, rail], 0.13, ochre);
        if (i % 2 === 0) mesh.boxInFrame(point, x, rail + 0.10, cross + side * 0.2, 0.65, 0.16, 0.10, ivory);
      }
    }
    mesh.boxInFrame(point, -3.7, rail + 0.4, 0, 3.3, 1.85, 3.78, iron);
    mesh.boxInFrame(point, 2.9, rail - 2.6, halfGauge + 0.82, 2.85, 2.55, 1.9, green);
    mesh.boxInFrame(point, 3.11, rail - 1.96, halfGauge + 1.79, 2.15, 0.84, 0.06, ivory);
    addBarge(mesh);
  }

  // The rig uses solid-material UVs as vertical weights for the hook and box.
  // The top ends of the four ropes stay on the trolley as the spreader descends.
  function buildRig() {
    const mesh = new G.Mesh();
    const fixed = material => ({...material, uv: [0, 0]});
    const suspended = material => ({...material, uv: [1, 0]});
    const loaded = material => ({...material, uv: [0, 1]});
    mesh.box(0, rail - 0.47, 0, 2.25, 0.42, 2 * halfGauge + 0.30, fixed(iron));
    for (const side of [-1, 1]) {
      for (const x of [-0.72, 0.72]) {
        mesh.beam([x, rail - 0.20, side * (halfGauge - 0.19)], [x, rail - 0.20, side * (halfGauge + 0.19)],
          0.26, fixed(brass), 8);
      }
    }
    mesh.box(0, rail - 0.70, 0, 1.64, 0.38, 3.05, fixed(ochre));
    const pulley = rail - 0.7;
    const rope = {...brass, uv: p => [1 - p[1] / pulley, 0]};
    for (const x of [-0.78, 0.78]) for (const z of [-1.38, 1.38]) {
      mesh.beam([x, 0, z], [x, pulley, z], 0.052, rope);
    }
    mesh.box(0, 0, 0, 2.26, 0.29, 5.48, suspended(ochre));
    for (const x of [-0.93, 0.93]) mesh.box(x, 0.29, 0, 0.17, 0.14, 5.3, suspended(iron));
    mesh.box(0, 0, 0, 2.30, boxHeight, 5.5, loaded(green));
    for (const side of [-1, 1]) {
      for (let i = -4; i <= 4; i++) mesh.box(side * 1.16, 0.12, i * 0.55, 0.07, boxHeight - 0.24, 0.12, loaded(green));
      for (const y of [0.04, boxHeight - 0.13]) mesh.box(side * 1.16, y, 0, 0.10, 0.09, 5.53, loaded(brass));
      // The Kowloon Tong canteen marks its deliveries with three tea cups.
      for (const x of [-0.55, 0, 0.55]) {
        const cup = [[-0.12,1.46],[0.12,1.46],[0.20,1.84],[-0.20,1.84]]
          .map(([dx,y]) => [x + dx, y, side * 2.77]);
        mesh.face(side > 0 ? cup : cup.reverse(), loaded(G.solid([0.94, 0.81, 0.57])));
        mesh.box(x, 1.85, side * 2.77, 0.42, 0.06, 0.04, loaded(brass));
      }
    }
    return mesh.finish();
  }
  return {berth, reach, rail, quayTop, freeboard, boxHeight, leg, point, transfer, nextSetDown, addBerth, buildRig};
});
