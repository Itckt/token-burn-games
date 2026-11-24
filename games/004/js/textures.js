(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./city.js'));
  else root.HarbourTextures = factory(root.HarbourMath, root.HarbourCity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, City) {
  'use strict';
  const TILE = 512, COLS = 16, FLOORS = 24;
  const paints = ['#29333a','#31404a','#253944','#343a3c','#283a41','#3d4142','#293d48','#29373d'];
  const panes = ['#162832','#223943','#20333c','#31464c','#1b2e38','#2a4047'];
  const gold = ['#ffe0ab','#eeb779','#db9a64','#f7cf95','#b68d64','#e9bca0','#ffe6b3'];
  const cool = ['#b7ddd2','#9accc1','#b9d7d8','#7baab1','#94bfca','#d9d8bc','#b0baa5'];
  function surface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  function facadePattern(tile, seed) {
    const rng = M.random((seed + Math.imul(tile+1, 7919)) >>> 0);
    const type = tile % 4;
    const cells = [];
    for (let row=0; row<FLOORS; row++) {
      const floorLight = rng();
      const occupancy = (type === 2 ? 0.20 : 0.17) + floorLight * (type === 2 ? 0.55 : 0.32);
      let previous = false;
      for (let col=0; col<COLS; col++) {
        const lit = rng() < occupancy * (previous && type === 2 ? 1.45 : 1);
        previous = lit;
        const palette = lit ? (rng() < (type === 2 ? 0.36 : 0.70) ? gold : cool) : panes;
        cells.push({lit, color: palette[Math.floor(rng()*palette.length)], shade: rng(),
          blind: rng() < 0.24, split: rng() < 0.63, ac: type !== 2 && rng() < 0.22});
      }
    }
    return cells;
  }
  function atlasSize(designSize, limit) {
    return 2 ** Math.floor(Math.log2(Math.min(designSize, limit)));
  }
  function facadeAtlas(seed, limit = TILE * 4) {
    const size = atlasSize(TILE * 4, limit);
    const canvas = surface(size,size);
    const ctx = canvas.getContext('2d');
    ctx.scale(size / (TILE * 4), size / (TILE * 4));
    const cw = TILE / COLS, ch = TILE / FLOORS;
    for (let tile=0; tile<16; tile++) {
      const type = tile%4, cells = facadePattern(tile, seed);
      ctx.save();
      ctx.translate((tile%4)*TILE, Math.floor(tile/4)*TILE);
      ctx.fillStyle = paints[tile%paints.length];
      ctx.fillRect(0,0,TILE,TILE);
      for (let row=0; row<FLOORS; row++) {
        const y = row*ch;
        ctx.fillStyle = type===2 ? '#152b36' : 'rgba(9,18,23,0.75)';
        ctx.fillRect(0,y+ch-2.5,TILE,type===2 ? 1.4 : 2.5);
        ctx.fillStyle = 'rgba(169,183,177,0.15)';
        ctx.fillRect(0,y+ch-1,TILE,1);
        for (let col=0; col<COLS; col++) {
          const cell = cells[row*COLS+col];
          const x = col*cw;
          const inset = [5.4,6.5,1.2,4.1][type];
          const w = cw-inset*2, h = ch*[0.56,0.67,0.78,0.49][type];
          const left = x+inset, top = y+[3.1,2.7,1.1,4][type];
          ctx.fillStyle = '#15242b';
          ctx.fillRect(left-1.3,top-1.2,w+2.6,h+2.5);
          ctx.fillStyle = cell.color;
          ctx.fillRect(left,top,w,h);
          ctx.fillStyle = 'rgba(14,32,38,'+(0.08+cell.shade*0.33)+')';
          ctx.fillRect(left,top,w,h);
          if (cell.blind) {
            ctx.fillStyle = 'rgba(24,41,46,0.56)';
            ctx.fillRect(left,top,w,h*(0.24+cell.shade*0.39));
          }
          if (cell.split) {
            ctx.fillStyle = 'rgba(20,35,39,0.84)';
            ctx.fillRect(left+w*0.54,top,1.4,h);
          }
          if (cell.lit && cell.shade > 0.71) {
            ctx.fillStyle = 'rgba(255,239,185,0.49)';
            ctx.fillRect(left+1,top+1,w-2,1.7);
          }
          if (cell.ac) {
            ctx.fillStyle = '#13272c'; ctx.fillRect(x+cw-8,y+ch-7,8,4.8);
            ctx.fillStyle = '#62706c'; ctx.fillRect(x+cw-7.5,y+ch-7.7,6.6,3.1);
            ctx.fillStyle = '#394b4d'; ctx.fillRect(x+cw-6.6,y+ch-6.4,4.8,0.8);
          }
          if (type===1 && col%4===0) {
            ctx.fillStyle = '#52605d'; ctx.fillRect(x+0.7,y,1.6,ch);
          }
          if (type===3 && row%3===0) {
            ctx.fillStyle = '#47585c'; ctx.fillRect(x,y+ch-4,cw,1.65);
          }
        }
      }
      ctx.restore();
    }
    return canvas;
  }
  const inks = {
    coral: ['#411c20','#ff452e','#ffb195'], jade: ['#132e30','#45d7bd','#c0ffdc'],
    gold: ['#3b2a20','#ffb456','#ffdf92'], pink: ['#3b2132','#f677a6','#ffd0d9'],
    blue: ['#162a3e','#58b5ea','#d1efff']
  };
  const hanFont = '"Microsoft JhengHei","Noto Sans HK","PingFang TC","Heiti TC",sans-serif';
  function signAtlas(limit = 1024) {
    const size = atlasSize(1024, limit);
    const canvas = surface(size,size), ctx = canvas.getContext('2d');
    ctx.scale(size / 1024, size / 1024);
    ctx.fillStyle = '#111b21'; ctx.fillRect(0,0,1024,1024);
    City.signDesigns.forEach((design,id) => {
      const r = City.signRect(id), [base, tube, core] = inks[design.color];
      const vertical = design.type==='vertical';
      ctx.save(); ctx.translate(r.x,r.y);
      ctx.fillStyle = base; ctx.fillRect(0,0,r.w,r.h);
      ctx.strokeStyle = tube; ctx.shadowColor = tube; ctx.shadowBlur = 9;
      ctx.lineWidth = 3.4; ctx.strokeRect(6,6,r.w-12,r.h-12);
      ctx.lineWidth = 1.1; ctx.strokeStyle = core; ctx.strokeRect(10,10,r.w-20,r.h-20);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const type = (word,x,y,size) => {
        ctx.font = '600 '+size+'px '+hanFont;
        ctx.shadowBlur = 12; ctx.strokeStyle = tube; ctx.lineWidth = 3.5; ctx.strokeText(word,x,y);
        ctx.shadowBlur = 0; ctx.fillStyle = core; ctx.fillText(word,x,y);
      };
      if (vertical) {
        const glyphs = Array.from(design.han);
        glyphs.forEach((ch,j) => type(ch,r.w/2,102+j*142,133));
        ctx.strokeStyle = tube; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(21,r.h-71); ctx.lineTo(r.w-21,r.h-71); ctx.stroke();
        ctx.font = 'bold 20px Arial,sans-serif'; ctx.fillStyle = core; ctx.fillText(design.latin,r.w/2,r.h-40);
      } else {
        const glyphs = Array.from(design.han), cell = (r.w-45)/glyphs.length;
        glyphs.forEach((ch,j) => type(ch,22+cell*(j+0.5),58,82));
        ctx.font = 'bold 15px Arial,sans-serif'; ctx.fillStyle = core; ctx.fillText(design.latin,r.w/2,r.h-26);
      }
      ctx.restore();
    });
    return canvas;
  }
  function noisePixels(seed, size=128) {
    const rng = M.random(seed), out = new Uint8Array(size*size*4);
    for (let i=0;i<out.length;i+=4) {
      out[i]=Math.floor(rng()*256); out[i+1]=Math.floor(rng()*256); out[i+2]=Math.floor(rng()*256); out[i+3]=255;
    }
    return out;
  }
  return {facadePattern, facadeAtlas, signAtlas, atlasSize, noisePixels, COLS, FLOORS};
});
