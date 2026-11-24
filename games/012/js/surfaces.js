(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { TAU, clamp, wrap, randomGenerator } = common ? require("./math.js") : root.OrbitAtlas.math;
  const { byId } = common ? require("./catalog.js") : root.OrbitAtlas.catalog;

  const mix = (a, b, t) => a + (b - a) * t;
  const fade = t => t * t * (3 - 2 * t);
  const smooth = (a, b, value) => fade(clamp((value - a) / (b - a), 0, 1));
  const paint = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const noiseRandom = randomGenerator(762016);
  const lattice = Float32Array.from({ length: 32 ** 3 }, noiseRandom);

  function noise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
    const a = ix & 31, b = (ix + 1) & 31;
    const c = (iy & 31) << 5, d = ((iy + 1) & 31) << 5;
    const e = (iz & 31) << 10, f = ((iz + 1) & 31) << 10;
    return mix(mix(mix(lattice[a+c+e], lattice[b+c+e], u), mix(lattice[a+d+e], lattice[b+d+e], u), v),
      mix(mix(lattice[a+c+f], lattice[b+c+f], u), mix(lattice[a+d+f], lattice[b+d+f], u), v), w);
  }

  function terrain(x, y, z) {
    return noise(x, y, z) * 0.53 + noise(x * 2.1 + 7, y * 2.1, z * 2.1) * 0.27
      + noise(x * 4.3, y * 4.3 + 11, z * 4.3) * 0.14 + noise(x * 9, y * 9, z * 9 + 3) * 0.06;
  }

  // Hand-drawn coastlines, in longitude/latitude. Scan-convert once, then
  // perturb at sampling time to add islands, broken shores and shallow shelves.
  const continents = [
    [[-169,66],[-162,71],[-144,70],[-130,69],[-119,76],[-98,74],[-94,70],[-82,72],[-79,64],[-89,59],[-84,55],[-78,55],[-77,63],[-67,59],[-61,54],[-55,52],[-56,48],[-66,45],[-70,41],[-75,37],[-80,32],[-81,25],[-84,29],[-91,29],[-97,26],[-97,20],[-91,18],[-89,22],[-86,21],[-88,16],[-84,15],[-83,10],[-78,8],[-80,7],[-85,10],[-90,14],[-97,16],[-106,21],[-109,26],[-113,31],[-110,23],[-115,28],[-118,34],[-123,38],[-125,45],[-128,51],[-134,56],[-140,59],[-151,60],[-160,56],[-165,55],[-158,59],[-166,62]],
    [[-80,11],[-74,12],[-69,11],[-62,10],[-60,8],[-52,4],[-49,0],[-44,-2],[-35,-6],[-35,-10],[-39,-18],[-41,-22],[-47,-24],[-49,-29],[-54,-34],[-58,-35],[-57,-38],[-64,-42],[-65,-48],[-68,-54],[-73,-55],[-75,-50],[-74,-42],[-72,-38],[-71,-30],[-70,-20],[-76,-14],[-81,-6],[-80,-2],[-77,2],[-78,6]],
    [[-53,60],[-46,60],[-40,65],[-27,71],[-20,77],[-22,82],[-39,84],[-57,81],[-68,77],[-60,72],[-55,69]],
    [[-18,15],[-17,21],[-13,28],[-10,32],[-6,36],[2,36],[10,37],[12,33],[19,30],[24,32],[32,31],[35,27],[37,22],[43,12],[50,12],[51,10],[47,4],[42,-2],[39,-6],[40,-13],[36,-19],[35,-24],[32,-29],[27,-34],[19,-35],[16,-29],[13,-22],[12,-16],[13,-12],[10,-6],[8,-1],[9,4],[3,6],[-3,5],[-8,5],[-14,9]],
    [[-10,36],[-9,43],[-2,44],[-5,48],[1,49],[4,52],[9,54],[8,58],[11,57],[12,54],[15,54],[20,55],[24,59],[28,60],[23,64],[20,62],[18,58],[13,56],[8,59],[5,60],[7,64],[13,69],[23,71],[31,70],[41,67],[49,68],[58,70],[69,73],[80,74],[96,78],[106,77],[113,73],[128,74],[141,72],[157,71],[170,68],[179,67],[179,61],[170,60],[164,55],[159,51],[156,52],[161,60],[154,59],[146,59],[140,54],[141,48],[135,43],[130,42],[128,38],[129,35],[126,34],[125,39],[120,39],[122,36],[120,32],[122,30],[119,25],[115,22],[110,21],[107,20],[106,16],[109,12],[106,9],[102,11],[100,15],[99,10],[104,2],[102,1],[97,8],[95,16],[91,22],[87,21],[85,18],[81,15],[78,8],[76,9],[72,19],[68,23],[61,25],[57,25],[54,27],[49,30],[51,25],[55,24],[56,26],[59,23],[57,18],[49,15],[44,12],[42,16],[39,20],[35,28],[32,30],[35,35],[29,37],[26,39],[27,41],[23,40],[24,36],[21,37],[19,41],[14,45],[16,41],[17,39],[15,38],[12,42],[9,44],[5,43],[2,41],[0,38],[-5,36]],
    [[112,-22],[115,-20],[120,-19],[125,-14],[130,-12],[134,-12],[137,-15],[141,-17],[142,-10],[145,-15],[146,-19],[151,-24],[154,-28],[152,-33],[149,-38],[145,-39],[141,-37],[137,-35],[133,-32],[128,-32],[123,-34],[116,-35],[113,-31]],
    [[44,-13],[49,-12],[50,-16],[47,-25],[44,-25],[43,-21]],
    [[-6,50],[-3,51],[-5,54],[-3,55],[-6,58],[-3,59],[0,56],[-1,54],[2,53],[1,51]],
    [[-11,52],[-9,55],[-6,55],[-6,52]], [[-24,64],[-18,67],[-13,65],[-17,63]],
    [[130,32],[134,34],[138,35],[140,39],[142,41],[141,36],[137,33],[131,31]],
    [[141,42],[143,46],[146,44],[144,42]], [[95,6],[100,2],[106,-6],[102,-5],[98,0]],
    [[108,3],[117,7],[119,2],[116,-4],[110,-3]], [[105,-6],[114,-7],[115,-9],[108,-8]],
    [[131,-1],[138,-2],[145,-4],[152,-10],[144,-8],[138,-6],[134,-4]],
    [[173,-34],[178,-38],[175,-41],[173,-39]], [[173,-41],[172,-44],[167,-47],[166,-45]],
    [[119,18],[122,19],[124,12],[121,13]], [[-84,23],[-78,22],[-74,20],[-79,20]],
    [[-80,73],[-77,79],[-66,77],[-64,69],[-70,66]], [[-97,76],[-95,80],[-85,80],[-84,75]]
  ];

  function landMask(width, height) {
    const mask = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) {
      const lat = (row + 0.5) * 180 / height - 90;
      for (const polygon of continents) {
        const edges = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          if ((a[1] > lat) === (b[1] > lat)) continue;
          edges.push(a[0] + (lat - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        edges.sort((a, b) => a - b);
        for (let i = 0; i + 1 < edges.length; i += 2) {
          const col = lon => clamp(Math.ceil((lon + 180) * width / 360 - 0.5), 0, width);
          mask.fill(1, row * width + col(edges[i]), row * width + col(edges[i + 1]));
        }
      }
    }
    return (lon, lat) => mask[clamp(Math.floor((lat + 90) * height / 180), 0, height - 1) * width
      + Math.floor(wrap(lon + 180, 360) * width / 360)];
  }

  function earthColor(x, y, z, lon, lat, broad, fine, land) {
    const shift = (broad - 0.5) * 7 + (fine - 0.5) * 1.8;
    const solid = land(lon + shift, lat + shift * 0.65);
    let color;
    if (solid) {
      const dry = Math.exp(-(((Math.abs(lat) - 25) / 12) ** 2)) * (0.38 + broad * 0.86);
      const forest = paint([48, 85, 66], [142, 154, 112], broad);
      color = paint(forest, [221, 185, 126], clamp(dry, 0, 1));
      const ridge = smooth(0.58, 0.76, broad) * 0.62;
      color = paint(color, [171, 147, 118], ridge);
    } else {
      const shallow = land(lon + shift + 1.8, lat + shift * 0.65 + 1.4);
      color = paint([27, 64, 104], [58, 111, 153], broad + fine * 0.1);
      if (shallow) color = paint(color, [76, 149, 157], 0.58);
    }
    const ice = smooth(69, 83, Math.abs(lat) + (broad - 0.5) * 14 + (lat < 0 ? 7 : 0));
    color = paint(color, [222, 232, 226], ice);
    const twist = Math.sin(y * 13 + broad * 5) * 1.6;
    const weather = terrain(x * 7 + twist, y * 12 + broad * 1.8, z * 7 + twist * 0.7);
    const cloud = smooth(0.49, 0.71, weather + 0.035 * Math.sin(lat * 0.65 + broad * 10));
    return [...paint(color, [239, 241, 228], cloud * 0.94), solid ? 4 : Math.round(200 * (1 - cloud))];
  }

  function gasColor(id, lat, lon, broad, fine) {
    const wave = lat + (broad - 0.5) * 6 + Math.sin(lon * 0.09 + lat * 0.12) * 0.52;
    const ribbons = Math.sin(wave * 0.59) * 0.5 + Math.sin(wave * 1.65) * 0.21;
    if (id === "jupiter") {
      const belt = Math.exp(-(((wave - 15) / 6) ** 2)) + Math.exp(-(((wave + 17) / 7.2) ** 2));
      let color = paint([224, 209, 181], [161, 111, 86],
        clamp(0.18 + belt * 0.72 + ribbons * 0.24 + (broad - 0.5) * 0.38, 0, 1));
      const d = (((lon - 9) / 14) ** 2 + ((lat + 21 + Math.sin(lon * 0.14)) / 5.5) ** 2) ** 0.5;
      color = paint(color, [172, 109, 83], (1 - smooth(0.68, 1.12, d)) * (0.75 + 0.2 * Math.cos(d * 14)));
      return color;
    }
    const tones = {
      saturn: [[168, 146, 108], [235, 215, 170]],
      uranus: [[122, 177, 180], [182, 215, 210]],
      neptune: [[60, 95, 157], [106, 151, 199]]
    }[id];
    return paint(tones[0], tones[1], clamp(0.5 + Math.cos(wave * 0.14) * 0.21
      + ribbons * (id === "uranus" ? 0.045 : 0.17) + (broad - 0.5) * 0.31 + fine * 0.04, 0, 1));
  }

  function addCraters(data, width, height, seed) {
    const random = randomGenerator(seed);
    for (let i = 0; i < 290; i++) {
      const cx = random() * width, cy = (0.07 + random() * 0.86) * height;
      const ry = (0.003 + Math.pow(random(), 4) * 0.035) * height;
      const rx = ry * width / (height * 2 * Math.sin(cy * Math.PI / height));
      for (let row = Math.max(0, Math.floor(cy - ry)); row <= Math.min(height - 1, cy + ry); row++) {
        for (let col = Math.floor(cx - rx); col <= cx + rx; col++) {
          const dx = (col - cx) / rx, dy = (row - cy) / ry, r = Math.hypot(dx, dy);
          if (r >= 1) continue;
          const rim = Math.exp(-(((r - 0.78) / 0.14) ** 2));
          const amount = (dx - dy) * rim * 34 - (1 - r) * 21;
          const index = (row * width + wrap(col, width)) * 4;
          for (let c = 0; c < 3; c++) data[index + c] = clamp(data[index + c] + amount, 0, 255);
        }
      }
    }
  }

  function surface(id, width = 512, height = 256) {
    if (!Object.hasOwn(byId, id)) throw new RangeError("Unknown celestial body");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
      throw new RangeError("Invalid surface resolution");
    }
    const data = new Uint8Array(width * height * 4);
    const land = id === "earth" ? landMask(width, height) : null;
    const meridians = Array.from({ length: width }, (_, col) => {
      const lon = ((col + 0.5) / width - 0.5) * TAU;
      return [Math.sin(lon), Math.cos(lon), lon * 180 / Math.PI];
    });
    for (let row = 0; row < height; row++) {
      const phi = ((row + 0.5) / height - 0.5) * Math.PI;
      const y = Math.sin(phi), cp = Math.cos(phi), lat = phi * 180 / Math.PI;
      for (let col = 0; col < width; col++) {
        const [s, c, lon] = meridians[col], x = s * cp, z = c * cp;
        const broad = terrain(x * 3.6 + 8, y * 3.6 + 2, z * 3.6);
        const fine = noise(x * 91 + 8, y * 91, z * 91);
        let color;
        if (id === "earth") color = earthColor(x, y, z, lon, lat, broad, fine, land);
        else if (id === "sun") {
          const cells = terrain(x * 31 + broad * 3, y * 31, z * 31) * 0.6 + fine * 0.4;
          color = paint([244, 116, 24], [255, 228, 125], clamp(cells * 1.3 + (broad - 0.5) * 0.6, 0, 1));
        } else if (id === "mercury") {
          color = paint([89, 87, 86], [197, 188, 174], broad * 0.81 + fine * 0.25);
        } else if (id === "moon") {
          const basalt = smooth(0.40, 0.53, broad + 0.07 * Math.sin(4*x + 2*y));
          color = paint([87, 91, 98], [204, 202, 195], basalt * 0.78 + fine * 0.19);
        } else if (id === "mars") {
          color = paint([110, 75, 63], [219, 143, 98], smooth(0.27, 0.72, broad + fine * 0.09));
          color = paint(color, [222, 216, 195], smooth(75, 87, Math.abs(lat) + (broad - 0.5) * 16));
        } else if (id === "venus") {
          const swirls = terrain(x * 3 + broad * 3, y * 11 + broad * 2, z * 3);
          color = paint([179, 134, 86], [240, 216, 164], swirls * 0.85 + broad * 0.25);
        } else color = gasColor(id, lat, lon, broad, fine);
        const k = (row * width + col) * 4;
        for (let ch = 0; ch < 3; ch++) data[k + ch] = clamp(Math.round(color[ch]), 0, 255);
        data[k + 3] = color[3] || 0;
      }
    }
    if (id === "mercury" || id === "moon") addCraters(data, width, height, id === "moon" ? 23701 : 87211);
    return { width, height, data };
  }

  const cache = new Map();
  function textureFor(id) {
    if (!cache.has(id)) cache.set(id, surface(id, id === "earth" ? 512 : 256, id === "earth" ? 256 : 128));
    return cache.get(id);
  }

  function dustMap(size = 128) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = Math.round(255 * smooth(0.26, 0.79, terrain(x / 21, y / 20, 15.2)));
        data.set([value, value, value, 255], (y * size + x) * 4);
      }
    }
    return { width: size, height: size, data };
  }

  const api = { surface, landMask, textureFor, dustMap };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).surfaces = api;
})(globalThis);
