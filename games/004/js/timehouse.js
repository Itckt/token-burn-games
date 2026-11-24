(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'));
  else root.HarbourTimehouse = factory(root.HarbourMath, root.HarbourMesh);
})(globalThis, function (M, G) {
  'use strict';
  const x = -6.5, z = -14.1, dialY = 15.8, dialRadius = 2.31;
  const center = [x, dialY, z], ballY = 21.62, rise = 3.45;
  const dialTile = -7, ballTile = -8;
  // Fifteen dial seconds per simulation second. The first drop signals midnight.
  const minuteLength = 4, midnight = 8, quarter = 15 * minuteLength;
  const nextDrop = time => M.nextOccurrence(time, quarter, midnight);
  function reading(time) {
    // Classify the minute before adding its fractional part. Adding a day-scale
    // offset first can round the last frame before midnight into the next day.
    const start = M.nextOccurrence(time, minuteLength, midnight) - minuteLength;
    const minutes = M.wrap((start - midnight) / minuteLength, 1440);
    const fraction = (time - start) / minuteLength;
    const minute = M.TAU * (minutes % 60 + fraction) / 60, hour = M.TAU * (minutes % 720 + fraction) / 720;
    const hh = Math.floor(minutes / 60), mm = minutes % 60;
    const label = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    const next = nextDrop(time), last = next - quarter;
    let lift = 0, signal = 'Ball down';
    if (time < last + 1.2) {
      lift = 1 - ((time - last) / 1.2) ** 2;
      signal = 'Dropping';
    } else if (time >= next - 4) {
      lift = 1;
      signal = 'Ball aloft';
    } else if (time >= next - 12) {
      lift = M.ease((time - (next - 12)) / 8);
      signal = 'Raising';
    }
    return {label, signal, lift: lift * rise, hands: [Math.sin(hour), Math.cos(hour), Math.sin(minute), Math.cos(minute)]};
  }
  const brick = G.solid([0.55, 0.26, 0.18]), stone = G.solid([0.72, 0.65, 0.51]);
  const patina = G.solid([0.18, 0.36, 0.34]), brass = G.solid([0.72, 0.52, 0.28]);
  const shadow = G.solid([0.13, 0.19, 0.20]), honey = G.light([0.97, 0.72, 0.39]);
  function addBall(mesh) {
    const radius = 0.93, drum = (y, r) => G.horizontalRing(x, ballY + y, z, r, 16);
    const levels = [[-0.91, 0.18], [-0.73, 0.59], [-0.38, 0.91], [-0.10, 1], [0.10, 1],
      [0.38, 0.91], [0.73, 0.59], [0.91, 0.18]];
    for (let i = 1; i < levels.length; i++) {
      const [a, ra] = levels[i - 1], [b, rb] = levels[i];
      const material = {tile: ballTile, color: i === 4 ? [0.98, 0.79, 0.40] : [0.94, 0.29, 0.14]};
      mesh.rings(drum(a, radius * ra), drum(b, radius * rb), material);
    }
  }
  function addTower(mesh, shoreZ) {
    const box = (base, w, h, d, material) => mesh.box(x, base, z, w, h, d, material);
    const shore = shoreZ(x) - 0.08, end = z - 2.9;
    mesh.box(x, 0.83, (shore + end) / 2, 2.18, 0.50, end - shore, stone);
    box(-1.65, 7.15, 2.98, 6.92, shadow);
    box(1.33, 7.36, 0.35, 7.08, stone);
    box(1.68, 5.36, 10.77, 5.36, brick);
    for (const dx of [-2.54, 2.54]) for (const dz of [-2.54, 2.54])
      mesh.box(x + dx, 1.68, z + dz, 0.48, 10.77, 0.48, stone);
    for (const side of [-1, 1]) {
      for (const offset of [-0.92, 0, 0.92]) {
        mesh.box(x + offset, 5.0, z + side * 2.71, 0.51, 4.86, 0.12, honey);
        mesh.box(x + side * 2.71, 5.0, z + offset, 0.12, 4.86, 0.51, honey);
      }
    }
    for (const y of [4.72, 9.98, 11.93]) box(y, 5.60, 0.19, 5.60, stone);
    box(12.45, 6.25, 0.47, 6.25, patina);
    box(12.92, 5.86, 5.73, 5.86, brick);
    const dial = {tile: dialTile, color: [1, 0.86, 0.61]};
    for (const [nx, nz] of [[0,1],[1,0],[0,-1],[-1,0]]) {
      // Each dial's right axis points clockwise as seen from outside that wall.
      const onFace = (right, up, depth) => [x + nz * right + nx * depth, dialY + up, z - nx * right + nz * depth];
      mesh.beam(onFace(0, 0, 2.92), onFace(0, 0, 3.12), dialRadius + 0.18, brass, 32);
      const uv = Array.from({length: 32}, (_, i) => [Math.cos(M.TAU * i / 32), Math.sin(M.TAU * i / 32)]);
      mesh.face(uv.map(([u,v]) => onFace(u * dialRadius, v * dialRadius, 3.14)), dial, uv);
    }
    box(18.65, 6.34, 0.34, 6.34, stone);
    const cornice = (y, half) => [[-1,1],[1,1],[1,-1],[-1,-1]].map(([a,b]) => [x + half*a, y, z + half*b]);
    mesh.rings(cornice(18.99, 3.11), cornice(20.48, 1.42), patina);
    box(20.48, 2.85, 0.18, 2.85, brass);
    mesh.beam([x, 20.66, z], [x, ballY + rise + 1.34, z], 0.13, stone, 8);
    mesh.beam([x, ballY + rise + 1.32, z], [x, ballY + rise + 1.57, z], 0.19, honey, 8);
    addBall(mesh);
  }
  return {center, dialRadius, ballY, rise, dialTile, ballTile, quarter, reading, nextDrop, addTower};
});
