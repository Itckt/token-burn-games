(function (root) {
  'use strict';
  const G = root.CupMeshes, M = root.CupMath, P = root.CupPacking, D = root.CupDesign;
  const {line, fill, cupOutline, blockOutline, arrowHead} = root.CupDrawing;
  const ink = '#4d6355', orange = '#a95730';

  function scanViews(ctx, scan, fit) {
    const cx = 49, cy = 58, pixelsPerMM = 0.8;
    const unit = pixelsPerMM * P.mmPerUnit, radius = scan.radius * unit;
    ctx.beginPath(); ctx.arc(cx,cy,radius,0,M.TAU);
    ctx.fillStyle = '#303d48'; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = '#c8b9e6'; ctx.stroke();
    line(ctx,[[cx-radius,cy],[cx+radius,cy]],'#687381',0.65,[2,3]);
    line(ctx,[[cx,cy-radius],[cx,cy+radius]],'#687381',0.65,[2,3]);
    ctx.beginPath();
    const {strokes} = scan;
    for (let i=0; i<strokes.length; i+=4) {
      ctx.moveTo(cx+strokes[i]*unit,cy+strokes[i+1]*unit);
      ctx.lineTo(cx+strokes[i+2]*unit,cy+strokes[i+3]*unit);
    }
    ctx.lineWidth = 0.85; ctx.strokeStyle = '#ffcb7b'; ctx.stroke();

    // The two views share a scale. The side silhouette locates the sheet even
    // when the WebGL stage has been replaced by this drawing.
    const sideX = 141, sideY = height => 98 - (height-G.FLOOR)*unit;
    const side = blockOutline(sideX,98,unit,fit);
    fill(ctx,side,'#796953'); line(ctx,[...side,side[0]],'#d1ab78',1);
    line(ctx,cupOutline(sideX,98,unit,fit.taper),'#b6c7c1',1.2);
    const y = sideY(scan.height);
    line(ctx,[[sideX-radius-3,y],[sideX+radius+3,y]],'#d9baf4',1.6);
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#f7f4ea';
    ctx.font = 'bold 10.5px "Segoe UI", sans-serif';
    ctx.fillText('Plan view',16,8); ctx.fillText('Side view',110,8);
    ctx.font = '9px Consolas, monospace'; ctx.fillStyle = '#e6cef6'; ctx.textAlign = 'right'; ctx.fillText(scan.heightLabel,222,y < 30 ? y+10 : y-8);
    ctx.textAlign = 'left';
    const bar = 20 * pixelsPerMM;
    line(ctx,[[18,103],[18,107],[18+bar,107],[18+bar,103]],'#deeadf',1);
    ctx.fillStyle = '#deeadf'; ctx.fillText('20 mm',24+bar,106);
  }

  function pressViews(ctx, scene) {
    const pixelsPerMM = 0.76, unit = pixelsPerMM * P.mmPerUnit, floor = 95;
    const atY = y => floor - (y - G.FLOOR) * unit;
    function specimen(cx, fit, press, label) {
      const cupEdge = y => G.innerRadiusAt(y,fit.taper) * unit;
      const foot = cupEdge(G.FLOOR), cup = cupOutline(cx,floor,unit,fit.taper);
      fill(ctx,cup,'#fffaf0');
      const y = atY(press.surfaceY), pad = cupEdge(press.surfaceY);
      fill(ctx,[[cx-pad,y],[cx+pad,y],cup[2],cup[1]],'#daab82');
      const cake = blockOutline(cx,floor,unit,fit,press.lift);
      fill(ctx,cake,'#e6b570'); line(ctx,[...cake,cake[0]],'#9a643c',1);
      line(ctx,cup,ink,1.35);
      line(ctx,[[cx-pad,y],[cx+pad,y]],orange,1.7);
      if (press.liftMM > 0) {
        const rest = atY(fit.bottom);
        line(ctx,[[cx-foot-3,rest],[cx+foot+3,rest]],ink,0.8,[2,2]);
      } else if (!press.touching) {
        const bottom = atY(fit.bottom);
        line(ctx,[[cx,bottom],[cx,y]],ink,0.9,[2,2]);
        for (const h of [bottom,y]) line(ctx,[[cx-3,h],[cx+3,h]],ink);
      }
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='bold 10.5px "Segoe UI", sans-serif'; ctx.fillStyle=ink;
      ctx.fillText(label,cx,8);
      ctx.font='10px Consolas, monospace'; ctx.fillStyle=orange;
      ctx.fillText('Lift '+D.gapLabel(press.liftMM),cx,107);
    }
    specimen(55,scene.reference.fit,scene.reference.press,scene.reference.fit.diameter+' mm floor fit');
    specimen(168,scene.fit,scene.press,scene.fit.diameter+' mm test fit');
  }

  function forceView(ctx, scene) {
    const {fit,forces} = scene;
    const cx = 55, floor = 100, unit = 84 / (G.HEIGHT-G.FLOOR);
    const project = ([x,y]) => [cx+x*unit, floor-(y-G.FLOOR)*unit];
    const cup = cupOutline(cx,floor,unit,fit.taper), block = blockOutline(cx,floor,unit,fit);
    fill(ctx,cup,'#fffaf0'); fill(ctx,block,'#f1d7a8');
    line(ctx,[...block,block[0]],'#ae8050',0.85);
    line(ctx,cup,ink,1.4);
    for (const {tail,tip,kind} of forces.arrows) {
      const a = project(tail), b = project(tip);
      const color = kind === 'weight' ? '#a24628' : '#216c65';
      line(ctx,[a,b],color,2.1); line(ctx,arrowHead(a,b,5),color,2.1);
    }
    ctx.textBaseline='middle';
    ctx.fillStyle=ink; ctx.font='bold 11px "Segoe UI", sans-serif';
    ctx.fillText(fit.onFloor ? 'From the floor' : 'From each wall',112,19);
    // A common axis stays fixed as the test mass changes at the same seat.
    const left=112, right=214;
    const scaleN=Math.ceil(Math.max(forces.upN,forces.inwardN)*D.maxMassG/forces.massG);
    ctx.lineCap='butt';
    for (const [label,value,y] of [['Upward',forces.upN,39],['Inward',forces.inwardN,68]]) {
      ctx.textAlign='left'; ctx.fillStyle=ink; ctx.font='10px "Segoe UI", sans-serif';
      ctx.fillText(label,left,y);
      ctx.textAlign='right'; ctx.fillStyle='#216c65'; ctx.font='bold 10px Consolas, monospace';
      ctx.fillText(value.toFixed(2)+' N',right,y);
      line(ctx,[[left,y+10],[right,y+10]],'#d6e2d7',5);
      line(ctx,[[left,y+10],[M.lerp(left,right,value/scaleN),y+10]],'#216c65',5);
    }
    line(ctx,[[left,93],[left,90],[right,90],[right,93]],ink,0.8);
    ctx.fillStyle=ink; ctx.font='9px Consolas, monospace';
    ctx.fillText(scaleN+' N',right,102); ctx.textAlign='left'; ctx.fillText('0',left,102);
  }

  const mapColors = ['#b34327','#edab4d','#4d7a75'];
  function clearanceDial(ctx, map) {
    const cx = 48, cy = 51, r = 31;
    const step = M.TAU / map.gaps.length;
    ctx.lineCap = 'butt';
    map.gaps.forEach((gap,i) => {
      const end = Math.PI/2 - i*step;
      ctx.beginPath(); ctx.arc(cx,cy,r,end-step+0.017,end-0.017);
      ctx.lineWidth = 9;
      ctx.strokeStyle = gap === null ? '#d9ddd0' : mapColors[gap <= D.closeMM ? 0 : gap <= D.nearMM ? 1 : 2];
      ctx.stroke();
    });
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = 'bold 10px "Segoe UI", sans-serif'; ctx.fillStyle = ink;
    ctx.fillText('Plan view',cx,cy);
    line(ctx,[[cx,cy+r+6],[cx,92]],ink);
    ctx.font = '9px Consolas, monospace'; ctx.fillText('Front',cx,99);
    ctx.textAlign = 'left'; ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.fillText('Distance to lining',99,21);
    ctx.font = '10px Consolas, monospace';
    const labels = ['≤ '+D.closeMM+' mm','> '+D.closeMM+' to '+D.nearMM+' mm','> '+D.nearMM+' mm'];
    labels.forEach((label,i) => {
      const y = 42+20*i;
      ctx.fillStyle = mapColors[i]; ctx.fillRect(100,y-4,12,8);
      ctx.fillStyle = ink; ctx.fillText(label,119,y);
    });
  }

  function finderChart(ctx, brief, diameter) {
    const {sizes, matches, pocketML, roomMM} = brief;
    const left = 27, right = 212, top = 20, bottom = 91;
    const maxML = Math.max(D.maxPocketML, ...sizes.map(s => 50*Math.ceil(s.capacityML/50)));
    const x = ml => M.lerp(left,right,ml/maxML), y = mm => M.lerp(bottom,top,mm/D.maxRoomMM);
    ctx.fillStyle = '#fcfbf4'; ctx.fillRect(left,top,right-left,bottom-top);
    ctx.fillStyle = '#d2e4d0'; ctx.fillRect(x(pocketML),top,right-x(pocketML),y(roomMM)-top);
    line(ctx,[[x(pocketML),bottom],[x(pocketML),top]],ink,0.8,[2,2]);
    line(ctx,[[left,y(roomMM)],[right,y(roomMM)]],ink,0.8,[2,2]);
    line(ctx,[[left,top],[left,bottom],[right,bottom]],ink,1.1);
    const points = sizes.map(s => [x(s.capacityML),y(s.headroomMM)]);
    line(ctx,points,'#897b66',1);
    function dot(px,py,r,color) {
      ctx.beginPath(); ctx.arc(px,py,r,0,M.TAU); ctx.fillStyle = color; ctx.fill();
    }
    sizes.forEach((s,i) => dot(...points[i],1.8,matches.includes(s) ? '#346044' : '#8e806d'));
    const selected = sizes.findIndex(s => s.diameter === diameter);
    const [px,py] = points[selected];
    dot(px,py,4.1,orange); ctx.strokeStyle = '#fff9e7'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 10px "Segoe UI", sans-serif'; ctx.fillText('Room above (mm)',left,9);
    dot(170,9,2.9,orange); ctx.fillStyle = ink; ctx.fillText(diameter+' mm',177,9);
    ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'right';
    ctx.fillText(String(D.maxRoomMM),left-4,top); ctx.fillText('0',left-4,bottom);
    ctx.fillText(String(maxML),right,bottom+9);
    ctx.textAlign = 'left'; ctx.fillText('0',left,bottom+9);
    ctx.textAlign = 'center'; ctx.fillText('Pocket capacity (mL)',(left+right)/2,bottom+12);
  }
  root.CupBenchViews = {scanViews, pressViews, forceView, clearanceDial, finderChart};
})(globalThis);
