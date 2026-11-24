(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./quay.js'), require('./vessels.js'), require('./cableway.js'));
  else root.HarbourCity = factory(root.HarbourMath, root.HarbourMesh, root.HarbourQuay, root.HarbourVessels, root.HarbourCableway);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, G, Quay, Vessels, Cableway) {
  'use strict';
  const SEED = 0x4E495445;
  const {solid, light, wall} = G;
  const roof = solid([0.103, 0.157, 0.168]);
  const steel = solid([0.125, 0.185, 0.197]);
  const dark = solid([0.068, 0.109, 0.128]);
  const opal = light([0.51, 0.83, 0.81]);
  const signal = light([1, 0.25, 0.16]);

  const signDesigns = [
    {han: '晚潮冰室', latin: 'TIDE CAFE', color: 'coral', type: 'vertical'},
    {han: '銀灣戲院', latin: 'SILVER BAY', color: 'jade', type: 'vertical'},
    {han: '南風旅舍', latin: 'SOUTH WIND', color: 'gold', type: 'vertical'},
    {han: '月帆茶樓', latin: 'MOON SAIL', color: 'pink', type: 'vertical'},
    {han: '長夜書房', latin: 'NIGHT BOOKS', color: 'blue', type: 'vertical'},
    {han: '夜渡小館', latin: 'NIGHT PIER', color: 'coral', type: 'horizontal'},
    {han: '九龍印務', latin: 'KOWLOON PRINT', color: 'jade', type: 'horizontal'},
    {han: '三人茶座', latin: 'TABLE FOR THREE', color: 'gold', type: 'horizontal'},
    {han: '通宵自修室', latin: 'KOWLOON TONG  /  STUDY LATE', color: 'pink', type: 'horizontal'}
  ];
  function signRect(id) {
    return id < 5 ? {x: id * 200 + 4, y: 4, w: 192, h: 688}
      : {x: ((id - 5) % 2) * 512 + 4, y: 708 + Math.floor((id - 5) / 2) * 154, w: 504, h: 144};
  }
  const shoreZ = Quay.shoreZ;
  function ridgeHeight(x, layer) {
    const phase = layer * 1.73;
    return 25 + layer * 10 +
      (8 + layer * 2) * Math.sin(x * 0.023 + phase) + 8 * Math.sin(x * 0.042 - phase) +
      4 * Math.cos(x * 0.085 + phase) + 1.8 * Math.sin(x * 0.157 + phase) +
      13 * Math.pow(Math.sin(x * 0.011 - phase), 2);
  }
  function readSeed(search, hash) {
    for (const source of [hash.replace(/^#/, ''), search]) {
      const value = new URLSearchParams(source).get('seed');
      if (value !== null && /^\d{1,10}$/.test(value) && Number(value) <= 0xffffffff) return Number(value);
    }
    return SEED;
  }
  function generateCity(seed = SEED) {
    seed = seed >>> 0;
    const rng = M.random(seed);
    const range = (a, b) => M.mix(a, b, rng());
    const landmarks = [
      {x: 22, z: -79, width: 13.5, depth: 12, height: 61},
      {x: -55, z: -85, width: 13, depth: 10.8, height: 49, tile: 10, trim: [0.94,0.73,0.49]},
      {x: 69, z: -93, width: 14.5, depth: 12.0, height: 58, tile: 6, trim: opal.color},
      {x: -114, z: -75, width: 12, depth: 10.0, height: 43, tile: 2, trim: opal.color}
    ];
    const buildings = [];
    for (let row = 0; row < 5; row++) {
      let left = -258 + range(-7, 4);
      while (left < 254) {
        const width = row === 0 ? range(5.8, 12.2) : range(6.5, 14.8);
        const x = left + width * 0.5;
        const depth = range(6, 10.6) + row * 0.85;
        const z = shoreZ(x) - 5.5 - depth / 2 - row * 18.5 - range(0, 2.8);
        let height = range(6.3, 18.8) + row * range(3.5, 7.2);
        height += Math.max(0, Math.cos((x - 41) / 28)) * range(1, 8);
        if (row > 0 && rng() < 0.15) height *= range(1.15, 1.48);
        const style = Math.floor(rng() * 16);
        const setback = row > 0 && rng() > 0.47;
        const paint = range(0.76, 1.1);
        const lot = {x, z, row, width, depth, height, style, setback, paint,
          roofType: Math.floor(rng() * 5), offset: range(0, 20), rib: rng() > 0.64};
        const reserved = landmarks.some(tower =>
          Math.abs(tower.x - x) < (tower.width + width) / 2 + 0.6 &&
          Math.abs(tower.z - z) < (tower.depth + depth) / 2 + 0.6);
        const limit = Cableway.roofLimit(lot);
        if (!reserved && limit > 5) {
          lot.height = Math.min(lot.height, limit);
          buildings.push(lot);
        }
        left += width + range(0.7, row ? 3.5 : 2.3);
      }
    }
    // A few designed addresses anchor the randomly parcelled waterfront.
    const addresses = [
      [35, 0, 0, 27, 4.2, 20.8], [-31, 0, 1, 20, 3.3, 15.2], [-66, 0, 2, 24, 3.5, 16.8],
      [62, 0, 3, 24, 3.7, 17.4], [6, 0, 2, 17.7, 2.8, 12.5], [91, 0, 4, 26, 3.6, 16.5],
      [-107, 0, 0, 25, 3.7, 17], [138, 0, 1, 22, 3.3, 15.5], [-144, 0, 3, 20, 3, 14],
      [-10, 0, 5, 12, 10.5, 3.2], [20, 0, 6, 14, 9.2, 2.9], [-49, 0, 7, 12, 8.6, 2.8],
      [48, 0, 8, 13, 9.1, 3.1], [-83, 0, 6, 13, 9.3, 3], [114, 0, 5, 14, 10.1, 3.1],
      [73, 1, 5, 33, 12, 3.8], [-42, 2, 6, 34, 12.7, 3.6]
    ];
    const signs = [], signed = new Set();
    for (const [at, row, design, height, w, h] of addresses) {
      const lot = buildings.filter(b => b.row === row && !signed.has(b) && Cableway.roofLimit(b) >= height)
        .reduce((a, b) => Math.abs(a.x - at) < Math.abs(b.x - at) ? a : b);
      signed.add(lot);
      lot.height = height;
      const vertical = signDesigns[design].type === 'vertical';
      signs.push({design, x: lot.x + (vertical ? lot.width * 0.31 : 0), y: height - h + (vertical ? 0.7 : -0.9),
        z: lot.z + lot.depth / 2 + (vertical ? 1.4 : 0.5), w: Math.min(w, lot.width - 0.25), h, vertical});
    }
    return {seed, buildings, landmarks, signs};
  }
  function addHills(mesh) {
    for (let layer = 0; layer < 3; layer++) {
      const z = -147 - layer * 68;
      const color = [[0.095,0.166,0.194], [0.125,0.204,0.234], [0.162,0.236,0.259]][layer];
      const material = {tile: -3, color};
      for (let x = -640; x < 640; x += 3.2) {
        const r = x + 3.2;
        mesh.face([[x,-3,z], [r,-3,z], [r,ridgeHeight(r, layer),z], [x,ridgeHeight(x, layer),z]], material);
      }
    }
  }
  function addBuilding(mesh, b) {
    const {x,z,width:w,depth:d,height:h,style,offset} = b;
    const facade = wall(style, [b.paint, b.paint, b.paint]);
    mesh.box(x, 1.28, z, w, h - 1.28, d, facade, roof, offset);
    mesh.box(x, h - 0.25, z, w + 0.26, 0.45, d + 0.27, steel);
    let top = h;
    if (b.setback) {
      const upper = h * 0.16;
      mesh.box(x - w * 0.06, h, z, w * 0.75, upper, d * 0.83, facade, roof, offset);
      top += upper;
    }
    if (b.roofType !== 0) {
      mesh.box(x + w * 0.12, top, z - 0.4, w * 0.33, 1.2 + b.roofType * 0.4, d * 0.45, steel);
      if (b.roofType === 2 || b.roofType === 4) {
        mesh.box(x - w * 0.24, top, z + 0.55, 1.25, 1.8, 1.6, dark);
        mesh.box(x - w * 0.24, top + 1.8, z + 0.55, 1.4, 0.14, 1.74, steel);
      }
    }
    if (b.roofType === 3 && b.row > 0) {
      mesh.box(x + w * 0.14, top, z, 0.16, 5.3, 0.16, steel);
      if (h > 34) mesh.box(x + w * 0.14, top + 5.3, z, 0.25, 0.21, 0.25, signal);
    }
    if (b.rib) {
      const bands = 2 + (style % 3);
      for (let i = 1; i <= bands; i++) {
        mesh.box(x, h * i / (bands + 1), z, w + 0.13, 0.30, d + 0.16, steel);
      }
    }
    if (b.row === 0) addShops(mesh, b);
  }
  function addShops(mesh, lot) {
    const z = lot.z + lot.depth / 2 + 0.17;
    const left = lot.x - lot.width / 2 + 0.22, width = lot.width - 0.44;
    const bays = Math.max(3, Math.floor(width / 1.6));
    const glazing = [light([0.81,0.54,0.32]), light([0.62,0.73,0.62]), light([0.89,0.68,0.46])];
    const cloth = [solid([0.41,0.18,0.16]), solid([0.12,0.32,0.29]), solid([0.44,0.31,0.20])][lot.style % 3];
    const canvasStripe = solid([0.45,0.43,0.35]);
    for (let i = 0; i < bays; i++) {
      const l = left + i * width / bays, r = left + (i + 1) * width / bays;
      const glass = (i + lot.roofType) % 5 === 0 ? dark : glazing[(i + lot.style) % 3];
      mesh.face([[l,1.48,z], [r-0.13,1.48,z], [r-0.13,3.4,z], [l,3.4,z]], glass);
      mesh.face([[l,2.85,z+0.02], [r,2.85,z+0.02], [r,2.94,z+0.02], [l,2.94,z+0.02]], steel);
      const awning = lot.style % 2 === 0 && i % 2 ? canvasStripe : cloth;
      mesh.face([[l,3.65,z+1.18], [r,3.65,z+1.18], [r,4.18,z], [l,4.18,z]], awning);
      mesh.face([[l,3.45,z+1.18], [r,3.45,z+1.18], [r,3.65,z+1.18], [l,3.65,z+1.18]], awning);
    }
  }
  function addSign(mesh, s) {
    const {x,y,z,w,h} = s;
    mesh.box(x, y-0.10, z-0.17, w+0.2, h+0.2, 0.33, dark);
    if (s.vertical) {
      mesh.box(x, y + h * 0.13, z - 0.78, 0.34, 0.19, 1.52, steel);
      mesh.box(x, y + h * 0.89, z - 0.78, 0.34, 0.19, 1.52, steel);
    }
    const r = signRect(s.design);
    const l = (r.x+0.5)/1024, t = (r.y+0.5)/1024, right = (r.x+r.w-0.5)/1024, b = (r.y+r.h-0.5)/1024;
    mesh.face([[x-w/2,y,z+0.01], [x+w/2,y,z+0.01], [x+w/2,y+h,z+0.01], [x-w/2,y+h,z+0.01]],
      wall(16 + s.design), [[l,b],[right,b],[right,t],[l,t]]);
  }
  function rectangle(x,y,z,w,d) {
    return [[x-w/2,y,z+d/2], [x+w/2,y,z+d/2], [x+w/2,y,z-d/2], [x-w/2,y,z-d/2]];
  }
  function addLandmarks(mesh, [lantern, ...terraced]) {
    // Folded glass lantern with a sloping crown and illuminated diagonal ribs.
    const {x, z, width: w, depth: d, height: h} = lantern;
    mesh.box(x, 1.3, z, w, h-1.3, d, wall(14), roof);
    const lower = rectangle(x,h,z,w,d);
    const upper = rectangle(x, h+7.7, z, w, d);
    upper[0][1] = h+1.5; upper[3][1] = h+1.5;
    mesh.rings(lower, upper, wall(14), steel);
    const rib = light([0.47, 0.79, 0.81]);
    for (let j = 0; j < 4; j++) {
      const next = (j+1)%4;
      mesh.beam([lower[j][0],1.5,lower[j][2]], upper[j], 0.12, rib);
      mesh.beam(upper[j], upper[next], 0.16, opal);
      for (let i = 0; i < 4; i++) {
        const a = i % 2 ? next : j, b = i % 2 ? j : next;
        mesh.beam([lower[a][0],5+i*14,lower[a][2]+0.06], [lower[b][0],19+i*14,lower[b][2]+0.06], 0.19, rib);
      }
    }
    for (const dz of [-3.3, 3.3]) {
      mesh.beam([x+w/2-0.35,h+7,z+dz], [x+w/2-0.35,h+15.7,z+dz], 0.13, opal);
      mesh.box(x+w/2-0.35,h+15.6,z+dz,0.34,0.3,0.34,signal);
    }
    // Stacked brass-lit shoulders and a fluted office tower on opposite banks of the frame.
    for (const {x: cx, z: cz, height: baseH, width, depth, trim, tile} of terraced) {
      const accent = light(trim);
      let y = 1.3;
      for (let level = 0; level < 4; level++) {
        const size = width*(1-level*0.143), height = level === 0 ? baseH : 2.8;
        const d = depth * (size / width);
        mesh.box(cx,y,cz,size,height,d,wall(tile),roof,2);
        y += height;
        mesh.box(cx,y-0.28,cz,size+0.1,0.28,d+0.1,accent);
      }
      mesh.beam([cx,y,cz],[cx,y+4.8,cz],0.13,steel);
      mesh.box(cx,y+4.8,cz,0.28,0.2,0.28,signal);
      for (let k = 0; k < 5; k++) {
        mesh.box(cx + (k-2)*width/5, 3, cz+depth/2+0.03, 0.13, baseH-1.8, 0.12, steel);
      }
    }
  }
  function buildWorld(city) {
    const mesh = new G.Mesh();
    addHills(mesh);
    Quay.addWaterfront(mesh);
    Cableway.addLine(mesh);
    city.buildings.forEach(b => addBuilding(mesh,b));
    addLandmarks(mesh, city.landmarks);
    city.signs.forEach(s => addSign(mesh,s));
    return mesh.finish();
  }
  return {SEED, signDesigns, signRect, shoreZ, ridgeHeight, readSeed, generateCity, buildWorld,
    ferryPose: Vessels.ferryPose, buildFerry: Vessels.buildFerry, junkPose: Vessels.junkPose, buildJunk: Vessels.buildJunk};
});
