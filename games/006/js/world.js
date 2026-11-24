(function () {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const M = node ? require('./math.js') : Nightline.math;
  const { Mesh, paint, PART, STRAP_RAIL } = node ? require('./mesh.js') : Nightline.mesh;
  const { BLADE } = node ? require('./weather.js') : Nightline.weather;
  const R = node ? require('./route.js') : Nightline.route;
  const viaduct = node ? require('./viaduct.js') : Nightline.viaduct;
  const signals = node ? require('./signals.js') : Nightline.signals;
  const lineSpeed = node ? require('./line-speed.js') : Nightline.lineSpeed;
  const { TRACK_X } = node ? require('./shuttle.js') : Nightline.shuttle;
  const L = R.CHUNK;
  const concrete = paint(0x8b8b81, 1, 0, { scale: [4, 2] });
  const dark = paint(0x252e32), steel = paint(0x738282), black = paint(0x161e21);
  const brightSteel = paint(0xb6c1b9), shadowSteel = paint(0x465154);
  const amber = paint(0xe8ad4e), brass = paint(0xb78a4c);
  const lamp = paint(0xffecc6, 0, 0.97), warm = paint(0xffce86, 0, 0.88);
  const guardLamp = { ...warm, part: PART.GUARD_LAMP };
  const cool = paint(0xd9f4ed, 0, 0.90);
  const enamel = paint(0xced5c7, 2, 0, { scale: [2.4, 1.2] });
  const asphalt = paint(0x8f9289, 4, 0, { scale: [2.25, 1.13] });
  const paving = paint(0xadaf9e, 5, 0, { scale: [4, 2] });
  const tactile = paint(0xdbaf56, 7, 0, { scale: [0.72, 0.36] });
  const shutter = paint(0x626f70, 6, 0, { scale: [1.2, 0.6] });
  const soffit = paint(0x666b68, 3, 0, { scale: [4, 2] });
  const glass = paint(0x79b7ad, 25, 0.08, { alpha: 0.17, scale: [1.6, 1.7] });
  const poster = id => paint(0xffffff, id, 0.32);

  // Distances in a chunk increase down the track, towards negative world Z.
  function block(m, x0, x1, y0, y1, s0, s1, material) {
    m.box(x0, y0, -s1, x1, y1, -s0, material);
  }
  function rightWall(m, x, y0, y1, s0, s1, material) {
    m.quad([x, y0, -s1], [x, y0, -s0], [x, y1, -s0], [x, y1, -s1], material);
  }
  function leftWall(m, x, y0, y1, s0, s1, material) {
    m.quad([x, y0, -s0], [x, y0, -s1], [x, y1, -s1], [x, y1, -s0], material);
  }
  function front(m, x0, x1, y0, y1, s, material) {
    m.quad([x0, y0, -s], [x1, y0, -s], [x1, y1, -s], [x0, y1, -s], material);
  }

  function buildTrack(m, random) {
    block(m, -3.85, 3.85, -0.25, 0.035, 0, L, asphalt);
    const sleeper = paint(0x665f53, 1, 0, { scale: [1.9, 0.65] });
    for (let i = 0; i < 24; i++) {
      const s = (i + 0.5) * L / 24 + random() * 0.026;
      block(m, -1.19, 1.19, 0.041, 0.17, s - 0.105, s + 0.105, sleeper);
      for (const x of [-0.755, 0.755]) {
        block(m, x - 0.15, x + 0.15, 0.17, 0.207, s - 0.068, s + 0.068, shadowSteel);
      }
    }
    for (const x of [-0.755, 0.755]) {
      block(m, x - 0.089, x + 0.089, 0.205, 0.235, 0, L, shadowSteel);
      block(m, x - 0.029, x + 0.029, 0.235, 0.318, 0, L, steel);
      block(m, x - 0.05, x + 0.05, 0.318, 0.363, 0, L, brightSteel);
    }
    block(m, -2.06, -1.91, 0.17, 0.27, 0, L, dark);
    block(m, -2.12, -1.87, 0.27, 0.32, 0, L, steel);
    block(m, -3.73, -2.21, 0.01, 0.58, 0, L, concrete);
    block(m, -2.32, -2.22, 0.58, 0.603, 0, L, brass);
  }

  function archPoint(t, inset, station) {
    return [-(3.73 - inset) * Math.cos(t), 1.55 + ((station ? 3.46 : 2.98) - inset) * Math.sin(t)];
  }
  function arch(m, station) {
    const count = station ? 9 : 18;
    const lining = paint(station ? 0x888b83 : 0x93918a, 1, 0, { scale: [3.2, 1.6] });
    for (let i = -1; i < count + (station ? 0 : 1); i++) {
      const at = (j, inset, s) => {
        if (j < 0) return [-3.73 + inset, 0, -s];
        if (j > 18) return [3.73 - inset, 0, -s];
        const p = archPoint(j * Math.PI / 18, inset, station);
        return [p[0], p[1], -s];
      };
      m.quad(at(i, 0, 0), at(i, 0, L), at(i + 1, 0, L), at(i + 1, 0, 0), lining);
      for (let s = 0; s < L; s += station ? 4 : 2) {
        const end = s + (s % 8 === 0 ? 0.18 : 0.075);
        const depth = s % 8 === 0 ? 0.125 : 0.055;
        m.quad(at(i, depth, s), at(i, depth, end), at(i + 1, depth, end), at(i + 1, depth, s), shadowSteel);
        m.quad(at(i, 0, s), at(i, depth, s), at(i + 1, depth, s), at(i + 1, 0, s), steel);
      }
    }
  }

  function utilities(m, station, index) {
    for (const [y, r, finish] of [[1.02, 0.082, dark], [1.26, 0.052, brass], [1.43, 0.048, steel], [1.61, 0.035, dark]]) {
      m.tube([-3.45, y, 0], [-3.45, y, -L], r, finish, 8);
    }
    for (let s = 0.7; s < L; s += 4) {
      block(m, -3.61, -3.40, 0.92, 1.71, s, s + 0.075, shadowSteel);
      const lx = station ? -3.12 : -3.39, ly = station ? 3.42 : 2.38;
      block(m, lx, lx+0.14, ly, ly+0.20, s, s+1.9, dark);
      block(m, lx+0.14, lx+0.20, ly+0.052, ly+0.14, s+0.09, s+1.81, station ? warm : lamp);
    }
    block(m, -3.44, -3.14, 1.71, 2.22, 5.65, 6.55, shutter);
    leftWall(m, -3.13, 1.84, 2.11, 5.85, 6.37, poster(21));
    if (!station) {
      for (const y of [1.18, 1.38, 1.58]) m.tube([3.49, y, 0], [3.49, y, -L], 0.055, shadowSteel, 7);
      block(m, 3.40, 3.54, 2.05, 2.35, 8.1, 8.9, dark);
      block(m, 3.34, 3.41, 2.12, 2.26, 8.18, 8.82, cool);
      for (const x of [-0.45, 0.45]) m.tube([x, 4.32, 0], [x, 4.32, -L], 0.046, shadowSteel, 7);
      if (index % 5 === 1 || index % 7 === 2) {
        // A recessed ventilation grille and enamel hazard jambs break up the bore.
        block(m, 3.23, 3.59, 0.84, 2.73, 4.86, 7.34, dark);
        rightWall(m, 3.216, 1.13, 2.54, 5.04, 7.17, poster(28));
        for (const s of [4.91, 7.21]) block(m, 3.21, 3.23, 0.92, 2.61, s, s+0.055, brass);
      }
    }
  }

  function platformDoors(m, panes, s) {
    const x = 1.875, mid = s + 2;
    for (const edge of [s + 0.035, s + 1.10, s + 2.90]) {
      block(m, x - 0.062, x + 0.065, 1.07, 3.27, edge - 0.031, edge + 0.031, steel);
    }
    for (const sign of [-1, 1]) {
      const z0 = sign < 0 ? mid - 0.85 : mid + 0.015;
      const z1 = sign < 0 ? mid - 0.015 : mid + 0.85;
      const movable = base => ({ ...base, slide: -sign * 0.81 });
      const frame = movable(shadowSteel), trim = movable(steel);
      rightWall(panes, x + 0.012, 1.20, 3.12, z0, z1, movable(glass));
      block(m, x - 0.045, x + 0.044, 1.08, 1.24, z0, z1, trim);
      block(m, x - 0.041, x + 0.031, 3.09, 3.19, z0, z1, frame);
      const edge = sign < 0 ? z1 - 0.026 : z0;
      block(m, x - 0.048, x + 0.024, 1.18, 3.13, edge, edge + 0.027, frame);
      rightWall(m, x - 0.014, 2.01, 2.035, z0, z1, movable(amber));
      rightWall(m, x - 0.017, 2.20, 2.29, (z0 + z1) / 2 - 0.09, (z0 + z1) / 2 + 0.09, movable(poster(26)));
    }
    for (const [a, b] of [[s + 0.06, s + 1.12], [s + 2.88, s + 3.99]]) {
      rightWall(panes, x + 0.068, 1.20, 3.16, a, b, glass);
      rightWall(m, x + 0.052, 2.01, 2.035, a, b, amber);
      block(m, x - 0.008, x + 0.11, 1.08, 1.23, a, b, shadowSteel);
    }
    // The continuous lintel and the door status lamp sit above the sliding leaves.
    block(m, x - 0.10, x + 0.15, 3.20, 3.40, s, s + 4, dark);
    block(m, x - 0.112, x - 0.098, 3.36, 3.405, s, s + 4, brass);
    rightWall(m, x - 0.114, 3.24, 3.278, mid - 0.18, mid + 0.18, guardLamp);
    rightWall(m, x - 0.064, 2.42, 2.63, s + 1.077, s + 1.123, guardLamp);
    rightWall(m, x - 0.115, 3.225, 3.355, s + 0.19, s + 0.76, poster(27));
  }

  function archRim(m, s) {
    const z = -s, inside = s === 0 ? -0.045 : 0.045;
    const face = (a,b,c,d,finish) => {
      if (s === 0) m.quad(b,a,d,c,finish);
      else m.quad(a,b,c,d,finish);
    };
    for (let i=0;i<18;i++) {
      const t0 = Math.PI*i/18, t1 = Math.PI*(i+1)/18;
      const a = archPoint(t0,0,false), b = archPoint(t1,0,false);
      face([...a,z], [...b,z], [b[0],5.17,z], [a[0],5.17,z], concrete);
      const innerA = archPoint(t0,0.10,false), innerB = archPoint(t1,0.10,false);
      face([...innerA,z+inside], [...innerB,z+inside], [...b,z], [...a,z], brightSteel);
    }
  }

  function portal(m, s, tile) {
    archRim(m, s);
    const start = s === 0 ? 0 : L-0.15;
    block(m, 3.73, 7.31, 1.09, 5.17, start, start+0.15, tile);
  }

  function bridgeMouth(m, s) {
    archRim(m, s);
    const start = s === 0 ? 0 : L - 0.28;
    for (const [a, b] of [[-12, TRACK_X-2.08], [TRACK_X+2.08, -3.73], [3.73, 12]]) {
      block(m, a, b, -1.32, 5.17, start, start + 0.28, concrete);
    }
    block(m, TRACK_X-2.08, TRACK_X+2.08, 4.07, 5.17, start, start + 0.28, concrete);
    block(m, -12.1, 12.1, 5.17, 5.43, start, start + 0.28, shadowSteel);
    viaduct.shuttlePortal(m, s);
  }

  function signalMast(m, marker) {
    const s = marker.at % L, x = -2.54;
    block(m,x-0.15,x+0.15,0.58,0.74,s,s+0.28,concrete);
    block(m,x-0.065,x+0.065,0.74,2.34,s+0.07,s+0.20,steel);
    block(m,x-0.23,x+0.23,2.01,3.22,s,s+0.18,black);
    const bands = marker.distant ? 2 : 1;
    for (let i=0; i<bands; i++) block(m,x-0.076,x+0.076,1.72+i*0.095,1.77+i*0.095,s+0.04,s+0.22,amber);
    const inks = [0x83ffd4, 0xffc25c, 0xff655b];
    for (const [aspect, color] of inks.entries()) {
      const y = 2.24+aspect*0.365, z = -s+0.008;
      const lens = { ...paint(color,0,1), part: -(aspect+1) };
      front(m,x-0.08,x+0.08,y-0.14,y+0.14,-z,lens);
      for (const side of [-1,1]) {
        const a = [x+side*0.08,y-0.14,z], b = [x+side*0.14,y-0.08,z];
        const c = [b[0],y+0.08,z], d = [a[0],y+0.14,z];
        if (side > 0) m.quad(a,b,c,d,lens); else m.quad(b,a,d,c,lens);
      }
      block(m,x-0.19,x+0.19,y+0.15,y+0.18,s-0.13,s+0.04,dark);
    }
  }

  function speedBoard(m, board) {
    const s = board.at % L, x = 2.67;
    const releasing = board.kmh === lineSpeed.MAX_KMH;
    const rim = releasing ? paint(0x96dcc5, 0, 0.58) : warm;
    block(m, x-0.15, x+0.15, 0.03, 0.23, s, s+0.28, concrete);
    block(m, x-0.045, x+0.045, 0.23, 2.73, s+0.055, s+0.14, steel);
    block(m, x-0.39, x+0.39, 1.95, 2.74, s, s+0.10, black);
    front(m, x-0.37, x+0.37, 1.97, 2.72, s-0.003, rim);
    front(m, x-0.34, x+0.34, 2.00, 2.69, s-0.006, black);
    for (const [i, char] of [...String(board.kmh)].entries()) {
      const n = Number(char), left = x - 0.32 + i * 0.32;
      const ink = { ...rim, texture: 31, uvRect: [n % 5 / 5, Math.floor(n / 5) / 2, 0.2, 0.5] };
      front(m, left, left+0.32, 2.095, 2.61, s-0.009, ink);
    }
    front(m, x-0.24, x+0.24, 2.045, 2.065, s-0.009, rim);
  }

  function platform(m, panes, index, stationIndex) {
    const tile = paint(R.STATIONS[stationIndex].tile, 2, 0.05, { scale: [2.08, 1.04] });
    // The coloured mosaic returns on the trackside wall, above the cable tray.
    leftWall(m, -3.20, 1.67, 3.39, 0, L, tile);
    block(m, -3.41, -3.17, 1.62, 1.69, 0, L, shadowSteel);
    block(m, -3.31, -3.14, 3.36, 3.43, 0, L, steel);
    leftWall(m, -3.183, 1.71, 3.34, 3.9, 10.1, poster(8 + stationIndex));
    block(m, 1.57, 7.30, 0.01, 1.045, 0, L, concrete);
    block(m, 1.59, 7.28, 1.045, 1.09, 0, L, paving);
    block(m, 1.58, 1.68, 0.95, 1.094, 0, L, amber);
    block(m, 2.07, 2.43, 1.091, 1.103, 0, L, tactile);
    rightWall(m, 7.21, 1.09, 4.99, 0, L, tile);
    rightWall(m, 7.197, 1.10, 1.31, 0, L, shadowSteel);
    rightWall(m, 7.197, 4.37, 4.96, 0, L, enamel);
    block(m, -0.12, 7.34, 4.98, 5.17, 0, L, soffit);
    for (const x of [0.65, 3.10, 6.42]) {
      block(m, x - 0.15, x + 0.15, 4.79, 4.98, 0, L, black);
      block(m, x - 0.085, x + 0.085, 4.765, 4.80, 0.13, 7.86, x > 5 ? cool : lamp);
      block(m, x - 0.085, x + 0.085, 4.765, 4.80, 8.13, 15.86, x > 5 ? cool : lamp);
    }
    for (let s = 0; s < L; s += 4) platformDoors(m, panes, s);
    for (let s = 0.26; s < L; s += 8) {
      block(m, -0.2, 7.23, 4.83, 4.98, s, s + 0.13, shadowSteel);
      block(m, 4.78, 5.22, 1.09, 4.82, s + 0.9, s + 1.38, tile);
      block(m, 4.77, 5.23, 1.09, 1.25, s + 0.89, s + 1.39, steel);
      block(m, 4.76, 5.24, 3.07, 3.17, s + 0.88, s + 1.40, enamel);
    }
    rightWall(m, 7.187, 2.03, 3.91, 7.40, 13.80, poster(8 + stationIndex));
    block(m, 7.11, 7.20, 1.77, 3.45, 2.25, 4.86, shadowSteel);
    rightWall(m, 7.097, 1.84, 3.38, 2.32, 4.79, poster(index % 2 ? 19 : 18));
    for (const s of [5.67, 11.9]) {
      block(m, 5.50, 6.08, 1.53, 1.63, s - 0.8, s + 0.8, brightSteel);
      block(m, 6.02, 6.11, 1.61, 2.02, s - 0.8, s + 0.8, steel);
      for (const d of [-0.53, 0.53]) block(m, 5.65, 5.92, 1.09, 1.53, s + d, s + d + 0.07, shadowSteel);
    }
    if (M.mod(index - R.STATIONS[stationIndex].at / L, 2) === 0) {
      const s = 7.65;
      for (const x of [0.56, 3.60]) block(m, x, x + 0.048, 4.70, 4.97, s + 0.055, s + 0.11, steel);
      block(m, 0.24, 3.97, 3.76, 4.72, s, s + 0.15, dark);
      front(m, 0.28, 3.93, 3.80, 4.68, s - 0.006, poster(13 + stationIndex));
    } else {
      block(m, 3.68, 5.79, 3.55, 4.08, 7.0, 7.13, black);
      front(m, 3.70, 5.77, 3.57, 4.06, 6.99, poster(20));
      block(m, 4.67, 4.73, 4.08, 4.99, 7.03, 7.09, steel);
    }
    if (R.stationAt((index + 1) * L + 0.01) < 0) portal(m,L,tile);
    if (R.stationAt(index * L - 0.01) < 0) portal(m,0,tile);
    if (index * L === R.STATIONS[stationIndex].at) {
      block(m, -2.47, -2.40, 0.58, 2.55, 0.015, 0.11, steel);
      block(m, -2.72, -2.15, 2.10, 2.77, 0, 0.065, dark);
      front(m, -2.69, -2.18, 2.13, 2.74, -0.002, poster(30));
    }
  }

  function buildChunk(index) {
    const canonical = M.mod(index, R.LENGTH / L);
    const start = canonical * L;
    const station = R.stationAt(start + L / 2);
    const span = R.viaductAt(start);
    const m = new Mesh(station < 0 ? 4 : Infinity), panes = new Mesh();
    buildTrack(m, M.seeded(canonical + 401));
    if (span) {
      viaduct.deck(m, canonical);
      if (span.start === start) bridgeMouth(m, 0);
      if (span.end === start + L) bridgeMouth(m, L);
    } else {
      arch(m, station >= 0); utilities(m, station >= 0, canonical);
      if (station >= 0) platform(m, panes, canonical, station);
    }
    const marker = signals.markerInChunk(canonical);
    if (marker) signalMast(m, marker);
    const board = lineSpeed.boardInChunk(canonical);
    if (board) speedBoard(m, board);
    const trackEnd = m.vertices.length;
    if (span) viaduct.city(m, canonical, span);
    const bends = new Map();
    function warp(vertices, i) {
      if (station >= 0 || i >= trackEnd) return;
      const z = vertices[i + 2];
      if (!bends.has(z)) bends.set(z, [R.trackOffset(start - z), R.trackSlope(start - z)]);
      const [offset, slope] = bends.get(z);
      vertices[i] += offset;
      vertices[i + 15] = offset;
      const normal = M.normalize([vertices[i + 3], vertices[i + 4], vertices[i + 5] + slope * vertices[i + 3]]);
      vertices.set(normal, i + 3);
    }
    return { station, marker, outdoor: Boolean(span), solid: m.finish(warp), glass: panes.finish(warp) };
  }

  function buildCab() {
    const m = new Mesh(), panes = new Mesh();
    const shell = paint(0x54616a, 3, 0, { scale: [2.4, 1.2] });
    const rubber = paint(0x21292b), dash = paint(0x404e55, 0), lip = paint(0x6c7676);
    const rail = paint(0xd5a354), interior = paint(0x97a197, 3, 0, { scale: [2.8, 1.4] });
    const seat = paint(0x3e7471, 0), windowGlass = { ...glass, alpha: 0.072 };
    m.box(-1.57, 1.10, -1.62, 1.57, 1.65, -0.58, shell);
    m.quad([-1.56, 1.66, -0.58], [1.56, 1.66, -0.58], [1.56, 1.955, -1.60], [-1.56, 1.955, -1.60], dash);
    m.box(-1.58, 1.91, -1.65, 1.58, 1.965, -1.59, rubber);
    m.box(-1.56, 1.932, -1.592, 1.56, 1.950, -1.572, lip);
    m.box(-1.58, 3.13, -1.66, 1.58, 3.32, -1.51, shell);
    m.box(-1.56, 3.102, -1.635, 1.56, 3.14, -1.55, rubber);
    panes.quad([-1.42,1.962,-1.625], [1.42,1.962,-1.625], [1.48,3.12,-1.639], [-1.48,3.12,-1.639],
      { ...windowGlass, alpha: 0.035, part: PART.WINDSCREEN });
    for (const side of [-1, 1]) {
      const x = side * 1.48;
      m.tube([x * 0.96, 1.90, -1.59], [x, 3.17, -1.60], 0.068, shell, 10);
      m.tube([x * 0.952, 1.92, -1.62], [x * 0.988, 3.17, -1.63], 0.040, rubber, 8);
      const bounds = (a, b) => [Math.min(side * a, side * b), Math.max(side * a, side * b)];
      const [a, b] = bounds(1.48, 1.58);
      const sideWindow = side > 0 ? rightWall : leftWall;
      m.box(a, 1.09, -1.60, b, 1.91, 0.83, interior);
      m.box(a, 3.08, -1.60, b, 3.32, 5.40, interior);
      m.box(a, 1.09, 3.12, b, 1.92, 5.40, interior);
      for (const z of [0.81, 3.14, 5.30]) m.box(a, 1.11, z - 0.055, b, 3.11, z + 0.055, shell);
      if (side > 0) {
        m.box(1.415, 2.30, 0.73, 1.485, 2.67, 0.89, rubber);
        sideWindow(m, 1.413, 2.35, 2.62, -0.86, -0.76, guardLamp);
      }
      m.tube([side * 1.36, 1.58, -0.98], [side * 1.36, 3.15, -0.98], 0.032, rail, 12);
      const railX = side * STRAP_RAIL.x;
      m.tube([railX, STRAP_RAIL.y, -0.92], [railX, STRAP_RAIL.y, 5.27], 0.027, brightSteel, 8);
      for (const [z0, z1] of [[-1.56,0.80], [3.19,5.26]]) {
        sideWindow(panes, side*1.53, 1.91, 3.08, -z1, -z0, windowGlass);
      }
      for (const [z0,z1] of [[0.84,1.16], [2.84,3.14]]) {
        m.box(a, 1.09, z0, b, 1.91, z1, interior);
        sideWindow(panes, side*1.53, 1.91, 3.08, -z1, -z0, windowGlass);
      }
      // Carriage doors share their centre line with the corresponding platform pair.
      const [da, db] = bounds(1.435, 1.478);
      for (const direction of [-1, 1]) {
        const mid = 2 + direction * 0.42;
        const z0 = mid - 0.414, z1 = mid + 0.414;
        const slide = direction * 0.81 * (side > 0 ? 1 : 0);
        const doorFrame = { ...shell, slide };
        m.box(da, 1.09, z0, db, 1.91, z1, doorFrame);
        m.box(da, 2.83, z0, db, 3.07, z1, doorFrame);
        m.box(da, 1.90, z0, db, 2.85, z0 + 0.055, doorFrame);
        m.box(da, 1.90, z1 - 0.055, db, 2.85, z1, doorFrame);
        sideWindow(panes, side * 1.46, 1.90, 2.84, -z1, -z0, { ...glass, alpha: 0.09, slide });
        sideWindow(m, side*1.431, 1.83, 1.85, -z1, -z0, { ...brass, slide });
      }
      sideWindow(m, side*1.475, 3.082, 3.185, -2.50, -1.50, poster(27));
      const [seatA, seatB] = bounds(0.92, 1.47), [backA, backB] = bounds(1.37, 1.46);
      for (const z of [3.62, 4.45]) {
        m.box(seatA, 1.46, z, seatB, 1.62, z + 0.77, seat);
        m.box(backA, 1.62, z, backB, 1.99, z + 0.77, seat);
        m.tube([side*1.22,1.09,z+0.38], [side*1.22,1.46,z+0.38], 0.034, brightSteel);
      }
      for (const z of [-0.42, 1.25, 2.65, 3.91, 4.73]) {
        const strap = { ...rubber, part: PART.STRAP, hingeZ: z };
        const grip = { ...rail, part: PART.STRAP, hingeZ: z };
        m.tube([railX,STRAP_RAIL.y,z], [railX,2.79,z], 0.015, strap);
        m.tube([railX,2.79,z], [railX,2.66,z-0.072], 0.019, grip);
        m.tube([railX,2.66,z-0.072], [railX,2.66,z+0.072], 0.019, grip);
        m.tube([railX,2.66,z+0.072], [railX,2.79,z], 0.019, grip);
      }
    }
    m.box(-1.57, 1.02, -1.61, 1.57, 1.09, 5.44, shutter);
    m.box(-1.57, 3.20, -1.61, 1.57, 3.30, 5.44, interior);
    m.box(-1.55, 1.09, 5.32, 1.55, 3.20, 5.44, interior);
    m.box(-0.57,1.09,5.27,0.57,2.99,5.32,rubber);
    m.box(-0.53,1.10,5.25,0.53,2.95,5.27,shell);
    m.box(-0.39,1.90,5.23,0.39,2.76,5.25,dark);
    m.box(-0.36,1.94,5.22,0.36,2.72,5.23,paint(0x294447));
    for (const x of [-0.75, 0.75]) m.box(x - 0.055, 3.179, -1.42, x + 0.055, 3.202, 5.30, lamp);

    // The hanging information display faces the rear seats, above the aisle.
    for (const x of [-0.72, 0.72]) m.box(x-0.026,3.10,0.42,x+0.026,3.19,0.49,steel);
    m.box(-1.08,2.825,0.40,1.08,3.116,0.52,rubber);
    front(m,-1.04,1.04,2.841,3.101,-0.522,{ ...lamp, part: PART.SALOON_SIGN });

    // Instruments sit on the inclined desk. The front windscreen stays clear.
    const deskY = z => 1.66 + (-z - 0.58) * 0.295 / 1.02;
    function plate(x0, x1, z0, z1, rise, material) {
      m.quad([x0, deskY(z1) + rise, z1], [x1, deskY(z1) + rise, z1],
        [x1, deskY(z0) + rise, z0], [x0, deskY(z0) + rise, z0], material);
    }
    plate(-1.13, -0.33, -1.51, -0.96, 0.007, rubber);
    plate(-1.095, -0.365, -1.48, -0.99, 0.009, poster(22));
    plate(-0.23, 0.21, -1.49, -1.14, 0.009, paint(0x8d9896, 28));
    plate(0.265, 0.455, -1.49, -1.12, 0.009, rubber);
    for (let i=0; i<5; i++) plate(0.416,0.449,-1.45+i*0.065,-1.44+i*0.065,0.012,lip);
    m.tube([0.345,deskY(-1.29),-1.29], [0.345,2.048,-1.34], 0.025, brightSteel);
    m.tube([0.278,2.049,-1.34], [0.411,2.049,-1.34], 0.04, rubber, 12);
    plate(0.51, 1.22, -1.51, -1.02, 0.008, rubber);
    plate(0.53, 1.20, -1.49, -1.04, 0.011, poster(23));
    for (let i = 0; i < 3; i++) {
      const x = 0.64 + i * 0.19;
      plate(x, x + 0.085, -1.39, -1.29, 0.016, [warm, { ...paint(0x8ac4af, 0, 0.57), part: PART.GUARD_LAMP }, brass][i]);
    }
    m.box(BLADE.x-0.05, 1.942, -1.676, BLADE.x+0.05, 2.016, -1.644, rubber);
    m.part = PART.WIPER;
    const arm = (radius, z, lift = 0) => [BLADE.x - radius * Math.cos(BLADE.park),
      BLADE.y + radius * Math.sin(BLADE.park) + lift, z];
    m.tube(arm(0, -1.682), arm(0.72, -1.686), 0.012, black, 6);
    m.tube(arm(0, -1.682, 0.018), arm(0.72, -1.686, 0.006), 0.007, shadowSteel, 5);
    m.tube(arm(BLADE.inner, -1.673), arm(BLADE.outer, -1.673), 0.014, rubber, 6);
    return { station: -1, solid: m.finish(), glass: panes.finish() };
  }

  const api = { buildChunk, buildCab };
  if (node) module.exports = api;
  else Nightline.world = api;
})();
