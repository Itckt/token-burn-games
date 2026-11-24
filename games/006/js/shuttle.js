(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { mod } = node ? require('./math.js') : Nightline.math;
  const { LENGTH, VIADUCTS, trackOffset } = node ? require('./route.js') : Nightline.route;
  const { Mesh, paint } = node ? require('./mesh.js') : Nightline.mesh;
  const TRACK_X = -7.5, BORE = 16, RAIL_TOP = 0.50;
  const HEADWAY = 44, SPEED = 12, SPACING = 10.65;

  // Both cars follow the chord between their bogies. Each portal has a short
  // covered track, so even the trailing gangway can disappear behind masonry.
  function carsAt(position, time) {
    for (const [i, span] of VIADUCTS.entries()) {
      const lap = Math.round((position - (span.start + span.end) / 2) / LENGTH) * LENGTH;
      const start = span.start + lap, end = span.end + lap;
      if (position < start - 42 || position > end + 30) continue;
      const phase = mod(time - (i ? 3 : 6), HEADWAY);
      const lead = end + BORE + 6 - SPEED * phase;
      const cars = [];
      for (let car = 0; car < 2; car++) {
        const at = lead + car * SPACING, relative = at - position;
        if (at < start - BORE - 6 || at > end + BORE + 6 || relative < -52 || relative > 164) continue;
        const front = trackOffset(at - 3.28), back = trackOffset(at + 3.28);
        const slope = (back - front) / 6.56;
        const cos = (car ? -1 : 1) / Math.hypot(1, slope);
        cars.push({ car, at, x: TRACK_X + (front + back) / 2, cos, sin: slope * cos });
      }
      return cars;
    }
    return [];
  }

  function buildCar(tail) {
    const m = new Mesh();
    const alloy = paint(0xc3cfc8), teal = paint(0x278a82), gold = paint(0xfbcb81, 0, 0.24);
    const frame = paint(0x21343c), glass = paint(0x31525b, 0, 0.14);
    const warm = paint(0xfed99c, 0, 0.82), cool = paint(0xa6d5c7, 0, 0.65);
    const silhouette = paint(0x475e60), rubber = paint(0x293038), roof = paint(0x657981);
    const marker = tail ? paint(0xff6552, 0, 1) : paint(0xffedc7, 0, 1);
    function endFace(x0, x1, y0, y1, z0, z1, material) {
      m.quad([x0,y0,z0], [x1,y0,z0], [x1,y1,z1], [x0,y1,z1], material);
    }
    // The projecting cab nose, sloped windscreen and roof brow share a profile.
    const profile = [[1.02,4.72], [1.28,5.00], [1.85,5.03], [2.14,5.00], [3.15,4.72], [3.42,4.56]];
    const finishes = [roof, teal, alloy, glass, frame];
    for (let i = 1; i < profile.length; i++) {
      const [y0,z0] = profile[i-1], [y1,z1] = profile[i];
      endFace(-1.32,1.32,y0,y1,z0,z1,finishes[i-1]);
      for (const side of [-1,1]) {
        const a = [side*1.32,y0,z0], b = [side*1.42,y0,4.23];
        const c = [b[0],y1,b[2]], d = [a[0],y1,z1];
        if (side > 0) m.quad(a,b,c,d,finishes[i-1]); else m.quad(b,a,d,c,finishes[i-1]);
      }
    }
    endFace(-0.035,0.035,2.14,3.15,5.006,4.726,frame);
    endFace(-0.88,0.88,3.17,3.39,4.717,4.587,paint(0xffffff,24,0.86));
    for (const x of [-1.02,1.02]) {
      m.box(x-0.22,1.69,5.028,x+0.22,1.96,5.053,frame);
      endFace(x-0.16,x+0.16,1.76,1.90,5.056,5.056,marker);
    }
    m.box(-1.42,1.02,-5.0,1.42,3.42,4.23,alloy);
    m.box(-1.35,3.42,-4.98,1.35,3.51,4.57,roof);
    m.box(-0.83,3.51,-2.74,0.83,3.69,0.44,roof);
    for (const z of [-2.29,-1.61,-0.93]) m.box(-0.69,3.69,z,0.69,3.71,z+0.24,frame);
    m.box(-1.12,0.79,-4.85,1.12,1.02,4.62,rubber);
    m.box(-0.97,1.24,-5.59,0.97,3.13,-5.0,rubber);
    for (const z of [-3.28,3.28]) {
      m.box(-0.84,0.68,z-0.75,0.84,0.97,z+0.75,frame);
      for (const dz of [-0.48,0.48]) {
        m.tube([-0.81,RAIL_TOP+0.23,z+dz],[0.81,RAIL_TOP+0.23,z+dz],0.23,rubber,8);
      }
    }
    for (const side of [-1,1]) {
      function panel(z0, z1, y0, y1, relief, material) {
        const x = side * (1.42 + relief), a = side > 0 ? z1 : z0, b = side > 0 ? z0 : z1;
        m.quad([x,y0,a], [x,y0,b], [x,y1,b], [x,y1,a], material);
      }
      panel(-4.99,4.22,1.28,1.84,0.002,teal);
      panel(-4.99,4.22,1.85,1.89,0.002,gold);
      panel(-4.99,4.22,2.09,3.14,0.002,frame);
      for (const z of [-3.87,-2.40,1.28,2.76]) {
        panel(z-0.54,z+0.54,2.22,3.02,0.008,z < 0 ? warm : cool);
        panel(z+0.12,z+0.30,2.48,2.72,0.010,silhouette);
        panel(z+0.02,z+0.40,2.22,2.48,0.010,silhouette);
      }
      for (const z of [-1.22,-0.30]) {
        panel(z,z+0.89,1.08,3.16,0.012,roof);
        panel(z+0.04,z+0.85,1.12,3.12,0.014,alloy);
        panel(z+0.10,z+0.79,2.08,2.97,0.016,frame);
        panel(z+0.15,z+0.74,2.16,2.90,0.018,warm);
        panel(z+0.04,z+0.85,1.28,1.84,0.016,teal);
      }
    }
    return m.finish();
  }

  const api = { TRACK_X, BORE, RAIL_TOP, HEADWAY, SPEED, SPACING, carsAt, buildCar };
  if (node) module.exports = api;
  else Nightline.shuttle = api;
})();
