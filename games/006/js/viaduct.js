(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { seeded } = node ? require('./math.js') : Nightline.math;
  const { CHUNK, trackOffset, VIADUCTS } = node ? require('./route.js') : Nightline.route;
  const { Mesh, paint } = node ? require('./mesh.js') : Nightline.mesh;
  const { TRACK_X, BORE, RAIL_TOP } = node ? require('./shuttle.js') : Nightline.shuttle;
  const concrete = paint(0x989c9a, 1, 0, { scale: [4, 2] });
  const girder = paint(0x42595e), lip = paint(0xb4b5a1), metal = paint(0x737e80);
  const lantern = paint(0xffdfad, 0, 0.96), roof = paint(0x525a66);
  const walls = [0xd7d8db, 0xb9cdd2, 0xddc7b0, 0xbdbecf].map(color =>
    paint(color, 29, 0, { scale: [10.4, 11.6] }));

  function shuttleTrack(m, far, near) {
    m.box(TRACK_X-2.38,-1.22,far,TRACK_X+2.38,0.17,near,concrete);
    for (let z = far + 0.4; z < near; z += 0.8) {
      m.box(TRACK_X-1.14,0.17,z-0.10,TRACK_X+1.14,0.31,z+0.10,girder);
    }
    for (const x of [TRACK_X-0.755, TRACK_X+0.755]) {
      m.box(x-0.07,0.31,far,x+0.07,RAIL_TOP,near,metal);
    }
  }

  function shuttlePortal(m, s) {
    const face = -s, far = s === 0 ? face : face-BORE, near = s === 0 ? face+BORE : face;
    shuttleTrack(m, far, near);
    for (const x of [TRACK_X-2.35,TRACK_X+2.08]) {
      m.box(x,0.17,far,x+0.27,4.07,near,girder);
    }
    m.box(TRACK_X-2.35,4.07,far,TRACK_X+2.35,4.38,near,concrete);
    const back = s === 0 ? near-0.17 : far;
    m.box(TRACK_X-2.35,0.17,back,TRACK_X+2.35,4.07,back+0.17,girder);
  }

  function deck(m, index) {
    shuttleTrack(m, -CHUNK, 0);
    for (const x of [TRACK_X-2.30,TRACK_X+2.15]) {
      m.box(x,0.17,-CHUNK,x+0.15,0.88,0,concrete);
      m.box(x-0.015,0.88,-CHUNK,x+0.165,0.95,0,lip);
    }
    if (index % 2 === 0) {
      m.box(TRACK_X-1.02,-16,-8.43,TRACK_X+1.02,-1.22,-7.57,concrete);
    }
    m.box(-3.95, -1.32, -CHUNK, 3.95, -0.25, 0, concrete);
    m.box(-3.69, -1.85, -8.5, 3.69, -1.32, -7.5, girder);
    if (index % 2 === 0) m.box(-1.20, -16, -8.43, 1.20, -1.85, -7.57, concrete);
    for (const side of [-1, 1]) {
      const x = side * 3.71;
      m.box(x - 0.12, 0, -CHUNK, x + 0.12, 0.86, 0, concrete);
      m.box(x - 0.14, 0.85, -CHUNK, x + 0.14, 0.94, 0, lip);
      for (const y of [1.12, 1.42]) m.box(x - 0.032, y, -CHUNK, x + 0.032, y + 0.045, 0, metal);
      for (let z = -2; z > -CHUNK; z -= 4) {
        m.box(x - 0.045, 0.94, z - 0.05, x + 0.045, 1.47, z + 0.05, metal);
      }
    }
    const x = -3.28;
    m.box(x - 0.06, 0.58, -8.07, x + 0.06, 4.16, -7.93, girder);
    m.box(x - 0.08, 4.12, -8.18, x + 0.77, 4.22, -7.82, metal);
    m.box(x + 0.16, 4.09, -8.15, x + 0.73, 4.12, -7.85, lantern);
    for (const wire of [-0.36, 0.36]) m.box(wire, 4.42, -CHUNK, wire + 0.029, 4.45, 0, girder);
    if (index % 3 === 1) {
      m.box(3.43, 0.15, -3.11, 3.56, 4.78, -2.89, girder);
      m.box(-0.58, 4.62, -3.08, 3.47, 4.75, -2.92, girder);
      for (const wire of [-0.36, 0.36]) m.box(wire, 4.45, -3.05, wire + 0.05, 4.62, -2.95, metal);
    }
  }

  function rooftopCourt(m, x) {
    const floor = paint(0x469186), line = paint(0xffdfaa, 0, 0.42), rim = paint(0xe79254, 0, 0.3);
    m.box(x - 5.4, -16, -15.4, x + 5.4, 0.35, -0.6, walls[1]);
    m.box(x - 5.5, 0.35, -15.5, x + 5.5, 0.48, -0.5, floor);
    function stripe(left, right, far, near) {
      m.quad([x+left,0.49,near], [x+right,0.49,near], [x+right,0.49,far], [x+left,0.49,far], line);
    }
    for (const edge of [-4.8, 4.7]) stripe(edge, edge + 0.1, -14.6, -1.4);
    for (const edge of [-14.6, -1.5]) stripe(-4.7, 4.7, edge, edge + 0.1);
    for (const edge of [-1.5, 1.4]) stripe(edge, edge + 0.1, -14.5, -10.4);
    stripe(-1.5, 1.5, -10.4, -10.3);
    function arc(z, y, radius, width, angle, material) {
      const point = (i, r) => [x + r * Math.cos(i * angle / 20), y, z + r * Math.sin(i * angle / 20)];
      for (let i = 1; i <= 20; i++) {
        m.quad(point(i, radius), point(i, radius+width), point(i-1, radius+width), point(i-1, radius), material);
      }
    }
    arc(-13.2, 0.495, 4.15, 0.10, Math.PI, line);
    m.box(x-0.06, 0.48, -14.8, x+0.06, 3.4, -14.65, metal);
    m.box(x-0.80, 2.63, -14.65, x+0.80, 3.46, -14.53, lip);
    m.box(x-0.04, 2.7, -14.53, x+0.04, 2.75, -14.31, rim);
    arc(-14.13, 2.74, 0.19, 0.035, 2*Math.PI, rim);
  }

  // Entire buildings stay plumb in world space, including on the outside of a bend.
  function city(m, index, span) {
    const random = seeded(7019 + index);
    const track = trackOffset((index + 0.5) * CHUNK);
    const foothills = span === VIADUCTS[1];
    function tower(x, width, top, depth) {
      const a = x - width / 2, b = x + width / 2, near = -1 - random() * 2;
      const far = near - depth;
      m.box(a, -16, far, b, top, near, walls[Math.floor(random() * walls.length)]);
      m.box(a - 0.13, top, far - 0.13, b + 0.13, top + 0.24, near + 0.13, roof);
      m.box(a + 1.1, top + 0.24, far + 1, x + 0.6, top + 1.3, far + 3.4, concrete);
    }
    for (const side of [-1, 1]) {
      if (side === 1 && !foothills && index * CHUNK === span.start + 96) {
        rooftopCourt(m, track + 15.6);
      } else if (!foothills || random() > 0.48) {
        tower(track + side * (19 + random() * 14), 5.5 + random() * 4, random() * 11 - 3, 6 + random() * 5);
      }
      tower(track + side * (44 + random() * 14), 8 + random() * 6, 4 + random() * (foothills ? 9 : 18), 9 + random() * 3);
    }
  }

  function buildSky() {
    const m = new Mesh();
    m.box(-120, -120, -120, 120, 120, 120, paint(0xffffff));
    return m.finish();
  }

  const api = { deck, city, buildSky, shuttlePortal };
  if (node) module.exports = api;
  else Nightline.viaduct = api;
})();
