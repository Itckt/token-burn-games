"use strict";

// Paint the two original landscapes on a small indexed-pixel canvas.
// Run "node tools/draw-art.js" to reproduce the checked-in PNGs.
const fs = require("node:fs");
const path = require("node:path");
const { deflateSync } = require("node:zlib");

class Canvas {
  constructor(w, h, background) {
    this.w = w;
    this.h = h;
    this.pixels = Buffer.alloc(w * h);
    this.palette = [];
    this.indices = new Map();
    this.rect(0, 0, w, h, background);
  }
  ink(color) {
    if (!this.indices.has(color)) {
      this.indices.set(color, this.palette.length);
      this.palette.push(Buffer.from(color.slice(1), "hex"));
    }
    return this.indices.get(color);
  }
  rect(x, y, w, h, color) {
    const ink = this.ink(color);
    const left = Math.max(0, Math.round(x));
    const right = Math.min(this.w, Math.round(x + w));
    if (left >= right) return;
    for (let row = Math.max(0, Math.round(y)); row < Math.min(this.h, Math.round(y + h)); row++) {
      this.pixels.fill(ink, row * this.w + left, row * this.w + right);
    }
  }
  polygon(points, color) {
    const ys = points.map(p => p[1]);
    for (let y = Math.max(0, Math.min(...ys)); y < Math.min(this.h, Math.max(...ys)); y++) {
      const hits = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) hits.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) this.rect(hits[i], y, hits[i + 1] - hits[i], 1, color);
    }
  }
  disc(x, y, radius, color) {
    for (let j = -radius; j <= radius; j++) {
      const width = Math.floor(Math.sqrt(radius * radius - j * j));
      this.rect(x - width, y + j, width * 2 + 1, 1, color);
    }
  }
  png() {
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const chunk = (name, data) => {
      const type = Buffer.from(name);
      let crc = 0xffffffff;
      for (const byte of Buffer.concat([type, data])) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      const size = Buffer.alloc(4);
      size.writeUInt32BE(data.length);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
      return Buffer.concat([size, type, data, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.w, 0);
    header.writeUInt32BE(this.h, 4);
    header[8] = 8;
    header[9] = 3;
    const rows = [];
    for (let y = 0; y < this.h; y++) rows.push(Buffer.from([0]), this.pixels.subarray(y * this.w, (y + 1) * this.w));
    return Buffer.concat([signature, chunk("IHDR", header), chunk("PLTE", Buffer.concat(this.palette)),
      chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}

function random(seed) {
  return max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * max);
  };
}

function ground(canvas, ridge, color) {
  canvas.polygon([...ridge, [canvas.w + 1, canvas.h], [-1, canvas.h]], color);
}

function height(ridge, x) {
  for (let i = 1; i < ridge.length; i++) {
    const [bx, by] = ridge[i];
    const [ax, ay] = ridge[i - 1];
    if (x <= bx) return Math.round(ay + (by - ay) * (x - ax) / (bx - ax));
  }
  return ridge.at(-1)[1];
}

function pine(c, x, base, size, shadow, light) {
  const top = base - size;
  const radius = Math.max(2, Math.round(size * 0.21));
  c.rect(x, top, 1, size, shadow);
  for (const [from, to, spread] of [[0, 0.38, 0.46], [0.16, 0.60, 0.70], [0.34, 0.79, 0.88], [0.47, 0.91, 1]]) {
    const y = Math.round(top + size * from);
    const end = Math.round(top + size * to);
    const half = Math.max(1, Math.round(radius * spread));
    c.polygon([[x, y], [x + half + 1, end - 1], [x + half - 1, end - 1], [x + half - 1, end + 1],
      [x + 1, end], [x - half + 1, end + 1], [x - half, end - 1]], shadow);
    if (light && size > 12) {
      c.polygon([[x, y + 1], [x + half + 1, end - 1], [x + Math.round(half / 2), end - 1],
        [x + Math.round(half / 2), end - 3], [x, end - 4]], light);
    }
  }
  if (size > 24) c.rect(x - 1, base - 4, 3, 5, shadow);
}

function cloud(c, x, y, size) {
  const layers = [[0, 7, 46, 2], [6, 5, 35, 3], [14, 3, 17, 3], [17, 1, 10, 3], [30, 4, 7, 2]];
  for (const [dx, dy, w, h] of layers) c.rect(x + dx * size, y + dy * size, w * size, h * size, "#ffddb2");
  c.rect(x + size * 7, y + size * 9, size * 43, size, "#eab7ad");
  c.rect(x - size * 6, y + size * 10, size * 11, size, "#ffe8be");
}

function landscape() {
  const c = new Canvas(576, 140, "#eaa0a1");
  const rand = random(6042);
  const sky = ["#e9a1a2", "#f0aaa0", "#f6b69f", "#fac29e", "#fbcda3", "#fbd6ad"];
  sky.forEach((v, i) => c.rect(0, i * 12 + 6, 576, 15, v));
  c.rect(0, 81, 576, 59, "#f8d7b4");
  c.disc(413, 37, 19, "#fac9a1");
  c.disc(413, 37, 16, "#ffe5ac");
  c.disc(413, 36, 14, "#ffebbb");
  c.rect(393, 45, 30, 1, "#ffd5a5");
  c.rect(396, 48, 24, 1, "#fbcda3");
  cloud(c, 310, 18, 0.8);
  cloud(c, 347, 31, 0.65);
  cloud(c, 452, 11, 0.85);
  cloud(c, 155, 25, 1);
  cloud(c, 232, 11, 0.55);
  c.rect(374, 51, 26, 1, "#ffe3b6");
  c.rect(433, 35, 16, 1, "#ffe3b6");
  for (const [x, y] of [[387,27],[392,24],[368,39]]) {
    c.rect(x - 2, y - 1, 2, 1, "#ab828d");
    c.rect(x, y, 2, 1, "#ab828d");
    c.rect(x + 2, y - 1, 2, 1, "#ab828d");
  }
  ground(c, [[-1,64],[38,48],[72,66],[99,48],[123,56],[160,35],[177,45],[189,43],[228,69],
    [255,59],[270,61],[301,41],[319,50],[351,30],[365,42],[374,39],[408,61],[432,52],
    [459,32],[469,38],[482,24],[515,50],[544,31],[577,37]], "#c59fa9");
  c.polygon([[301,41],[319,50],[309,49],[302,44],[294,50]], "#e7bab3");
  c.polygon([[351,30],[365,42],[359,40],[356,38],[352,37],[350,35],[342,42]], "#ecc1b5");
  c.polygon([[482,24],[515,50],[497,42],[494,38],[488,35],[484,32],[481,30],[476,35],[478,29]], "#e4b6b2");
  const peaks = [[-1,52],[32,37],[54,42],[75,59],[87,58],[107,71],[143,48],[157,53],[173,64],
    [196,61],[214,53],[225,57],[257,34],[263,32],[279,46],[290,49],[302,63],[314,67],
    [328,59],[339,62],[372,81],[402,75],[429,49],[440,54],[454,42],[481,61],[501,43],[527,58],
    [550,47],[577,55]];
  ground(c, peaks, "#9e8da2");
  c.polygon([[263,32],[279,46],[290,49],[302,63],[314,67],[321,80],[289,64],[282,58],[275,56],[269,44],[261,44],[251,52]], "#c0a2ae");
  c.polygon([[263,32],[273,41],[269,40],[266,38],[263,40],[262,37],[255,41]], "#e6bcb6");
  c.polygon([[429,49],[440,54],[433,54],[437,58],[427,54],[419,60]], "#c9a6af");
  c.polygon([[454,42],[480,61],[470,58],[463,56],[459,49],[452,48],[446,50]], "#c6a1aa");
  const farTrees = [[-1,65],[36,62],[83,77],[115,69],[159,76],[205,65],[237,72],[277,64],[313,80],
    [341,86],[380,79],[407,82],[454,65],[498,76],[541,61],[577,67]];
  ground(c, farTrees, "#897e94");
  for (let x = 0; x < 576; x += 2 + rand(4)) pine(c,x,height(farTrees,x)+1,3+rand(8),"#897e94");
  const middle = [[-1,80],[51,72],[99,83],[137,77],[188,88],[230,82],[256,84],[297,76],[332,86],
    [360,92],[385,88],[422,92],[466,78],[507,79],[551,72],[577,75]];
  ground(c, middle, "#736e86");
  for (let x = 0; x < 576; x += 3 + rand(6)) pine(c,x,height(middle,x)+2,4+rand(11),"#736e86");
  c.polygon([[82,92],[139,88],[211,93],[270,87],[331,91],[380,94],[423,90],[503,93],[552,88],
    [576,99],[576,128],[86,128]], "#b7a5b1");
  for (let n = 0; n < 120; n++) {
    const x = 134 + rand(408), y = 93 + rand(25);
    c.rect(x, y, 3 + rand(15), 1, x > 353 && x < 435 ? "#e9c6ba" : "#ccbac0");
  }
  const near = [[-1,69],[35,75],[70,84],[108,80],[149,92],[198,97],[245,92],[279,104],[316,109],
    [333,115],[362,121],[393,120],[435,106],[476,96],[504,93],[542,80],[577,78]];
  ground(c, near, "#565771");
  for (let x = 0; x < 576; x += 4 + rand(7)) {
    if (x < 335 || x > 440) pine(c,x,height(near,x)+2,7+rand(17),"#565771","#65637a");
  }
  const bank = [[-1,91],[20,85],[51,89],[79,97],[121,100],[154,109],[187,112],[210,119],[248,116],
    [276,126],[312,129],[342,137],[365,137],[390,127],[410,120],[426,116],[444,106],[466,102],
    [478,100],[495,102],[510,96],[525,96],[545,90],[577,86]];
  ground(c, bank, "#4d515c");
  c.polygon([[365,140],[389,126],[410,120],[427,116],[444,106],[465,102],[479,100],[496,102],[512,96],
    [525,96],[545,90],[577,86],[577,94],[550,96],[537,102],[515,101],[494,109],[470,108],[450,112],
    [432,119],[412,122],[391,132],[379,140]], "#939479");
  c.polygon([[394,140],[416,127],[432,123],[426,120],[431,116],[453,109],[466,106],[477,106],[482,104],
    [476,103],[488,103],[489,106],[471,109],[469,112],[447,114],[433,118],[434,121],[443,123],[421,130],
    [411,140]], "#c99b78");
  c.polygon([[419,140],[439,130],[457,125],[475,118],[501,118],[512,109],[539,108],[550,102],[577,100],
    [577,140]], "#3c414e");
  for (let i = 0; i < 190; i++) {
    const x = rand(576), y = height(bank,x) + 3 + rand(26);
    c.rect(x,y,1+rand(4),1,["#62645f","#706a67","#585760"][rand(3)]);
  }
  for (const [x,h] of [[2,43],[13,27],[30,37],[53,22],[78,30],[93,20],[119,25],[145,14],[177,18],
    [221,16],[268,10],[304,10],[535,26],[546,39],[559,34],[569,49],[578,39]]) {
    pine(c,x,height(bank,x)+4,h,"#3e4053","#534e5e");
  }
  // A canvas tent, guy lines, a pennant and a small fire on the trail lookout.
  c.polygon([[468,103],[482,84],[491,82],[506,100],[498,103]], "#594552");
  c.polygon([[465,102],[479,82],[488,80],[503,99],[492,101]], "#de9368");
  c.polygon([[479,82],[488,80],[503,99],[494,99]], "#f5b47c");
  c.polygon([[465,102],[479,82],[491,101]], "#ffc384");
  c.polygon([[471,101],[479,87],[485,101]], "#624650");
  c.polygon([[471,101],[478,88],[475,100]], "#935c55");
  c.rect(464,102,31,1,"#7f605a");
  c.rect(489,80,1,2,"#554952");
  c.polygon([[488,81],[510,100],[509,100]], "#806966");
  c.rect(509,99,1,3,"#725550");
  c.rect(508,67,2,32,"#665357");
  c.rect(509,67,1,30,"#c79b79");
  c.polygon([[510,68],[516,68],[521,70],[529,69],[526,72],[528,74],[519,75],[515,73],[510,73]], "#d9785b");
  c.rect(510,68,6,1,"#ffd087");
  c.rect(508,65,2,2,"#ffe5a9");
  c.rect(453,106,9,2,"#755247");
  c.rect(455,102,5,5,"#d87b56");
  c.rect(456,99,2,7,"#f3ac61");
  c.rect(459,101,1,4,"#ef9857");
  c.rect(457,103,2,4,"#ffdc8b");
  c.rect(458,95,1,2,"#efb87e");
  for (const [x,y] of [[446,108],[464,110],[501,104],[515,99],[523,101],[534,94]]) {
    c.rect(x,y-2,1,3,"#696b58"); c.rect(x,y-2,2,1,"#e8b882");
  }
  return c;
}

function campsite() {
  const c = new Canvas(148, 61, "#302738");
  const rand = random(812);
  for (let i = 0; i < 30; i++) c.rect(rand(148), rand(38), 1, 1, "#59495c");
  for (const [x,y] of [[33,12],[80,7],[104,17]]) {
    c.rect(x-1,y,3,1,"#806570"); c.rect(x,y-1,1,3,"#806570");
  }
  const hills = [[-1,44],[15,39],[26,42],[42,32],[60,40],[76,38],[95,46],[115,36],[129,41],[148,36]];
  ground(c,hills,"#3a3042");
  for (const [x,h] of [[7,17],[15,21],[29,11],[112,13],[127,21],[139,26]]) pine(c,x,49,h,"#4b3e50");
  ground(c,[[-1,52],[23,47],[45,51],[61,48],[81,51],[111,47],[138,50],[149,47]],"#403443");
  c.polygon([[37,51],[49,33],[57,33],[70,51]],"#7f636b");
  c.polygon([[49,33],[57,33],[70,51],[59,51]],"#997674");
  c.polygon([[41,51],[49,38],[55,51]],"#463848");
  c.rect(73,53,11,1,"#8e6e67"); c.rect(75,52,8,1,"#a47b69");
  c.rect(76,47,5,5,"#de9867"); c.rect(77,44,2,6,"#df9b69"); c.rect(79,48,2,4,"#ffd18c");
  c.rect(81,41,1,2,"#d08e6d"); c.rect(77,37,1,1,"#8c6a69");
  for(let i=0;i<35;i++) c.rect(rand(148),54+rand(6),1+rand(4),1,"#584453");
  return c;
}

if (require.main === module) {
  const dir = path.join(__dirname, "..", "assets");
  fs.writeFileSync(path.join(dir, "highland-dusk.png"), landscape().png());
  fs.writeFileSync(path.join(dir, "night-camp.png"), campsite().png());
}
module.exports = { landscape, campsite };
