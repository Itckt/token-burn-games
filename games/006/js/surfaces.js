(function () {
  'use strict';
  const { seeded } = Nightline.math;
  const W = 512, H = 256;
  const CJK = '"Microsoft JhengHei", "PingFang HK", "Noto Sans CJK TC", sans-serif';
  const SANS = '"Bahnschrift", "Arial", sans-serif';
  const MONO = '"Consolas", monospace';

  function makeAtlas() {
    const atlas = document.createElement('canvas');
    atlas.width = W * 4; atlas.height = H * 8;
    const out = atlas.getContext('2d', { alpha: false });
    out.fillStyle = '#e4e3dc'; out.fillRect(0, 0, atlas.width, atlas.height);
    const tile = document.createElement('canvas'); tile.width = W; tile.height = H;
    const g = tile.getContext('2d', { alpha: false });
    let rand;
    const rect = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    function line(x0, y0, x1, y1, color, width = 1) {
      g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    function type(text, x, y, size, color, weight = 600, family = SANS) {
      g.fillStyle = color; g.font = `${weight} ${size}px ${family}`; g.fillText(text, x, y);
    }
    function dot(x, y, radius, color) {
      g.fillStyle = color; g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill();
    }
    function polygon(points, color) {
      g.fillStyle = color; g.beginPath(); g.moveTo(...points[0]);
      for (const p of points.slice(1)) g.lineTo(...p);
      g.closePath(); g.fill();
    }
    function cell(id, fn) {
      rand = seeded(1903 + id); g.save(); rect(0, 0, W, H, '#fff'); fn(); g.restore();
      out.drawImage(tile, (id % 4) * W, Math.floor(id / 4) * H);
    }
    function grain(base, amplitude) {
      const pixels = g.createImageData(W, H);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const n = base + amplitude * (rand() - 0.5);
        pixels.data[i] = n; pixels.data[i + 1] = n; pixels.data[i + 2] = n; pixels.data[i + 3] = 255;
      }
      g.putImageData(pixels, 0, 0);
    }
    function tiles(size, base, spread, grout) {
      rect(0, 0, W, H, grout);
      for (let y = 0; y < H; y += size) for (let x = 0; x < W; x += size) {
        const k = (rand() - 0.5) * spread;
        const color = `rgb(${base.map(v => Math.round(v + k)).join(',')})`;
        rect(x + 1.4, y + 1.6, size - 2.1, size - 2.4, color);
        rect(x + 2, y + 2, size - 3.3, 1.1, 'rgba(255,255,255,.18)');
        rect(x + 2, y + 2, 0.9, size - 3.2, 'rgba(255,255,255,.11)');
      }
    }
    function bolt(x, y) {
      dot(x, y + 1, 3.2, '#969997'); dot(x, y, 2.7, '#575c59'); dot(x, y - 0.5, 1.7, '#bfc1bc');
    }
    cell(0, () => grain(251, 8));
    cell(1, () => {
      grain(216, 33);
      for (let i = 0; i < 400; i++) {
        const x = rand() * W, y = rand() * H;
        rect(x, y, rand() * 2.6 + 0.4, rand() * 50 + 1, `rgba(39,42,39,${rand() * 0.12})`);
      }
      rect(0, 0, W, 3, '#888b83'); rect(0, 3, W, 2, '#eeeeea'); rect(0, 0, 3, H, '#979b93');
      for (const x of [26, 255, 485]) for (const y of [18, 233]) {
        dot(x, y, 3.3, '#a8a9a4'); dot(x, y - 0.9, 2.3, '#797e77');
      }
      for (let i = 0; i < 8; i++) {
        const x = rand() * W, w = 8 + rand() * 53;
        const wash = g.createLinearGradient(x, 0, x + w, 0);
        wash.addColorStop(0, 'rgba(65,63,57,0)'); wash.addColorStop(0.6, 'rgba(65,63,57,.075)'); wash.addColorStop(1, 'rgba(65,63,57,0)');
        rect(x, 0, w, H, wash);
      }
    });
    cell(2, () => tiles(32, [234, 237, 233], 27, '#9aaca2'));
    cell(3, () => {
      grain(229, 11); rect(0, 0, 2, H, '#929b96'); rect(0, 0, W, 2, '#9da5a1');
      for (const x of [7, 505]) for (const y of [7, 249]) bolt(x, y);
      for (let i = 0; i < 75; i++) rect(rand() * W, rand() * H, rand() * 120, 0.5, 'rgba(255,255,255,.18)');
    });
    cell(4, () => {
      grain(100, 76);
      for (let i = 0; i < 11000; i++) {
        const x = rand() * W, y = rand() * H, r = 0.6 + rand() * 4.5;
        const v = Math.round(85 + rand() * 112);
        polygon([[x-r,y],[x-0.3*r,y-0.65*r],[x+r,y-0.22*r],[x+0.4*r,y+r*0.66]], `rgb(${v},${v},${v-3})`);
      }
    });
    cell(5, () => {
      grain(229, 20);
      for (let y = 0; y < H; y += 64) {
        rect(0, y, W, 2, '#8e918a');
        for (let x = (y % 128 ? 64 : 0); x < W; x += 128) rect(x, y, 2, 64, '#a2a59f');
      }
    });
    cell(6, () => { grain(195, 15); for (let y = 0; y < H; y += 18) { rect(0, y, W, 5, '#62706e'); rect(0, y+5, W, 2, '#f0f0e9'); } });
    cell(7, () => {
      grain(222, 16);
      for (let y = 14; y < H; y += 32) for (let x = 14; x < W; x += 32) {
        dot(x, y + 2, 6.3, '#899084'); dot(x, y, 5.6, '#eee9dd'); dot(x - 0.8, y - 1, 3.7, '#f6efdf');
      }
    });
    Nightline.ride.STATIONS.forEach((station, i) => {
      cell(8 + i, () => {
        const base = station.tile.map(v => Math.round(v * 236));
        tiles(18, base, 12, `rgb(${base.map(v => Math.round(v * 0.7)).join(',')})`);
        g.scale(W / 820, H / 250);
        type(station.chinese, 31, 148, 116, '#f5f0da', 650, CJK);
        type(station.name, 38, 205, 45, '#f5f0da', 600);
        rect(735, 36, 49, 4, '#edc777'); type('KL', 736, 69, 24, '#f1e7c4', 650, MONO);
      });
      cell(13 + i, () => {
        g.scale(W / 920, H / 236); rect(0, 0, 920, 236, '#e9e8d7');
        rect(0, 0, 12, 236, '#3c796b'); rect(727, 0, 193, 236, '#dcb362');
        type('K O W L O O N   L O O P', 38, 32, 17, '#41645c', 700);
        type(station.chinese, 33, 134, 91, '#172e30', 700, CJK);
        type(station.name, 40, 203, 53, '#172e30', 650);
        type('PLATFORM', 756, 40, 23, '#403f32', 700);
        type('1', 770, 193, 155, '#303b34', 650);
      });
    });
    // Original canteen print and campus court notice for the platform walls.
    cell(18, () => {
      rect(0, 0, W, H, '#cf8b50'); rect(12, 12, 488, 232, '#e2a86a');
      dot(383, 126, 87, '#abc0a4'); dot(383, 126, 68, '#eac89a');
      polygon([[300,153],[365,85],[457,113],[389,185]], '#9c582f');
      polygon([[301,144],[365,76],[458,104],[390,175]], '#f0ce8f');
      for (let i=0;i<42;i++) dot(348+rand()*44,106+rand()*34,rand()*1.6,'#c49055');
      polygon([[356,116],[373,99],[400,107],[384,126]], '#f4b254');
      type('通 宵 茶 檔', 31, 68, 40, '#343d33', 650, CJK); type('MIDNIGHT', 32, 129, 41, '#343d33', 750);
      type('TOAST', 31, 176, 55, '#343d33', 750); type('CAMPUS CANTEEN  /  UNTIL 01.00', 32, 222, 13, '#504738', 650, MONO);
    });
    cell(19, () => {
      rect(0, 0, W, H, '#abc0b5'); rect(252, 12, 245, 232, '#417467');
      g.strokeStyle = '#dedaa5'; g.lineWidth = 4; g.strokeRect(270,26,206,201);
      line(270, 127, 476, 127, '#dedaa5', 3); g.beginPath(); g.arc(373,127,36,0,Math.PI*2); g.stroke();
      for (const [x,y] of [[310,65],[350,91],[420,57],[320,184],[383,162],[432,200]]) dot(x,y,7, y<126?'#efc57e':'#233c37');
      type('AFTER CLASS', 21, 56, 28, '#214439', 700); type('3 × 3', 18, 140, 68, '#214439', 700);
      type('NIGHT COURT', 22, 187, 29, '#214439', 700); type('HKBU  /  CAMPUS GATE', 22, 231, 15, '#29483b', 600, MONO);
    });
    cell(20, () => {
      g.scale(1, 2); rect(0, 0, W, 128, '#223233'); rect(10, 10, 105, 108, '#ddb667');
      type('↗',22,92,88,'#25302b'); type('出口', 138,59,48,'#ebe8d6',650,CJK); type('Way out', 141,101,34,'#ebe8d6');
    });
    cell(21, () => { rect(0,0,W,H,'#d7c795'); type('SERVICE',21,94,77,'#3c4540'); type('K L  /  0 4',24,202,69,'#3c4540',650,MONO); });
    cell(22, () => {
      rect(0,0,W,H,'#1b373a'); rect(10,9,W-20,H-18,'#244346');
      type('CAB 01   /   LINE 04',24,39,22,'#b7ceba',600,MONO);
      line(24,51,488,51,'#73948b',2);
      type('km/h',38,184,22,'#b1c9bb',600,MONO);
      type('STATION',223,184,19,'#b1c9bb',600,MONO);
      line(40,215,472,215,'#85aba1',4);
      for(let i=0;i<5;i++) { dot(40+i*108,215,9,'#132e30'); dot(40+i*108,215,5,'#a1b9ae'); }
    });
    cell(23, () => {
      rect(0,0,W,H,'#45504f'); type('AUXILIARY   /   CAB 01',19,48,23,'#bdc0ae',600,MONO);
      line(18,64,493,64,'#8b978b',2); type('LINE        DOORS       CAB',20,189,22,'#afb8a9',600,MONO);
      for(const x of [14,498]) for(const y of [13,243]) bolt(x,y);
    });
    cell(24, () => {
      rect(0,0,W,H,'#1a292b');
      g.scale(W/1024,H/144);
      type('校園接駁',32,107,90,'#ffdb90',650,CJK);
      type('CAMPUS SHUTTLE',432,98,67,'#f3c47e',650,MONO);
    });
    cell(25, () => {
      grain(235,6);
      for(let i=0;i<35;i++) line(rand()*W,0,rand()*W,H,'rgba(140,178,173,.08)',1+rand()*5);
      const sheen=g.createLinearGradient(0,H,W,0); sheen.addColorStop(0,'#aebfb9'); sheen.addColorStop(.36,'rgba(255,255,255,0)'); sheen.addColorStop(.7,'rgba(255,255,255,.4)'); sheen.addColorStop(1,'#aabeb8'); rect(0,0,W,H,sheen);
    });
    cell(26, () => { rect(0,0,W,H,'#e1c57a'); polygon([[220,48],[316,128],[220,208],[180,208],[277,128],[180,48]],'#48504a'); });
    cell(27, () => {
      rect(0,0,W,H,'#2d3939'); g.scale(1,2);
      rect(0,12,86,105,'#e0b56a'); type('1',21,94,82,'#2b3936');
      type('月台門',112,61,47,'#e8e6d7',650,CJK);
      type('PLATFORM DOORS',114,100,32,'#d9dfd0',650,MONO);
    });
    cell(28, () => {
      grain(141,11);
      for(let y=18;y<246;y+=22) { rect(14,y,484,11,'#313d3d'); rect(17,y+11,478,3,'#a9afa6'); }
      for(const x of [8,504]) for(const y of [9,247]) bolt(x,y);
    });
    // Apartment windows share one repeating facade. Narrow awnings catch the evening light.
    cell(29, () => {
      rect(0, 0, W, H, '#68717b');
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const x = 128 * col, y = 64 * row;
        rect(x + 10, y + 4, 110, 50, '#49515e');
        const panes = ['#405566', '#354858', '#8ca4a5', '#deb876', '#ffdd9e'];
        rect(x + 15, y + 8, 98, 40, panes[Math.floor(rand() * panes.length)]);
        rect(x + 62, y + 8, 5, 40, '#55585b');
        rect(x + 7, y + 51, 116, 4, '#949592');
        rect(x + 78, y + 55, 31, 8, '#838988');
      }
    });
    cell(30, () => {
      rect(0, 0, W, H, '#eac075');
      rect(12, 6, 488, 244, '#223331');
      g.scale(2, 1);
      type('S', 68, 160, 164, '#ffdc93', 750);
      rect(30, 177, 196, 3, '#ba9c67');
      type('STOP MARK', 39, 219, 30, '#f7e9c7', 650, MONO);
    });
    // Ten seven-segment glyphs for the live desk. Each has a black sampling gutter.
    cell(31, () => {
      rect(0, 0, W, H, '#000');
      const segments = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
      const bars = [
        [[23,10],[76,10],[69,18],[30,18]],
        [[78,12],[78,55],[71,60],[71,20]],
        [[78,68],[78,112],[71,105],[71,64]],
        [[22,115],[76,115],[69,107],[29,107]],
        [[20,68],[27,64],[27,105],[20,112]],
        [[20,12],[27,20],[27,60],[20,55]],
        [[23,62],[30,58],[68,58],[75,62],[68,66],[30,66]]
      ];
      segments.forEach((active, digit) => {
        const x = digit % 5 * W / 5, y = Math.floor(digit / 5) * H / 2;
        bars.forEach((bar, i) => polygon(bar.map(([a, b]) => [x + a, y + b]),
          active.includes('abcdefg'[i]) ? '#fff' : '#121212'));
      });
    });
    return atlas;
  }
  // Two independent columns of bilingual lettering. The shader selects rows
  // for the station and the door/approach message from this single upload.
  function makeSaloonAtlas() {
    const { ATLAS_SIZE, ROWS, DIVIDER, stages } = Nightline.saloon;
    const screen = document.createElement('canvas');
    screen.width = screen.height = ATLAS_SIZE;
    const g = screen.getContext('2d', { alpha: false }), h = ATLAS_SIZE / ROWS;
    g.fillStyle = '#102424'; g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    function text(value, x, y, size, ink, family) {
      g.fillStyle = ink; g.font = '600 ' + size + 'px ' + family; g.fillText(value, x, y);
    }
    Nightline.route.STATIONS.forEach((station, row) => {
      const y = row * h;
      g.fillStyle = 'rgb(' + station.tile.map(v => Math.round(110 + v * 145)).join(',') + ')';
      g.fillRect(4, y + 5, 4, h - 10);
      text(station.chinese, 20, y + 32, 28, '#e0ffee', CJK);
      text(station.name, 21, y + 55, 19, '#b2e9d8', SANS);
    });
    for (const stage of stages) {
      const y = stage.row * h, warning = stage.key === 'closing' || stage.key === 'hold';
      g.fillStyle = warning ? '#33291e' : '#1b302f'; g.fillRect(DIVIDER, y, ATLAS_SIZE - DIVIDER, h);
      const ink = warning ? '#ffd08c' : '#b5e5d9';
      text(stage.chinese, DIVIDER + 14, y + 31, 23, ink, CJK);
      text(stage.english, DIVIDER + 15, y + 54, 17, ink, SANS);
    }
    return screen;
  }
  Nightline.surfaces = { makeAtlas, makeSaloonAtlas };
})();
