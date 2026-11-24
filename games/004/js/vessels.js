(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./tide.js'));
  else root.HarbourVessels = factory(root.HarbourMath, root.HarbourMesh, root.HarbourTide);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G, Tide) {
  'use strict';
  const {solid, light} = G;
  const dark = solid([0.068, 0.109, 0.128]);
  const opal = light([0.51, 0.83, 0.81]);
  const warm = light([1, 0.68, 0.36]);
  const signal = light([1, 0.25, 0.16]);
  const ferryPeriod = 240;
  function ferryPose(time, index = 0) {
    const period = index ? 210 : ferryPeriod;
    const angle = M.TAU * M.wrap(time, period) / period + (index ? 2.0 : -0.32);
    const rx = index ? 42 : 32, rz = index ? 3 : 5.6;
    const x = (index ? 35 : -10) + rx * Math.sin(angle);
    const z = (index ? -3 : 23) + rz * Math.cos(angle);
    return {x, y: Tide.heightAt(time) + 0.045 * Math.sin(time * 0.82 + index), z,
      angle: Math.atan2(-rz * Math.sin(angle), rx * Math.cos(angle))};
  }
  function deckView(time) {
    const ferry = ferryPose(time);
    // Just inside the brass rail, one and a half metres above the deck boards.
    const eye = [ferry.x + 0.55 * Math.cos(ferry.angle), ferry.y + 5.46, ferry.z + 0.55 * Math.sin(ferry.angle)];
    return {eye, aim: [ferry.x * 0.64 + 5, 13.4, -56], fov: 61};
  }
  function addUpperDeck(mesh, rail) {
    const deck = solid([0.49, 0.36, 0.25]), brass = solid([0.77, 0.61, 0.36]);
    mesh.box(1.05, 3.86, 0, 4.85, 0.10, 2.81, deck);
    for (const z of [-1.34, 1.34]) {
      for (const x of [-1.28, 0.29, 1.86, 3.43]) mesh.beam([x,3.96,z], [x,4.91,z], 0.047, rail);
      for (const y of [4.41, 4.91]) mesh.beam([-1.28,y,z], [3.43,y,z], 0.058, y > 4.5 ? brass : rail, 6);
    }
    mesh.beam([3.43,4.91,-1.34], [3.43,4.91,1.34], 0.058, brass, 6);
  }
  function buildFerry() {
    const mesh = new G.Mesh();
    const hull = solid([0.107,0.245,0.224]), cream = solid([0.67,0.65,0.49]);
    const roofPaint = solid([0.105,0.244,0.232]), rail = solid([0.5,0.53,0.44]);
    const outline = [[-6.4,0.76],[-5.2,1.65],[3.8,1.65],[5.6,1.25],[7.2,0],[5.6,-1.25],[3.8,-1.65],[-5.2,-1.65],[-6.4,-0.76]];
    const ring = (y,k) => outline.map(([x,z]) => [x*k,y,z*k]);
    mesh.rings(ring(-0.5,0.82),ring(0.88,1),hull,cream);
    mesh.rings(ring(0.82,1.003),ring(0.95,1.006),cream);
    mesh.box(-0.38,0.95,0,10.3,1.46,2.81,cream);
    mesh.box(-0.35,2.36,0,11.0,0.19,3.19,roofPaint);
    mesh.box(-0.65,2.54,0,8.4,1.15,2.52,cream);
    mesh.box(-0.65,3.68,0,9.05,0.18,2.99,roofPaint);
    addUpperDeck(mesh, rail);
    for (const side of [-1,1]) {
      for (let k = 0; k < 10; k++) {
        const c = (k+2)%5 === 0 ? solid([0.132,0.23,0.218]) : light(k%3 ? [0.96,0.68,0.35] : [0.76,0.78,0.55]);
        mesh.box(-4.8+k*0.91,1.39,side*1.413,0.68,0.66,0.04,c);
        if (k < 8) mesh.box(-4.17+k*0.98,2.78,side*1.272,0.76,0.61,0.04,c);
      }
      for (let k=0;k<5;k++) mesh.box(4.87+k*0.34,0.96,side*(1.29-k*0.23),0.048,0.62,0.048,rail);
      mesh.beam([4.85,1.57,side*1.29],[6.25,1.57,side*0.36],0.052,rail);
    }
    mesh.box(3.58,2.83,0,0.07,0.55,1.89,light([0.8,0.71,0.48]));
    mesh.box(-1.5,3.86,0,0.73,0.98,0.69,roofPaint);
    mesh.box(-1.5,4.74,0,0.78,0.16,0.74,dark);
    mesh.beam([2.2,3.86,0],[2.2,5.02,0],0.055,rail);
    mesh.box(2.2,5.02,0,0.14,0.15,0.14,warm);
    mesh.box(2.85,3.75,1.44,0.22,0.16,0.18,signal);
    mesh.box(2.85,3.75,-1.44,0.22,0.16,0.18,opal);
    return mesh.finish();
  }
  function junkPose(time) {
    const phase = M.TAU * time / 280 + 0.55;
    return {x: 1 + 16 * Math.sin(phase), y: Tide.heightAt(time) + 0.07 * Math.sin(time * 0.72), z: 41 + 2.6 * Math.cos(phase),
      angle: Math.atan2(-2.6 * Math.sin(phase), 16 * Math.cos(phase))};
  }
  function addSail(mesh, mastX, foot, height, span) {
    // The battens fan out towards the leech. A third column bows the cloth away from the mast.
    const levels = [[0, 0.63], [0.16, 0.91], [0.34, 1.0], [0.54, 0.96], [0.74, 0.79], [0.89, 0.57], [1, 0.25]];
    const vermilion = [[0.86,0.27,0.17], [0.7,0.17,0.13], [0.79,0.21,0.15]];
    const bamboo = solid([0.28,0.17,0.12]);
    const rows = levels.map(([rise, breadth]) => {
      const y = foot + height * rise, tack = mastX + rise * 0.42, edge = tack - span * breadth;
      const lift = height * (0.06 + rise * 0.12);
      return [[edge,y+lift,0.12], [M.mix(edge,tack,0.48),y+lift*0.52,0.12+breadth*0.54], [tack,y,0.12]];
    });
    for (let row = 0; row < rows.length; row++) {
      const current = rows[row];
      mesh.beam(current[0], current[1], 0.043, bamboo);
      mesh.beam(current[1], current[2], 0.043, bamboo);
      if (row === rows.length - 1) break;
      for (let side = 0; side < 2; side++) {
        const fabric = solid(M.scale(vermilion[row % 3], side === 0 ? 0.82 : 1));
        const points = [current[side], current[side+1], rows[row+1][side+1], rows[row+1][side]];
        mesh.face(points, fabric);
        mesh.face([...points].reverse(), fabric);
      }
    }
  }
  function buildJunk() {
    const mesh = new G.Mesh();
    const timber = solid([0.19,0.14,0.13]), rail = solid([0.44,0.24,0.17]);
    const outline = [[-5.9,0.88],[-4.2,1.4],[2.6,1.38],[4.8,0.84],[6.4,0],[4.8,-0.84],[2.6,-1.38],[-4.2,-1.4],[-5.9,-0.88]];
    const ring = (height, breadth) => outline.map(([x,z]) => [x*breadth,height+0.42*Math.pow(Math.abs(x)/6.4,3),z*breadth]);
    mesh.rings(ring(-0.58,0.82),ring(0.88,1),timber,rail);
    mesh.rings(ring(0.88,1.001),ring(1.04,1.019),rail);
    mesh.box(-3.85,1.12,0,2.5,1.04,1.99,timber);
    mesh.box(-3.85,2.15,0,2.85,0.16,2.23,rail);
    for (const side of [-1,1]) {
      for (let i = 0; i < 3; i++) mesh.box(-4.58+i*0.72,1.41,side,0.49,0.48,0.055,warm);
    }
    for (const [x, foot, height, span] of [[1.4,2.0,6.8,4.6],[-2.95,2.75,4.15,2.95]]) {
      mesh.beam([x,1.08,0],[x+0.44,foot+height+0.12,0],0.086,rail,6);
      addSail(mesh,x,foot,height,span);
    }
    mesh.beam([1.84,8.87,0],[5.87,1.37,0],0.027,rail);
    mesh.beam([-2.51,7.02,0],[-5.73,1.38,0],0.027,rail);
    mesh.box(4.66,1.35,0,0.24,0.31,0.24,warm);
    return mesh.finish();
  }
  return {ferryPeriod, ferryPose, deckView, buildFerry, junkPose, buildJunk};
});
