(function (root) {
  'use strict';
  const G = root.CupMeshes, L = root.CupLesson;
  function path(ctx,points) {
    ctx.beginPath();
    points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  }
  function line(ctx,points,color,width=1,dash=[]) {
    path(ctx,points); ctx.strokeStyle=color; ctx.lineWidth=width;
    ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function fill(ctx,points,color) {
    path(ctx,points); ctx.closePath(); ctx.fillStyle=color; ctx.fill();
  }
  function arrowHead([x,y], [a,b], size) {
    const length = Math.hypot(a-x,b-y);
    if (length < 0.01) return [];
    const head = Math.min(size,length*0.48);
    const dx = (a-x)*head/length, dy = (b-y)*head/length;
    return [[a-dx+0.5*dy,b-dy-0.5*dx],[a,b],[a-dx-0.5*dy,b-dy+0.5*dx]];
  }

  // Cup elevations all use the same rim, floor and optional floor flex.
  function cupOutline(cx, floorY, unit, taper = 1, flex = 0) {
    const lip = G.innerRadiusAt(G.HEIGHT,taper) * unit, foot = G.innerRadiusAt(G.FLOOR,taper);
    const atY = y => floorY - (y - G.FLOOR) * unit;
    const floorXs = flex ? [-foot,-foot/2,0,L.gapProbe.x,foot] : [-foot,foot];
    return [[cx-lip,atY(G.HEIGHT)],...floorXs.map(x => [cx+x*unit,atY(L.floorAt(x,flex))]),[cx+lip,atY(G.HEIGHT)]];
  }
  function blockOutline(cx, floorY, unit, fit, lift = 0) {
    const edge = side => fit.outline.map(([r,y]) => [cx+side*r*unit, floorY-(y+lift-G.FLOOR)*unit]);
    return [...edge(-1), ...edge(1).reverse()];
  }
  root.CupDrawing = {path, line, fill, cupOutline, blockOutline, arrowHead};
})(globalThis);
