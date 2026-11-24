(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./simulation.js'));
  else root.Atlas.postcard = factory(root.Atlas.sim);
})(globalThis, function (sim) {
  'use strict';

  function caption(place, state, zoom, lookout = null) {
    const bearing = sim.bearing(state.yaw);
    const degrees = String(bearing.degrees).padStart(3,'0');
    const shifting = state.light > .02 && state.light < .98;
    const light = shifting ? (state.night ? 'Dusk' : 'Dawn') : (state.light >= .98 ? 'Night' : 'Day');
    const sky = state.weather.wet <= .02 ? 'Clear' : state.weather.shower ? 'Shower' : 'Clearing';
    return {
      name: place.name, lookout,
      detail: [light, sky, bearing.label+' '+degrees+'°', zoom+'×'].join('  ·  '),
      filename: ['campus-atlas',place.id,light.toLowerCase(),sky.toLowerCase(),degrees].join('-')+(lookout ? '-study' : '')+'.png'
    };
  }
  function layout(sourceWidth, sourceHeight) {
    if (![sourceWidth,sourceHeight].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Empty camera frame');
    const scale = Math.min(1, 1440 / Math.max(sourceWidth,sourceHeight));
    const w = Math.max(1,Math.round(sourceWidth*scale)), h = Math.max(1,Math.round(sourceHeight*scale));
    const rim = Math.max(12,Math.round(Math.min(w,h)*.035));
    const width = Math.max(360,w+2*rim), unit = Math.max(.8,width/900);
    return {width, height:h+rim+Math.ceil(112*unit), x:(width-w)/2, y:rim, w, h, rim, unit};
  }
  function print(sheet, scene, info) {
    const p = layout(scene.width,scene.height);
    sheet.width=p.width; sheet.height=p.height;
    const ctx=sheet.getContext('2d');
    ctx.fillStyle='#f6f0df';
    ctx.fillRect(0,0,p.width,p.height);
    ctx.drawImage(scene,p.x,p.y,p.w,p.h);
    ctx.save();
    ctx.translate(p.rim,p.y+p.h);
    ctx.scale(p.unit,p.unit);
    const span=(p.width-2*p.rim)/p.unit;
    ctx.fillStyle='#875a40';
    ctx.font='600 11px "Segoe UI", sans-serif';
    const imprint=info.lookout ? info.lookout.study.name.toUpperCase() : 'KOWLOON TONG';
    ctx.fillText('CAMPUS ATLAS   /   '+imprint,0,25,span-65);
    ctx.fillStyle='#294639';
    ctx.font='34px Georgia, serif';
    ctx.fillText(info.name,0,64,span-65);
    ctx.fillStyle='#566358';
    ctx.font='14px Consolas, monospace';
    ctx.fillText(info.detail,0,89,span-65);
    // A small printer's mark beside the caption, in the same ink as the heading.
    ctx.translate(span-24,56);
    ctx.strokeStyle='#9e684b'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(0,0,21,0,2*Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-15,7); ctx.lineTo(-4,-10); ctx.lineTo(3,0);
    ctx.lineTo(8,-6); ctx.lineTo(15,7); ctx.closePath(); ctx.stroke();
    ctx.restore();
    return p;
  }
  return {caption, layout, print};
});
